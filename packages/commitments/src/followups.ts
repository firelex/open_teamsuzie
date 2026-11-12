import { fill, prompt } from './prompts.js';
import type { Commitment } from './store.js';

/**
 * Following up what others owe the owner (owed_to_you). Ported from Jeff
 * Desk (jeff_desk/followups.py). A follow-up is due a working day after the
 * due date, or 7 working days after the promise when there is none; then
 * every 7 days; at most MOST automatic ones; never while one waits for the
 * owner's approval, and never once stopped. The host drafts it with
 * `draftFollowUp` and holds it for approval; nothing is sent by itself.
 */

export const MOST_AUTOMATIC = 3;
export const FIRST_WITHOUT_DUE_WORKING_DAYS = 7;
export const EVERY_DAYS = 7;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The date `days` working days (Monday to Friday) after `start` (YYYY-MM-DD). */
export function afterWorkingDays(start: string, days: number): string {
    const d = new Date(`${start}T00:00:00Z`);
    let left = days;
    while (left > 0) {
        d.setUTCDate(d.getUTCDate() + 1);
        const wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6) left--;
    }
    return iso(d);
}

/** When an automatic follow-up of this commitment is due (YYYY-MM-DD), or null when none is. */
export function nextFollowUp(c: Commitment): string | null {
    if (c.direction !== 'owed_to_you' || c.status !== 'open' || c.followUpsStopped) return null;
    if (c.followUps.some((f) => f.status === 'pending')) return null;
    if (c.followUps.filter((f) => f.kind === 'auto').length >= MOST_AUTOMATIC) return null;
    if (c.followUps.length) {
        const last = new Date(Math.max(...c.followUps.map((f) => f.at)));
        last.setUTCDate(last.getUTCDate() + EVERY_DAYS);
        return iso(last);
    }
    if (c.due) return afterWorkingDays(c.due, 1);
    return afterWorkingDays(iso(new Date(c.createdAt)), FIRST_WITHOUT_DUE_WORKING_DAYS);
}

/** The follow-up email's text, written as the owner. Throws when the model writes nothing. */
export async function draftFollowUp(opts: {
    write: (prompt: string, maxTokens: number) => Promise<string>;
    ownerName: string;
    person: string;
    commitment: Commitment;
    /** What is known about the owner and about the person (free text), and the email the promise came from. */
    aboutOwner: string | null;
    aboutPerson: string | null;
    original: string | null;
}): Promise<string> {
    const earlier = opts.commitment.followUps.length;
    const text = (
        await opts.write(
            fill(prompt('followups/follow_up'), {
                user: opts.ownerName,
                person: opts.person,
                text: opts.commitment.text,
                due: opts.commitment.due ? ` (they said by ${opts.commitment.due})` : '',
                evidence: opts.commitment.evidence ?? '(not recorded)',
                about: opts.aboutOwner ?? '(nothing written yet)',
                known: opts.aboutPerson ?? '(nothing yet)',
                original: opts.original ?? '(not available)',
                earlier: earlier ? `${fill(prompt('followups/earlier'), { count: String(earlier), plural: earlier > 1 ? 's' : '' })} ` : '',
            }),
            800,
        )
    ).trim();
    if (!text) throw new Error('the model wrote an empty follow-up');
    return text;
}
