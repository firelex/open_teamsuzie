import 'dotenv/config';

const SKILL_VAR_PREFIX = 'AGENT_SKILL_VAR_';

function collectSkillRenderContext(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(SKILL_VAR_PREFIX) || value === undefined) continue;
    out[key.slice(SKILL_VAR_PREFIX.length)] = value;
  }
  return out;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.warn('AGENT_EXTRA_BODY must be a JSON object; ignoring');
    return undefined;
  } catch {
    console.warn('AGENT_EXTRA_BODY is not valid JSON; ignoring');
    return undefined;
  }
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

const isProduction = process.env.NODE_ENV === 'production';
const devAuth = parseBool(process.env.AGENT_DEV_AUTH);

if (devAuth && isProduction) {
  throw new Error(
    'AGENT_DEV_AUTH must not be set in production — it bypasses auth on /api/* and would expose the agent to the public internet. Unset AGENT_DEV_AUTH and rely on the platform-token middleware (or layer in real auth).',
  );
}

// Platform bridge is opt-in: an agent boots fine without it (local dev), and
// only attempts marketplace registration when at least PLATFORM_URL is set.
// PLATFORM_TOKEN must match the mothership's INTERNAL_SERVICE_KEY for
// proxied chat + webhook calls to succeed.
const platform = (process.env.PLATFORM_URL || process.env.PLATFORM_TOKEN)
  ? {
      url: (process.env.PLATFORM_URL || '').replace(/\/$/, ''),
      token: process.env.PLATFORM_TOKEN || undefined,
      registrationToken: process.env.PLATFORM_REG_TOKEN || undefined,
      slug: process.env.PLATFORM_SLUG || 'unnamed-agent',
      name: process.env.PLATFORM_NAME || 'Unnamed Agent',
      description: process.env.PLATFORM_DESCRIPTION || 'External marketplace agent built from starter-external-agent',
      providerName: process.env.PLATFORM_PROVIDER_NAME || undefined,
      version: process.env.PLATFORM_VERSION || '0.1.0',
      /** Optional declared features beyond the auto-derived `tools` list. */
      features: parseList(process.env.PLATFORM_FEATURES).length
        ? parseList(process.env.PLATFORM_FEATURES)
        : ['sse_streaming'],
    }
  : undefined;

export const config = {
  env: isProduction ? 'production' as const : 'development' as const,
  devAuth,
  port: parseInt(process.env.AGENT_PORT || '16311', 10),
  publicUrl: (process.env.AGENT_PUBLIC_URL || 'http://localhost:16311').replace(/\/$/, ''),
  allowedOrigin: process.env.AGENT_ALLOWED_ORIGIN || 'http://localhost:17276',
  title: process.env.AGENT_TITLE || 'External Agent',
  agent: {
    name: process.env.AGENT_NAME || 'Suzie',
    description: process.env.AGENT_DESCRIPTION || 'OpenAI-compatible assistant',
    baseUrl: (process.env.AGENT_BASE_URL || 'http://localhost:4000').replace(/\/$/, ''),
    apiKey: process.env.AGENT_API_KEY || undefined,
    model: process.env.AGENT_MODEL || 'openai/gpt-4.1-mini',
    /**
     * Fallback system prompt used by the inter-agent DM webhook handler. The
     * /api/chat handler builds its prompt from skills + persona instead, so
     * this only applies to webhook-routed turns from other agents.
     */
    systemPrompt:
      process.env.AGENT_SYSTEM_PROMPT ||
      'You are a helpful assistant. Answer questions clearly and use the available tools when they help you give a better answer.',
    /** JSON object merged into every chat-completions body. Use for provider-specific knobs (e.g. {"enable_thinking":false} for Qwen). */
    extraBody: parseJsonObject(process.env.AGENT_EXTRA_BODY),
  },
  vectorDb: {
    baseUrl: (process.env.AGENT_VECTOR_DB_BASE_URL || 'http://localhost:3006').replace(/\/$/, ''),
    apiKey: process.env.AGENT_VECTOR_DB_API_KEY || undefined,
  },
  tools: {
    maxIterations: parseInt(process.env.AGENT_TOOL_MAX_ITERATIONS || '30', 10),
    /** Hosts the http_request tool may call. Auto-extended with any URL hosts found in skill render-context. */
    allowedHttpHosts: parseList(process.env.AGENT_HTTP_ALLOWED_HOSTS),
  },
  skills: {
    skillsDir: process.env.AGENT_SKILLS_DIR || undefined,
    catalogUrl: process.env.AGENT_SKILL_CATALOG_URL || undefined,
    catalogToken: process.env.AGENT_SKILL_CATALOG_TOKEN || undefined,
    /** Subset of skill names to install. Empty = install all discovered. */
    allow: parseList(process.env.AGENT_SKILLS_ALLOW),
    /** {{TOKEN}} substitutions for skill markdown. Set via AGENT_SKILL_VAR_<NAME>=<value>. */
    renderContext: collectSkillRenderContext(),
  },
  mcp: {
    /** Path to a JSON config file using the Claude Desktop `mcpServers` shape. */
    configPath: process.env.AGENT_MCP_CONFIG || undefined,
  },
  personas: {
    /** Directory of `<id>/PERSONA.md` files for builtin personas. */
    dir: process.env.AGENT_PERSONAS_DIR || undefined,
  },
  files: {
    /** Per-file size cap on uploads. Default 25MB. */
    maxUploadBytes: parseInt(process.env.AGENT_MAX_UPLOAD_BYTES || `${25 * 1024 * 1024}`, 10),
  },
  db: {
    /** SQLite path for persisted top-level Assistant chats. */
    path: process.env.AGENT_DB_PATH || './data/agent.db',
  },
  /**
   * markitdown-agent (sibling Python service) provides DOCX/PDF/etc → markdown
   * conversion and markdown → DOCX export. When set, the agent gets
   * `convert_to_markdown` and `export_to_docx` tools.
   */
  markitdown: {
    baseUrl: (process.env.AGENT_MARKITDOWN_AGENT_BASE_URL || '').replace(/\/$/, ''),
  },
  platform,
};

export type AppConfig = typeof config;
