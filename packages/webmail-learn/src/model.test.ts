import { describe, expect, it } from 'vitest';
import { openAiCompatibleRouteModel } from './model.js';

describe('openAiCompatibleRouteModel', () => {
    it('sends the conversation and tools, and returns the tool calls', async () => {
        let sent: Record<string, unknown> = {};
        let url = '';
        const fetchImpl = (async (u: string, init: RequestInit) => {
            url = u;
            sent = JSON.parse(init.body as string);
            return new Response(JSON.stringify({
                choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'try_target', arguments: '{"target":{"role":"button"}}' } }] } }],
                usage: { prompt_tokens: 10, completion_tokens: 5 },
            }), { status: 200 });
        }) as unknown as typeof fetch;
        const model = openAiCompatibleRouteModel({ baseUrl: 'http://gpu-box:8000/v1/', model: 'qwen3-72b', apiKey: 'k', maxTokens: 4000, fetchImpl });
        const turn = await model.chat([{ role: 'user', content: 'Fix it.' }], [{ name: 'try_target', description: 'd', parameters: { type: 'object' } }]);
        expect(model.id).toBe('qwen3-72b');
        expect(url).toBe('http://gpu-box:8000/v1/chat/completions');
        expect(sent).toMatchObject({ model: 'qwen3-72b', stream: false, tools: [{ type: 'function', function: { name: 'try_target' } }] });
        expect(turn).toEqual({ text: '', toolCalls: [{ id: 'c1', name: 'try_target', arguments: '{"target":{"role":"button"}}' }] });
    });

    it('throws when the runtime refuses', async () => {
        const fetchImpl = (async () => new Response('model not loaded', { status: 503 })) as unknown as typeof fetch;
        const model = openAiCompatibleRouteModel({ baseUrl: 'http://gpu-box:8000/v1', model: 'm', maxTokens: 10, fetchImpl });
        await expect(model.chat([{ role: 'user', content: 'x' }], [])).rejects.toThrow(/503/);
    });
});
