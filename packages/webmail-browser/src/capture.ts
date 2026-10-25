import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';

export interface PageCapture {
    url: string;
    /** Playwright's accessibility snapshot of the page: roles, names and nesting, as YAML. */
    aria: string;
    /** Interactive elements with no accessible name, as their opening tags (no content). */
    unnamed: string[];
    /**
     * A compact outline of the visible page as HTML-like lines: each element's tag and its describing attributes
     * (role, aria-label, title, name, type, class, data-*), with its own short text. Runs of similar siblings (list
     * rows) are cut to the first three. Shows what the accessibility tree leaves out, such as ids and addresses kept
     * in attributes.
     */
    outline: string;
}

const MAX_UNNAMED = 300;

const ARIA_SETTLE_TRIES = 8;
const ARIA_SETTLE_MS = 500;
const MIN_ARIA_CHARS = 200;

/**
 * What a model needs to see to write targets for the current page. Webmail apps briefly hide their whole page from
 * assistive technology while they re-render (the accessibility tree is then just "- application"), so the capture
 * waits up to four seconds for the tree to come back before taking it.
 */
export async function capturePage(page: Page, maxOutlineChars: number): Promise<PageCapture> {
    let aria = await page.locator('body').ariaSnapshot();
    for (let i = 0; i < ARIA_SETTLE_TRIES && aria.length < MIN_ARIA_CHARS; i++) {
        await new Promise((r) => setTimeout(r, ARIA_SETTLE_MS));
        aria = await page.locator('body').ariaSnapshot();
    }
    if (aria.length < MIN_ARIA_CHARS) {
        aria = `${aria}\n(The page's accessibility tree was nearly empty when captured: the page was hiding its content from assistive technology. Use the page outline below.)`;
    }
    const unnamed = await page.evaluate((max) => {
        const selector = 'button, a[href], input, textarea, select, [role], [contenteditable="true"], [tabindex]';
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll(selector))) {
            if (out.length >= max) break;
            if (el.closest('[aria-hidden="true"]')) continue;
            const role = el.getAttribute('role');
            if (role === 'none' || role === 'presentation') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 2 || rect.height <= 2) continue;
            const name = (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el as HTMLElement).innerText ?? '').trim();
            if (name || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder')) continue;
            const shallow = el.cloneNode(false) as Element;
            shallow.removeAttribute('style');
            out.push(shallow.outerHTML.slice(0, 300));
        }
        return out;
    }, MAX_UNNAMED);
    const outline = await page.evaluate(outlineOf, maxOutlineChars);
    return { url: page.url(), aria, unnamed, outline };
}

/**
 * Runs in the page. See PageCapture.outline. Anonymous wrapper elements (no role, label, title, useful data
 * attribute, interactivity or text of their own) are left out and their children shown in their place, so deeply
 * nested apps stay readable. Hidden elements and focus-trap helpers are skipped.
 */
function outlineOf(maxChars: number): string {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'META', 'LINK', 'BR', 'IMG', 'I']);
    const NOISY_DATA = /^data-(tabster|focus|is-focusable|automationid|fui|overflow|unique-id|ktp-execute|lpc|log|bi|app-section-id)/;
    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'TIME']);
    const CONTROL_TAGS = new Set(['A', 'BUTTON', 'OPTION', 'LABEL', 'H1', 'H2', 'H3', 'H4']);
    const CONTROL_ROLES = new Set(['button', 'tab', 'link', 'menuitem', 'menuitemcheckbox', 'option', 'heading', 'checkbox', 'radio', 'treeitem', 'switch']);
    const lines: string[] = [];
    let length = 0;
    const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
    const visible = (el: Element) => {
        if (el.getAttribute('aria-hidden') === 'true') return false;
        if (el.hasAttribute('data-tabster-dummy') || el.hasAttribute('data-focus-trap-dummy')) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 2 && rect.height <= 2) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    };
    // Generated class names (hashes such as "QdrUx" or "___1n1jw41") say nothing; keep only readable ones.
    const readableClass = (c: string) => c.length >= 3 && /^[a-z]+(?:-[a-z0-9]+)*$/.test(c) && !/\d{3,}/.test(c);
    const attributesOf = (el: Element): string[] => {
        const attrs: string[] = [];
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name;
            if (name === 'class') {
                const classes = attr.value.split(/\s+/).filter(readableClass).slice(0, 2);
                if (classes.length > 0) attrs.push(`class="${classes.join(' ')}"`);
            } else if (name === 'id') {
                if (!/\d{2,}/.test(attr.value) && attr.value.length <= 40) attrs.push(`id="${attr.value}"`);
            } else if (/^(role|aria-label|aria-selected|aria-checked|aria-expanded|aria-level|title|name|type|placeholder|href|datetime|contenteditable)$/.test(name)
                || (name.startsWith('data-') && !NOISY_DATA.test(name))) {
                if (name === 'role' && (attr.value === 'none' || attr.value === 'presentation')) continue;
                attrs.push(`${name}="${clip(attr.value, 80)}"`);
            }
        }
        return attrs;
    };
    const ownText = (el: Element) => Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    const signature = (el: Element) => `${el.tagName}.${el.getAttribute('role') ?? ''}.${el.getAttribute('class') ?? ''}`;
    const walk = (el: Element, depth: number) => {
        if (length > maxChars || SKIP.has(el.tagName.toUpperCase()) || !visible(el)) return;
        const attrs = attributesOf(el);
        const role = el.getAttribute('role');
        const interactive = INTERACTIVE.has(el.tagName) || el.getAttribute('contenteditable') === 'true' || (role !== null && role !== 'none' && role !== 'presentation');
        let text = ownText(el);
        // Controls often keep their label in nested spans: show it on the control itself.
        const control = CONTROL_TAGS.has(el.tagName) || (role !== null && CONTROL_ROLES.has(role));
        if (!text && control) text = ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
        const meaningful = interactive || attrs.some((a) => !a.startsWith('class=') && !a.startsWith('id=')) || text.length > 0;
        let childDepth = depth;
        if (meaningful) {
            const line = `${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>${text ? ` ${clip(text, 70)}` : ''}`;
            lines.push(line);
            length += line.length + 1;
            childDepth = depth + 1;
        }
        const children = Array.from(el.children);
        let run = 0;
        for (let i = 0; i < children.length; i++) {
            run = i > 0 && signature(children[i]!) === signature(children[i - 1]!) ? run + 1 : 0;
            if (run === 3) {
                const rest = children.slice(i).filter((c) => signature(c) === signature(children[i - 1]!)).length;
                lines.push(`${'  '.repeat(childDepth)}… ${rest} more like the one above`);
            }
            if (run >= 3) continue;
            walk(children[i]!, childDepth);
        }
    };
    walk(document.body, 0);
    return length > maxChars ? `${lines.join('\n')}\n… (outline cut at ${maxChars} characters)` : lines.join('\n');
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
