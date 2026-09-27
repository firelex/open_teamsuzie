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
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
    });
}

export function header(part: GmailApiPart, name: string): string | null {
    const h = part.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return h ? decodeWords(h.value) : null;
}

const text = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

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
        bodyText: plain ? text(plain.body!.data!) : null,
        bodyHtml: html ? text(html.body!.data!) : null,
        date: new Date(Number(m.internalDate)).toISOString(),
        unread: labelIds.includes('UNREAD'),
        labels: labelIds.map(labelName),
        messageIdHeader: header(m.payload, 'Message-ID'),
        attachments,
    };
}
