import { describe, expect, it } from 'vitest';
import { openAiCompatibleRouteModel } from './model.js';

describe('openAiCompatibleRouteModel', () => {
    it('asks the runtime for a streamed JSON reply and joins it', async () => {
        const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            calls.push({ url, body: JSON.parse(init.body as string), auth: new Headers(init.headers).get('authorization') });
            const chunks = ['{"steps":', '[{"goto":"home"}]}'].map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
            return new Response(chunks.join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }) as unknown as typeof fetch;
        const model = openAiCompatibleRouteModel({ baseUrl: 'http://gpu-box:8000/v1/', model: 'qwen3-72b', apiKey: 'k', maxTokens: 4000, jsonMode: true, fetchImpl });
        expect(model.id).toBe('qwen3-72b');
        expect(await model.complete('Fix the route.')).toBe('{"steps":[{"goto":"home"}]}');
        expect(calls[0]!.url).toBe('http://gpu-box:8000/v1/chat/completions');
        expect(calls[0]!.auth).toBe('Bearer k');
        expect(calls[0]!.body).toMatchObject({ model: 'qwen3-72b', stream: true, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Fix the route.' }] });
    });

    it('leaves out response_format when JSON mode is off', async () => {
        let body: Record<string, unknown> = {};
        const fetchImpl = (async (_url: string, init: RequestInit) => {
            body = JSON.parse(init.body as string);
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '{}' } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
        }) as unknown as typeof fetch;
        await openAiCompatibleRouteModel({ baseUrl: 'http://x/v1', model: 'm', maxTokens: 10, jsonMode: false, fetchImpl }).complete('x');
        expect(body.response_format).toBeUndefined();
    });

    it('throws when the runtime refuses', async () => {
        const fetchImpl = (async () => new Response('model not loaded', { status: 503 })) as unknown as typeof fetch;
        const model = openAiCompatibleRouteModel({ baseUrl: 'http://gpu-box:8000/v1', model: 'm', maxTokens: 10, jsonMode: false, fetchImpl });
        await expect(model.complete('x')).rejects.toThrow(/503/);
    });
});
