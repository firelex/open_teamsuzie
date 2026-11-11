import type { LlmCall } from './apply.js';

/**
 * One position in a structured playbook: what the firm wants on an issue,
 * what it can live with, and what it rejects.
 */
export interface PlaybookRule {
  id: string;
  /** Short issue name, e.g. "Limitation of liability cap". */
  title: string;
  /** The firm's preferred position. */
  standard: string;
  /** A position the firm will accept if the standard is not achievable. */
  fallback?: string | null;
  /** Positions the firm will not accept. */
  unacceptable?: string | null;
  /** Notes for the reviewer: why the position matters, what to look for. */
  guidance?: string | null;
  /** Model clause language the firm prefers. */
  sampleClause?: string | null;
}

export type RuleStatus =
  | 'meets_standard'
  | 'acceptable_fallback'
  | 'unacceptable'
  | 'missing'
  | 'not_applicable';

export const RULE_STATUSES: readonly RuleStatus[] = [
  'meets_standard',
  'acceptable_fallback',
  'unacceptable',
  'missing',
  'not_applicable',
] as const;

/**
 * A tracked-change edit keyed by content, in the shape
 * `@teamsuzie/docx` `proposeDocumentEdits` takes. `find` is deleted and
 * `replace` inserted; an empty `find` inserts at the point where
 * `context_before` meets `context_after`.
 */
export interface SuggestedEdit {
  find: string;
  replace: string;
  context_before: string;
  context_after: string;
  reason?: string;
  /** Set by the host after applying the edit to the document: 'applied',
   *  or why it could not be (e.g. 'not_found', 'ambiguous'). */
  applyStatus?: string;
}

export interface RuleFinding {
  ruleId: string;
  ruleTitle: string;
  status: RuleStatus;
  /** Verbatim text from the contract the verdict rests on; '' when absent. */
  excerpt: string;
  /** Plain-English reasoning for the verdict. */
  explanation: string;
  /** Edits that would bring the contract to the standard (or fallback). */
  edits: SuggestedEdit[];
}

export interface ReviewOptions {
  rules: PlaybookRule[];
  /** The contract as markdown or plain text. */
  contractText: string;
  llm: LlmCall;
  /** Rules checked at once. Default 3. */
  concurrency?: number;
  /** When to keep suggested edits. 'strict': whenever the standard is not
   *  met (fallback, unacceptable, missing). 'lenient': only when the
   *  position is unacceptable or missing. Default 'strict'. */
  posture?: 'strict' | 'lenient';
  signal?: AbortSignal;
  /** Called as each rule finishes, in completion order. */
  onFinding?: (finding: RuleFinding) => void;
}

const REVIEW_SYSTEM_PROMPT = `You are a careful contract reviewer working for a law firm.

You will receive one rule from the firm's playbook and the full text of a contract. The rule states the firm's
preferred position (STANDARD), a position it can accept (FALLBACK, optional), and positions it rejects
(UNACCEPTABLE, optional).

Decide which one describes the contract:
- "meets_standard": the contract already gives the firm its preferred position.
- "acceptable_fallback": the contract does not meet the standard but matches the FALLBACK. Only possible when the
  rule gives a FALLBACK; without one, a position short of the standard is "unacceptable".
- "unacceptable": the contract takes a position the firm rejects, or one worse than the fallback.
- "missing": the STANDARD requires the contract to contain something (a clause, a right, a protection) and the
  contract does not address it at all.
- "not_applicable": the issue does not arise for this kind of contract.

Some standards say what the contract must NOT contain (for example "no most-favoured-nation right" or "no
uncapped indemnity"). When such a contract is silent on the issue, it already gives the firm its preferred
position: that is "meets_standard", never "missing".

Then answer with a single JSON object, no prose and no code fences:
{
  "status": one of the five values above,
  "excerpt": the contract text your verdict rests on, copied exactly, word for word (empty string if missing),
  "explanation": two or three plain-English sentences a lawyer can read quickly,
  "edits": a list of edits that bring the contract to the STANDARD position (or the FALLBACK if the standard is
    clearly unrealistic), each { "find", "replace", "context_before", "context_after", "reason" }
}

Rules for edits:
- "find" is the exact contract text to replace, copied verbatim. "replace" is the new text. Keep edits minimal: change
  the words that need changing, not whole paragraphs.
- "context_before" and "context_after" are 5 to 15 words copied verbatim from the contract immediately before and
  after "find", so the location is unambiguous.
- To add a missing clause, use an empty "find" and put the new clause in "replace", with the context showing where
  it goes (for example, the end of the last sentence of a related clause and the start of the next one).
- Prefer the firm's SAMPLE CLAUSE wording when one is given.
- Return an empty "edits" list when no change is needed.`;

function ruleBlock(rule: PlaybookRule): string {
  const lines = [`TITLE: ${rule.title}`, `STANDARD: ${rule.standard}`];
  if (rule.fallback) lines.push(`FALLBACK: ${rule.fallback}`);
  if (rule.unacceptable) lines.push(`UNACCEPTABLE: ${rule.unacceptable}`);
  if (rule.guidance) lines.push(`GUIDANCE: ${rule.guidance}`);
  if (rule.sampleClause) lines.push(`SAMPLE CLAUSE: ${rule.sampleClause}`);
  return lines.join('\n');
}

