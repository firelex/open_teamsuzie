import { describe, it, expect, vi } from 'vitest';
import { applyPlaybook } from '../apply.js';
import type { Playbook } from '../types.js';

const fakePlaybook: Playbook = {
  id: 'fake',
  title: 'Fake',
  body: '## Notice\n\nMust be 30 days.',
  source: { filename: 'f.md', originalMime: 'text/markdown', ingestedAt: '2026-05-14T00:00:00Z' },
};

const fakeTarget = '# Engagement Letter\n\nTermination on 15 days notice.';

describe('applyPlaybook', () => {
  it('calls the provided llm function with the playbook + target embedded', async () => {
    const llmFn = vi.fn().mockResolvedValue(JSON.stringify({
      deviations: [
        {
          label: 'Notice period below 30 days',
          playbookExcerpt: 'Must be 30 days',
          targetExcerpt: 'Termination on 15 days notice',
          targetParagraphIndex: 1,
          severity: 'required',
        },
      ],
    }));

    const report = await applyPlaybook(fakePlaybook, fakeTarget, llmFn);
    expect(llmFn).toHaveBeenCalledOnce();
    const promptArg = llmFn.mock.calls[0][0] as string;
    expect(promptArg).toContain('Must be 30 days');
    expect(promptArg).toContain('Termination on 15 days notice');
    expect(report.deviations).toHaveLength(1);
    expect(report.deviations[0].label).toBe('Notice period below 30 days');
    expect(report.markdown).toContain('Notice period below 30 days');
  });

  it('returns empty report when LLM returns no deviations', async () => {
    const llmFn = vi.fn().mockResolvedValue(JSON.stringify({ deviations: [] }));
    const report = await applyPlaybook(fakePlaybook, fakeTarget, llmFn);
    expect(report.deviations).toEqual([]);
    expect(report.markdown).toMatch(/no deviations/i);
  });
});
