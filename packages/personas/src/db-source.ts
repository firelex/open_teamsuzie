import { jsonColumn, prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import type { Persona, PersonaCreateInput, PersonaUpdateInput } from './types.js';

/**
 * SQLite-backed persona store. Apps construct one with their open DB
 * (after running `PERSONAS_MIGRATIONS`) and use it for user-created personas.
 *
 * Ownership is enforced by the caller — every read takes an `ownerId` (or a
 * variant that lists everyone's). The store doesn't know about auth; it just
 * indexes/filters by `owner_id`.
 */
export class PersonaStore {
  constructor(private readonly db: DatabaseInstance) {}

  list(ownerId: string): Persona[] {
    const rows = prepareCached<[string], DbRow>(
      this.db,
      `SELECT * FROM personas WHERE owner_id = ? ORDER BY updated_at DESC`,
    ).all(ownerId);
    return rows.map(rowToPersona);
  }

  get(id: string, ownerId: string): Persona | null {
    const row = prepareCached<[string, string], DbRow>(
      this.db,
      `SELECT * FROM personas WHERE id = ? AND owner_id = ?`,
    ).get(id, ownerId);
    return row ? rowToPersona(row) : null;
  }

  create(input: PersonaCreateInput): Persona {
    const id = generateId();
    const now = Date.now();
    prepareCached<
      [string, string, string, string, string | null, string | null, string | null, string | null, string, number, number]
    >(
      this.db,
      `INSERT INTO personas (
        id, owner_id, name, description, avatar, model,
        allowed_tools, blocked_tools, system_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ownerId,
      input.name,
      input.description,
      input.avatar ?? null,
      input.model ?? null,
      input.allowedTools ? jsonColumn.serialize(input.allowedTools) : null,
      input.blockedTools ? jsonColumn.serialize(input.blockedTools) : null,
      input.systemPrompt,
      now,
      now,
    );
    return {
      id,
      source: 'user',
      ownerId: input.ownerId,
      name: input.name,
      description: input.description,
      avatar: input.avatar,
      model: input.model,
      allowedTools: input.allowedTools,
      blockedTools: input.blockedTools,
      systemPrompt: input.systemPrompt,
      createdAt: now,
      updatedAt: now,
    };
  }

  update(id: string, ownerId: string, patch: PersonaUpdateInput): Persona | null {
    const existing = this.get(id, ownerId);
    if (!existing) return null;

    const merged = applyPatch(existing, patch);
    const now = Date.now();
    prepareCached<
      [string, string, string | null, string | null, string | null, string | null, string, number, string, string]
    >(
      this.db,
      `UPDATE personas SET
        name = ?, description = ?, avatar = ?, model = ?,
        allowed_tools = ?, blocked_tools = ?, system_prompt = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?`,
    ).run(
      merged.name,
      merged.description,
      merged.avatar ?? null,
      merged.model ?? null,
      merged.allowedTools ? jsonColumn.serialize(merged.allowedTools) : null,
      merged.blockedTools ? jsonColumn.serialize(merged.blockedTools) : null,
      merged.systemPrompt,
      now,
      id,
      ownerId,
    );
    return { ...merged, updatedAt: now };
  }

  delete(id: string, ownerId: string): boolean {
    const result = prepareCached<[string, string]>(
      this.db,
      `DELETE FROM personas WHERE id = ? AND owner_id = ?`,
    ).run(id, ownerId);
    return result.changes > 0;
  }
}

interface DbRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  avatar: string | null;
  model: string | null;
  allowed_tools: string | null;
  blocked_tools: string | null;
  system_prompt: string;
  created_at: number;
  updated_at: number;
}

function rowToPersona(row: DbRow): Persona {
  const persona: Persona = {
    id: row.id,
    source: 'user',
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.avatar) persona.avatar = row.avatar;
  if (row.model) persona.model = row.model;
  const allowed = jsonColumn.parseNullable<string[]>(row.allowed_tools);
  if (allowed) persona.allowedTools = allowed;
  const blocked = jsonColumn.parseNullable<string[]>(row.blocked_tools);
  if (blocked) persona.blockedTools = blocked;
  return persona;
}

function applyPatch(existing: Persona, patch: PersonaUpdateInput): Persona {
  const out: Persona = { ...existing };
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.description !== undefined) out.description = patch.description;
  if (patch.avatar !== undefined) out.avatar = patch.avatar ?? undefined;
  if (patch.model !== undefined) out.model = patch.model ?? undefined;
  if (patch.allowedTools !== undefined) out.allowedTools = patch.allowedTools ?? undefined;
  if (patch.blockedTools !== undefined) out.blockedTools = patch.blockedTools ?? undefined;
  if (patch.systemPrompt !== undefined) out.systemPrompt = patch.systemPrompt;
  return out;
}

function generateId(): string {
  return `persona_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
