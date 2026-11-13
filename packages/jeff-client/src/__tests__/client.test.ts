import { describe, expect, it } from 'vitest';
import { JeffClient, JeffError } from '../index.js';

const q = { type: 'choice' as const, criteria: { yes: 'Yes', no: 'No' } };

function fakeFetch(status: number, body: unknown, seen?: { url?: string; init?: RequestInit }): typeof fetch {
    return (async (url: string, init: RequestInit) => {
        if (seen) Object.assign(seen, { url, init });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
}

describe('JeffClient', () => {
    it('sends the request with the key and returns the choice', async () => {
        const seen: { url?: string; init?: RequestInit } = {};
        const answer = { model: 'm', answers: { q: { type: 'choice', probabilities: { yes: 0.9, no: 0.1 }, choice: 'yes', confidence: 0.8 } }, usage: { input_tokens: 5, output_tokens: 0, orders: 1 }, timing: { model_ms: 1, server_ms: 2 } };
        const c = new JeffClient({ baseUrl: 'https://jeff.example/', apiKey: 'k', fetch: fakeFetch(200, answer, seen) });
        const r = await c.choose('m', { a: 'b' }, q);
        expect(r.choice).toBe('yes');
        expect(seen.url).toBe('https://jeff.example/v1/systemone');
        expect((seen.init!.headers as Record<string, string>).Authorization).toBe('Bearer k');
        expect(JSON.parse(String(seen.init!.body)).state).toEqual({ a: 'b' });
    });

    it('fails loudly on a refusal or a missing answer', async () => {
        await expect(new JeffClient({ baseUrl: 'https://j', apiKey: null, fetch: fakeFetch(401, 'bad key') }).choose('m', 's', q)).rejects.toThrow(/refused m \(401\): bad key/);
        await expect(new JeffClient({ baseUrl: 'https://j', apiKey: null, fetch: fakeFetch(200, { answers: {} }) }).choose('m', 's', q)).rejects.toBeInstanceOf(JeffError);
        expect(() => new JeffClient({ baseUrl: 'jeff.example', apiKey: null })).toThrow(/http/);
    });
});
