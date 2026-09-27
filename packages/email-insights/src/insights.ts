import { z } from 'zod';

/** Any model client that takes a system prompt and a user prompt and returns parsed JSON. */
export interface InsightModel {
  json(system: string, user: string): Promise<unknown>;
}

export interface InsightThread {
  subject: string | null;
  messages: Array<{
    id: string;
    from: string;
    /** ISO date. */
    sentAt: string;
    text: string;
    /** Offset into `text` where quoted history starts; null when there is none. It is left out of the prompt. */
    quotedFrom: number | null;
  }>;
}

export const ASKS = ['reply_needed', 'review_attachment', 'signature', 'decision', 'fyi'] as const;
export type Asks = (typeof ASKS)[number];

export interface ThreadSummary {
  summary: string;
  short: string;
  asks: Asks;
}

export interface ThreadIssue {
  issue: string;
  short: string;
  status: 'open' | 'agreed' | 'unclear';
  sources: string[];
}

/** The model's reply could not be used, even after one repair. */
export class InsightError extends Error {
  constructor(message: string, readonly problems: string[]) {
    super(message);
    this.name = 'InsightError';
  }
}

const SETTING = `You help a lawyer read an email conversation. The lawyer works at a law firm and the emails are usually with the firm's client, the other side of a transaction (the party across the table) and that side's lawyers. In what you write, "we" and "our" mean the lawyer's firm and its client, and "they" and "their" mean the other side. Use only what the emails say. Never invent a fact, a number, a date, a name or a position. British English. No greetings.`;

export const SUMMARY_SYSTEM_PROMPT = `${SETTING}

Read the conversation and reply with one JSON object:
{"summary": "...", "short": "...", "asks": "..."}

- "summary": one sentence of at most 120 characters saying where the conversation stands now.
- "short": the same in at most 40 characters, for a small smart-glasses display and for reading aloud. It must make sense on its own.
- "asks": what the newest messages ask of the lawyer, exactly one of:
  - "reply_needed": someone is waiting for the lawyer to answer or act;
  - "review_attachment": a document is attached for the lawyer to review;
  - "signature": something needs signing;
  - "decision": the lawyer or the client has to choose between options;
  - "fyi": nothing is asked; it is for information only.

Reply with the JSON object only.`;

export const ISSUES_SYSTEM_PROMPT = `${SETTING}

List the points under discussion in the conversation: each point where the two sides have taken positions, asked for something, or agreed something. Reply with one JSON object:
{"issues": [{"issue": "...", "short": "...", "status": "...", "sources": ["..."]}]}

- "issue": one sentence of at most 160 characters saying what the point is and where it stands.
- "short": the same in at most 40 characters, for a small smart-glasses display and for reading aloud.
- "status": "open" when it is not settled, "agreed" when both sides have accepted it, "unclear" when the emails do not say.
- "sources": the ids of the messages the point comes from, exactly as given (for example "m1").

At most 8 points, the most important first. An empty list is fine when the emails discuss nothing. Reply with the JSON object only.`;

const SummarySchema = z.object({
  summary: z.string().trim().min(1).max(120),
  short: z.string().trim().min(1).max(40),
  asks: z.enum(ASKS),
});

const IssuesSchema = z.object({
  issues: z.array(z.object({
    issue: z.string().trim().min(1).max(160),
    short: z.string().trim().min(1).max(40),
    status: z.enum(['open', 'agreed', 'unclear']),
    sources: z.array(z.string()).min(1),
  })).max(8),
});

/** The conversation as the model sees it: oldest first, each message's own words without the history it quotes. */
function conversation(thread: InsightThread): string {
  if (thread.messages.length === 0) throw new Error('The conversation has no messages');
  const lines = [`Subject: ${thread.subject ?? '(none)'}`, ''];
  for (const m of [...thread.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    const own = (m.quotedFrom === null ? m.text : m.text.slice(0, m.quotedFrom)).trim();
    lines.push(`Message ${m.id}, from ${m.from}, sent ${m.sentAt}:`, own || '(no text of its own)', '');
  }
  return lines.join('\n');
}

function problemsOf(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const where = i.path.join('.') || 'the reply';
    if (i.code === 'too_big' && i.type === 'string') return `"${where}" is longer than ${i.maximum} characters`;
    if (i.code === 'too_big' && i.type === 'array') return `"${where}" has more than ${i.maximum} items`;
    if (i.code === 'invalid_enum_value') return `"${where}" must be one of ${i.options.map((o) => `"${String(o)}"`).join(', ')}, not "${String(i.received)}"`;
    return `"${where}": ${i.message}`;
  });
}

async function ask<T>(model: InsightModel, system: string, user: string, check: (reply: unknown) => { ok: true; value: T } | { ok: false; problems: string[] }, what: string): Promise<T> {
  const first = await model.json(system, user);
  const checked = check(first);
  if (checked.ok) return checked.value;
  const repair = [
    user,
    '',
    'Your previous reply could not be used because of these problems:',
    ...checked.problems.map((p) => `- ${p}`),
    '',
    'Your previous reply was:',
    JSON.stringify(first),
    '',
    'Reply again with a corrected JSON object only.',
  ].join('\n');
  const second = check(await model.json(system, repair));
  if (second.ok) return second.value;
  throw new InsightError(`The ${what} could not be written: ${second.problems.join('; ')}`, second.problems);
}

/** A one-sentence summary of where the conversation stands, its short form, and what it asks of the lawyer. */
export async function summariseThread(model: InsightModel, thread: InsightThread): Promise<ThreadSummary> {
  const user = `Here is the conversation.\n\n${conversation(thread)}\nReply with the JSON object only.`;
  return ask(model, SUMMARY_SYSTEM_PROMPT, user, (reply) => {
    const parsed = SummarySchema.safeParse(reply);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
  }, 'summary');
}

/** The points under discussion, each pointing at the messages it comes from. */
export async function threadIssues(model: InsightModel, thread: InsightThread): Promise<ThreadIssue[]> {
  const ids = new Set(thread.messages.map((m) => m.id));
  const user = `Here is the conversation.\n\n${conversation(thread)}\nReply with the JSON object only.`;
  return ask(model, ISSUES_SYSTEM_PROMPT, user, (reply) => {
    const parsed = IssuesSchema.safeParse(reply);
    if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
    const unknown = parsed.data.issues.flatMap((i, n) => i.sources.filter((s) => !ids.has(s)).map((s) => `issue ${n + 1} cites message "${s}", which is not in the conversation; use only the message ids given`));
    return unknown.length ? { ok: false, problems: unknown } : { ok: true, value: parsed.data.issues };
  }, 'list of issues');
}
