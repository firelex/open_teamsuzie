import { describe, expect, it } from 'vitest';
import { parseResponse } from '../parser.js';
import {
    SENTINEL_CLOSE,
    SENTINEL_OPEN,
    citationProtocolFragment,
} from '../protocol.js';
import type { CitationWarningKind } from '../types.js';

const block = (json: string) => `${SENTINEL_OPEN}\n${json}\n${SENTINEL_CLOSE}`;

const kinds = (result: { warnings: { kind: CitationWarningKind }[] }) =>
    result.warnings.map((w) => w.kind).sort();

describe('parseResponse — happy paths', () => {
    it('returns text and citations for a well-formed single citation', () => {
        const raw = [
            'The agreement is governed by Delaware law [1].',
            '',
            block(
                '[{"id": 1, "doc": "doc-0", "quote": "governed by the laws of the State of Delaware", "locator": "§7 Governing Law"}]',
            ),
        ].join('\n');

        const r = parseResponse(raw);
        expect(r.warnings).toEqual([]);
        expect(r.citations).toEqual([
            {
                id: 1,
                doc: 'doc-0',
                quote: 'governed by the laws of the State of Delaware',
                locator: '§7 Governing Law',
            },
        ]);
        expect(r.text).toContain('[1]');
        expect(r.text).not.toContain(SENTINEL_OPEN);
        expect(r.text).not.toContain(SENTINEL_CLOSE);
    });

    it('handles multiple citations in order', () => {
        const raw = [
            'First [1]. Second [2]. Third [3].',
            block(
                '[{"id":1,"doc":"a","quote":"x"},{"id":2,"doc":"a","quote":"y","locator":"p.4"},{"id":3,"doc":"b","quote":"z"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.warnings).toEqual([]);
        expect(r.citations).toHaveLength(3);
        expect(r.citations[1]!.locator).toBe('p.4');
        expect(r.citations[0]!.locator).toBeUndefined();
    });

    it('returns no citations and no warnings when no block and no markers', () => {
        const r = parseResponse('Just some prose with no citations.');
        expect(r.citations).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.text).toBe('Just some prose with no citations.');
    });

    it('tolerates extra whitespace around the JSON inside the block', () => {
        const raw = [
            'Claim [1].',
            `${SENTINEL_OPEN}\n\n   [{"id":1,"doc":"a","quote":"q"}]   \n\n${SENTINEL_CLOSE}`,
        ].join('\n');
        const r = parseResponse(raw);
        expect(kinds(r)).toEqual([]);
        expect(r.citations).toHaveLength(1);
    });

    it('treats locator: null the same as missing locator', () => {
        const raw = [
            'Claim [1].',
            block('[{"id":1,"doc":"a","quote":"q","locator":null}]'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.warnings).toEqual([]);
        expect(r.citations[0]!.locator).toBeUndefined();
    });
});

describe('parseResponse — block-level failures', () => {
    it('flags duplicate blocks and uses the first', () => {
        const raw = [
            'A [1]. B [2].',
            block('[{"id":1,"doc":"a","quote":"first"}]'),
            'middle prose',
            block('[{"id":2,"doc":"b","quote":"second"}]'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(kinds(r)).toContain('duplicate_block');
        expect(r.citations.map((c) => c.id)).toEqual([1]);
        expect(kinds(r)).toContain('orphan_marker');
        expect(r.text).not.toContain(SENTINEL_OPEN);
    });

    it('warns and keeps prose when block JSON is truncated', () => {
        const raw = [
            'Claim [1].',
            `${SENTINEL_OPEN}\n[{"id":1,"doc":"a","quote":"unclosed`,
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations).toEqual([]);
        expect(r.text).toContain('Claim [1].');
        expect(kinds(r)).toContain('orphan_marker');
    });

    it('warns when a complete block contains malformed JSON', () => {
        const raw = [
            'Claim [1].',
            `${SENTINEL_OPEN}\n[{id:1,doc:"a",quote:"q"}]\n${SENTINEL_CLOSE}`,
        ].join('\n');
        const r = parseResponse(raw);
        expect(kinds(r)).toContain('malformed_block_json');
        expect(r.citations).toEqual([]);
    });

    it('warns when block contains JSON that is not an array', () => {
        const raw = [
            'Claim [1].',
            block('{"id":1,"doc":"a","quote":"q"}'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(kinds(r)).toContain('malformed_block_shape');
        expect(r.citations).toEqual([]);
    });
});

describe('parseResponse — entry-level failures', () => {
    it('drops entries with missing or non-integer id', () => {
        const raw = [
            'A [1]. B [2].',
            block(
                '[{"doc":"a","quote":"q"},{"id":"2","doc":"a","quote":"q"},{"id":1,"doc":"a","quote":"q"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations.map((c) => c.id)).toEqual([1]);
        const malformed = r.warnings.filter((w) => w.kind === 'malformed_entry');
        expect(malformed).toHaveLength(2);
        expect(malformed[0]!.entryIndex).toBe(0);
        expect(malformed[1]!.entryIndex).toBe(1);
    });

    it('rejects non-positive ids', () => {
        const raw = [
            '[1] [2]',
            block(
                '[{"id":0,"doc":"a","quote":"q"},{"id":-1,"doc":"a","quote":"q"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations).toEqual([]);
        expect(r.warnings.filter((w) => w.kind === 'malformed_entry')).toHaveLength(2);
    });

    it('rejects empty doc or empty quote', () => {
        const raw = [
            '[1] [2]',
            block(
                '[{"id":1,"doc":"","quote":"q"},{"id":2,"doc":"a","quote":""}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations).toEqual([]);
        expect(r.warnings.filter((w) => w.kind === 'malformed_entry')).toHaveLength(2);
    });

    it('rejects empty-string locator (when the field is present)', () => {
        const raw = [
            'A [1].',
            block('[{"id":1,"doc":"a","quote":"q","locator":""}]'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations).toEqual([]);
        expect(r.warnings.filter((w) => w.kind === 'malformed_entry')).toHaveLength(1);
    });

    it('rejects non-string locator', () => {
        const raw = [
            'A [1].',
            block('[{"id":1,"doc":"a","quote":"q","locator":42}]'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations).toEqual([]);
        expect(r.warnings.filter((w) => w.kind === 'malformed_entry')).toHaveLength(1);
    });

    it('rejects null and array entries', () => {
        const raw = [
            '[1] [2]',
            block('[null, [1, 2, 3], {"id":1,"doc":"a","quote":"q"}]'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations.map((c) => c.id)).toEqual([1]);
        expect(r.warnings.filter((w) => w.kind === 'malformed_entry')).toHaveLength(2);
    });

    it('flags duplicate ids and keeps the first', () => {
        const raw = [
            'A [1]. B [1].',
            block(
                '[{"id":1,"doc":"a","quote":"first"},{"id":1,"doc":"b","quote":"second"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations).toHaveLength(1);
        expect(r.citations[0]!.quote).toBe('first');
        expect(kinds(r)).toContain('duplicate_id');
    });

    it('survives a mix of valid and invalid entries', () => {
        const raw = [
            '[1] [2] [3]',
            block(
                '[{"id":1,"doc":"a","quote":"q1"},"not an object",{"id":3,"doc":"a","quote":"q3"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.citations.map((c) => c.id).sort()).toEqual([1, 3]);
        expect(r.warnings.filter((w) => w.kind === 'malformed_entry')).toHaveLength(1);
    });
});

describe('parseResponse — referential warnings', () => {
    it('flags markers without entries as orphan_marker', () => {
        const raw = [
            'A [1]. B [9].',
            block('[{"id":1,"doc":"a","quote":"q"}]'),
        ].join('\n');
        const r = parseResponse(raw);
        const orphans = r.warnings.filter((w) => w.kind === 'orphan_marker');
        expect(orphans).toHaveLength(1);
        expect(orphans[0]!.id).toBe(9);
    });

    it('flags entries without markers as unreferenced_entry', () => {
        const raw = [
            'A [1].',
            block(
                '[{"id":1,"doc":"a","quote":"q"},{"id":2,"doc":"a","quote":"q"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        const unref = r.warnings.filter((w) => w.kind === 'unreferenced_entry');
        expect(unref).toHaveLength(1);
        expect(unref[0]!.id).toBe(2);
    });

    it('does not flag block-internal `[N]` text as inline markers', () => {
        const raw = [
            'A [1].',
            block(
                '[{"id":1,"doc":"a","quote":"references item [99] earlier"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.warnings).toEqual([]);
    });

    it('flags unknown_doc_handle when knownDocs is supplied', () => {
        const raw = [
            'A [1]. B [2].',
            block(
                '[{"id":1,"doc":"doc-0","quote":"q"},{"id":2,"doc":"phantom","quote":"q"}]',
            ),
        ].join('\n');
        const r = parseResponse(raw, { knownDocs: ['doc-0'] });
        const unknown = r.warnings.filter((w) => w.kind === 'unknown_doc_handle');
        expect(unknown).toHaveLength(1);
        expect(unknown[0]!.doc).toBe('phantom');
        expect(unknown[0]!.id).toBe(2);
    });

    it('does not warn unknown_doc_handle when knownDocs not supplied', () => {
        const raw = [
            'A [1].',
            block('[{"id":1,"doc":"phantom","quote":"q"}]'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.warnings.find((w) => w.kind === 'unknown_doc_handle')).toBeUndefined();
    });
});

describe('parseResponse — robustness', () => {
    it('returns cleanly on empty input', () => {
        const r = parseResponse('');
        expect(r).toEqual({ text: '', citations: [], warnings: [] });
    });

    it('does not throw on any of the failure fixtures', () => {
        const fixtures = [
            '',
            'plain text',
            '[1]',
            `${SENTINEL_OPEN}${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\n${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\nnot json\n${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\n42\n${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\n"a string"\n${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\n[]\n${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\n[1, 2, 3]\n${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\n[{}]\n${SENTINEL_CLOSE}`,
            `${SENTINEL_OPEN}\n[{"id":1,`,
            `<!-- regular comment --> [1]`,
        ];
        for (const f of fixtures) {
            expect(() => parseResponse(f)).not.toThrow();
            const r = parseResponse(f);
            expect(typeof r.text).toBe('string');
            expect(Array.isArray(r.citations)).toBe(true);
            expect(Array.isArray(r.warnings)).toBe(true);
        }
    });

    it('ignores ordinary HTML comments', () => {
        const raw = [
            '<!-- this is just a comment -->',
            'Claim [1].',
            block('[{"id":1,"doc":"a","quote":"q"}]'),
        ].join('\n');
        const r = parseResponse(raw);
        expect(r.warnings).toEqual([]);
        expect(r.citations).toHaveLength(1);
        expect(r.text).toContain('<!-- this is just a comment -->');
    });

    it('treats non-string input defensively', () => {
        // @ts-expect-error - intentional bad input
        const r = parseResponse(undefined);
        expect(r.citations).toEqual([]);
        expect(r.warnings).toEqual([]);
    });
});

describe('citationProtocolFragment', () => {
    it('lists provided doc handles', () => {
        const out = citationProtocolFragment({
            docs: [
                { handle: 'doc-0', label: 'NDA.pdf' },
                { handle: 'doc-1' },
            ],
        });
        expect(out).toContain('doc-0');
        expect(out).toContain('NDA.pdf');
        expect(out).toContain('doc-1');
        expect(out).toContain(SENTINEL_OPEN);
        expect(out).toContain(SENTINEL_CLOSE);
    });

    it('teaches the locator field', () => {
        const out = citationProtocolFragment({
            docs: [{ handle: 'doc-0' }],
        });
        expect(out).toContain('locator');
        expect(out).toContain('optional');
    });

    it('says do-not-cite when no docs are available', () => {
        const out = citationProtocolFragment({ docs: [] });
        expect(out).toMatch(/do not cite/i);
    });
});
