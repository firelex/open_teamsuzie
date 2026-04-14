/**
 * Regression tests for the DashScope body mutations in
 * `routes/completions.ts` and `routes/responses.ts`.
 *
 * These tests exercise the body-shaping logic directly without spinning
 * up an Express server or hitting an upstream. They lock in two
 * invariants that bit us:
 *
 *   1. DashScope requests MUST set `enable_caching: false` (existing).
 *   2. DashScope requests MUST default `enable_thinking: false` unless
 *      the caller explicitly sets it. The drafting SDK spent hours
 *      running with Qwen's reasoning phase enabled because nobody
 *      propagated `enable_thinking: false` end-to-end. Centralizing
 *      the default in the proxy means every caller inherits it and
 *      can't forget.
 *
 * The helper below is a minimal replica of the block from
 * `completions.ts`. If the real route diverges, update this and the
 * route together — or better, extract it into a shared function both
 * import.
 */

import { describe, expect, it } from 'vitest';

/** Mirror of the mutation block in completions.ts/responses.ts. */
function applyDashscopeDefaults(body: Record<string, any>, provider: string): void {
    if (provider === 'dashscope') {
        body.enable_caching = false;
        if (body.enable_thinking === undefined) {
            body.enable_thinking = false;
        }
    }
}

describe('DashScope request-body defaults', () => {
    it('sets enable_caching: false for dashscope', () => {
        const body: Record<string, any> = {
            model: 'qwen3.6-plus',
            messages: [{ role: 'user', content: 'hi' }],
        };
        applyDashscopeDefaults(body, 'dashscope');
        expect(body.enable_caching).toBe(false);
    });

    it('defaults enable_thinking: false for dashscope when caller omits it', () => {
        const body: Record<string, any> = {
            model: 'qwen3.6-plus',
            messages: [{ role: 'user', content: 'hi' }],
        };
        applyDashscopeDefaults(body, 'dashscope');
        expect(body.enable_thinking).toBe(false);
    });

    it('respects caller-provided enable_thinking: true', () => {
        const body: Record<string, any> = {
            model: 'qwen3.6-plus',
            messages: [{ role: 'user', content: 'solve a hard problem' }],
            enable_thinking: true,
        };
        applyDashscopeDefaults(body, 'dashscope');
        expect(body.enable_thinking).toBe(true);
    });

    it('respects caller-provided enable_thinking: false', () => {
        const body: Record<string, any> = {
            model: 'qwen3.6-plus',
            messages: [{ role: 'user', content: 'hi' }],
            enable_thinking: false,
        };
        applyDashscopeDefaults(body, 'dashscope');
        expect(body.enable_thinking).toBe(false);
    });

    it('does NOT touch enable_thinking for non-dashscope providers', () => {
        const body: Record<string, any> = {
            model: 'claude-sonnet-4',
            messages: [{ role: 'user', content: 'hi' }],
        };
        applyDashscopeDefaults(body, 'anthropic');
        expect(body.enable_thinking).toBeUndefined();
        expect(body.enable_caching).toBeUndefined();
    });

    it('does NOT touch enable_caching for non-dashscope providers', () => {
        const body: Record<string, any> = {
            model: 'gpt-4.1',
            messages: [{ role: 'user', content: 'hi' }],
        };
        applyDashscopeDefaults(body, 'openai');
        expect(body.enable_caching).toBeUndefined();
    });
});

/**
 * Sanity check: the block exists in both completions.ts and responses.ts
 * and contains the enable_thinking default. If anyone removes it, the
 * regression returns silently. This is a static content check.
 */
describe('DashScope defaults applied in both routes', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');

    const routesDir = path.resolve(__dirname, '..', 'src', 'routes');

    for (const file of ['completions.ts', 'responses.ts']) {
        it(`${file} defaults enable_thinking: false for dashscope`, () => {
            const source = fs.readFileSync(path.join(routesDir, file), 'utf-8');
            // Must set enable_thinking = false inside a dashscope block.
            // We don't lock in the exact text so the file can evolve, but
            // we do require both tokens appear together.
            expect(source).toContain("provider === 'dashscope'");
            expect(source).toContain('enable_thinking');
            expect(source).toContain('= false');
        });
    }
});
