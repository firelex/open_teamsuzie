import { randomUUID } from 'node:crypto';
import { Agent } from '@teamsuzie/shared-auth';
import type { AgentConfig } from '../config.js';
import { config } from '../config.js';
import { OpenClawClient, type ChatMessage } from './openclaw-client.js';
import type { AdminAgentConfig } from './agents.js';
import type { ConfigService } from './config.js';

export type AgentSource = 'db' | 'env';

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  running: boolean;
  source: AgentSource;
}

interface ResolvedAgent extends AgentConfig {
  source: AgentSource;
  /** Optional system prompt to inject at conversation start (DB agents only). */
  system_prompt?: string;
  /** Per-agent model override (DB agents only). */
  model?: string;
}

function dbAgentToResolved(agent: Agent): ResolvedAgent | null {
  const cfg = (agent.config ?? {}) as AdminAgentConfig;
  const baseUrl = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.replace(/\/$/, '') : '';
  if (!baseUrl) {
    return null;
  }
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description ?? undefined,
    baseUrl,
    apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : undefined,
    openclawAgentId: typeof cfg.openclawAgentId === 'string' ? cfg.openclawAgentId : undefined,
    system_prompt: typeof cfg.system_prompt === 'string' ? cfg.system_prompt : undefined,
    model: typeof cfg.text_model === 'string' ? cfg.text_model : undefined,
    source: 'db',
  };
}

function envAgentToResolved(agent: AgentConfig): ResolvedAgent {
  return { ...agent, source: 'env' };
}

export class ChatProxyService {
  private readonly openClawClient = new OpenClawClient();
  private readonly sessionKeys = new Map<string, string>();
  private readonly configService: ConfigService | null;

  constructor(configService: ConfigService | null = null) {
    this.configService = configService;
  }

  /**
   * Merge DB-managed agents with env-configured CHAT_AGENTS. DB entries win on id
   * collisions so an operator can shadow an env agent by creating one with the
   * same id (rare — DB ids are UUIDs, env ids are operator-chosen strings).
   */
  private async resolveAll(): Promise<ResolvedAgent[]> {
    const dbAgents: ResolvedAgent[] = [];
    try {
      const rows = await Agent.findAll({ where: { status: 'active' } });
      for (const row of rows) {
        const resolved = dbAgentToResolved(row);
        if (resolved) dbAgents.push(resolved);
      }
    } catch {
      // DB unreachable — fall back to env-only. Surface via /api/health later if needed.
    }
    const dbIds = new Set(dbAgents.map((a) => a.id));
    const envAgents = config.agents
      .filter((a) => !dbIds.has(a.id))
      .map(envAgentToResolved);
    return [...dbAgents, ...envAgents];
  }

  private async resolveOne(agentId: string): Promise<ResolvedAgent> {
    try {
      const row = await Agent.findByPk(agentId);
      if (row && row.status === 'active') {
        const resolved = dbAgentToResolved(row);
        if (resolved) return resolved;
      }
    } catch {
      // Ignore and fall through to env.
    }
    const env = config.agents.find((a) => a.id === agentId);
    if (env) return envAgentToResolved(env);
    throw new Error(`Unknown agent: ${agentId}`);
  }

  /**
   * Resolution order for the chat `model` field:
   *   1. agent.config.text_model (DB agents only)
   *   2. config `chat.default_model` at agent scope, then global
   *   3. the literal string 'default' (OpenClaw-compatible runtimes treat
   *      this as "use whatever the server has configured")
   */
  private async resolveModel(agent: ResolvedAgent): Promise<string> {
    if (agent.model) return agent.model;
    if (this.configService) {
      const scopes =
        agent.source === 'db'
          ? [
              { scope: 'agent' as const, scope_id: agent.id },
              { scope: 'global' as const, scope_id: null },
            ]
          : [{ scope: 'global' as const, scope_id: null }];
      const fromConfig = await this.configService.resolveValue('chat.default_model', scopes);
      if (fromConfig) return fromConfig;
    }
    return 'default';
  }

  async listAgents(): Promise<AgentInfo[]> {
    const resolved = await this.resolveAll();
    return Promise.all(
      resolved.map(async (agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        running: await this.openClawClient.checkHealth(agent),
        source: agent.source,
      })),
    );
  }

  getOrCreateSession(connectionId: string): string {
    let sessionKey = this.sessionKeys.get(connectionId);
    if (!sessionKey) {
      sessionKey = randomUUID();
      this.sessionKeys.set(connectionId, sessionKey);
    }
    return sessionKey;
  }

  clearSession(connectionId: string): void {
    this.sessionKeys.delete(connectionId);
  }

  async *chatCompletionStream(
    agentId: string,
    messages: ChatMessage[],
    connectionId: string,
  ): AsyncGenerator<string, void, unknown> {
    const agent = await this.resolveOne(agentId);
    const sessionKey = this.getOrCreateSession(connectionId);
    const model = await this.resolveModel(agent);

    // Phase 7 — signal liveness so the Activity surface can show "recently
    // active" agents without needing a separate telemetry channel.
    // Fire-and-forget; env agents have operator-chosen string ids that aren't
    // UUIDs, so scope to DB agents only.
    if (agent.source === 'db') {
      void Agent.update(
        { last_active_at: new Date() },
        { where: { id: agent.id } },
      ).catch(() => {
        // Non-fatal — DB blip shouldn't interrupt a live stream.
      });
    }

    // Inject the agent's system prompt (if any) as the first message for DB agents.
    // Env agents don't carry a system prompt today; they rely on the runtime's own config.
    const preparedMessages: ChatMessage[] =
      agent.source === 'db' && agent.system_prompt
        ? [{ role: 'system', content: agent.system_prompt }, ...messages]
        : messages;

    const reader = await this.openClawClient.chatCompletionStream(
      agent,
      preparedMessages,
      sessionKey,
      model,
    );
    yield* this.openClawClient.readTextStream(reader);
  }
}

export type { ChatMessage };
