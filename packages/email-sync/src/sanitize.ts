import sanitizeHtml from 'sanitize-html';

const LAYOUT_ATTRIBUTES = ['style', 'align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'dir'];
/**
 * The CSS properties email layout needs. Anything else is dropped, including
 * every property that can load an image (background, list-style-image,
 * content, cursor) and positioning that could cover the host page.
 */
const ALLOWED_CSS = new Set([
    'color', 'background-color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'text-align', 'text-decoration', 'text-transform', 'text-indent', 'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'direction',
    'vertical-align', 'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-style', 'border-width', 'border-radius',
    'border-collapse', 'border-spacing', 'list-style-type', 'table-layout',
]);

/** A value is kept only without escapes, comments or functions other than colours: nothing can be smuggled past the property check. */
function safeValue(value: string): boolean {
    const withoutColours = value.replace(/\b(rgba?|hsla?)\(\s*[\d.%\s,/]+\)/gi, '');
    return !/[\\(]|\/\*|expression|javascript:/i.test(withoutColours);
}

function safeStyle(style: string): string {
    return style.split(';').map((d) => d.trim()).filter((d) => {
        const colon = d.indexOf(':');
        if (colon < 1) return false;
        return ALLOWED_CSS.has(d.slice(0, colon).trim().toLowerCase()) && safeValue(d.slice(colon + 1));
    }).join(';');
}

export interface SanitizeOptions {
    /**
     * Where a remote image is shown from instead of the sender's server: the host's own image proxy, which fetches it
     * without the reader's address or cookies. Without it, remote images are not shown.
     */
    remoteImage?: (src: string) => string;
}

/**
 * Inline styles senders use to hide text: preview text shown only in the inbox list, parts meant for one mail client.
 * (font-size:0 is left alone: layout tables use it around content that is shown.)
 */
const HIDDEN = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|max-height\s*:\s*0(?:px)?\s*(?:!important)?\s*(?:;|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:!important)?\s*(?:;|$))/i;

/** The email with every element its sender hid taken out, with its contents (judged on the original styles). */
function withoutHidden(html: string): string {
    // Everything else passes untouched (schemes included: embedded cid: and data: images); the second pass makes it safe.
    return sanitizeHtml(html, { allowedTags: false, allowedAttributes: false, allowVulnerableTags: true, allowedSchemesAppliedToAttributes: [], exclusiveFilter: (frame) => HIDDEN.test(frame.attribs.style ?? '') });
}

/** A remote image's size from its attributes or style, when given: 2px or less is a tracking pixel or a spacer. */
function tiny(attribs: Record<string, string>): boolean {
    const px = (v: string | undefined) => (v === undefined ? null : Number.parseFloat(v));
    const style = attribs.style ?? '';
    const fromStyle = (prop: string) => px(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)px`, 'i').exec(style)?.[1]);
    const w = px(attribs.width) ?? fromStyle('width');
    const h = px(attribs.height) ?? fromStyle('height');
    return (w !== null && w <= 2) || (h !== null && h <= 2);
}

/**
 * Email HTML made safe to show: no scripts, event handlers, frames, forms,
 * javascript links, positioning, or CSS beyond an allowlist of layout
 * properties (so no CSS can fetch anything). Remote images never load from the sender: with `remoteImage`, each
 * is shown through the address it returns (the host's own image proxy); without it, one with a description shows
 * it as "[description]" and one without is left out. Tracking pixels (2px or less) are always left out. Text the
 * sender hid is left out too. Tables and inline styles stay, so Outlook-style layouts still look right. Images
 * embedded in the message (cid: and data:) stay.
 */
export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): string {
    return sanitizeHtml(withoutHidden(html), {
        allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'span', 'font', 'center', 'u', 's', 'hr'],
        allowedAttributes: {
            '*': LAYOUT_ATTRIBUTES,
            a: ['href', 'title', ...LAYOUT_ATTRIBUTES],
            img: ['src', 'alt', 'width', 'height', 'style'],
            font: ['color', 'face', 'size', ...LAYOUT_ATTRIBUTES],
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        allowedSchemesByTag: { img: ['cid', 'data'] },
        allowProtocolRelative: false,
        // Style attributes are filtered by safeStyle below, declaration by declaration.
        parseStyleAttributes: false,
        transformTags: {
            '*': (tagName, attribs) => {
                if (attribs.style === undefined) return { tagName, attribs };
                const style = safeStyle(attribs.style);
                const { style: _dropped, ...rest } = attribs;
                return { tagName, attribs: style ? { ...rest, style } : rest };
            },
            img: (tagName, attribs) => {
                const styled = (a: Record<string, string>) => (a.style === undefined ? a : { ...a, style: safeStyle(a.style) });
                const src = attribs.src ?? '';
                if (/^(cid|data):/i.test(src)) return { tagName, attribs: styled(attribs) };
                if (!/^https?:\/\//i.test(src) || tiny(attribs)) return { tagName: 'span', attribs: {}, text: '' };
                if (opts.remoteImage) return { tagName, attribs: styled({ ...attribs, src: opts.remoteImage(src) }) };
                const alt = (attribs.alt ?? '').trim();
                return { tagName: 'span', attribs: {}, text: alt ? `[${alt}]` : '' };
            },
        },
    });
}
