import {
  Agent,
  AgentApiKey,
  AgentProfile,
  AgentWorkspaceFile,
  User,
  type AgentStatus,
  type AgentType,
} from '@teamsuzie/shared-auth';

/**
 * OSS-safe subset of Agent.config. The private monorepo has many more fields
 * (TTS voice, phone SID, cron templates, approval mode, etc.) that we drop
 * deliberately — see the Phase 1 extraction plan in apps/platform/admin/README.md.
 */
export interface AdminAgentConfig {
  system_prompt?: string;
  /** OpenClaw-compatible base URL. If omitted, the agent is only configurable, not chattable. */
  baseUrl?: string;
  apiKey?: string;
  openclawAgentId?: string;
  skills?: string[];
  text_model?: string;
  /** Static avatar URL served by the admin client, e.g. `/avatars/female/12.webp`. */
  avatar?: string | null;
  temperature?: number;
  max_tokens?: number;
  approval_required?: boolean;
  [key: string]: unknown;
}

export interface CreateAgentInput {
  name: string;
  description?: string | null;
  agent_type?: AgentType;
  status?: AgentStatus;
  profile_id?: string | null;
  config?: AdminAgentConfig;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string | null;
  agent_type?: AgentType;
  status?: AgentStatus;
  profile_id?: string | null;
  config?: AdminAgentConfig;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  agent_type: AgentType;
  status: AgentStatus;
  profile_id: string | null;
  profile_name: string | null;
  config: AdminAgentConfig;
  created_at: Date;
  updated_at: Date | null;
}

function serialize(agent: Agent, profileName: string | null): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    agent_type: agent.agent_type,
    status: agent.status,
    profile_id: agent.profile_id,
    profile_name: profileName,
    config: (agent.config as AdminAgentConfig) ?? {},
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  };
}

export class AgentsService {
  async resolveOrgId(userId: string): Promise<string | null> {
    const user = await User.findByPk(userId);
    return user?.default_organization_id ?? null;
  }

  async listForOrg(organizationId: string): Promise<AgentSummary[]> {
    const agents = await Agent.findAll({
      where: { organization_id: organizationId },
      include: [{ model: AgentProfile }],
      order: [['created_at', 'DESC']],
    });
    return agents.map((a) => serialize(a, a.profile?.name ?? null));
  }

  async findForOrg(id: string, organizationId: string): Promise<AgentSummary | null> {
    const agent = await Agent.findOne({
      where: { id, organization_id: organizationId },
      include: [{ model: AgentProfile }],
    });
    return agent ? serialize(agent, agent.profile?.name ?? null) : null;
  }

  async create(
    input: CreateAgentInput,
    context: { userId: string; organizationId: string },
  ): Promise<AgentSummary> {
    const profile = input.profile_id
      ? await AgentProfile.findByPk(input.profile_id)
      : null;
    if (input.profile_id && !profile) {
      throw new ServiceInputError('Unknown profile_id');
    }

    const mergedConfig: AdminAgentConfig = {
      ...(profile?.default_config ?? {}),
      ...(input.config ?? {}),
    };

    const created = await Agent.create({
      user_id: context.userId,
      organization_id: context.organizationId,
      profile_id: profile?.id ?? null,
      name: input.name,
      description: input.description ?? null,
      agent_type: input.agent_type ?? profile?.agent_type ?? 'openclaw',
      status: input.status ?? 'active',
      config: mergedConfig,
      created_by: context.userId,
      updated_by: context.userId,
    } as Partial<Agent>);

    const withProfile = await Agent.findByPk(created.id, {
      include: [{ model: AgentProfile }],
    });
    return serialize(withProfile!, withProfile?.profile?.name ?? null);
  }

  async update(
    id: string,
    input: UpdateAgentInput,
    context: { userId: string; organizationId: string },
  ): Promise<AgentSummary | null> {
    const agent = await Agent.findOne({
      where: { id, organization_id: context.organizationId },
    });
    if (!agent) return null;

    if (input.name !== undefined) agent.name = input.name;
    if (input.description !== undefined) agent.description = input.description;
    if (input.agent_type !== undefined) agent.agent_type = input.agent_type;
    if (input.status !== undefined) agent.status = input.status;
    if (input.profile_id !== undefined) {
      if (input.profile_id) {
        const profile = await AgentProfile.findByPk(input.profile_id);
        if (!profile) throw new ServiceInputError('Unknown profile_id');
      }
      agent.profile_id = input.profile_id;
    }
    if (input.config !== undefined) {
      agent.config = { ...(agent.config ?? {}), ...input.config };
    }
    agent.updated_by = context.userId;
    await agent.save();

    const withProfile = await Agent.findByPk(agent.id, {
      include: [{ model: AgentProfile }],
    });
    return serialize(withProfile!, withProfile?.profile?.name ?? null);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const agent = await Agent.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!agent) return false;
    // Cascade-delete the agent's dependent rows so FK constraints don't
    // block destruction. v1 treats agent delete as a hard sweep; a softer
    // "archive" mode would preserve these for audit.
    await AgentApiKey.destroy({ where: { agent_id: agent.id } });
    await AgentWorkspaceFile.destroy({ where: { agent_id: agent.id } });
    await agent.destroy();
    return true;
  }

  async listProfiles(): Promise<
    { id: string; slug: string; name: string; description: string | null; agent_type: string }[]
  > {
    const profiles = await AgentProfile.findAll({ order: [['name', 'ASC']] });
    return profiles.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      agent_type: p.agent_type,
    }));
  }
}

export class ServiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceInputError';
  }
}
