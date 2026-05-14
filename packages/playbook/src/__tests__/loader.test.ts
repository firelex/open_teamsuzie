import { describe, it, expect } from 'vitest';
import { loadPlaybookFromMarkdown } from '../loader.js';

describe('loadPlaybookFromMarkdown', () => {
  it('captures title from the first H1 if present', () => {
    const pb = loadPlaybookFromMarkdown(
      '# Blixt EL Standards\n\n## Termination\n\nRequire 30-day notice.',
      { filename: 'eq.md', originalMime: 'text/markdown' },
    );
    expect(pb.title).toBe('Blixt EL Standards');
    expect(pb.body).toContain('30-day notice');
    expect(pb.id).toBeTruthy();
    expect(pb.source.filename).toBe('eq.md');
  });

  it('falls back to filename if no H1', () => {
    const pb = loadPlaybookFromMarkdown(
      'No heading here.\n\nJust prose.',
      { filename: 'rules.txt', originalMime: 'text/plain' },
    );
    expect(pb.title).toBe('rules.txt');
  });

  it('generates a stable id from the title', () => {
    const a = loadPlaybookFromMarkdown('# Same Title', { filename: 'a.md', originalMime: 'text/markdown' });
    const b = loadPlaybookFromMarkdown('# Same Title', { filename: 'b.md', originalMime: 'text/markdown' });
    expect(a.id).toBe(b.id);
  });
});
