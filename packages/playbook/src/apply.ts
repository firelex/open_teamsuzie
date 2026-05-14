import type { Playbook, DeviationReport, Deviation } from './types.js';

/**
 * A pluggable LLM call. Caller provides the function — agents typically
 * pass a wrapper around @teamsuzie/agent-loop's underlying chat function.
 *
 * The function MUST return a JSON string of shape `{ deviations: Deviation[] }`.
 */
export type LlmCall = (prompt: string) => Promise<string>;

const SYSTEM_PROMPT = `You are a precise document-review assistant.

You will be given a PLAYBOOK (markdown describing a firm's preferences for a
class of documents) and a TARGET DOCUMENT to review against it.

Your job: identify deviations from the playbook. For each deviation, return:
- label: short human-readable summary (e.g. "Notice period below 30 days")
- playbookExcerpt: the relevant playbook text
- targetExcerpt: the target text (or the empty string if the target is silent
  on a required item)
- targetParagraphIndex: the 0-based paragraph index in the target (or null
  for absence)
- severity: "required" (playbook says "must"/"required"/"reject"), "preferred"
  (softer language), or "note" (informational)

Output a single JSON object: { "deviations": [ ... ] }. No prose, no
markdown fences. If there are no deviations, return { "deviations": [] }.`;

export async function applyPlaybook(
  playbook: Playbook,
  targetMarkdown: string,
  llmCall: LlmCall,
): Promise<DeviationReport> {
  const userPrompt = [
    '=== PLAYBOOK ===',
    `Title: ${playbook.title}`,
    '',
    playbook.body,
    '',
    '=== TARGET DOCUMENT ===',
    targetMarkdown,
    '',
    'Return the deviation JSON now.',
  ].join('\n');

  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
  const raw = await llmCall(fullPrompt);
  const parsed = parseDeviations(raw);
  return {
    deviations: parsed,
    markdown: renderMarkdown(playbook, parsed),
  };
}

function parseDeviations(raw: string): Deviation[] {
  // Tolerate models that wrap in code fences.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned) as { deviations?: unknown };
  if (!Array.isArray(parsed.deviations)) return [];
  return parsed.deviations.map(coerceDeviation).filter((d): d is Deviation => d !== null);
}

function coerceDeviation(input: unknown): Deviation | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.label !== 'string' || typeof o.playbookExcerpt !== 'string') return null;
  const sev = o.severity === 'required' || o.severity === 'preferred' || o.severity === 'note'
    ? o.severity
    : 'note';
  return {
    label: o.label,
    playbookExcerpt: o.playbookExcerpt,
    targetExcerpt: typeof o.targetExcerpt === 'string' ? o.targetExcerpt : '',
    targetParagraphIndex: typeof o.targetParagraphIndex === 'number' ? o.targetParagraphIndex : null,
    severity: sev,
  };
}

function renderMarkdown(playbook: Playbook, deviations: Deviation[]): string {
  const header = [
    `# Deviation Report — ${playbook.title}`,
    '',
    `Playbook source: \`${playbook.source.filename}\``,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];
  if (deviations.length === 0) {
    return [...header, '_No deviations found._'].join('\n');
  }
  const sevMark = { required: '🔴', preferred: '🟡', note: '⚪' };
  const sections = deviations.map((d, i) => [
    `## ${i + 1}. ${d.label}`,
    `**Severity:** ${sevMark[d.severity]} ${d.severity}`,
    '',
    `**Playbook says:**`,
    `> ${d.playbookExcerpt.split('\n').join('\n> ')}`,
    '',
    `**Target ${d.targetParagraphIndex !== null ? `(¶${d.targetParagraphIndex + 1})` : '(absent)'}:**`,
    `> ${(d.targetExcerpt || '(absent)').split('\n').join('\n> ')}`,
    '',
  ].join('\n'));
  return [...header, ...sections].join('\n');
}
