import {
    MARKER_REGEX,
    SENTINEL_BLOCK_REGEX,
} from './protocol.js';
import type {
    Citation,
    CitationWarning,
    DocHandle,
    ParseOptions,
    ParseResult,
} from './types.js';

export function parseResponse(
    raw: string,
    opts: ParseOptions = {},
): ParseResult {
    const warnings: CitationWarning[] = [];

    if (typeof raw !== 'string' || raw.length === 0) {
        return { text: raw ?? '', citations: [], warnings };
    }

    const blockMatches: Array<{ index: number; length: number; body: string }> = [];
    SENTINEL_BLOCK_REGEX.lastIndex = 0;
    for (
        let m = SENTINEL_BLOCK_REGEX.exec(raw);
        m !== null;
        m = SENTINEL_BLOCK_REGEX.exec(raw)
    ) {
        blockMatches.push({
            index: m.index,
            length: m[0].length,
            body: m[1] ?? '',
        });
    }

    let text = raw;
    let chosenBody: string | null = null;

    if (blockMatches.length > 0) {
        chosenBody = blockMatches[0]!.body;
        if (blockMatches.length > 1) {
            warnings.push({
                kind: 'duplicate_block',
                detail: `Found ${blockMatches.length} citation blocks; using the first and dropping the rest.`,
            });
        }
        text = stripBlocks(raw, blockMatches);
    }

    const citations = chosenBody === null
        ? []
        : extractCitations(chosenBody, warnings);

    cleanupReferentialWarnings(text, citations, warnings, opts);

    return { text, citations, warnings };
}

function stripBlocks(
    raw: string,
    blocks: Array<{ index: number; length: number }>,
): string {
    const sorted = [...blocks].sort((a, b) => a.index - b.index);
    let out = '';
    let cursor = 0;
    for (const b of sorted) {
        out += raw.slice(cursor, b.index);
        cursor = b.index + b.length;
    }
    out += raw.slice(cursor);
    return trimTrailingBlankLines(out);
}

function trimTrailingBlankLines(s: string): string {
    return s.replace(/[ \t]+(?=\n)/g, '').replace(/\n{3,}$/, '\n\n').replace(/\s+$/g, (tail) => {
        const newlineCount = (tail.match(/\n/g) ?? []).length;
        if (newlineCount === 0) return '';
        if (newlineCount === 1) return '\n';
        return '\n';
    });
}

function extractCitations(
    body: string,
    warnings: CitationWarning[],
): Citation[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch (err) {
        warnings.push({
            kind: 'malformed_block_json',
            detail: `Citation block JSON did not parse: ${(err as Error).message}`,
        });
        return [];
    }

    if (!Array.isArray(parsed)) {
        warnings.push({
            kind: 'malformed_block_shape',
            detail: 'Citation block must be a JSON array of entries.',
        });
        return [];
    }

    const seenIds = new Set<number>();
    const citations: Citation[] = [];

    parsed.forEach((entry, index) => {
        const validated = validateEntry(entry, index, warnings);
        if (!validated) return;
        if (seenIds.has(validated.id)) {
            warnings.push({
                kind: 'duplicate_id',
                detail: `Duplicate citation id ${validated.id} at entry ${index}; keeping first occurrence.`,
                entryIndex: index,
                id: validated.id,
            });
            return;
        }
        seenIds.add(validated.id);
        citations.push(validated);
    });

    return citations;
}

function validateEntry(
    entry: unknown,
    index: number,
    warnings: CitationWarning[],
): Citation | null {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        warnings.push({
            kind: 'malformed_entry',
            detail: `Entry ${index} is not a JSON object.`,
            entryIndex: index,
        });
        return null;
    }
    const e = entry as Record<string, unknown>;

    const id = e.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
        warnings.push({
            kind: 'malformed_entry',
            detail: `Entry ${index} has invalid \`id\` (expected positive integer).`,
            entryIndex: index,
        });
        return null;
    }

    const doc = e.doc;
    if (typeof doc !== 'string' || doc.length === 0) {
        warnings.push({
            kind: 'malformed_entry',
            detail: `Entry ${index} has invalid \`doc\` (expected non-empty string).`,
            entryIndex: index,
            id,
        });
        return null;
    }

    const quote = e.quote;
    if (typeof quote !== 'string' || quote.length === 0) {
        warnings.push({
            kind: 'malformed_entry',
            detail: `Entry ${index} has invalid \`quote\` (expected non-empty string).`,
            entryIndex: index,
            id,
            doc,
        });
        return null;
    }

    const rawLocator = e.locator;
    let locator: string | undefined;
    if (rawLocator !== undefined && rawLocator !== null) {
        if (typeof rawLocator !== 'string' || rawLocator.length === 0) {
            warnings.push({
                kind: 'malformed_entry',
                detail: `Entry ${index} has invalid \`locator\` (expected non-empty string when present).`,
                entryIndex: index,
                id,
                doc,
            });
            return null;
        }
        locator = rawLocator;
    }

    const out: Citation = { id, doc, quote };
    if (locator !== undefined) out.locator = locator;
    return out;
}

function cleanupReferentialWarnings(
    text: string,
    citations: Citation[],
    warnings: CitationWarning[],
    opts: ParseOptions,
): void {
    const markerIds = collectMarkerIds(text);
    const entryIds = new Set(citations.map((c) => c.id));

    for (const id of markerIds) {
        if (!entryIds.has(id)) {
            warnings.push({
                kind: 'orphan_marker',
                detail: `Inline marker [${id}] has no matching citation entry.`,
                id,
            });
        }
    }

    for (const c of citations) {
        if (!markerIds.has(c.id)) {
            warnings.push({
                kind: 'unreferenced_entry',
                detail: `Citation id ${c.id} has no inline marker in the text.`,
                id: c.id,
                doc: c.doc,
            });
        }
    }

    if (opts.knownDocs) {
        const known = new Set<DocHandle>(opts.knownDocs);
        for (const c of citations) {
            if (!known.has(c.doc)) {
                warnings.push({
                    kind: 'unknown_doc_handle',
                    detail: `Citation id ${c.id} references unknown doc handle "${c.doc}".`,
                    id: c.id,
                    doc: c.doc,
                });
            }
        }
    }
}

function collectMarkerIds(text: string): Set<number> {
    const ids = new Set<number>();
    MARKER_REGEX.lastIndex = 0;
    for (
        let m = MARKER_REGEX.exec(text);
        m !== null;
        m = MARKER_REGEX.exec(text)
    ) {
        const id = Number(m[1]);
        if (Number.isInteger(id) && id > 0) ids.add(id);
    }
    return ids;
}
