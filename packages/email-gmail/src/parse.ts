import type { EmailAttachment, EmailMessage } from '@teamsuzie/email';

export interface GmailApiPart {
    partId?: string;
    mimeType: string;
    filename?: string;
    headers?: Array<{ name: string; value: string }>;
    body?: { size?: number; data?: string; attachmentId?: string };
    parts?: GmailApiPart[];
}
export interface GmailApiMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate: string; payload: GmailApiPart }

/** Decodes RFC 2047 encoded words ("=?UTF-8?B?...?=", "=?UTF-8?Q?...?=") in a header value. */
export function decodeWords(value: string): string {
    return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, charset: string, enc: string, text: string) => {
        const bytes = enc.toUpperCase() === 'B'
            ? Buffer.from(text, 'base64')
            : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
        return decodeIn(charset, bytes, 'a header');
    });
}

/**
 * Bytes 0x80-0x9F in windows-1252 (which the web's encoding standard also uses for "latin1" and
 * "iso-8859-1"). Node's decoder reads them as ISO-8859-1 control characters, losing "€", "–" and the
 * curly quotes that Outlook sends, so they are mapped here.
 */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
const CP1252_LABELS = new Set(['windows-1252', 'cp1252', 'x-cp1252', 'latin1', 'iso-8859-1', 'iso8859-1', 'l1', 'us-ascii', 'ascii']);

/** Bytes in a named character set; one the platform cannot decode is an error that names it. */
function decodeIn(charset: string, bytes: Uint8Array, where: string): string {
    if (CP1252_LABELS.has(charset.trim().toLowerCase())) {
        return Array.from(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : String.fromCharCode(b))).join('');
    }
    let decoder: InstanceType<typeof TextDecoder>;
    try {
        decoder = new TextDecoder(charset.trim().toLowerCase());
    } catch {
        throw new Error(`${where} uses the character set "${charset}", which cannot be decoded`);
    }
    return decoder.decode(bytes);
}

export function header(part: GmailApiPart, name: string): string | null {
    const h = part.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h ? decodeWords(h.value) : null;
}

/** A text part's body, in the character set its Content-Type declares (UTF-8, the default, when it declares none). */
function text(part: GmailApiPart, messageId: string): string {
    const charset = /charset\s*=\s*"?([^";\s]+)"?/i.exec(header(part, 'Content-Type') ?? '')?.[1] ?? 'utf-8';
    return decodeIn(charset, Buffer.from(part.body!.data!, 'base64url'), `Message ${messageId}`);
}

/** Every leaf part, depth first. */
function leaves(part: GmailApiPart): GmailApiPart[] {
    return part.parts?.length ? part.parts.flatMap(leaves) : [part];
}

export function parseGmailMessage(m: GmailApiMessage, labelName: (id: string) => string): EmailMessage {
    const all = leaves(m.payload);
    const isAttachment = (p: GmailApiPart) => Boolean(p.filename) && Boolean(p.body?.attachmentId);
    const plain = all.find((p) => p.mimeType === 'text/plain' && !isAttachment(p) && p.body?.data !== undefined);
    const html = all.find((p) => p.mimeType === 'text/html' && !isAttachment(p) && p.body?.data !== undefined);
    const attachments: EmailAttachment[] = all.filter(isAttachment).map((p) => ({
        id: p.body!.attachmentId!, filename: p.filename!, contentType: p.mimeType, size: p.body!.size ?? 0,
    }));
    const labelIds = m.labelIds ?? [];
    return {
        id: m.id,
        threadId: m.threadId,
        subject: header(m.payload, 'Subject'),
        from: header(m.payload, 'From'),
        to: header(m.payload, 'To'),
        cc: header(m.payload, 'Cc'),
        bodyText: plain ? text(plain, m.id) : null,
        bodyHtml: html ? text(html, m.id) : null,
        date: new Date(Number(m.internalDate)).toISOString(),
        unread: labelIds.includes('UNREAD'),
        labels: labelIds.map(labelName),
        messageIdHeader: header(m.payload, 'Message-ID'),
        attachments,
    };
}
