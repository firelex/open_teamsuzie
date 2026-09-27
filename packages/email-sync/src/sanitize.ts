import sanitizeHtml from 'sanitize-html';

const LAYOUT_ATTRIBUTES = ['style', 'align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'dir'];
/** CSS values that can run code or fetch from the network. */
const DANGEROUS_CSS = /expression\s*\(|url\s*\(|behavior\s*:|-moz-binding|javascript:|@import/i;

function safeStyle(style: string): string {
    return style.split(';').map((d) => d.trim()).filter((d) => d && !DANGEROUS_CSS.test(d)).join(';');
}

/**
 * Email HTML made safe to show: no scripts, event handlers, frames, forms,
 * javascript links or network-fetching CSS, and no remote images (they are
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
