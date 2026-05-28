import type {
  AgentManifest,
  ManifestComponents,
  ManifestCustomField,
  ManifestMatterType,
  ManifestModules,
  ManifestPersona,
  ThemeTokens,
} from './schema.js';

/**
 * Default values for optional theme tokens. These are *defaults only* — any
 * value the manifest's `theme.tokens` provides wins. Consumers (e.g. Sidebar)
 * read `tokens.<x> ?? DEFAULT_THEME_TOKENS.<x>` so an agent.json with no theme
 * still produces a legible UI.
 */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  sidebarFgMuted: '#9a9a94',
};

export const DEFAULT_COMPONENTS: ManifestComponents = {
  chat: true,
  toolActivity: true,
  approvals: false,
  knowledgeBase: false,
  files: false,
  citations: false,
  workspace: false,
};

export const DEFAULT_MODULES: ManifestModules = {
  assistant: true,
  history: true,
  personas: true,
  settings: true,
  matters: false,
  library: false,
  knowledgeBase: false,
  admin: false,
  reviews: false,
  billing: false,
  redline: false,
  drafting: false,
};

/**
 * Capabilities block shape (mirrors v2 CapabilitiesBlock without forcing
 * the v2 type import — keeps defaults.ts free of v2 dependencies and lets
 * the projection accept partial/unknown shapes safely).
 */
export type CapabilitiesShape = {
  chat?: boolean;
  fileUploads?: boolean;
  docxDrafting?: boolean;
  redlines?: boolean;
  legalResearch?: boolean;
  citations?: boolean;
  matters?: boolean;
  reviewGrids?: boolean;
  clientSharing?: boolean;
  approvals?: boolean;
  workspace?: boolean;
};

/**
 * Project a capabilities block to the runtime's module gating shape.
 * Only emits keys that the runtime actually gates behavior on:
 *   - matters       (server/index.ts:462 router mount + AgentApp nav)
 *   - knowledgeBase (nav-visible only — no router wired; see server/index.ts:1104 "unwired" warning)
 *   - reviews       (server/index.ts:646 router mount)
 *   - drafting      (server/index.ts:353 — tool-registry gate, not a mount)
 *   - redline       (server/index.ts:352 — tool-registry gate, not a mount)
 *
 * Modules NOT derived from capabilities (assistant, history, personas,
 * settings, library, admin, billing) keep their DEFAULT_MODULES values;
 * callers can still layer `manifest.modules` over the top for explicit
 * overrides.
 *
 * Capability keys with no module-side effect (chat, fileUploads,
 * citations, clientSharing, approvals, workspace) are intentionally
 * unmapped — they were dual-written into `modules` historically as
 * component-style keys, but the runtime never read those slots.
 */
export function capabilitiesToModules(
  caps: CapabilitiesShape | undefined,
): Partial<ManifestModules> {
  if (!caps) return {};
  const out: Partial<ManifestModules> = {};
  if (typeof caps.matters === 'boolean') out.matters = caps.matters;
  if (typeof caps.legalResearch === 'boolean') out.knowledgeBase = caps.legalResearch;
  if (typeof caps.reviewGrids === 'boolean') out.reviews = caps.reviewGrids;
  if (typeof caps.docxDrafting === 'boolean') out.drafting = caps.docxDrafting;
  if (typeof caps.redlines === 'boolean') out.redline = caps.redlines;
  return out;
}

export function resolveModules(manifest: AgentManifest): ManifestModules {
  return { ...DEFAULT_MODULES, ...(manifest.modules ?? {}) };
}

export interface MattersLabel {
  singular: string;
  plural: string;
}

export const DEFAULT_MATTERS_LABEL: MattersLabel = {
  singular: 'Matter',
  plural: 'Matters',
};

export function resolveMattersLabel(manifest: AgentManifest): MattersLabel {
  const label = manifest.matters?.label;
  const singular = typeof label?.singular === 'string' ? label.singular.trim() : '';
  const plural = typeof label?.plural === 'string' ? label.plural.trim() : '';
  return {
    singular: singular.length > 0 ? singular : DEFAULT_MATTERS_LABEL.singular,
    plural: plural.length > 0 ? plural : DEFAULT_MATTERS_LABEL.plural,
  };
}

