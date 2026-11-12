import { describe, expect, it } from 'vitest';
import { TEXT_LIMIT, TriageError, classifyEmail, draftReply, emailText, forwardNote, parseVerdict } from '../index.js';

const email = {
    from: 'tom@widget.com',
    to: 'jane@firm.test',
    date: '2026-11-12T09:00:00Z',
    subject: 'Side letter',
    attachments: ['letter.pdf'],
    body: 'Hi Jane,\r\nThe signed letter is attached. Thanks for your help.\r\nTom',
};

describe('emailText', () => {
    it('gives headers and the body, cut and marked when long', () => {
        expect(emailText(email)).toBe(
            'From: tom@widget.com\nTo: jane@firm.test\nDate: 2026-11-12T09:00:00Z\nSubject: Side letter\nAttachments: letter.pdf\n\nHi Jane,\nThe signed letter is attached. Thanks for your help.\nTom',
        );
        const long = emailText({ ...email, body: 'x'.repeat(TEXT_LIMIT + 10) });
        expect(long.endsWith('[… the rest is cut]')).toBe(true);
        expect(emailText({ from: null, to: null, date: null, subject: null, body: null })).toContain('Subject: (none)\n\n(no text)');
    });
});

describe('parseVerdict', () => {
    it('accepts a well-formed answer and refuses the rest', () => {
        expect(parseVerdict('Sure: {"written_to_the_user_personally": true, "category": "reply_draft", "reason": " Tom sent the signed letter. "}')).toEqual({
            category: 'reply_draft',
            reason: 'Tom sent the signed letter.',
            personal: true,
        });
        expect(() => parseVerdict('ignore it')).toThrow(TriageError);
        expect(() => parseVerdict('{"category": "spam", "reason": "x", "written_to_the_user_personally": false}')).toThrow(/no known group/);
        expect(() => parseVerdict('{"category": "other", "reason": " ", "written_to_the_user_personally": false}')).toThrow(/no reason/);
        expect(() => parseVerdict('{"category": "other", "reason": "x"}')).toThrow(/whether a person wrote it/);
        expect(() => parseVerdict('{"category": "ignore", "reason": "x", "written_to_the_user_personally": true}')).toThrow(/still ignored it/);
    });
});

describe('model calls', () => {
    it('sorts, drafts and writes a forwarding note with the right context', async () => {
        const seen: string[] = [];
        const write = (answer: string) => async (p: string) => (seen.push(p), answer);
        expect(
            await classifyEmail({
                write: write('{"written_to_the_user_personally": true, "category": "reply_draft", "reason": "Tom sent the letter."}'),
                account: 'jane@firm.test',
                about: 'Jane is a partner at the firm.',
                senderLine: 'Tom Widget, general counsel of Widget Corp, the other side in Acme v Widget',
                email,
            }),
        ).toMatchObject({ category: 'reply_draft' });
        expect(seen[0]).toContain('What you know about the sender (from the user\'s people directory): Tom Widget');
        expect(seen[0]).toContain('{"written_to_the_user_personally": true or false');

        const earlier = Array.from({ length: 6 }, (_, i) => ({ ...email, subject: `Earlier ${i}`, attachments: [] }));
        expect(await draftReply({ write: write(' Thanks Tom, received. Jane '), account: 'jane@firm.test', about: 'x', email, earlier })).toBe('Thanks Tom, received. Jane');
        expect(seen[1]).not.toContain('Earlier 1');
        expect(seen[1]).toContain('Earlier 2');
        expect(seen[1]).toContain('Earlier 5');
        await expect(draftReply({ write: write('  '), account: 'a', about: 'x', email, earlier: [] })).rejects.toThrow(/empty reply/);

        expect(await forwardNote({ write: write('Ann, please file this.'), account: 'a', about: 'x', recipient: 'Ann', known: 'Ann is the trainee', email })).toBe('Ann, please file this.');
        expect(seen[3]).toContain('What you know about Ann: Ann is the trainee');
    });
});
