/**
 * Layout contract — the ONE way a page lays out its content, enforced so it
 * can't drift again (and so future apps stamped from this scaffold inherit the
 * guard, the same way the data-testid contract works).
 *
 * The rule: a page renders `<PageShell>` (full-bleed hero + padding-free body),
 * then routes its content through the canonical `<PageBody>` container, which
 * owns the single horizontal + top inset (`px-8 py-6`). Object/record pages use
 * `<RecordWorkspace>` (which owns its own inset via RecordDetailLayout). Content
 * components (the canonical patterns, PipelineBoard) are inset-transparent and
 * rely on that container. Screens must NOT hand-roll a wrapper with an ad-hoc
 * inset (`mx-6`, `px-1/px-4/px-6`, `py-2`) — that is what produced ragged,
 * inconsistent indents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../pages');
const pageFiles = readdirSync(pagesDir).filter((f) => f.endsWith('.tsx'));
const read = (f: string) => readFileSync(path.join(pagesDir, f), 'utf8');

test('no page hand-rolls an ad-hoc left-margin inset (use PageBody, not mx-6)', () => {
  const bad = pageFiles.filter((f) => /\bmx-6\b/.test(read(f)));
  assert.deepEqual(
    bad,
    [],
    `Pages must inset content via <PageBody> (px-8), not an ad-hoc mx-6. Offenders: ${bad.join(', ')}`,
  );
});

test('no page re-centers content with mx-auto (PageBody owns width + inset)', () => {
  // An `mx-auto max-w-*` wrapper *inside* PageBody double-insets: it centers the
  // column, pushing the left edge right of the full-bleed hero (and often adds a
  // second `p-4`). PageBody already owns width + `px-8 py-6`; pages must not
  // re-center. This is the class of bug the PageBody-presence check above misses.
  const bad = pageFiles.filter((f) => /\bmx-auto\b/.test(read(f)));
  assert.deepEqual(
    bad,
    [],
    `Pages must let <PageBody> own width/centering — an mx-auto wrapper inside it misaligns the left edge with the hero. Offenders: ${bad.join(', ')}`,
  );
});

test('every PageShell screen carries the canonical px-8 + py-6 inset (PageBody preferred)', () => {
  // Preferred: wrap content in <PageBody> (owns px-8 py-6). Accepted: a raw top
  // container carrying BOTH px-8 (left) AND py-6 (top) — full-height board/scroll
  // screens that can't use PageBody use `flex h-full min-h-0 flex-col px-8 py-6`.
  // Rejected: px-8 without py-6 (content crowds the hero — no top gap), or no
  // inset at all (flush). New screens should use <PageBody> (see AGENTS.md).
  const bad = pageFiles.filter((f) => {
    const src = read(f);
    if (!/\bPageShell\b/.test(src)) return false; // not a hero+body screen
    if (/\bPageBody\b/.test(src) || /\bRecordWorkspace\b/.test(src)) return false; // canonical containers own their inset
    return !(/\bpx-8\b/.test(src) && /\bpy-6\b/.test(src));
  });
  assert.deepEqual(
    bad,
    [],
    `PageShell screens must inset content via <PageBody> or a container with BOTH px-8 and py-6 — px-8 alone leaves no top gap and crowds the hero. Offenders: ${bad.join(', ')}`,
  );
});
