import type { DocHandle } from './types.js';

export const PAGE_MARKER_REGEX = /\[page (\d+)\]/g;

export type PreparedDocument = {
    marked: string;
    handle: DocHandle;
    text: string;
    pageBreaks: number[];
};

export type PrepareDocumentOptions = {
    handle?: DocHandle;
};

export function prepareDocumentForPrompt(
    text: string,
    pageBreaks: number[],
    opts: PrepareDocumentOptions = {},
): PreparedDocument {
    if (typeof text !== 'string') {
        throw new TypeError('prepareDocumentForPrompt: `text` must be a string');
    }
    if (!Array.isArray(pageBreaks)) {
        throw new TypeError('prepareDocumentForPrompt: `pageBreaks` must be an array of numbers');
    }

    validatePageBreaks(pageBreaks, text.length);

    const handle = opts.handle ?? deriveHandle(text, pageBreaks);

    const marked = renderMarked(text, pageBreaks);

    return { marked, handle, text, pageBreaks: [...pageBreaks] };
}

export function prepareDocumentFromPages(
    pages: string[],
    opts: PrepareDocumentOptions = {},
): PreparedDocument {
    if (!Array.isArray(pages)) {
        throw new TypeError('prepareDocumentFromPages: `pages` must be an array of strings');
    }
    for (let i = 0; i < pages.length; i++) {
        if (typeof pages[i] !== 'string') {
            throw new TypeError(`prepareDocumentFromPages: page ${i} is not a string`);
        }
    }

    const text = pages.join('');
    const breaks: number[] = [];
    let cursor = 0;
    for (let i = 0; i < pages.length - 1; i++) {
        cursor += pages[i]!.length;
        breaks.push(cursor);
    }

    return prepareDocumentForPrompt(text, breaks, opts);
}

function validatePageBreaks(breaks: number[], textLen: number): void {
    let prev = 0;
    for (let i = 0; i < breaks.length; i++) {
        const b = breaks[i]!;
        if (!Number.isInteger(b)) {
            throw new RangeError(`pageBreaks[${i}] is not an integer`);
        }
        if (b <= 0) {
            throw new RangeError(
                `pageBreaks[${i}] is ${b}; page 1 starts implicitly at 0, so breaks must be > 0`,
            );
        }
        if (b > textLen) {
            throw new RangeError(
                `pageBreaks[${i}] = ${b} exceeds text length ${textLen}`,
            );
        }
        if (b <= prev) {
            throw new RangeError(
                `pageBreaks must be strictly increasing; index ${i} (${b}) is not greater than previous (${prev})`,
            );
        }
        prev = b;
    }
}

function renderMarked(text: string, breaks: number[]): string {
    const offsets = [0, ...breaks, text.length];
    const segments: string[] = [];

    for (let page = 0; page < offsets.length - 1; page++) {
        const start = offsets[page]!;
        const end = offsets[page + 1]!;
        const content = text.slice(start, end);

        if (segments.length > 0) {
            const last = segments[segments.length - 1]!;
            if (!last.endsWith('\n')) segments.push('\n');
        }
        segments.push(`[page ${page + 1}]\n`);
        segments.push(content);
    }

    return segments.join('');
}

function deriveHandle(text: string, breaks: number[]): DocHandle {
    // Two FNV-1a 32-bit passes with different seeds give a 16-hex
    // collision-tolerant id without dragging node:crypto into browser
    // bundles. Handles are session-scoped identifiers, not cryptographic
    // commitments, so non-crypto hashing is fine.
    const payload = `${text}${JSON.stringify(breaks)}`;
    const a = fnv1a(payload, 0x811c9dc5);
    const b = fnv1a(payload, 0xcbf29ce4);
    return `d-${toHex(a)}${toHex(b)}`;
}

function fnv1a(s: string, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function toHex(n: number): string {
    return n.toString(16).padStart(8, '0');
}
