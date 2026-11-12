import { fill, prompt } from './prompts.js';
import type { CommitmentSource, CommitmentStore, Direction } from './store.js';

/**
 * Finding commitments in what the assistant reads, and closing the ones
 * that are done. Ported from Jeff Desk (jeff_desk/commitments.py).
 *
 *   incoming email  promises others made to the owner (owed_to_you); and whether it fulfils an open one owed by its sender
 *   sent email      promises the owner made (you_owe); and whether it fulfils an open one the owner owed its recipients
 *   chat messages   (Teams, WhatsApp) promises the other person made and the owner made in the new messages of a chat
 *   assistant chat  things the owner asks the assistant to do later (assistant_owes) or says they promised (you_owe)
 *
 * Each commitment found must quote the words it came from, and the code
 * checks that they are really there: nothing is kept on the model's word
 * alone. A model answer that is not what was asked for raises
 * CommitmentFindError; nothing from it is kept.
 */

const MAX_TEXT = 6000;
const TRACKED_SHOWN = 60;

export class CommitmentFindError extends Error {
    readonly code = 'bad_model_answer';
}

/** Text reduced to lower-case words (and @ . $ £ € %), so a quote is found whatever the spacing and punctuation. */
export function plain(text: string | null | undefined): string {
    return (text ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_@.$£€%]+/gu, ' ')
        .split(' ')
        .filter(Boolean)
        .join(' ');
}

function answerJson(text: string): Record<string, unknown> {
    const found = text.match(/\{[\s\S]*\}/);
    if (!found) throw new CommitmentFindError(`the model's answer is not a JSON object: ${text.slice(0, 200)}`);
    try {
        return JSON.parse(found[0]) as Record<string, unknown>;
    } catch (err) {
        throw new CommitmentFindError(`the model's answer is not valid JSON (${err instanceof Error ? err.message : String(err)}): ${text.slice(0, 200)}`);
    }
}

interface Found {
    direction: Direction;
    text: string;
    counterparty: string | null;
    due: string | null;
    evidence: string;
}

/** The commitments whose evidence is really in the source, and how many were rejected. */
function foundItems(answer: Record<string, unknown>, allowed: string[], sourceWords: string, mapDirection: (d: string) => string = (d) => d): { kept: Found[]; rejected: number } {
    const items = answer.commitments;
    if (!Array.isArray(items)) throw new CommitmentFindError(`the answer has no "commitments" list: ${JSON.stringify(answer).slice(0, 200)}`);
    const kept: Found[] = [];
    let rejected = 0;
    for (const raw of items) {
        const c = raw as Record<string, unknown>;
        const direction = typeof c?.direction === 'string' ? mapDirection(c.direction) : '';
        if (!c || !allowed.includes(direction) || typeof c.text !== 'string' || c.text.trim().length < 3) {
            throw new CommitmentFindError(`a commitment is not a direction and a text: ${JSON.stringify(c).slice(0, 200)}`);
        }
        // A date or none: a vague one is no date.
        const due = typeof c.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : null;
        const evidence = String(c.evidence ?? '');
        if (!plain(evidence) || !sourceWords.includes(plain(evidence))) {
            rejected++;
            continue;
        }
        kept.push({
            direction: direction as Direction,
            text: c.text.split(/\s+/).filter(Boolean).join(' '),
            counterparty: typeof c.counterparty === 'string' && c.counterparty ? c.counterparty : null,
            due,
            evidence,
        });
    }
    return { kept, rejected };
}

export interface FinderEmail {
    messageId: string;
    sender: string | null;
    to: string | null;
    cc?: string | null;
    subject: string | null;
    date: string | null;
    body: string;
}

export interface FinderChatMessage {
    sender: string;
    fromMe: boolean;
    text: string;
}

export interface FindResult {
    added: number[];
    closed: number[];
    rejected: number;
}

