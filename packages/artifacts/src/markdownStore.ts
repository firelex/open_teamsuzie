import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  type FrontmatterData,
  parseFrontmatter,
  serializeFrontmatter,
} from './frontmatter.js';

/**
 * Generic record returned from {@link MarkdownArtifactStore}. `meta` is the
 * host-supplied metadata shape; `id` and `updatedAt` come from the filename
 * and mtime so hosts don't have to thread them through frontmatter.
 */
export interface MarkdownArtifact<TMeta> {
  id: string;
  meta: TMeta;
  body: string;
  updatedAt: string;
}

export interface MarkdownArtifactStoreOptions<TMeta> {
  /** Directory that holds the `*.md` artifacts. Created on first write. */
  dir: string;
  /** Filenames inside `dir` to hide from `list()` (e.g. trackers, READMEs). */
  reservedFilenames?: ReadonlySet<string>;
  /** Subdirectory names inside `dir` to skip when listing (e.g. `.activity`). */
  skipDirectoryNames?: ReadonlySet<string>;
  /** Parse the raw frontmatter map into the host's typed shape. */
  parseMeta: (data: FrontmatterData, ctx: { id: string }) => TMeta;
  /** Serialize the host's typed shape back into a frontmatter map. */
  serializeMeta: (meta: TMeta) => FrontmatterData;
}

/**
 * CRUD over a directory of `<id>.md` files that carry frontmatter metadata.
 * The package handles file I/O, frontmatter parse/serialize and listing; the
 * host owns metadata shape via `parseMeta` / `serializeMeta`.
 */
export class MarkdownArtifactStore<TMeta> {
  private readonly dir: string;
  private readonly reserved: ReadonlySet<string>;
  private readonly skipDirs: ReadonlySet<string>;
  private readonly parseMeta: (data: FrontmatterData, ctx: { id: string }) => TMeta;
  private readonly serializeMeta: (meta: TMeta) => FrontmatterData;

  constructor(options: MarkdownArtifactStoreOptions<TMeta>) {
    this.dir = options.dir;
    this.reserved = options.reservedFilenames ?? new Set();
    this.skipDirs = options.skipDirectoryNames ?? new Set();
    this.parseMeta = options.parseMeta;
    this.serializeMeta = options.serializeMeta;
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.md`);
  }

  list(): MarkdownArtifact<TMeta>[] {
    if (!existsSync(this.dir)) return [];
    const out: MarkdownArtifact<TMeta>[] = [];
    for (const entry of readdirSync(this.dir)) {
      if (this.reserved.has(entry)) continue;
      if (this.skipDirs.has(entry)) continue;
      if (!entry.endsWith('.md')) continue;
      const id = entry.replace(/\.md$/, '');
      const art = this.read(id);
      if (art) out.push(art);
    }
    return out;
  }

  read(id: string): MarkdownArtifact<TMeta> | null {
    const p = this.filePath(id);
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const st = statSync(p);
    return {
      id,
      meta: this.parseMeta(data, { id }),
      body,
      updatedAt: st.mtime.toISOString(),
    };
  }

  write(id: string, meta: TMeta, body: string): void {
    mkdirSync(this.dir, { recursive: true });
    const fm = this.serializeMeta(meta);
    writeFileSync(this.filePath(id), serializeFrontmatter(fm, body));
  }

  /**
   * Read-modify-write helper. Returns the new artifact or `null` if the id
   * does not exist.
   */
  update(
    id: string,
    mutate: (existing: MarkdownArtifact<TMeta>) => { meta: TMeta; body: string },
  ): MarkdownArtifact<TMeta> | null {
    const existing = this.read(id);
    if (!existing) return null;
    const next = mutate(existing);
    this.write(id, next.meta, next.body);
    return this.read(id);
  }

  delete(id: string): void {
    try {
      unlinkSync(this.filePath(id));
    } catch {
      /* idempotent */
    }
  }

  exists(id: string): boolean {
    return existsSync(this.filePath(id));
  }
}
