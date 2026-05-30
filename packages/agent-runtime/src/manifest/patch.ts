import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentManifest } from './schema.js';
import type { AgentManifestV2 } from './v2/schema.js';
import { validateManifestAny } from './validate.js';
import { snapshotManifest, type HistorySourceKind } from './history.js';

export interface AnchorPatch {
  anchor: string;
  replacement: string;
}

export interface RejectedPatch {
  anchor: string;
  reason: 'not found' | 'not unique';
}

export interface ApplyResult {
  result: string;
  applied: AnchorPatch[];
  rejected: RejectedPatch[];
}

export function applyAnchorPatches(text: string, patches: AnchorPatch[]): ApplyResult {
  const applied: AnchorPatch[] = [];
  const rejected: RejectedPatch[] = [];
  let buf = text;
  for (const patch of patches) {
    if (!patch.anchor) {
      rejected.push({ anchor: patch.anchor, reason: 'not unique' });
      continue;
    }
    const firstIdx = buf.indexOf(patch.anchor);
    if (firstIdx === -1) {
      rejected.push({ anchor: patch.anchor, reason: 'not found' });
      continue;
    }
    const secondIdx = buf.indexOf(patch.anchor, firstIdx + 1);
    if (secondIdx !== -1) {
      rejected.push({ anchor: patch.anchor, reason: 'not unique' });
      continue;
    }
    buf = buf.slice(0, firstIdx) + patch.replacement + buf.slice(firstIdx + patch.anchor.length);
    applied.push(patch);
  }
  return { result: buf, applied, rejected };
}

export type ApplyAndPersistResult =
  | { ok: true; manifest: AgentManifest | AgentManifestV2; applied: AnchorPatch[]; rejected: RejectedPatch[]; snapshotTs: string }
  | { ok: false; reason: string; applied: AnchorPatch[]; rejected: RejectedPatch[] };

export function applyAndPersistPatches(args: {
  buildDir: string;
  patches: AnchorPatch[];
  label: string;
  sourceKind: HistorySourceKind;
  byMessageId?: string;
}): ApplyAndPersistResult {
  const { buildDir, patches, label, sourceKind, byMessageId } = args;
  const manifestFile = path.join(buildDir, 'agent.json');
  if (!existsSync(manifestFile)) {
    return { ok: false, reason: 'agent.json missing', applied: [], rejected: [] };
  }
  const before = readFileSync(manifestFile, 'utf8');
  const { result, applied, rejected } = applyAnchorPatches(before, patches);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch (err) {
    return {
      ok: false,
      reason: `JSON parse failed after patching: ${err instanceof Error ? err.message : String(err)}`,
      applied,
      rejected,
    };
  }
  const validation = validateManifestAny(parsed);
  if (!validation.ok) {
    return { ok: false, reason: `Schema validation failed: ${validation.errors.join('; ')}`, applied, rejected };
  }

  const snapshotTs = snapshotManifest({ buildDir, label, sourceKind, byMessageId });
  writeFileSync(manifestFile, JSON.stringify(validation.value, null, 2) + '\n');
  return { ok: true, manifest: validation.value, applied, rejected, snapshotTs };
}
