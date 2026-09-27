const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/** Plain text from email HTML: block ends and line breaks become new lines, everything else is dropped. */
export function htmlToText(html: string): string {
    return html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (e) => ENTITIES[e]!)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Where quoted history starts in plain text, by the patterns mail programs use; null when there is none. */
const QUOTE_STARTS: RegExp[] = [
    /^On [^\n]{4,300}wrote:\s*$/m,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^From: [^\n]+\n(?:Sent|Date): /m,
    /^>/m,
];

function quoteStart(text: string): number | null {
    const found = QUOTE_STARTS.map((p) => p.exec(text)?.index).filter((i): i is number => i !== undefined);
    return found.length ? Math.min(...found) : null;
}

/** The first HTML quote container: Gmail's gmail_quote block or a blockquote. */
const HTML_QUOTE = /<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>|<blockquote\b[^>]*>/i;

/**
 * A message's plain text and where its quoted history starts (a character
 * offset into `text`, or null when it quotes nothing). Plain text is used as
 * sent when there is some; otherwise it is taken from the HTML.
 */
export function emailText(message: { bodyText?: string | null; bodyHtml?: string | null }): { text: string; quotedFrom: number | null } {
    if (message.bodyText != null && message.bodyText.trim() !== '') {
        const text = message.bodyText.replace(/\r\n/g, '\n').trimEnd();
        return { text, quotedFrom: quoteStart(text) };
    }
    if (message.bodyHtml == null || message.bodyHtml.trim() === '') throw new Error('The message has neither a text nor an HTML body');
    const split = HTML_QUOTE.exec(message.bodyHtml);
    if (split) {
        const before = htmlToText(message.bodyHtml.slice(0, split.index));
        const after = htmlToText(message.bodyHtml.slice(split.index));
        return before ? { text: `${before}\n${after}`, quotedFrom: before.length + 1 } : { text: after, quotedFrom: 0 };
    }
    const text = htmlToText(message.bodyHtml);
    return { text, quotedFrom: quoteStart(text) };
}
