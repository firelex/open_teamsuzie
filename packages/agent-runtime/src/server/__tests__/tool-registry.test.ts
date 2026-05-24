import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../tool-registry.js';
import type { AnyToolDefinition } from '@teamsuzie/agent-loop';

const stub = (name: string): AnyToolDefinition => ({
  name,
  description: '',
  parameters: { type: 'object', properties: {} },
  execute: async () => 'ok',
});

describe('ToolRegistry', () => {
  it('lists tools and tracks source', () => {
    const reg = new ToolRegistry();
    reg.register(stub('echo'));
    reg.register(
      stub('courtlistener_search'),
      { source: 'extension', extensionName: 'legal-research' },
    );
    expect(reg.list().map((t) => t.name)).toEqual(['echo', 'courtlistener_search']);
    expect(reg.metaFor('courtlistener_search')).toEqual({
      source: 'extension', extensionName: 'legal-research',
    });
    expect(reg.metaFor('echo')).toEqual({ source: 'core' });
    expect(reg.metaFor('does-not-exist')).toBeUndefined();
  });
});
