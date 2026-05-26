import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export type HistorySourceKind = 'initial' | 'nl-patch' | 'json-editor' | 'revert';

export interface RevisionEntry {
  ts: string;
  label: string;
  sourceKind: HistorySourceKind;
  byMessageId?: string;
}

const HISTORY_DIRNAME = '.manifest-history';
const INDEX_FILENAME = 'revisions.json';

function historyDir(buildDir: string): string {
  return path.join(buildDir, HISTORY_DIRNAME);
}

function indexPath(buildDir: string): string {
  return path.join(historyDir(buildDir), INDEX_FILENAME);
}

function ensureDir(buildDir: string): void {
  const dir = historyDir(buildDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadIndex(buildDir: string): RevisionEntry[] {
  const p = indexPath(buildDir);
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as RevisionEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIndex(buildDir: string, entries: RevisionEntry[]): void {
  ensureDir(buildDir);
  writeFileSync(indexPath(buildDir), JSON.stringify(entries, null, 2) + '\n');
}

let lastTs = '';
let dupCounter = 0;
function newTimestamp(): string {
  const base = new Date().toISOString().replace(/:/g, '-');
  if (base === lastTs) {
    dupCounter += 1;
    return `${base}-${dupCounter.toString().padStart(3, '0')}`;
  }
  lastTs = base;
  dupCounter = 0;
  return base;
}

export function snapshotManifest(args: {
  buildDir: string;
  label: string;
  sourceKind: HistorySourceKind;
  byMessageId?: string;
}): string {
  const { buildDir, label, sourceKind, byMessageId } = args;
  ensureDir(buildDir);
  const ts = newTimestamp();
  const src = path.join(buildDir, 'agent.json');
  const body = existsSync(src) ? readFileSync(src, 'utf8') : '';
  writeFileSync(path.join(historyDir(buildDir), `${ts}.json`), body);
  const entries = loadIndex(buildDir);
  entries.push({ ts, label, sourceKind, byMessageId });
  saveIndex(buildDir, entries);
  return ts;
}

export function listRevisions(buildDir: string): RevisionEntry[] {
  return loadIndex(buildDir);
}

export function readRevision(buildDir: string, ts: string): string | null {
  const p = path.join(historyDir(buildDir), `${ts}.json`);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

export function revertToRevision(args: { buildDir: string; ts: string; byMessageId?: string }): void {
  const { buildDir, ts, byMessageId } = args;
  const body = readRevision(buildDir, ts);
  if (body === null) {
    throw new Error(`revision ${ts} not found in ${buildDir}`);
  }
  snapshotManifest({ buildDir, label: `Pre-revert state (replaced by ${ts})`, sourceKind: 'json-editor' });
  writeFileSync(path.join(buildDir, 'agent.json'), body);
  const entries = loadIndex(buildDir);
  entries.push({ ts: newTimestamp(), label: `Revert to ${ts}`, sourceKind: 'revert', byMessageId });
  saveIndex(buildDir, entries);
}

export function pruneHistory(buildDir: string, max: number): void {
  const entries = loadIndex(buildDir);
  if (entries.length <= max) return;
  const drop = entries.slice(0, entries.length - max);
  const keep = entries.slice(entries.length - max);
  for (const entry of drop) {
    const file = path.join(historyDir(buildDir), `${entry.ts}.json`);
    try { if (existsSync(file)) rmSync(file); } catch { /* best-effort */ }
  }
  saveIndex(buildDir, keep);
}
