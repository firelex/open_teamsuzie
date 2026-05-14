import type { ReferenceDoc } from './types.js';

/**
 * Storage interface for ReferenceDocs. Consuming agents implement this
 * (typically backed by SQLite) — the package itself ships no concrete
 * impl, only the interface.
 */
export interface ReferenceDocStore {
  save(ref: ReferenceDoc): Promise<void>;
  load(id: string): Promise<ReferenceDoc | null>;
  listByDocType(docType: string): Promise<ReferenceDoc[]>;
  delete(id: string): Promise<void>;
}
