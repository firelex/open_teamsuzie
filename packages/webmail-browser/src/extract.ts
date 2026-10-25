import type { Locator } from 'playwright-core';
import type { FieldSource, FieldSpec } from '@teamsuzie/webmail-routes';

const EMAIL = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g;
const ID = /^[\w:.#+=/-]{1,256}$/;

/** Collapse every kind of whitespace (including the narrow no-break space webmail puts before AM/PM) to one space. */
export function cleanText(text: string): string {
    return text.replace(/[\s\u00a0\u2000-\u200b\u202f\u205f\u3000]+/g, ' ').trim();
}

/** The element's text, accessible name, or one attribute, cleaned. Null when the attribute is absent. */
export async function readSource(el: Locator, from: FieldSource): Promise<string | null> {
    if (from === 'text') return cleanText(await el.innerText());
    if (from === 'name') return cleanText(await el.evaluate(accessibleName));
    const value = await el.getAttribute(from.slice('attr:'.length));
    return value === null ? null : cleanText(value);
}

/**
 * The accessible name of an element, following the main rules browsers use: aria-labelledby, aria-label, a
 * label for form fields, alt/title, then the text content.
 */
function accessibleName(node: Element): string {
    const byIds = node.getAttribute('aria-labelledby');
    if (byIds) {
        const text = byIds.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
        if (text) return text;
    }
    const label = node.getAttribute('aria-label');
    if (label && label.trim()) return label;
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
        const labels = node.labels ? [...node.labels].map((l) => l.textContent ?? '').join(' ').trim() : '';
        if (labels) return labels;
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
            if (node.placeholder) return node.placeholder;
        }
    }
    const alt = node.getAttribute('alt');
    if (alt) return alt;
    const title = node.getAttribute('title');
    const text = node.textContent?.trim() ?? '';
    return text || title || '';
}

/** Apply the field's pattern (first capture group). Null when the pattern does not match. */
export function applyPattern(value: string | null, pattern: string | undefined): string | null {
    if (value === null || pattern === undefined) return value;
    const match = new RegExp(pattern).exec(value);
    return match?.[1] === undefined ? null : cleanText(match[1]);
}

/**
 * The field's value in its normal form, or null when it does not satisfy its format. `emails` becomes a
 * comma-separated list of the addresses found; `flag` becomes `true`/`false`; `email` is lowercased; `date` becomes
 * an ISO timestamp.
 */
export function normalizeField(value: string | null, spec: FieldSpec): string | null {
    if (spec.format === 'flag') return value !== null && value !== '' ? 'true' : 'false';
    if (value === null) return null;
    switch (spec.format) {
        case 'email': {
            // "Alice <alice@example.com>" is one address; text naming two addresses is not.
            const found = value.match(EMAIL);
            return found?.length === 1 ? found[0]!.toLowerCase() : null;
        }
        case 'emails': {
            const found = value.match(EMAIL);
            return found ? found.map((e) => e.toLowerCase()).join(', ') : null;
        }
        case 'date': {
            // Dates are read in the machine's local time zone, which is the user's.
            const ms = Date.parse(value.replace(/\bat\b/, ''));
            return Number.isNaN(ms) ? null : new Date(ms).toISOString();
        }
        case 'nonempty':
            return value.length > 0 ? value : null;
        case 'id':
            return ID.test(value) ? value : null;
        case 'text':
            return value;
    }
}

/** Every email address in `text`, lowercased. */
export function emailsIn(text: string): string[] {
    return (text.match(EMAIL) ?? []).map((e) => e.toLowerCase());
}