/** Pull the first JSON object out of a model reply (tolerates fences). */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`model reply has no JSON object: ${cleaned.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function coerceEdit(input: unknown): SuggestedEdit | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  const edit: SuggestedEdit = {
    find: str(o.find),
    replace: str(o.replace),
    context_before: str(o.context_before),
    context_after: str(o.context_after),
  };
  if (edit.find === '' && edit.replace === '') return null;
  if (typeof o.reason === 'string' && o.reason) edit.reason = o.reason;
  return edit;
}

/** Parse and validate one rule's model reply. Throws on a malformed status. */
export function parseFinding(rule: PlaybookRule, raw: string): RuleFinding {
  const o = extractJsonObject(raw) as Record<string, unknown>;
  const status = o.status;
  if (typeof status !== 'string' || !(RULE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`rule "${rule.title}": model returned an invalid status ${JSON.stringify(status)}`);
  }
  const edits = Array.isArray(o.edits)
    ? o.edits.map(coerceEdit).filter((e): e is SuggestedEdit => e !== null)
    : [];
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    status: status as RuleStatus,
    excerpt: str(o.excerpt),
    explanation: str(o.explanation),
    edits,
  };
}

/** Why a finding cannot be right for its rule, or null when it can. */
export function findingProblem(rule: PlaybookRule, finding: RuleFinding): string | null {
  if (finding.status === 'acceptable_fallback' && !rule.fallback?.trim()) {
    return 'you answered "acceptable_fallback" but this rule has no FALLBACK position; choose between "meets_standard" and "unacceptable" (or "missing" / "not_applicable")';
  }
  // A standard can be met by silence (e.g. "no MFN right"), so only the
  // verdicts that rest on contract wording need an excerpt.
  if ((finding.status === 'acceptable_fallback' || finding.status === 'unacceptable') && !finding.excerpt.trim()) {
    return `you answered "${finding.status}" but gave no excerpt; quote the contract text your verdict rests on, word for word`;
  }
  return null;
}

/**
 * Check a contract against each rule (one model call per rule, a few at a
 * time) and return the findings in rule order. Rules that meet the
 * standard never carry edits; in 'lenient' posture only unacceptable or
 * missing positions do.
 */
export async function reviewAgainstRules(opts: ReviewOptions): Promise<RuleFinding[]> {
  const { rules, contractText, llm } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const posture = opts.posture ?? 'strict';
  const results: RuleFinding[] = new Array(rules.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < rules.length) {
      opts.signal?.throwIfAborted();
      const index = next++;
      const rule = rules[index]!;
      const prompt = [
        REVIEW_SYSTEM_PROMPT,
        '=== RULE ===',
        ruleBlock(rule),
        '=== CONTRACT ===',
        contractText,
        '=== END ===',
        'Return the JSON object now.',
      ].join('\n\n');
      let finding = parseFinding(rule, await llm(prompt));
      const problem = findingProblem(rule, finding);
      if (problem) {
        // One correction round; a second invalid answer fails the run.
        finding = parseFinding(
          rule,
          await llm(`${prompt}\n\nYour previous answer was not valid: ${problem}. Answer again with the corrected JSON object.`),
        );
        const again = findingProblem(rule, finding);
        if (again) throw new Error(`rule "${rule.title}": the model's answer is still invalid after a correction (${again})`);
      }
      const wantsEdits =
        finding.status === 'unacceptable' ||
        finding.status === 'missing' ||
        (posture === 'strict' && finding.status === 'acceptable_fallback');
      if (!wantsEdits) finding.edits = [];
      results[index] = finding;
      opts.onFinding?.(finding);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rules.length) }, worker));
  return results;
}

const DRAFT_SYSTEM_PROMPT = `You turn a law firm's negotiation guide into a structured playbook.

You will receive the guide's text. Identify each distinct issue it takes a position on (for example: limitation of
liability, indemnities, governing law, confidentiality term, assignment). For each issue return:
- "title": a short issue name
- "standard": the firm's preferred position, in one or two sentences
- "fallback": a position it says it can accept, or null if the guide gives none
- "unacceptable": positions it says it will not accept, or null if the guide gives none
- "guidance": brief notes for a reviewer, or null
- "sampleClause": model clause wording quoted from the guide, or null

Only use positions the guide actually states; do not invent any. Answer with a single JSON object, no prose and no
code fences: { "rules": [ ... ] }`;

export type DraftedRule = Omit<PlaybookRule, 'id'>;

/** Draft structured rules from a negotiation guide's text. */
export async function draftRulesFromGuide(guideText: string, llm: LlmCall): Promise<DraftedRule[]> {
  const raw = await llm([DRAFT_SYSTEM_PROMPT, '=== GUIDE ===', guideText, '=== END ==='].join('\n\n'));
  const o = extractJsonObject(raw) as { rules?: unknown };
  if (!Array.isArray(o.rules)) throw new Error('model reply has no "rules" list');
  const nullable = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const rules: DraftedRule[] = [];
  for (const r of o.rules) {
    if (typeof r !== 'object' || r === null) continue;
    const x = r as Record<string, unknown>;
    const title = nullable(x.title);
    const standard = nullable(x.standard);
    if (!title || !standard) continue;
    rules.push({
      title,
      standard,
      fallback: nullable(x.fallback),
      unacceptable: nullable(x.unacceptable),
      guidance: nullable(x.guidance),
      sampleClause: nullable(x.sampleClause),
    });
  }
  return rules;
}
