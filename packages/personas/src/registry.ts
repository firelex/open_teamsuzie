import { loadPersonasFromDir } from './file-source.js';
import { PersonaStore } from './db-source.js';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import type { Persona, PersonaCreateInput, PersonaUpdateInput } from './types.js';

export interface PersonaRegistryOptions {
  /** Directory of `<id>/PERSONA.md` files for builtin (file-based) personas. */
  filesystemDir?: string;
  /** Open SQLite database for user-created personas. Migrations must already
   *  have been applied (see `PERSONAS_MIGRATIONS`). */
  db?: DatabaseInstance;
}

/**
 * Merged registry: builtin personas (file-based, read-only) + user personas
 * (SQLite-backed, owner-scoped CRUD).
 *
 * Builtin personas are loaded once at construction time. Apps that want to
 * reload from disk without restarting should construct a fresh registry.
 */
export class PersonaRegistry {
  private readonly builtins: Persona[];
  private readonly store: PersonaStore | null;
  private readonly seedDb: DatabaseInstance | null;

  constructor(opts: PersonaRegistryOptions) {
    this.builtins = opts.filesystemDir ? loadPersonasFromDir(opts.filesystemDir) : [];
    this.store = opts.db ? new PersonaStore(opts.db) : null;
    this.seedDb = opts.db ?? null;
  }

  /** All builtin personas — same for every caller. */
  listBuiltins(): Persona[] {
    return this.builtins.slice();
  }

  /** User-owned personas for one caller. Empty if no DB is configured.
   *  Optional paging via `{ limit, offset }`, optional substring filter via
   *  `{ q }` against name + description. */
  listForOwner(
    ownerId: string,
    opts?: { limit?: number; offset?: number; q?: string },
  ): Persona[] {
    return this.store ? this.store.list(ownerId, opts) : [];
  }

  /** Total user personas the caller owns. Useful for paging. */
  countForOwner(ownerId: string, opts?: { q?: string }): number {
    return this.store ? this.store.count(ownerId, opts) : 0;
  }

  /** Builtins + the caller's own user personas. The shape clients want for a
   *  picker. Builtins come first.
   *
   *  Once a caller has been seeded (see `seedFromBuiltinsIfNeeded`), the
   *  built-ins are skipped — the caller now owns editable copies in their
   *  own personas table, so re-listing the file-based originals would
   *  produce duplicates. */
  listVisibleTo(ownerId: string): Persona[] {
    const userItems = this.listForOwner(ownerId);
    if (this.isSeeded(ownerId)) return userItems;
    return [...this.listBuiltins(), ...userItems];
  }

  /** Has the seed-from-builtins step already run for this owner? */
  isSeeded(ownerId: string): boolean {
    if (!this.seedDb) return false;
    const row = prepareCached<[string], { owner_id: string }>(
      this.seedDb,
      `SELECT owner_id FROM personas_seeded WHERE owner_id = ?`,
    ).get(ownerId);
    return !!row;
  }

  /**
   * One-shot seeding: copies every file-based built-in into the caller's
   * SQLite-backed personas table, then marks the caller as seeded so we
   * don't re-copy on subsequent calls (even if the user later deletes
   * everything — that's "Reset" territory and should be an explicit
   * action, not an accident).
   *
   * Idempotent. Safe to call on every login or every `/api/personas`
   * request — the seeded-marker check is cheap.
   *
   * Returns the number of rows just copied (0 when already seeded). The
   * caller can use this to surface a "We added 12 starter personas to
   * your library" toast on first login.
   */
  seedFromBuiltinsIfNeeded(ownerId: string): { seeded: boolean; count: number } {
    if (!this.store || !this.seedDb) return { seeded: false, count: 0 };
    if (this.isSeeded(ownerId)) return { seeded: false, count: 0 };

    let count = 0;
    const insertSeed = prepareCached<[string, number]>(
      this.seedDb,
      `INSERT INTO personas_seeded (owner_id, seeded_at) VALUES (?, ?)
       ON CONFLICT(owner_id) DO NOTHING`,
    );
    const tx = this.seedDb.transaction(() => {
      for (const builtin of this.builtins) {
        // Filter out the wildcard "*" — it's the file-source's way of
        // saying "all tools allowed", and PersonaCreateInput expects a
        // concrete list (or undefined for "all").
        const allowedTools = builtin.allowedTools?.filter((t) => t !== '*');
        const input: PersonaCreateInput = {
          ownerId,
          name: builtin.name,
          description: builtin.description,
          systemPrompt: builtin.systemPrompt,
        };
        if (builtin.avatar) input.avatar = builtin.avatar;
        if (builtin.model) input.model = builtin.model;
        if (allowedTools && allowedTools.length > 0) input.allowedTools = allowedTools;
        if (builtin.blockedTools && builtin.blockedTools.length > 0) {
          input.blockedTools = builtin.blockedTools;
        }
        this.store!.create(input);
        count += 1;
      }
      insertSeed.run(ownerId, Date.now());
    });
    tx();
    return { seeded: true, count };
  }

  /**
   * Resolve a persona by id, scoped to one owner. Builtins are visible to
   * everyone; user personas are visible only to their owner. Returns null if
   * not found, or if a user persona belongs to a different owner.
   */
  get(id: string, ownerId: string): Persona | null {
    const builtin = this.builtins.find((p) => p.id === id);
    if (builtin) return builtin;
    return this.store?.get(id, ownerId) ?? null;
  }

  create(input: PersonaCreateInput): Persona {
    if (!this.store) throw new Error('PersonaRegistry has no DB configured; cannot create user personas');
    if (this.builtins.some((p) => p.id === input.name)) {
      // Name collisions with builtin ids aren't actually a problem (user gets
      // a generated id), but flagging for sanity.
    }
    return this.store.create(input);
  }

  update(id: string, ownerId: string, patch: PersonaUpdateInput): Persona | null {
    if (!this.store) throw new Error('PersonaRegistry has no DB configured');
    if (this.builtins.some((p) => p.id === id)) return null; // builtins are immutable
    return this.store.update(id, ownerId, patch);
  }

  delete(id: string, ownerId: string): boolean {
    if (!this.store) throw new Error('PersonaRegistry has no DB configured');
    if (this.builtins.some((p) => p.id === id)) return false;
    return this.store.delete(id, ownerId);
  }
}
