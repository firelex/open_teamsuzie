/**
 * A persona is a packaged "agent identity": a system prompt plus optional
 * model + tool-list overrides plus presentation (name, description, avatar).
 *
 * Two sources merge at runtime:
 *  - **builtin** — `PERSONA.md` files in the repo. Code-reviewed, version-
 *    controlled, visible to everyone.
 *  - **user** — rows in the `personas` SQLite table. Created at runtime via
 *    UI/API. Private to the creator.
 */
export type PersonaSource = 'builtin' | 'user';

export interface Persona {
  /** Stable identifier. For builtins this is the directory name; for user
   * personas it's a generated id (e.g. `persona_abc123`). */
  id: string;
  source: PersonaSource;
  /** Display name. */
  name: string;
  /** Short blurb shown in the picker. */
  description: string;
  /** Avatar reference — typically a URL path the app serves under `/avatars/...`. */
  avatar?: string;
  /** Optional model override. If unset, server's default is used. */
  model?: string;
  /** Tool-name allowlist. `["*"]` (or undefined) = all server tools.
   *  Strings are matched against a tool's `name` field. */
  allowedTools?: string[];
  /** Tool-name blocklist. Applied after the allowlist. */
  blockedTools?: string[];
  /** Full system-prompt body (markdown allowed; agent-loop just concatenates). */
  systemPrompt: string;
  /** Owner of a user-created persona. Undefined for builtins. */
  ownerId?: string;
  /** Epoch ms. Undefined for builtins (their lifecycle is the repo). */
  createdAt?: number;
  updatedAt?: number;
}

/**
 * The fields a caller supplies when creating a user persona. `id` and
 * timestamps are filled in by the store.
 */
export interface PersonaCreateInput {
  ownerId: string;
  name: string;
  description: string;
  avatar?: string;
  model?: string;
  allowedTools?: string[];
  blockedTools?: string[];
  systemPrompt: string;
}

/** Patch shape for updates. All fields optional. */
export interface PersonaUpdateInput {
  name?: string;
  description?: string;
  avatar?: string | null;
  model?: string | null;
  allowedTools?: string[] | null;
  blockedTools?: string[] | null;
  systemPrompt?: string;
}

/**
 * Resolve a list of tools for a persona.
 *
 * Semantics:
 *  - No persona, or `allowedTools` is undefined / contains `'*'` → all tools.
 *  - Otherwise, keep tools whose name appears in `allowedTools`.
 *  - Then drop any tool whose name appears in `blockedTools`.
 *
 * Pure function — exported for use by agent-loop and any direct callers.
 */
export function filterToolsForPersona<T extends { name: string }>(
  tools: T[],
  persona: Pick<Persona, 'allowedTools' | 'blockedTools'> | null | undefined,
): T[] {
  if (!persona) return tools;
  const allow = persona.allowedTools;
  const block = new Set(persona.blockedTools ?? []);
  const allowAll = !allow || allow.includes('*');
  return tools.filter((t) => (allowAll || allow!.includes(t.name)) && !block.has(t.name));
}

export interface ApplyPersonaInput<T extends { name: string }> {
  /** Server's default system prompt (e.g. Counsel identity). Used when no
   *  persona is selected. */
  defaultSystemPrompt?: string;
  /** Skill markdown to append regardless of persona — skills are independent
   *  of identity. */
  skillSystemPrompt?: string;
  /** Full tool set the server has wired up; will be filtered by the persona. */
  tools: T[];
  /** The selected persona. `null`/`undefined` falls back to defaults. */
  persona?: Persona | null;
}

export interface ApplyPersonaResult<T extends { name: string }> {
  /** Final system prompt, or undefined if both persona and default are empty. */
  systemPrompt: string | undefined;
  /** Tool set after persona allowlist/blocklist applied. */
  tools: T[];
  /** Model override from the persona, if any — caller decides whether to honor it. */
  modelOverride?: string;
}

/**
 * Resolve the per-turn `{ systemPrompt, tools }` for `runChatTurn` from the
 * server's defaults and the (optional) selected persona.
 *
 * Precedence:
 *  - Persona's system prompt **replaces** the default Counsel prompt.
 *  - Skills are **always appended** to whatever the base ends up being.
 *  - Tools are filtered by the persona's allow/block lists; no persona = pass-through.
 */
export function applyPersona<T extends { name: string }>(
  input: ApplyPersonaInput<T>,
): ApplyPersonaResult<T> {
  const base = input.persona?.systemPrompt ?? input.defaultSystemPrompt ?? '';
  const combined = [base, input.skillSystemPrompt ?? ''].filter(Boolean).join('\n\n');
  const result: ApplyPersonaResult<T> = {
    systemPrompt: combined || undefined,
    tools: filterToolsForPersona(input.tools, input.persona),
  };
  if (input.persona?.model) result.modelOverride = input.persona.model;
  return result;
}
