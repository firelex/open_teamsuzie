import { describe, expect, it } from 'vitest';
import {
    SENTINEL_OPEN,
    prepareDocumentForPrompt,
    type PreparedDocument,
} from '@teamsuzie/citations';
import { openDb } from '@teamsuzie/db-sqlite';

import { REVIEWS_MIGRATIONS } from '../migrations.js';
import { ReviewsStore } from '../store.js';
import { runCell, type CellEvent, type LlmStream } from '../runner.js';
import type { CellChatMessage } from '../prompt.js';

/**
 * A scripted LLM that examines the messages it receives and emits a reply
 * that conforms to the citation protocol. The protocol fragment lists the
 * doc handle as `  - <handle> (<label>)`; we extract the handle and use it
 * verbatim in the citation block. The user message includes the column
 * prompt; we pattern-match to pick a canned answer + verbatim quote.
 */
function scriptedLlm(): LlmStream {
    return async function* ({ messages }) {
        const reply = makeReply(messages);
        // Stream in 5 chunks to exercise the token path.
        const chunkSize = Math.max(1, Math.ceil(reply.length / 5));
        for (let i = 0; i < reply.length; i += chunkSize) {
            yield reply.slice(i, i + chunkSize);
        }
    };
}

function makeReply(messages: CellChatMessage[]): string {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';

    // Protocol fragment lists handles as `  - <handle> (<label>)`. Grab the
    // first one — for cell runs there's exactly one.
    const handleMatch = sys.match(/-\s+([a-zA-Z0-9_-]+)\s+\(/);
    const handle = handleMatch?.[1] ?? 'doc-unknown';

    let answer = "Not found in the document";
    let quote = 'document';
    if (/governing law/i.test(user)) {
        answer = 'Delaware';
        quote = 'governing law is Delaware';
    } else if (/term/i.test(user) && !/termination/i.test(user)) {
        answer = '12 months';
        quote = 'Term is 12 months';
    } else if (/termination/i.test(user)) {
        answer = 'sixty (60) days';
        quote = 'Termination requires sixty (60) days notice';
    }

    return [
        `${answer} [1].`,
        SENTINEL_OPEN,
        `[{"id":1,"doc":"${handle}","quote":"${quote}"}]`,
        '-->',
    ].join('\n');
}

async function collect(events: AsyncIterable<CellEvent>): Promise<CellEvent[]> {
    const out: CellEvent[] = [];
    for await (const e of events) out.push(e);
    return out;
}

describe('runCell — single cell', () => {
    it('streams tokens then emits done with parsed citations', async () => {
        const doc = prepareDocumentForPrompt(
            'governing law is Delaware. Term is 12 months. Termination requires sixty (60) days notice.\n',
            [],
            { handle: 'doc-x' },
        );
        const events = await collect(
            runCell({
                document: doc,
                column: { prompt: 'What is the governing law?' },
                llm: scriptedLlm(),
            }),
        );

        const tokens = events.filter((e) => e.type === 'token');
        const done = events.find((e) => e.type === 'done');
        expect(tokens.length).toBeGreaterThan(0);
        expect(done).toBeDefined();
        expect(done!.type).toBe('done');
        if (done!.type !== 'done') return;
        expect(done.citations).toHaveLength(1);
        expect(done.citations[0]!.doc).toBe('doc-x');
        expect(done.citations[0]!.quote).toBe('governing law is Delaware');
        expect(done.text).toContain('[1]');
        expect(done.text).not.toContain(SENTINEL_OPEN);
        expect(done.warnings).toEqual([]);
    });

    it('emits an error event (not a throw) when the LLM rejects', async () => {
        const doc = prepareDocumentForPrompt('hello\n', [], { handle: 'doc-x' });
        const failingLlm: LlmStream = async function* () {
            yield 'partial';
            throw new Error('rate limited');
        };
        const events = await collect(
            runCell({
                document: doc,
                column: { prompt: 'anything' },
                llm: failingLlm,
            }),
        );
        const last = events[events.length - 1]!;
        expect(last.type).toBe('error');
        if (last.type !== 'error') return;
        expect(last.error.message).toBe('rate limited');
    });
});

describe('runCell — 3 columns × 5 docs end-to-end', () => {
    it('produces 15 done cells with citations and persists via upsertCell', async () => {
        const docs: PreparedDocument[] = Array.from({ length: 5 }, (_, i) =>
            prepareDocumentForPrompt(
                'governing law is Delaware. Term is 12 months.\nTermination requires sixty (60) days notice.\n',
                [],
                { handle: `doc-${i + 1}` },
            ),
        );

        const db = openDb({ path: ':memory:', migrations: REVIEWS_MIGRATIONS });
        const store = new ReviewsStore({ db });
        const review = store.createReview({ workspaceId: 'matter-1', name: 'Diligence' });

        const columnInputs = [
            { title: 'Governing law', prompt: 'What is the governing law?' as const },
            { title: 'Term', prompt: 'What is the term?' as const },
            { title: 'Termination notice', prompt: 'How many days notice for termination?' as const },
        ];
        const columns = columnInputs.map((c, i) =>
            store.addColumn({ reviewId: review.id, ...c, position: i }),
        );
        const rows = docs.map((d, i) =>
            store.addDocument({
                reviewId: review.id,
                externalDocId: d.handle,
                name: `Doc ${i + 1}`,
                position: i,
            }),
        );

        const llm = scriptedLlm();

        for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < columns.length; c++) {
                const events = runCell({
                    document: docs[r]!,
                    column: columns[c]!,
                    llm,
                });
                let latestText = '';
                for await (const e of events) {
                    if (e.type === 'token') {
                        store.upsertCell({
                            reviewId: review.id,
                            columnId: columns[c]!.id,
                            reviewDocumentId: rows[r]!.id,
                            status: 'streaming',
                            value: (latestText += e.text),
                        });
                    } else if (e.type === 'done') {
                        store.upsertCell({
                            reviewId: review.id,
                            columnId: columns[c]!.id,
                            reviewDocumentId: rows[r]!.id,
                            status: 'done',
                            value: e.text,
                            citations: JSON.stringify(e.citations),
                            error: null,
                        });
                    } else if (e.type === 'error') {
                        store.upsertCell({
                            reviewId: review.id,
                            columnId: columns[c]!.id,
                            reviewDocumentId: rows[r]!.id,
                            status: 'error',
                            error: e.error.message,
                        });
                    }
                }
            }
        }

        const snap = store.getReviewSnapshot(review.id);
        expect(snap).not.toBeNull();
        expect(snap!.columns).toHaveLength(3);
        expect(snap!.documents).toHaveLength(5);
        expect(snap!.cells).toHaveLength(15);
        for (const cell of snap!.cells) {
            expect(cell.status).toBe('done');
            expect(cell.value).toBeTruthy();
            expect(cell.citations).toBeTruthy();
            const parsed = JSON.parse(cell.citations!) as Array<{
                id: number;
                doc: string;
                quote: string;
            }>;
            expect(parsed).toHaveLength(1);
            // The cited handle should match the row's externalDocId.
            const row = snap!.documents.find((d) => d.id === cell.reviewDocumentId)!;
            expect(parsed[0]!.doc).toBe(row.externalDocId);
        }

        db.close();
    });
});
