import { describe, it, expect } from 'vitest';
import { WorkspaceRag } from '../workspace-rag.js';

describe('WorkspaceRag (extracted from suzielaw matter-rag)', () => {
  it('is exported as a class', () => {
    expect(typeof WorkspaceRag).toBe('function');
    expect(WorkspaceRag.prototype).toBeDefined();
  });
});
