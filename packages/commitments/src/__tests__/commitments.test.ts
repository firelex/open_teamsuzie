import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import {
    COMMITMENTS_MIGRATIONS,
    CommitmentFindError,
    CommitmentFinder,
    CommitmentStore,
    afterWorkingDays,
    nextFollowUp,
    plain,
    prompt,
    draftFollowUp,
} from '../index.js';

function setup(answers: string[]) {
    let now = Date.UTC(2026, 10, 12, 9);
    const store = new CommitmentStore({ db: openDb({ path: ':memory:', migrations: COMMITMENTS_MIGRATIONS }), now: () => now });
    const prompts: string[] = [];
    const finder = new CommitmentFinder({
        store,
        write: async (p) => {
            prompts.push(p);
            const a = answers.shift();
            if (a === undefined) throw new Error('no answer left');
            return a;
        },
        ownerId: 'jane@firm.test',
        ownerName: 'Jane Smith',
        assistantName: 'Counsel',
        today: () => 'Thursday 12 November 2026 (2026-11-12)',
        subject: { type: 'matter', id: 'm1' },
    });
    return { store, finder, prompts, setNow: (t: number) => (now = t) };
}

const email = {
    messageId: 'e1',
    sender: 'tom@widget.com',
    to: 'jane@firm.test',
    subject: 'Side letter',
    date: '2026-11-12T09:00:00Z',
    body: 'Hi Jane,\nI will send the signed side letter by Friday 13 November.\nTom',
};

