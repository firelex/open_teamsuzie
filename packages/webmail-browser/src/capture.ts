import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';

export interface PageCapture {
    url: string;
    /** Playwright's accessibility snapshot of the page: roles, names and nesting, as YAML. */
    aria: string;
    /** Interactive elements with no accessible name, as their opening tags (no content). */
    unnamed: string[];
}

const MAX_UNNAMED = 300;

/** What a model needs to see to write targets for the current page. */
export async function capturePage(page: Page): Promise<PageCapture> {
    const aria = await page.locator('body').ariaSnapshot();
    const unnamed = await page.evaluate((max) => {
        const selector = 'button, a[href], input, textarea, select, [role], [contenteditable="true"], [tabindex]';
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll(selector))) {
            if (out.length >= max) break;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const name = (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el as HTMLElement).innerText ?? '').trim();
            if (name || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder')) continue;
            const shallow = el.cloneNode(false) as Element;
            out.push(shallow.outerHTML.slice(0, 300));
        }
        return out;
    }, MAX_UNNAMED);
    return { url: page.url(), aria, unnamed };
}

// Subtrees whose names carry message content (rows, list items, message bodies) are left out of the fingerprint.
const CONTENT_ROLES = new Set(['grid', 'listbox', 'list', 'table', 'row', 'rowgroup', 'article', 'document', 'treegrid', 'feed', 'log']);
const LAYOUT_ROLES = new Set(['banner', 'navigation', 'search', 'toolbar', 'button', 'tab', 'tablist', 'menubar', 'menuitem', 'combobox', 'searchbox', 'link', 'complementary', 'main', 'contentinfo']);
const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/;

/**
 * A hash of the page's layout: the landmark regions, toolbars, buttons, tabs and links outside lists and message
 * content, with digits removed (so unread counts do not change it). It changes when the webmail changes its
 * layout, not when new mail arrives.
 */
export function fingerprintFromAria(aria: string): string {
    const kept = new Set<string>();
    let skipBelow: number | null = null;
    for (const line of aria.split('\n')) {
        const match = LINE.exec(line);
        if (!match) continue;
        const indent = match[1]!.length;
        if (skipBelow !== null) {
            if (indent > skipBelow) continue;
            skipBelow = null;
        }
        const role = match[2]!;
        if (CONTENT_ROLES.has(role)) {
            skipBelow = indent;
            continue;
        }
        if (LAYOUT_ROLES.has(role)) kept.add(`${role}:${(match[3] ?? '').replace(/\d+/g, '')}`);
    }
    const canonical = [...kept].sort().join('\n');
    return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export async function computeFingerprint(page: Page): Promise<string> {
    return fingerprintFromAria(await page.locator('body').ariaSnapshot());
}
