import type { PreparedDocument } from './document.js';
import { normalize } from './normalize.js';
import type { Citation, CitationVerification, DocHandle } from './types.js';

export type CitationValidation =
    | { ok: true }
    | { ok: false; reason: 'not_found' }
    | { ok: false; reason: 'unknown_doc' };

/**
 * Check whether the citation's quote actually appears anywhere in the
 * supplied document text. Drift-tolerant (smart quotes, en/em dashes,
 * NBSP, whitespace collapse). The `locator` field is informational and
 * not validated.
 */
export function validateCitation(
    citation: Citation,
    doc: PreparedDocument,
): CitationValidation {
    const normNeedle = normalize(citation.quote);
    if (normNeedle.length === 0) {
        return { ok: false, reason: 'not_found' };
    }
    const normHay = normalize(doc.text);
    if (normHay.includes(normNeedle)) {
        return { ok: true };
    }
    return { ok: false, reason: 'not_found' };
}

export function validateCitations(
    citations: Citation[],
    docs:
        | Map<DocHandle, PreparedDocument>
        | Record<DocHandle, PreparedDocument>,
): CitationValidation[] {
    const lookup = (h: DocHandle): PreparedDocument | undefined =>
        docs instanceof Map ? docs.get(h) : docs[h];

    return citations.map((c) => {
        const doc = lookup(c.doc);
        if (!doc) return { ok: false, reason: 'unknown_doc' };
        return validateCitation(c, doc);
    });
}

/**
 * Strip the markdown markup a model tends to drop when it quotes from a
 * converted document: emphasis markers, inline code ticks, heading hashes,
 * table pipes, and link syntax (keeping the link text).
 */
export function stripMarkdownMarkup(s: string): string {
    return s
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/[*_`|]+/g, ' ');
}

/**
 * Drop enumeration labels: parenthesised labels like "(b)", "(iv)", "(30)"
 * anywhere, and list numbers like "5." or "1.2" at the start of a line.
 * Document converters often turn a Word clause label into list numbering
 * (or drop it), so the quote and the converted text disagree on labels
 * while the wording matches.
 */
export function stripEnumerationLabels(s: string): string {
    return s
        .replace(/\(\s*[0-9a-zA-Z]{1,4}\s*\)/g, ' ')
        .replace(/^\s*(?:\d+(?:\.\d+)*\.?|[-+*•])\s+/gm, '');
}

/**
 * Mark each citation with whether its quote appears in the cited
 * document. `sources` maps a doc handle to that document's text (plain
 * or markdown); a handle with no entry is marked `unchecked`. Markdown
 * markup and enumeration labels are ignored on both sides, so a quote
 * that drops `**bold**` markers or table pipes, or keeps a "(b)" label
 * the converter turned into list numbering, still verifies. The wording
 * itself must match. Returns new citation objects.
 */
export function verifyCitations(
    citations: Citation[],
    sources: Map<DocHandle, string> | Record<DocHandle, string>,
): Citation[] {
    const lookup = (h: DocHandle): string | undefined =>
        sources instanceof Map ? sources.get(h) : sources[h];
    const haystacks = new Map<DocHandle, string>();
    return citations.map((c) => {
        const text = lookup(c.doc);
        let verification: CitationVerification;
        if (text === undefined) {
            verification = 'unchecked';
        } else {
            let hay = haystacks.get(c.doc);
            if (hay === undefined) {
                hay = normalize(stripEnumerationLabels(stripMarkdownMarkup(text)));
                haystacks.set(c.doc, hay);
            }
            const needle = normalize(stripEnumerationLabels(stripMarkdownMarkup(c.quote)));
            verification = needle.length > 0 && hay.includes(needle) ? 'verified' : 'not_found';
        }
        return { ...c, verification };
    });
}
