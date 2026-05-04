import { describe, expect, it } from 'vitest';
import {
    SENTINEL_OPEN,
    prepareDocumentForPrompt,
} from '@teamsuzie/citations';

import {
    runCellWithFormat,
    type FormattedCellEvent,
    type LlmStream,
} from '../runner.js';
import type { CellChatMessage } from '../prompt.js';

function citationBlock(handle: string, quote: string): string {
    return [
        SENTINEL_OPEN,
        `[{"id":1,"doc":"${handle}","quote":"${quote}"}]`,
        '-->',
    ].join('\n');
}

/**
 * Drives a sequence of canned replies. The Nth call to the LLM returns
 * `replies[N]` (or the last one if we run out). Lets a test simulate a bad
 * first answer + a good retry.
 */
function scriptedSequence(replies: string[]): LlmStream {
    let i = 0;
    return async function* () {
        const reply = replies[Math.min(i, replies.length - 1)] ?? '';
        i += 1;
        // Stream in 3 chunks
        const chunk = Math.max(1, Math.ceil(reply.length / 3));
        for (let j = 0; j < reply.length; j += chunk) {
            yield reply.slice(j, j + chunk);
        }
    };
}

async function collect(events: AsyncIterable<FormattedCellEvent>): Promise<FormattedCellEvent[]> {
    const out: FormattedCellEvent[] = [];
    for await (const e of events) out.push(e);
    return out;
}

const DOC = prepareDocumentForPrompt('Some content.\n', [], { handle: 'doc-x' });

describe('runCellWithFormat — happy paths per format', () => {
    it('coerces a yes_no cell on first pass', async () => {
        const llm = scriptedSequence([
            `Yes [1].\n${citationBlock('doc-x', 'something')}`,
        ]);
        const events = await collect(
            runCellWithFormat({
                document: DOC,
                column: { prompt: 'Is the contract assignable?' },
                format: 'yes_no',
                llm,
            }),
        );
        const done = events.find((e) => e.type === 'done');
        expect(done?.type).toBe('done');
        if (done?.type !== 'done') return;
        expect(done.formatted).toBe('Yes');
        expect(done.coerce.ok).toBe(true);
        expect(events.find((e) => e.type === 'retry')).toBeUndefined();
    });

    it('coerces a date cell on first pass', async () => {
        const llm = scriptedSequence([
            `January 15, 2025 [1].\n${citationBlock('doc-x', 'effective')}`,
        ]);
        const events = await collect(
            runCellWithFormat({
                document: DOC,
                column: { prompt: 'When was it effective?' },
                format: 'date',
                llm,
            }),
        );
        const done = events.find((e) => e.type === 'done');
        if (done?.type !== 'done') throw new Error('no done event');
        expect(done.formatted).toBe('2025-01-15');
    });
});

describe('runCellWithFormat — retry on shape failure', () => {
    it('retries once when the first answer is the wrong shape and accepts the second', async () => {
        const llm = scriptedSequence([
            // First pass: equivocation, doesn't fit yes_no
            `It depends on the jurisdiction [1].\n${citationBlock('doc-x', 'maybe')}`,
            // Second pass: clean Yes
            `Yes [1].\n${citationBlock('doc-x', 'assignable')}`,
        ]);
        const events = await collect(
            runCellWithFormat({
                document: DOC,
                column: { prompt: 'Is the contract assignable?' },
                format: 'yes_no',
                llm,
            }),
        );

        const retry = events.find((e) => e.type === 'retry');
        expect(retry).toBeDefined();
        if (retry?.type !== 'retry') return;
        expect(retry.format).toBe('yes_no');
        expect(retry.reason).toBeTruthy();

        const done = events.findLast?.((e) => e.type === 'done')
            ?? [...events].reverse().find((e) => e.type === 'done');
        if (done?.type !== 'done') throw new Error('no done event');
        expect(done.formatted).toBe('Yes');

        // Tokens from BOTH passes should appear in the stream — the wrapper
        // relays them as the model emits.
        const tokenChunks = events.filter((e) => e.type === 'token');
        expect(tokenChunks.length).toBeGreaterThan(3);
    });

    it('returns formatted=null after both passes fail', async () => {
        const llm = scriptedSequence([
            `It depends [1].\n${citationBlock('doc-x', 'q')}`,
            `Possibly [1].\n${citationBlock('doc-x', 'q')}`,
        ]);
        const events = await collect(
            runCellWithFormat({
                document: DOC,
                column: { prompt: 'Is the contract assignable?' },
                format: 'yes_no',
                llm,
            }),
        );
        const done = events.findLast?.((e) => e.type === 'done')
            ?? [...events].reverse().find((e) => e.type === 'done');
        if (done?.type !== 'done') throw new Error('no done event');
        expect(done.formatted).toBeNull();
        expect(done.coerce.ok).toBe(false);
    });

    it('retries date format after a vague first attempt', async () => {
        const llm = scriptedSequence([
            `Sometime in 2025 [1].\n${citationBlock('doc-x', 'effective')}`,
            `2025-03-01 [1].\n${citationBlock('doc-x', 'effective')}`,
        ]);
        const events = await collect(
            runCellWithFormat({
                document: DOC,
                column: { prompt: 'Effective date?' },
                format: 'date',
                llm,
            }),
        );
        expect(events.some((e) => e.type === 'retry')).toBe(true);
        const done = events.findLast?.((e) => e.type === 'done')
            ?? [...events].reverse().find((e) => e.type === 'done');
        if (done?.type !== 'done') throw new Error('no done event');
        expect(done.formatted).toBe('2025-03-01');
    });

    it('threads the retry user-message through the second LLM call', async () => {
        const seenMessages: CellChatMessage[][] = [];
        let i = 0;
        const replies = [
            `Maybe [1].\n${citationBlock('doc-x', 'q')}`,
            `Yes [1].\n${citationBlock('doc-x', 'q')}`,
        ];
        const llm: LlmStream = async function* ({ messages }) {
            seenMessages.push(messages);
            const reply = replies[Math.min(i, replies.length - 1)] ?? '';
            i += 1;
            yield reply;
        };
        await collect(
            runCellWithFormat({
                document: DOC,
                column: { prompt: 'Is X?' },
                format: 'yes_no',
                llm,
            }),
        );
        expect(seenMessages.length).toBe(2);
        // The second pass should include the assistant's failed reply +
        // a fresh user clarification appended.
        const second = seenMessages[1]!;
        expect(second.length).toBe(seenMessages[0]!.length + 2);
        const lastUser = second[second.length - 1]!;
        expect(lastUser.role).toBe('user');
        expect(lastUser.content.toLowerCase()).toMatch(/yes|no/);
    });
});

describe('runCellWithFormat — error pass-through', () => {
    it('emits an error event and stops on LLM failure', async () => {
        const failing: LlmStream = async function* () {
            yield 'partial';
            throw new Error('rate limited');
        };
        const events = await collect(
            runCellWithFormat({
                document: DOC,
                column: { prompt: 'X?' },
                format: 'yes_no',
                llm: failing,
            }),
        );
        const last = events[events.length - 1]!;
        expect(last.type).toBe('error');
    });
});
