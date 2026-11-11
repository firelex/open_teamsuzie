import { describe, expect, it } from 'vitest';
import { Redactor, SensitiveDataBlockedError, createGuardedFetch, describeCounts, detect } from '../index.js';

const cats = (text: string) => detect(text).map((f) => [f.category, f.value]);

describe('detect', () => {
    it('finds personal data and privilege markers', () => {
        const text =
            'Write to jane.doe@acme.co.uk or call +44 20 7946 0958. Pay GB82 WEST 1234 5698 7654 32 or card 4111 1111 1111 1111. ' +
            'SSN 123-45-6789, NI number AB 12 34 56 C. PRIVILEGED & CONFIDENTIAL. Without prejudice save as to costs.';
        expect(cats(text)).toEqual([
            ['email', 'jane.doe@acme.co.uk'],
            ['phone', '+44 20 7946 0958'],
            ['iban', 'GB82 WEST 1234 5698 7654 32'],
            ['card', '4111 1111 1111 1111'],
            ['us_ssn', '123-45-6789'],
            ['uk_nino', 'AB 12 34 56 C'],
            ['privilege', 'PRIVILEGED & CONFIDENTIAL'],
            ['privilege', 'Without prejudice'],
        ]);
    });

    it('ignores numbers that fail checksums and ordinary legal text', () => {
        expect(cats('Card 4111 1111 1111 1112, IBAN GB00 WEST 1234 5698 7654 32')).toEqual([]);
        expect(cats('Clause 14.2 applies from 1 January 2026; claim no. BL-2026-001234; £1,250,000.')).toEqual([]);
    });
});

describe('Redactor', () => {
    it('numbers values consistently across texts', () => {
        const r = new Redactor();
        expect(r.redact('a@b.com and c@d.com')).toBe('[EMAIL 1] and [EMAIL 2]');
        expect(r.redact('again a@b.com, privileged and confidential')).toBe('again [EMAIL 1], privileged and confidential');
        expect(r.counts).toEqual({ email: 2 });
        expect(describeCounts({ email: 2, privilege: 1 })).toBe('2 email addresses and 1 privilege marker');
    });
});

describe('createGuardedFetch', () => {
    const request = (content: string) => ({
        method: 'POST',
        body: JSON.stringify({
            model: 'm',
            messages: [
                { role: 'user', content },
                { role: 'assistant', content: null, tool_calls: [{ function: { arguments: '{"to":"x@y.com"}' } }] },
                { role: 'tool', content: 'Result for x@y.com' },
            ],
        }),
    });

    it('redacts every message before sending and reports counts', async () => {
        let sent = '';
        const reports: unknown[] = [];
        const f = createGuardedFetch({
            mode: 'redact',
            fetchImpl: (async (_i: unknown, init?: RequestInit) => {
                sent = String(init?.body);
                return new Response('{}');
            }) as typeof fetch,
            onReport: (r) => reports.push(r),
        });
        await f('https://api.example/v1/chat/completions', request('Email jane@acme.com'));
        const body = JSON.parse(sent);
        expect(body.messages[0].content).toBe('Email [EMAIL 1]');
        expect(body.messages[1].tool_calls[0].function.arguments).toBe('{"to":"[EMAIL 2]"}');
        expect(body.messages[2].content).toBe('Result for [EMAIL 2]');
        expect(reports).toEqual([{ mode: 'redact', counts: { email: 3 } }]);
    });

    it('blocks when told to, and passes clean requests untouched', async () => {
        let calls = 0;
        const inner = (async () => {
            calls++;
            return new Response('{}');
        }) as typeof fetch;
        const block = createGuardedFetch({ mode: 'block', fetchImpl: inner });
        await expect(block('u', request('Without prejudice offer'))).rejects.toBeInstanceOf(SensitiveDataBlockedError);
        await expect(block('u', request('x'))).rejects.toThrow(/2 email addresses/);
        expect(calls).toBe(0);
        await block('u', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Clause 4' }] }) });
        expect(calls).toBe(1);
    });
});
