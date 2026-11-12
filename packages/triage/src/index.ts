import { fill, promptLoader } from '@teamsuzie/prompt-files';

/**
 * Triage of incoming email, ported from Jeff Desk (jeff_desk/triage.py):
 * each new email is read in full and sorted into one of four groups by the
 * model, and for emails the assistant can answer, a reply is drafted for the
 * user to edit, send or reject.
 *
 *   ignore       nothing to read or do (newsletters, automated notifications, receipts)
 *   reply_user   needs an answer only the user can give
 *   reply_draft  needs an answer the assistant can draft from the email, its conversation and what it knows
 *   other        worth knowing, no reply needed
 *
 * The host keeps the results, applies the user's filters (an ignored sender
 * or subject, before asking the model at all) and sends nothing without the
 * user. Nothing is guessed: a model answer that is not what was asked for
 * throws TriageError.
 */

const prompt = promptLoader(new URL('./prompts/', import.meta.url));

export const CATEGORIES = ['ignore', 'reply_user', 'reply_draft', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Characters of an email given to the model. */
export const TEXT_LIMIT = 6000;
/** The last this many emails of a conversation, for drafting. */
export const THREAD_MESSAGES = 4;

export class TriageError extends Error {
    readonly code = 'bad_model_answer';
}

/** An opened email, as triage reads it. */
export interface TriageEmail {
    from: string | null;
    to: string | null;
    cc?: string | null;
    date: string | null;
    subject: string | null;
    /** Attachment file names. */
    attachments?: string[];
    /** The plain text of the body. */
    body: string | null;
}

export type Write = (prompt: string, maxTokens: number) => Promise<string>;

/** An email as the model reads it: headers, then the body cut at TEXT_LIMIT (marked). */
export function emailText(m: TriageEmail): string {
    const head = [`From: ${m.from || 'unknown'}`, `To: ${m.to || 'unknown'}`];
    if (m.cc) head.push(`Cc: ${m.cc}`);
    head.push(`Date: ${m.date || 'unknown'}`, `Subject: ${m.subject || '(none)'}`);
    if (m.attachments?.length) head.push(`Attachments: ${m.attachments.join(', ')}`);
    const body = (m.body || '(no text)').replace(/\r\n/g, '\n');
    return `${head.join('\n')}\n\n${body.length > TEXT_LIMIT ? `${body.slice(0, TEXT_LIMIT)}\n[… the rest is cut]` : body}`;
}

const senderPart = (line: string | null | undefined) => (line ? fill(prompt('triage/sender'), { line }) : '');

export interface Verdict {
    category: Category;
    /** One short sentence to the user saying why. */
    reason: string;
    /** Whether a person wrote it to the user, in their own words. */
    personal: boolean;
}

/** The model's sorting answer, checked: a known group, a reason, and never "ignore" for personal correspondence. */
export function parseVerdict(text: string): Verdict {
    const found = text.match(/\{[\s\S]*\}/);
    if (!found) throw new TriageError(`the model did not answer with a JSON object: ${text.slice(0, 200)}`);
    let a: Record<string, unknown>;
    try {
        a = JSON.parse(found[0]) as Record<string, unknown>;
    } catch (err) {
        throw new TriageError(`the model's answer is not valid JSON (${err instanceof Error ? err.message : String(err)}): ${text.slice(0, 200)}`);
    }
    if (!CATEGORIES.includes(a.category as Category)) throw new TriageError(`the model gave no known group: ${text.slice(0, 200)}`);
    if (typeof a.reason !== 'string' || !a.reason.trim()) throw new TriageError(`the model gave no reason: ${text.slice(0, 200)}`);
    if (typeof a.written_to_the_user_personally !== 'boolean') throw new TriageError(`the model did not say whether a person wrote it: ${text.slice(0, 200)}`);
    if (a.written_to_the_user_personally && a.category === 'ignore') {
        throw new TriageError(`the model says a person wrote this to the user and still ignored it (${a.reason}); try again`);
    }
    return { category: a.category as Category, reason: a.reason.trim(), personal: a.written_to_the_user_personally };
}

/** Sort one email. `about`: what the assistant knows about the user; `senderLine`: the people directory's line about the sender. */
export async function classifyEmail(opts: { write: Write; account: string; about: string; senderLine?: string | null; email: TriageEmail }): Promise<Verdict> {
    const text = await opts.write(
        fill(prompt('triage/classify'), { account: opts.account, about: opts.about, sender: senderPart(opts.senderLine), email: emailText(opts.email) }),
        400,
    );
    return parseVerdict(text);
}

/** A reply in the user's voice, from the email and the last emails of its conversation (oldest first, without this one). */
export async function draftReply(opts: { write: Write; account: string; about: string; senderLine?: string | null; email: TriageEmail; earlier: TriageEmail[] }): Promise<string> {
    const thread = opts.earlier.length ? opts.earlier.slice(-THREAD_MESSAGES).map(emailText).join('\n\n---\n\n') : '(only this email)';
    const text = (
        await opts.write(
            fill(prompt('triage/draft_reply'), { account: opts.account, about: opts.about, sender: senderPart(opts.senderLine), thread, email: emailText(opts.email) }),
            1500,
        )
    ).trim();
    if (!text) throw new TriageError('the model wrote an empty reply');
    return text;
}

/** The note on top of a forwarded email, in the user's voice. `known`: the people directory's line about the recipient. */
export async function forwardNote(opts: { write: Write; account: string; about: string; recipient: string; known?: string | null; email: TriageEmail }): Promise<string> {
    const text = (
        await opts.write(
            fill(prompt('triage/forward_note'), {
                account: opts.account,
                recipient: opts.recipient,
                about: opts.about,
                email: emailText(opts.email),
                known: opts.known ? `What you know about ${opts.recipient}: ${opts.known}\n\n` : '',
            }),
            500,
        )
    ).trim();
    if (!text) throw new TriageError('the model wrote an empty note');
    return text;
}
