import { describe, it, expect, vi } from 'vitest';
import { decomposePptx } from '../decompose-pptx.js';

describe('decomposePptx', () => {
  it('uses markitdown-agent to convert PPTX, then groups continuation slides', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        filename: 'deck.pptx',
        markdown: [
          '# Slide 1',
          'Title slide',
          '',
          '# Slide 2',
          'Financial overview',
          '',
          '# Slide 3',
          'Financial overview cont.',
        ].join('\n'),
      }), { status: 200 }),
    );

    const llmFn = vi.fn().mockResolvedValue(JSON.stringify({
      continuations: [
        { slideIndex: 2, continuesFrom: 1 },
      ],
    }));

    const ref = await decomposePptx(new Uint8Array([1, 2, 3]), {
      docType: 'ic-deck',
      displayName: 'IC_Deck_Meridian.pptx',
      sourceFilePath: '/tmp/IC_Deck_Meridian.pptx',
      markitdownAgentBaseUrl: 'http://localhost:3013',
      llmFn,
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(llmFn).toHaveBeenCalled();
    expect(ref.contentMarkdown).toContain('Slide 1');
    expect(ref.contentMarkdown).toContain('continues Slide 2');
    expect(ref.designUsable).toBe(false);
  });
});
