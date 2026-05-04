import type { PreparedDocument } from './document.js';
import { normalize } from './normalize.js';
import type { Citation, DocHandle } from './types.js';

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
