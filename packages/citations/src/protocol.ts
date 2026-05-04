import type { DocHandle } from './types.js';

export const SENTINEL_OPEN = '<!--teamsuzie:citations';
export const SENTINEL_CLOSE = '-->';

const SENTINEL_OPEN_ESC = SENTINEL_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SENTINEL_CLOSE_ESC = SENTINEL_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const SENTINEL_BLOCK_REGEX = new RegExp(
    `${SENTINEL_OPEN_ESC}\\s*([\\s\\S]*?)\\s*${SENTINEL_CLOSE_ESC}`,
    'g',
);

export const MARKER_REGEX = /\[(\d+)\]/g;

export type ProtocolDoc = {
    handle: DocHandle;
    label?: string;
};

export type ProtocolFragmentOptions = {
    docs: ProtocolDoc[];
};

export function citationProtocolFragment(opts: ProtocolFragmentOptions): string {
    const { docs } = opts;
    const handleList = docs.length
        ? docs
              .map((d) =>
                  d.label ? `  - ${d.handle} (${d.label})` : `  - ${d.handle}`,
              )
              .join('\n')
        : '  (none available — do not cite)';

    const exampleHandle = docs[0]?.handle ?? 'doc-0';

    return [
        '## Citation protocol',
        '',
        'When you reference material from a provided document, attach a citation.',
        '',
        'Inline marker:',
        '  - Place a marker `[N]` directly after the sentence it supports.',
        '  - **Every marker uses a different number, counting up from 1.**',
        '    Your first citation is `[1]`, the second is `[2]`, the third is',
        '    `[3]`, and so on. NEVER reuse a number — even when two sentences',
        '    rely on the same passage, give them distinct numbers.',
        '',
        'Citation block:',
        '  - At the end of your reply, emit ONE block in this exact form,',
        '    with one entry per marker you used:',
        '',
        `${SENTINEL_OPEN}`,
        '[',
        `  {"id": 1, "doc": "${exampleHandle}", "quote": "verbatim text supporting the first claim", "locator": "§2.1"},`,
        `  {"id": 2, "doc": "${exampleHandle}", "quote": "verbatim text supporting the second claim", "locator": "§3.4"},`,
        `  {"id": 3, "doc": "${exampleHandle}", "quote": "verbatim text supporting the third claim"}`,
        ']',
        SENTINEL_CLOSE,
        '',
        '  - Each entry\'s `id` matches the marker number it backs.',
        '  - `quote` must be verbatim from the source — copy-paste, do not',
        '    paraphrase.',
        '  - `locator` is optional. Use it to point the reader at a specific',
        '    spot — a heading path like "§2.1 Termination" for sectioned',
        '    docs, "p.4" for paginated PDFs, "Article III" for legal text.',
        '    Omit it if you don\'t have a useful pointer.',
        '  - If your reply has 5 citations, the block has 5 entries with',
        '    `id` 1 through 5. If your reply has nothing to cite, omit the',
        '    block entirely.',
        '',
        'Available document handles (use only these for `doc`):',
        handleList,
    ].join('\n');
}
