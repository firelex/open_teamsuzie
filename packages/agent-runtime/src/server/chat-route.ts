import express, { type Router } from 'express';
import type {
  AgentTarget, AnyToolDefinition, ChatMessage, ChatStreamEvent, ToolContext,
} from '@teamsuzie/agent-loop';
import type { ChatsStore } from '@teamsuzie/chats';
import { applyPersona, type PersonaRegistry } from '@teamsuzie/personas';
import {
  buildAttachmentContext, type InMemoryFileStore,
} from './files-route.js';

/**
 * Chat-completion router. Mounted at `/api/chat`. Streams `runChatTurn` output
 * to the client as SSE so the AssistantPage's reader gets {chunk, tool_call,
 * tool_result, tool_error, done, error} events. Logic is lifted from the
 * pre-runtime `starter-chat/src/index.ts` handler, adapted to the agent-runtime
 * registries (chats store + persona registry + manifest-driven default agent).
 *
 * Model precedence (most specific wins):
 *   1. `req.body.model` — the user's Settings-page model picker selection.
 *   2. The chat's bound persona's `model` (if any).
 *   3. `deps.agent.model` — the server-configured default.
 */
export interface CreateChatRouterDeps {
  /** Default LLM target. Per-request `body.model` overrides `.model`. */
  agent: AgentTarget;
  /** Persistent chats store; both messages and auto-title go through this. */
  chats: ChatsStore;
  /** Persona registry. Looks up `chat.personaId` for system-prompt + tool filter. */
  personaRegistry: PersonaRegistry;
  /** Single-tenant owner id — must match what the chats / personas modules use. */
  ownerId: string;
  /** Workspace scope. Must equal the `getWorkspaceId` the chats router uses. */
  workspaceId: string;
  /** Default system prompt when no persona is bound. Typically `manifest.persona.systemPrompt`. */
  defaultSystemPrompt?: string;
  /** Tools available to the chat loop. Default: []. */
  tools?: AnyToolDefinition[];
  /**
   * Optional per-turn tool factory. Returns tools that need a live
   * sessionId baked in via closure (e.g. the markdown-document drafting
   * tools, which take `getSessionId: () => string` at factory time
   * rather than reading it from the per-call ctx). Merged with `tools`
   * for the turn; tool names override the static list on collision.
   */
  buildPerTurnTools?: (sessionId: string) => AnyToolDefinition[];
  /** Tool execution context. Required for any non-empty `tools`. */
  toolCtx: ToolContext;
  /** Cap on tool-call iterations. Default: 30. */
  maxIterations?: number;
  /** Per-session file store. When supplied, `body.attachmentIds` are looked
   *  up via `fileStore.getMany(sessionId, ids)` and their content is
   *  prepended to the user message via `buildAttachmentContext`. */
  fileStore?: InMemoryFileStore;
  /** Injected for testability. In prod, this is `runChatTurn` from `@teamsuzie/agent-loop`. */
  runChatTurn: (input: {
    agent: AgentTarget;
    messages: ChatMessage[];
    tools: AnyToolDefinition[];
    toolCtx: ToolContext;
    systemPrompt?: string;
    maxIterations?: number;
    signal?: AbortSignal;
  }) => AsyncGenerator<ChatStreamEvent, void, unknown>;
}

