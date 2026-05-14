import { describe, it, expect } from 'vitest';
import { draftColumnPrompt } from '../column-draft.js';

describe('draftColumnPrompt (extracted from suzielaw)', () => {
  it('is exported', () => {
    expect(typeof draftColumnPrompt).toBe('function');
  });
});
