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
const MAX_OUTLINE_CHARS = 40_000;

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
    const outline = await page.evaluate(outlineOf, MAX_OUTLINE_CHARS);
    return { url: page.url(), aria, unnamed, outline };
}

/** Runs in the page. See PageCapture.outline. */
function outlineOf(maxChars: number): string {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'META', 'LINK', 'BR']);
    const KEEP = /^(role|aria-label|aria-checked|aria-selected|aria-expanded|title|name|type|placeholder|href|datetime|contenteditable|data-[\w-]+)$/;
    const lines: string[] = [];
    let length = 0;
    const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
    const visible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const describe = (el: Element) => {
        const attrs: string[] = [];
        for (const attr of Array.from(el.attributes)) {
            if (attr.name === 'class') {
                const classes = attr.value.split(/\s+/).filter((c) => c.length > 0).slice(0, 3);
                if (classes.length > 0) attrs.push(`class="${clip(classes.join(' '), 60)}"`);
            } else if (attr.name === 'id' && !/\d{2,}/.test(attr.value)) {
                attrs.push(`id="${clip(attr.value, 40)}"`);
            } else if (KEEP.test(attr.name)) {
                attrs.push(`${attr.name}="${clip(attr.value, 80)}"`);
            }
        }
        return `<${el.tagName.toLowerCase()}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>`;
    };
    const ownText = (el: Element) => clip(Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim(), 60);
    const signature = (el: Element) => `${el.tagName}.${el.getAttribute('role') ?? ''}.${el.getAttribute('class') ?? ''}`;
    const walk = (el: Element, depth: number) => {
        if (length > maxChars || SKIP.has(el.tagName.toUpperCase()) || !visible(el)) return;
        const text = ownText(el);
        const line = `${'  '.repeat(depth)}${describe(el)}${text ? ` ${text}` : ''}`;
        lines.push(line);
        length += line.length + 1;
        const children = Array.from(el.children);
        let run = 0;
        for (let i = 0; i < children.length; i++) {
            run = i > 0 && signature(children[i]!) === signature(children[i - 1]!) ? run + 1 : 0;
            if (run === 3) {
                const rest = children.slice(i).filter((c) => signature(c) === signature(children[i - 1]!)).length;
                lines.push(`${'  '.repeat(depth + 1)}… ${rest} more like the one above`);
            }
            if (run >= 3) continue;
            walk(children[i]!, depth + 1);
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
