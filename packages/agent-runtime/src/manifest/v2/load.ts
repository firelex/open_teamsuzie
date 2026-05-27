import type { AgentManifestV2 } from './schema.js';
import { migrateV1ToV2 } from './migrate.js';
import { validateManifestV2 } from './validate.js';

/**
 * Load a manifest from a raw value, auto-migrating v1 → v2 in memory.
 *
 * - `version: 2` → validated and returned.
 * - `schemaVersion: 1` (or no version field) → migrated, validated, returned.
 * - Any other version → throws.
 *
 * Migration is in-memory only. Callers that want the v2 form persisted
 * to disk must write the returned manifest themselves.
 */
export function loadManifestV2(raw: unknown): AgentManifestV2 {
  const v = (raw as { version?: number; schemaVersion?: number } | null)?.version
    ?? (raw as { schemaVersion?: number } | null)?.schemaVersion;
  if (v === 2) return validateManifestV2(raw);
  if (v === undefined || v === 1) {
    const migrated = migrateV1ToV2(raw as Parameters<typeof migrateV1ToV2>[0]);
    console.log('Migrated v1 → v2 in memory');
    return validateManifestV2(migrated);
  }
  throw new Error(`Unknown manifest version: ${v}`);
}
