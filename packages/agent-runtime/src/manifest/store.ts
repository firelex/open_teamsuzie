import { readFileSync, existsSync, watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import { defaultManifest } from './defaults.js';
import type { AgentManifest } from './schema.js';

function mergeWithDefaults(partial: Partial<AgentManifest>): AgentManifest {
  const base = defaultManifest();
  return {
    schemaVersion: 1,
    name: partial.name ?? base.name,
    description: partial.description ?? base.description,
    theme: { ...base.theme, ...(partial.theme ?? {}) },
    persona: { ...base.persona, ...(partial.persona ?? {}) },
    personas: Array.isArray(partial.personas) ? partial.personas : undefined,
    components: { ...base.components, ...(partial.components ?? {}) },
    modules: partial.modules,
    prompts: Array.isArray(partial.prompts) ? partial.prompts : undefined,
    tools: Array.isArray(partial.tools) ? partial.tools : [],
    ai: partial.ai,
    reviews: partial.reviews,
    source: partial.source,
  };
}

export function loadManifest(manifestPath: string): AgentManifest {
  if (!existsSync(manifestPath)) return defaultManifest();
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AgentManifest>;
    return mergeWithDefaults(parsed);
  } catch (err) {
    console.warn(
      `[manifest] failed to read ${manifestPath}: ${err instanceof Error ? err.message : err}`,
    );
    return defaultManifest();
  }
}

export class ManifestStore {
  private current: AgentManifest;
  private path: string;
  private listeners = new Set<(m: AgentManifest) => void>();

  constructor(manifestPath: string) {
    this.path = path.resolve(manifestPath);
    this.current = loadManifest(this.path);
    try {
      watchFile(this.path, { interval: 1000, persistent: false }, (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
        const next = loadManifest(this.path);
        this.current = next;
        for (const fn of this.listeners) {
          try { fn(next); } catch { /* listener errors must not break reload */ }
        }
      });
    } catch (err) {
      console.warn(
        `[manifest] watch unavailable for ${this.path}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  get(): AgentManifest { return this.current; }

  onChange(fn: (m: AgentManifest) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    try { unwatchFile(this.path); } catch { /* already unwatched */ }
    this.listeners.clear();
  }
}
