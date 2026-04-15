/**
 * Unit tests for llm-proxy's provider key store.
 *
 * Covers the exact bugs we hit:
 *   - After admin pushes keys, `getProviderKey` returns them.
 *   - `setProviderKeys` correctly wipes previous keys (no stale leaks).
 *   - `getProviderKey` for an unknown provider returns undefined
 *     (so the route can 502 with a clear error, not silently succeed).
 *   - QWEN_API_KEY falls back into the dashscope slot.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
    getProviderKey,
    setProviderKeys,
    setAgentOrgMapping,
    setOrgProviderKeys,
    resolveModel,
} from '../src/config.js';

describe('provider key store', () => {
    beforeEach(() => {
        setProviderKeys({});
        setAgentOrgMapping({});
        setOrgProviderKeys({});
    });

    it('setProviderKeys populates the global store', () => {
        setProviderKeys({
            OPENAI_API_KEY: 'sk-openai-test',
            DASHSCOPE_API_KEY: 'sk-dashscope-test',
            ANTHROPIC_API_KEY: 'sk-ant-test',
            GEMINI_API_KEY: 'sk-gemini-test',
        });
        expect(getProviderKey('openai')).toBe('sk-openai-test');
        expect(getProviderKey('dashscope')).toBe('sk-dashscope-test');
        expect(getProviderKey('anthropic')).toBe('sk-ant-test');
        expect(getProviderKey('gemini')).toBe('sk-gemini-test');
    });

    it('unknown provider returns undefined', () => {
        setProviderKeys({ OPENAI_API_KEY: 'sk-openai-test' });
        expect(getProviderKey('nonexistent-provider')).toBeUndefined();
    });

    it('missing provider returns undefined (not empty string, not default)', () => {
        setProviderKeys({ OPENAI_API_KEY: 'sk-openai-test' });
        // Regression: dashscope silently succeeding with an empty/default
        // key would hit upstream and get a confusing 401 instead of a
        // clean 502 at the proxy layer.
        expect(getProviderKey('dashscope')).toBeUndefined();
    });

    it('setProviderKeys clears previously set keys', () => {
        setProviderKeys({ DASHSCOPE_API_KEY: 'old-key' });
        expect(getProviderKey('dashscope')).toBe('old-key');
        setProviderKeys({ OPENAI_API_KEY: 'only-openai-now' });
        expect(getProviderKey('dashscope')).toBeUndefined();
        expect(getProviderKey('openai')).toBe('only-openai-now');
    });

    it('QWEN_API_KEY populates dashscope when DASHSCOPE_API_KEY is absent', () => {
        setProviderKeys({ QWEN_API_KEY: 'qwen-fallback-key' });
        expect(getProviderKey('dashscope')).toBe('qwen-fallback-key');
    });

    it('DASHSCOPE_API_KEY wins over QWEN_API_KEY when both present', () => {
        setProviderKeys({
            DASHSCOPE_API_KEY: 'dashscope-primary',
            QWEN_API_KEY: 'qwen-fallback',
        });
        expect(getProviderKey('dashscope')).toBe('dashscope-primary');
    });

    it('strips quoted and Bearer-prefixed values on ingest', () => {
        setProviderKeys({
            OPENAI_API_KEY: '"sk-openai-quoted"',
            DASHSCOPE_API_KEY: 'Bearer sk-dashscope-prefixed',
            ANTHROPIC_API_KEY: "'sk-ant-single-quoted'",
        });
        expect(getProviderKey('openai')).toBe('sk-openai-quoted');
        expect(getProviderKey('dashscope')).toBe('sk-dashscope-prefixed');
        expect(getProviderKey('anthropic')).toBe('sk-ant-single-quoted');
    });

    it('org-level override takes precedence over global key', () => {
        setProviderKeys({ DASHSCOPE_API_KEY: 'global-dashscope' });
        setAgentOrgMapping({ 'hash-abc': 'org-1' });
        setOrgProviderKeys({ 'org-1': { dashscope: 'org-scoped-key' } });

        expect(getProviderKey('dashscope', 'hash-abc')).toBe('org-scoped-key');
    });

    it('falls through to global when org has no override for the provider', () => {
        setProviderKeys({ DASHSCOPE_API_KEY: 'global-dashscope' });
        setAgentOrgMapping({ 'hash-abc': 'org-1' });
        setOrgProviderKeys({ 'org-1': { openai: 'org-openai-only' } });

        expect(getProviderKey('dashscope', 'hash-abc')).toBe('global-dashscope');
    });

    it('unknown key hash falls through to global', () => {
        setProviderKeys({ DASHSCOPE_API_KEY: 'global-dashscope' });
        expect(getProviderKey('dashscope', 'unknown-hash')).toBe('global-dashscope');
    });

    it('local provider always returns a placeholder (no upstream auth needed)', () => {
        setProviderKeys({});
        expect(getProviderKey('local')).toBeTruthy();
    });
});

describe('resolveModel', () => {
    it('routes bare qwen model to dashscope', () => {
        const result = resolveModel('qwen3.6-plus');
        expect(result).toEqual({ provider: 'dashscope', model: 'qwen3.6-plus' });
    });

    it('routes explicit dashscope/ prefix', () => {
        const result = resolveModel('dashscope/qwen3.6-plus');
        expect(result).toEqual({ provider: 'dashscope', model: 'qwen3.6-plus' });
    });

    it('routes claude models to anthropic', () => {
        const result = resolveModel('claude-sonnet-4-20250514');
        expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    });

    it('routes bare gemini models to gemini', () => {
        expect(resolveModel('gemini-2.5-pro')).toEqual({ provider: 'gemini', model: 'gemini-2.5-pro' });
        expect(resolveModel('gemini-2.0-flash')).toEqual({ provider: 'gemini', model: 'gemini-2.0-flash' });
        expect(resolveModel('gemini-2.0-flash-exp')).toEqual({ provider: 'gemini', model: 'gemini-2.0-flash-exp' });
    });

    it('routes explicit gemini/ prefix', () => {
        const result = resolveModel('gemini/gemini-2.5-pro');
        expect(result).toEqual({ provider: 'gemini', model: 'gemini-2.5-pro' });
    });

    it('routes gemini-native embedding ids to gemini (not the OpenAI→dashscope rewrite)', () => {
        // Regression guard: the text-embedding-* → dashscope rewrite above
        // only fires for OpenAI-style embedding ids. Provider-native embedding
        // model names like `gemini-embedding-001` must stay on their owning
        // provider.
        const result = resolveModel('gemini-embedding-001');
        expect(result).toEqual({ provider: 'gemini', model: 'gemini-embedding-001' });
    });

    it('routes gpt/o1/o3/o4 to openai', () => {
        expect(resolveModel('gpt-4.1')).toEqual({ provider: 'openai', model: 'gpt-4.1' });
        expect(resolveModel('o1-preview')).toEqual({ provider: 'openai', model: 'o1-preview' });
    });

    it('maps OpenAI-style embedding ids to dashscope text-embedding-v4', () => {
        expect(resolveModel('text-embedding-3-small')).toEqual({
            provider: 'dashscope',
            model: 'text-embedding-v4',
        });
    });

    it('returns null for unrecognized models', () => {
        expect(resolveModel('totally-made-up-model')).toBeNull();
    });
});
