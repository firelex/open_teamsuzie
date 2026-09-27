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

const isQuoted = (line: string) => line.startsWith('>');
const isBlank = (line: string) => line.trim() === '';

/**
 * Where quoted history starts in plain text; null when there is none. History
 * is only ever the tail of a message: when the writer's own words come after
 * a quote (answering below or between quoted lines), nothing is treated as
 * history, so nothing they wrote is hidden.
 */
function quoteStart(text: string): number | null {
    const lines = text.split('\n');
    const offsets: number[] = [];
    let at = 0;
    for (const l of lines) { offsets.push(at); at += l.length + 1; }
    const restIsQuoted = (from: number) => lines.slice(from).every((l) => isBlank(l) || isQuoted(l));
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // "On Tue, 22 Sep 2026, Anna wrote:" followed only by quoted lines.
        if (/^On .{4,300}wrote:\s*$/.test(line) && restIsQuoted(i + 1)) return offsets[i]!;
        // Outlook: everything after the original-message marker is the original.
        if (/^-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)) return offsets[i]!;
        if (/^From: /.test(line) && /^(Sent|Date): /.test(lines[i + 1] ?? '')) return offsets[i]!;
        // Two or more ">" lines running to the end.
        if (isQuoted(line) && isQuoted(lines[i + 1] ?? '') && restIsQuoted(i)) return offsets[i]!;
    }
    return null;
}

/**
 * The first HTML quote container: Gmail's gmail_quote block, a cited
 * blockquote, or a plain blockquote right after a "… wrote:" line. Any other
 * blockquote is part of the message (a quoted clause, for example).
 */
function htmlQuoteStart(html: string): number | null {
    const gmail = /<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>/i.exec(html);
    const cite = /<blockquote\b[^>]*type="cite"[^>]*>/i.exec(html);
    const found = [gmail?.index, cite?.index].filter((i): i is number => i !== undefined);
    const plain = /<blockquote\b[^>]*>/gi;
    for (let m = plain.exec(html); m; m = plain.exec(html)) {
        if (/wrote:\s*$/i.test(htmlToText(html.slice(0, m.index)))) { found.push(m.index); break; }
    }
    return found.length ? Math.min(...found) : null;
}

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
    const split = htmlQuoteStart(message.bodyHtml);
    if (split !== null) {
        const before = htmlToText(message.bodyHtml.slice(0, split));
        const after = htmlToText(message.bodyHtml.slice(split));
        return before ? { text: `${before}\n${after}`, quotedFrom: before.length + 1 } : { text: after, quotedFrom: 0 };
    }
    const text = htmlToText(message.bodyHtml);
    return { text, quotedFrom: quoteStart(text) };
}