/**
 * Read the configured matter types, dropping malformed entries. An empty
 * array means implicit-single-type mode — the host UI renders one flat
 * shape with no picker and no custom fields, which is the existing
 * single-type build pattern. Trims id + label so trailing whitespace in
 * agent.json doesn't quietly break the type picker.
 */
export function resolveMatterTypes(manifest: AgentManifest): ManifestMatterType[] {
  const raw = manifest.matters?.types;
  if (!Array.isArray(raw)) return [];
  const out: ManifestMatterType[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    const label = typeof t.label === 'string' ? t.label.trim() : '';
    if (!id || !label) continue;
    const entry: ManifestMatterType = { id, label };
    if (typeof t.description === 'string' && t.description.trim().length > 0) {
      entry.description = t.description.trim();
    }
    if (Array.isArray(t.customFields)) {
      entry.customFields = t.customFields;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Returns the type whose id matches `typeId`, or null when no match. A
 * null / undefined / empty typeId short-circuits to null so callers can
 * pass through a stale `matter_metadata.type_id` without a manual guard.
 */
export function getMatterType(
  manifest: AgentManifest,
  typeId: string | null | undefined,
): ManifestMatterType | null {
  if (!typeId) return null;
  return resolveMatterTypes(manifest).find((t) => t.id === typeId) ?? null;
}

export interface ValidateCustomFieldValuesResult {
  ok: boolean;
  /** Map of fieldKey → user-facing error string. Empty when ok. */
  errors: Record<string, string>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a values blob against a custom-field configuration. Returns
 * a per-field error map so the host UI can highlight inputs. Empty
 * strings on optional fields are treated as undefined (form-friendly).
 * Extra keys not in the configuration are ignored — they don't trip
 * validation but won't get persisted either when the host saves only
 * the known keys.
 */
export function validateCustomFieldValues(
  fields: ManifestCustomField[] | undefined,
  values: Record<string, unknown>,
): ValidateCustomFieldValuesResult {
  const errors: Record<string, string> = {};
  for (const field of fields ?? []) {
    const raw = values[field.key];
    const empty =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim().length === 0);

    if (empty) {
      if (field.required) {
        errors[field.key] = `${field.label} is required`;
      }
      continue;
    }

    switch (field.type) {
      case 'text':
        if (typeof raw !== 'string') {
          errors[field.key] = `${field.label} must be a string`;
        }
        break;
      case 'number': {
        if (typeof raw === 'number' && Number.isFinite(raw)) break;
        // Numeric strings allowed — HTML form inputs hand back strings.
        if (typeof raw === 'string' && raw.trim().length > 0) {
          const n = Number(raw);
          if (Number.isFinite(n)) break;
        }
        errors[field.key] = `${field.label} must be a number`;
        break;
      }
      case 'date':
        if (typeof raw !== 'string' || !DATE_PATTERN.test(raw)) {
          errors[field.key] = `${field.label} must be a date (YYYY-MM-DD)`;
        }
        break;
      case 'enum': {
        const opts = field.options ?? [];
        if (typeof raw !== 'string' || !opts.includes(raw)) {
          errors[field.key] = `${field.label} must be one of: ${opts.join(', ')}`;
        }
        break;
      }
      case 'boolean':
        if (typeof raw !== 'boolean') {
          errors[field.key] = `${field.label} must be a boolean`;
        }
        break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function defaultManifest(): AgentManifest {
  return {
    schemaVersion: 1,
    name: 'Agent',
    description: 'An SDK-based agent.',
    theme: { id: 'default' },
    persona: {
      id: 'default',
      name: 'Default',
      systemPrompt:
        'You are a helpful assistant. Answer clearly and use tools when they help.',
    },
    components: { ...DEFAULT_COMPONENTS },
    tools: [],
  };
}

export function listPersonas(manifest: AgentManifest): ManifestPersona[] {
  const out: ManifestPersona[] = [manifest.persona];
  if (Array.isArray(manifest.personas)) {
    for (const p of manifest.personas) {
      if (p && p.id !== manifest.persona.id) out.push(p);
    }
  }
  return out;
}

export function findPersona(
  manifest: AgentManifest,
  id: string | null | undefined,
): ManifestPersona {
  if (!id) return manifest.persona;
  return listPersonas(manifest).find((p) => p.id === id) ?? manifest.persona;
}