describe('prompts', () => {
    it('load with their includes and fill every placeholder', () => {
        for (const name of ['commitments/email', 'commitments/chat_messages', 'commitments/assistant_chat', 'followups/follow_up']) {
            expect(prompt(name)).not.toMatch(/\[\[include/);
        }
        expect(prompt('commitments/incoming_kinds')).toContain('may need chasing'); // obligation.txt, included
    });
});

describe('CommitmentFinder.email', () => {
    it('keeps commitments whose evidence is in the email and rejects invented ones', async () => {
        const { finder, store, prompts } = setup([
            JSON.stringify({
                commitments: [
                    { direction: 'owed_to_you', text: 'Tom will send Jane the signed side letter', counterparty: 'Tom', due: '2026-11-13', evidence: 'I will send the signed  side letter by Friday' },
                    { direction: 'owed_to_you', text: 'Tom will pay the invoice', due: 'next week', evidence: 'I will pay the invoice' },
                ],
                fulfils: [],
            }),
        ]);
        const r = await finder.email(email, false, 'jane@firm.test');
        expect(r).toMatchObject({ closed: [], rejected: 1 });
        const [c] = store.list({ ownerId: 'jane@firm.test' });
        expect(c).toMatchObject({ direction: 'owed_to_you', counterparty: 'Tom', due: '2026-11-13', subject: { type: 'matter', id: 'm1' }, source: { kind: 'email', messageId: 'e1' } });
        expect(prompts[0]).toContain('From: tom@widget.com');
        expect(prompts[0]).toContain('call Jane Smith "Jane"');
    });

    it('closes open commitments the email fulfils, and refuses to close ones it was not shown', async () => {
        const { finder, store } = setup([]);
        const id = store.add({ ownerId: 'jane@firm.test', direction: 'owed_to_you', text: 'Tom will send the side letter', counterparty: 'tom@widget.com', due: null, evidence: null, source: { kind: 'manual' } });
        const ok = setup([JSON.stringify({ commitments: [], fulfils: [id] })]);
        const id2 = ok.store.add({ ownerId: 'jane@firm.test', direction: 'owed_to_you', text: 'Tom will send the side letter', counterparty: 'tom@widget.com', due: null, evidence: null, source: { kind: 'manual' } });
        expect((await ok.finder.email(email, false, 'a')).closed).toEqual([id2]);
        expect(ok.store.get(id2).status).toBe('done');
        const bad = setup([JSON.stringify({ commitments: [], fulfils: [999] })]);
        await expect(bad.finder.email(email, false, 'a')).rejects.toBeInstanceOf(CommitmentFindError);
        await expect(setup(['not json']).finder.email(email, false, 'a')).rejects.toThrow(/not a JSON object/);
        expect(store.get(id).status).toBe('open');
    });
});

describe('CommitmentFinder.chatMessages', () => {
    it('quotes each side from their own messages and files promises under whoever made them', async () => {
        const { finder, store } = setup([
            JSON.stringify({
                commitments: [
                    { direction: 'owed_to_you', text: 'Tom will review the draft', due: '2026-11-12', evidence: 'can do this afternoon' },
                    { direction: 'you_owe', text: 'Jane will send the term sheet', due: null, evidence: 'will send the term sheet in 10 minutes' },
                    // Jane's words claimed as Tom's promise: rejected.
                    { direction: 'owed_to_you', text: 'Tom will send the term sheet', due: null, evidence: 'will send the term sheet' },
                ],
                fulfils: [],
            }),
        ]);
        const r = await finder.chatMessages(
            'Teams',
            'Tom Widget',
            [{ sender: 'User', fromMe: true, text: 'Could you review the draft?' }],
            [
                { sender: 'Tom Widget', fromMe: false, text: 'Yes, can do this afternoon' },
                { sender: 'Jane', fromMe: true, text: 'Thanks, will send the term sheet in 10 minutes' },
            ],
            { kind: 'teams', chatId: 'c1' },
        );
        expect(r.rejected).toBe(1);
        expect(store.list({ ownerId: 'jane@firm.test' }).map((c) => [c.direction, c.counterparty])).toEqual([
            ['owed_to_you', 'Tom Widget'],
            ['you_owe', 'Tom Widget'],
        ]);
    });
});

describe('CommitmentFinder.assistantChat', () => {
    it('keeps what the owner asked the assistant to track, quoted from their own words', async () => {
        const { finder, store, prompts } = setup([
            JSON.stringify({ commitments: [{ direction: 'assistant_owes', text: 'Counsel will remind Jane to chase Widget', counterparty: null, due: '2026-11-19', evidence: 'remind me next Thursday to chase Widget' }] }),
        ]);
        await finder.assistantChat('User: remind me next Thursday to chase Widget\nCounsel: Will do.', 'remind me next Thursday to chase Widget', 'chat-1');
        expect(store.list({ ownerId: 'jane@firm.test' })[0]).toMatchObject({ direction: 'assistant_owes', due: '2026-11-19' });
        expect(prompts[0]).toContain('and Counsel, the user');
    });
});

describe('store and follow-ups', () => {
    it('does not keep the same open promise twice, and orders open ones by due date', () => {
        const { store } = setup([]);
        const base = { ownerId: 'jane@firm.test', direction: 'you_owe' as const, counterparty: 'Tom', evidence: null, source: { kind: 'manual' } };
        const a = store.add({ ...base, text: 'Send the  term sheet', due: '2026-11-20' });
        expect(store.add({ ...base, text: 'send the term sheet', due: null })).toBe(a);
        store.add({ ...base, text: 'Call Tom', due: '2026-11-13' });
        store.add({ ...base, text: 'Read the lease', due: null });
        expect(store.list({ ownerId: 'JANE@firm.test' }).map((c) => c.text)).toEqual(['Call Tom', 'Send the term sheet', 'Read the lease']);
        expect(() => store.add({ ...base, text: 'x', due: null })).toThrow(/needs a text/);
        expect(() => store.add({ ...base, text: 'Valid', due: '2026-02-30' })).toThrow(/not a date/);
    });

    it('schedules follow-ups on working days, then weekly, at most three, never while one waits', () => {
        expect(afterWorkingDays('2026-11-13', 1)).toBe('2026-11-16'); // Friday -> Monday
        const { store } = setup([]);
        const id = store.add({ ownerId: 'j', direction: 'owed_to_you', text: 'Tom sends the letter', counterparty: 'Tom', due: '2026-11-13', evidence: null, source: { kind: 'manual' } });
        expect(nextFollowUp(store.get(id))).toBe('2026-11-16');
        const noDue = store.add({ ownerId: 'j', direction: 'owed_to_you', text: 'Tom signs', counterparty: 'Tom', due: null, evidence: null, source: { kind: 'manual' } });
        expect(nextFollowUp(store.get(noDue))).toBe('2026-11-23'); // 7 working days after Thu 12 Nov
        store.addFollowUp(id, { kind: 'auto', at: Date.UTC(2026, 10, 16), status: 'pending', ref: 'apr-1' });
        expect(nextFollowUp(store.get(id))).toBeNull();
        expect(store.updateFollowUp('apr-1', { status: 'sent' })).toBe(id);
        expect(nextFollowUp(store.get(id))).toBe('2026-11-23');
        store.addFollowUp(id, { kind: 'auto', at: Date.UTC(2026, 10, 23), status: 'sent', ref: null });
        store.addFollowUp(id, { kind: 'auto', at: Date.UTC(2026, 10, 30), status: 'sent', ref: null });
        expect(nextFollowUp(store.get(id))).toBeNull();
        store.stopFollowUps(noDue);
        expect(nextFollowUp(store.get(noDue))).toBeNull();
    });

    it('drafts a follow-up and refuses an empty one', async () => {
        const { store } = setup([]);
        const id = store.add({ ownerId: 'j', direction: 'owed_to_you', text: 'Tom sends the letter', counterparty: 'Tom', due: null, evidence: 'I will send it', source: { kind: 'manual' } });
        let seen = '';
        const text = await draftFollowUp({
            write: async (p) => ((seen = p), ' Hi Tom, any news on the letter? Jane '),
            ownerName: 'Jane Smith',
            person: 'Tom',
            commitment: store.get(id),
            aboutOwner: null,
            aboutPerson: null,
            original: null,
        });
        expect(text).toBe('Hi Tom, any news on the letter? Jane');
        expect(seen).toContain('Their own words: "I will send it"');
        await expect(draftFollowUp({ write: async () => ' ', ownerName: 'J', person: 'T', commitment: store.get(id), aboutOwner: null, aboutPerson: null, original: null })).rejects.toThrow(/empty/);
        expect(plain('Send the £5,000 cheque!')).toBe('send the £5 000 cheque');
    });
});
