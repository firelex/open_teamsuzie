import { describe, it, expect } from 'vitest';
import { resolveAgentTarget, type AgentTargetRegistry } from '../resolve-agent.js';
import type { AgentTarget } from '../chat-provider.js';

const defaultAgent: AgentTarget = {
  baseUrl: 'https://dashscope.example/v1',
  apiKey: 'qwen-key',
  model: 'qwen3.7-max',
};

describe('resolveAgentTarget', () => {
  it('returns the default agent when modelId is undefined', () => {
    const out = resolveAgentTarget(undefined, {}, defaultAgent);
    expect(out).toEqual(defaultAgent);
  });

  it('returns the default agent when modelId is empty after trim', () => {
    const out = resolveAgentTarget('   ', {}, defaultAgent);
    expect(out).toEqual(defaultAgent);
  });

  it('substitutes a flat (no-prefix) modelId into the default agent when no registry entry', () => {
    const out = resolveAgentTarget('qwen3.5-coder', {}, defaultAgent);
    expect(out.baseUrl).toBe(defaultAgent.baseUrl);
    expect(out.apiKey).toBe(defaultAgent.apiKey);
    expect(out.model).toBe('qwen3.5-coder');
  });

  it('falls back to the default agent unchanged when a prefixed modelId has no registry entry', () => {
    // Prior behavior would have substituted "openai/gpt-5.5" into the default
    // agent's wire model and 404'd against Dashscope. New behavior: ignore
    // the picker selection when we can't route it.
    const out = resolveAgentTarget('openai/gpt-5.5', {}, defaultAgent);
    expect(out).toEqual(defaultAgent);
  });

  it('applies registry overrides including a remapped wire model id', () => {
    const registry: AgentTargetRegistry = {
      'openai/gpt-5.5': {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.5',
      },
    };
    const out = resolveAgentTarget('openai/gpt-5.5', registry, defaultAgent);
    expect(out.baseUrl).toBe('https://api.openai.com/v1');
    expect(out.apiKey).toBe('sk-openai');
    expect(out.model).toBe('gpt-5.5');
  });

  it('uses the requested id as the wire model when the registry entry has no model override', () => {
    const registry: AgentTargetRegistry = {
      'qwen3.7-max': { baseUrl: 'http://localhost:8801', apiKey: '' },
    };
    const out = resolveAgentTarget('qwen3.7-max', registry, defaultAgent);
    expect(out.baseUrl).toBe('http://localhost:8801');
    expect(out.model).toBe('qwen3.7-max');
  });
});