export interface FinderOptions {
    store: CommitmentStore;
    /** The model: a prompt in, its text answer out. */
    write: (prompt: string, maxTokens: number) => Promise<string>;
    ownerId: string;
    /** The owner's full name, as the prompts call them. */
    ownerName: string;
    /** The assistant's name in chats with the owner (e.g. "Counsel"). */
    assistantName: string;
    /** The date as text, e.g. "Thursday 12 November 2026 (2026-11-12)". */
    today: () => string;
    /** The subject new commitments belong to (e.g. the matter of an email), when the host knows it. */
    subject?: { type: string; id: string } | null;
}

export function todayText(now = new Date()): string {
    const day = now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
    return `${day} (${now.toISOString().slice(0, 10)})`;
}

export class CommitmentFinder {
    private readonly first: string;

    constructor(private readonly o: FinderOptions) {
        this.first = o.ownerName.split(/\s+/)[0] || 'the user';
    }

    private naming(): Record<string, string> {
        return { user: this.o.ownerName, first: this.first, today: this.o.today(), tracked: this.tracked() };
    }

    /** The open commitments, so the model does not add one again in other words (the newest TRACKED_SHOWN). */
    private tracked(): string {
        return (
            this.o.store
                .list({ ownerId: this.o.ownerId })
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, TRACKED_SHOWN)
                .map((c) => `- ${c.text} (with ${c.counterparty ?? 'nobody named'})`)
                .join('\n') || '(none)'
        );
    }

    /** Commitments in an email (received, or sent by the owner), and the open ones it fulfils. */
    async email(message: FinderEmail, sent: boolean, account: string): Promise<FindResult> {
        const people = new Set(
            [message.sender, message.to, message.cc]
                .filter(Boolean)
                .join(',')
                .split(/[,;]/)
                .map((p) => p.trim().toLowerCase())
                .filter(Boolean),
        );
        const openItems = this.o.store
            .list({ ownerId: this.o.ownerId, direction: sent ? 'you_owe' : 'owed_to_you' })
            .filter((c) => people.has((c.counterparty ?? '').toLowerCase()));
        const text = [
            `From: ${message.sender}`,
            `To: ${message.to}`,
            ...(message.cc ? [`Cc: ${message.cc}`] : []),
            `Subject: ${message.subject}`,
            '',
            message.body.slice(0, MAX_TEXT),
        ].join('\n');
        const p = fill(prompt('commitments/email'), {
            ...this.naming(),
            direction_words: sent ? 'that the user sent' : 'that the user received',
            date: message.date ?? 'unknown',
            kinds: prompt(sent ? 'commitments/sent_kinds' : 'commitments/incoming_kinds'),
            directions: sent ? '"you_owe" or "owed_to_you"' : '"owed_to_you"',
            open_part: openItems.length
                ? fill(prompt('commitments/email_open'), { open: openItems.map((c) => `- ${c.id}: ${c.text} (with ${c.counterparty})`).join('\n') })
                : '',
            email: text,
        });
        const answer = answerJson(await this.o.write(p, 1200));
        const { kept, rejected } = foundItems(answer, sent ? ['you_owe', 'owed_to_you'] : ['owed_to_you'], plain(text));
        const fulfils = this.checkFulfils(answer, openItems.map((c) => c.id));
        const source: CommitmentSource = { kind: sent ? 'sent_email' : 'email', account, messageId: message.messageId, subject: message.subject ?? undefined };
        const added = kept.map((k) =>
            this.o.store.add({
                ownerId: this.o.ownerId,
                direction: k.direction,
                text: k.text,
                counterparty: k.counterparty ?? (sent ? message.to : message.sender),
                due: k.due,
                evidence: k.evidence,
                source,
                subject: this.o.subject ?? null,
            }),
        );
        for (const f of fulfils) {
            this.o.store.finish(f, 'done', `Done according to the email “${message.subject || '(no subject)'}” of ${(message.date ?? '').slice(0, 10)}`);
        }
        return { added, closed: fulfils, rejected };
    }

    /**
     * Commitments in the new messages of a Teams or WhatsApp chat with
     * `person` (`earlier`: messages before them, for context), and the open
     * ones with that person they fulfil. What each side owes is quoted from
     * their own new messages.
     */
    async chatMessages(label: string, person: string, earlier: FinderChatMessage[], fresh: FinderChatMessage[], source: CommitmentSource): Promise<FindResult> {
        if (fresh.length === 0) return { added: [], closed: [], rejected: 0 };
        const openItems = this.o.store.list({ ownerId: this.o.ownerId }).filter((c) => (c.counterparty ?? '').toLowerCase() === person.toLowerCase());
        const line = (m: FinderChatMessage) => `${m.fromMe ? 'User' : m.sender}: ${m.text}`;
        const chat = [...earlier.map(line), '---- NEW ----', ...fresh.map(line)].join('\n');
        const p = fill(prompt('commitments/chat_messages'), {
            ...this.naming(),
            label,
            person,
            chat,
            open_part: openItems.length
                ? fill(prompt('commitments/chat_open'), {
                      person,
                      open: openItems.map((c) => `- ${c.id}: ${c.text} (${c.direction === 'you_owe' ? 'the user owes it' : `${person} owes it`})`).join('\n'),
                  })
                : '',
        });
        const answer = answerJson(await this.o.write(p, 1000));
        if (!Array.isArray(answer.commitments)) throw new CommitmentFindError(`the answer has no "commitments" list: ${JSON.stringify(answer).slice(0, 200)}`);
        const said = (mine: boolean) => plain(fresh.filter((m) => m.fromMe === mine).map((m) => m.text).join(' '));
        const all = answer.commitments as Array<Record<string, unknown>>;
        const theirs = foundItems({ commitments: all.filter((c) => c?.direction !== 'you_owe') }, ['owed_to_you'], said(false));
        const mine = foundItems({ commitments: all.filter((c) => c?.direction === 'you_owe') }, ['you_owe'], said(true));
        const fulfils = this.checkFulfils(answer, openItems.map((c) => c.id));
        // Whom a commitment is with: for what someone owes the owner, whoever wrote the message it is quoted from.
        const owner = (k: Found) => {
            if (k.direction !== 'owed_to_you') return person;
            const quoted = plain(k.evidence);
            return fresh.find((m) => !m.fromMe && plain(m.text).includes(quoted))?.sender ?? person;
        };
        const added = [...theirs.kept, ...mine.kept].map((k) =>
            this.o.store.add({
                ownerId: this.o.ownerId,
                direction: k.direction,
                text: k.text,
                counterparty: owner(k),
                due: k.due,
                evidence: k.evidence,
                source,
                subject: this.o.subject ?? null,
            }),
        );
        for (const f of fulfils) this.o.store.finish(f, 'done', `Done according to the ${label} chat with ${person}`);
        return { added, closed: fulfils, rejected: theirs.rejected + mine.rejected };
    }

    /** Commitments the owner stated in a conversation with the assistant. `ownerWords`: their own messages only. */
    async assistantChat(transcript: string, ownerWords: string, conversation: string): Promise<FindResult> {
        if (!transcript.includes('User: ')) return { added: [], closed: [], rejected: 0 };
        const p = fill(prompt('commitments/assistant_chat'), { ...this.naming(), assistant: this.o.assistantName, transcript });
        const answer = answerJson(await this.o.write(p, 1000));
        const { kept, rejected } = foundItems(answer, ['assistant_owes', 'you_owe'], plain(ownerWords));
        const added = kept.map((k) =>
            this.o.store.add({
                ownerId: this.o.ownerId,
                direction: k.direction,
                text: k.text,
                counterparty: k.counterparty,
                due: k.due,
                evidence: k.evidence,
                source: { kind: 'chat', conversation },
                subject: this.o.subject ?? null,
            }),
        );
        return { added, closed: [], rejected };
    }

    private checkFulfils(answer: Record<string, unknown>, shown: number[]): number[] {
        const fulfils = answer.fulfils ?? [];
        if (!Array.isArray(fulfils) || fulfils.some((f) => !shown.includes(f as number))) {
            throw new CommitmentFindError(`the answer closes commitments it was not shown: ${JSON.stringify(fulfils)}`);
        }
        return fulfils as number[];
    }
}
