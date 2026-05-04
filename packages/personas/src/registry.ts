import { loadPersonasFromDir } from './file-source.js';
import { PersonaStore } from './db-source.js';
import type { DatabaseInstance } from '@teamsuzie/db-sqlite';
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

  constructor(opts: PersonaRegistryOptions) {
    this.builtins = opts.filesystemDir ? loadPersonasFromDir(opts.filesystemDir) : [];
    this.store = opts.db ? new PersonaStore(opts.db) : null;
  }

  /** All builtin personas — same for every caller. */
  listBuiltins(): Persona[] {
    return this.builtins.slice();
  }

  /** User-owned personas for one caller. Empty if no DB is configured. */
  listForOwner(ownerId: string): Persona[] {
    return this.store ? this.store.list(ownerId) : [];
  }

  /** Builtins + the caller's own user personas. The shape clients want for a
   *  picker. Builtins come first. */
  listVisibleTo(ownerId: string): Persona[] {
    return [...this.listBuiltins(), ...this.listForOwner(ownerId)];
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
