import 'dotenv/config';

const SKILL_VAR_PREFIX = 'STARTER_CHAT_SKILL_VAR_';

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

export const config = {
  port: parseInt(process.env.STARTER_CHAT_PORT || '16311', 10),
  publicUrl: (process.env.STARTER_CHAT_PUBLIC_URL || 'http://localhost:16311').replace(/\/$/, ''),
  allowedOrigin: process.env.STARTER_CHAT_ALLOWED_ORIGIN || 'http://localhost:17276',
  title: process.env.STARTER_CHAT_TITLE || 'Starter Chat',
  agent: {
    name: process.env.STARTER_CHAT_AGENT_NAME || 'Suzie',
    description: process.env.STARTER_CHAT_AGENT_DESCRIPTION || 'OpenAI-compatible assistant',
    baseUrl: (process.env.STARTER_CHAT_AGENT_BASE_URL || 'http://localhost:4000').replace(/\/$/, ''),
    apiKey: process.env.STARTER_CHAT_AGENT_API_KEY || undefined,
    model: process.env.STARTER_CHAT_MODEL || 'openai/gpt-4.1-mini',
  },
  vectorDb: {
    baseUrl: (process.env.STARTER_CHAT_VECTOR_DB_BASE_URL || 'http://localhost:3006').replace(/\/$/, ''),
    apiKey: process.env.STARTER_CHAT_VECTOR_DB_API_KEY || undefined,
  },
  tools: {
    maxIterations: parseInt(process.env.STARTER_CHAT_TOOL_MAX_ITERATIONS || '6', 10),
    /** Hosts the http_request tool may call. Auto-extended with any URL hosts found in skill render-context. */
    allowedHttpHosts: parseList(process.env.STARTER_CHAT_HTTP_ALLOWED_HOSTS),
  },
  skills: {
    skillsDir: process.env.STARTER_CHAT_SKILLS_DIR || undefined,
    catalogUrl: process.env.STARTER_CHAT_SKILL_CATALOG_URL || undefined,
    catalogToken: process.env.STARTER_CHAT_SKILL_CATALOG_TOKEN || undefined,
    /** Subset of skill names to install. Empty = install all discovered. */
    allow: parseList(process.env.STARTER_CHAT_SKILLS_ALLOW),
    /** {{TOKEN}} substitutions for skill markdown. Set via STARTER_CHAT_SKILL_VAR_<NAME>=<value>. */
    renderContext: collectSkillRenderContext(),
  },
  mcp: {
    /** Path to a JSON config file using the Claude Desktop `mcpServers` shape. */
    configPath: process.env.STARTER_CHAT_MCP_CONFIG || undefined,
  },
  files: {
    /** Per-file size cap on uploads. Default 25MB. */
    maxUploadBytes: parseInt(process.env.STARTER_CHAT_MAX_UPLOAD_BYTES || `${25 * 1024 * 1024}`, 10),
  },
};