export function createChatRouter(deps: CreateChatRouterDeps): Router {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    const history = Array.isArray(body.history) ? (body.history as ChatMessage[]) : [];
    const chatId = String(body.chatId ?? '').trim();
    const requestedModel = String(body.model ?? '').trim();
    const sessionId = String(body.sessionId ?? '').trim();
    // Optional override of the workspace check for matter-bound chats. When
    // the client passes `workspaceId`, the chat's stored workspace_id must
    // match it AND it must equal the file-bucket key (sessionId). Without
    // it, the check falls back to the server-configured default
    // (`assistant:default`) so existing top-level chats keep working.
    const requestedWorkspaceId = String(body.workspaceId ?? '').trim();
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? (body.attachmentIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const expectedWorkspaceId = requestedWorkspaceId || deps.workspaceId;
    const persistedChat = chatId ? deps.chats.getChat(chatId) : null;
    if (chatId && (!persistedChat || persistedChat.workspaceId !== expectedWorkspaceId)) {
      res.status(404).json({ error: 'chat_not_found' });
      return;
    }

    const persona = persistedChat?.personaId
      ? deps.personaRegistry.get(persistedChat.personaId, deps.ownerId)
      : null;

    // Static (registry) tools + per-turn tools that close over the live
    // sessionId. Per-turn names take precedence so a per-turn convert tool
    // overrides any registry default with the same name.
    const perTurnTools = deps.buildPerTurnTools && sessionId
      ? deps.buildPerTurnTools(sessionId)
      : [];
    const perTurnNames = new Set(perTurnTools.map((t) => t.name));
    const mergedTools: AnyToolDefinition[] = [
      ...(deps.tools ?? []).filter((t) => !perTurnNames.has(t.name)),
      ...perTurnTools,
    ];

    const turnConfig = applyPersona({
      defaultSystemPrompt: deps.defaultSystemPrompt,
      tools: mergedTools,
      persona,
    });

    const effectiveModel = requestedModel || turnConfig.modelOverride || deps.agent.model;
    const agent: AgentTarget = { ...deps.agent, model: effectiveModel };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: ChatStreamEvent) =>
      res.write(`data: ${JSON.stringify(event)}\n\n`);

    const abort = new AbortController();
    // res.close (not req.close): fires when the response stream ends — i.e.,
    // the client actually disconnected. req.close in Express 5 / Node 22+ can
    // fire as soon as the request body is fully consumed by middleware, which
    // would abort the upstream LLM call before it ever runs.
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    // Prepend an `[Attachments]` block listing ALL files currently in
    // the session — not just the ones attached this turn — so the model
    // keeps sight of earlier uploads on follow-up turns (otherwise it
    // loses the file_ids after turn 1). Text-like files attached *this
    // turn* additionally have their body inlined; binaries and older
    // text files render metadata-only.
    const sessionFiles = deps.fileStore && sessionId
      ? deps.fileStore.listSession(sessionId)
      : [];
    const newAttachmentIds = new Set(attachmentIds);
    const attachmentContext = buildAttachmentContext(sessionFiles, newAttachmentIds);
    const userContent = attachmentContext
      ? `${attachmentContext}\n\n[Message]\n${message}`
      : message;

    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: userContent },
    ];

    let assistantText = '';
    const collectedToolEvents: unknown[] = [];

    try {
      for await (const event of deps.runChatTurn({
        agent,
        messages,
        tools: turnConfig.tools,
        toolCtx: { ...deps.toolCtx, sessionId: sessionId || undefined },
        systemPrompt: turnConfig.systemPrompt,
        maxIterations: deps.maxIterations ?? 30,
        signal: abort.signal,
      })) {
        send(event);
        if (persistedChat) {
          if (event.type === 'chunk') {
            assistantText += event.text;
          } else if (
            event.type === 'tool_call'
            || event.type === 'tool_result'
            || event.type === 'tool_error'
          ) {
            collectedToolEvents.push(event);
          }
        }
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (err) {
      send({
        type: 'error',
        message: err instanceof Error ? err.message : 'Chat request failed',
      });
    } finally {
      if (persistedChat) {
        try {
          deps.chats.appendMessage({
            chatId: persistedChat.id,
            role: 'user',
            content: message,
          });
          deps.chats.appendMessage({
            chatId: persistedChat.id,
            role: 'assistant',
            content: assistantText,
            toolEvents: collectedToolEvents.length > 0
              ? JSON.stringify(collectedToolEvents)
              : null,
            citations: null,
          });
          // First-turn auto-title from the user's first line.
          if (persistedChat.name === 'New chat') {
            const firstLine = message.split('\n')[0]?.trim() ?? '';
            const provisional = firstLine.length > 0
              ? firstLine.slice(0, 60) + (firstLine.length > 60 ? '…' : '')
              : 'New chat';
            if (provisional !== persistedChat.name) {
              deps.chats.updateChat(persistedChat.id, { name: provisional });
            }
          }
        } catch (err) {
          console.error(
            '[agent-runtime] failed to persist chat messages:',
            err instanceof Error ? err.message : err,
          );
        }
      }
      res.end();
    }
  });

  return router;
}
