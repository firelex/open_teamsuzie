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

/**
 * Email HTML made safe to show: no scripts, event handlers, frames, forms,
 * javascript links, positioning, or CSS beyond an allowlist of layout
 * properties (so no CSS can fetch anything), and no remote images (they are
 * tracking pixels as often as pictures; each becomes "[image]"). Tables and
 * inline styles stay, so Outlook-style layouts still look right. Images
 * embedded in the message (cid: and data:) stay.
 */
export function sanitizeEmailHtml(html: string): string {
    return sanitizeHtml(html, {
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
            img: (tagName, attribs) => (/^(cid|data):/i.test(attribs.src ?? '')
                ? { tagName, attribs: attribs.style === undefined ? attribs : { ...attribs, style: safeStyle(attribs.style) } }
                : { tagName: 'span', attribs: {}, text: '[image]' }),
        },
    });
}
