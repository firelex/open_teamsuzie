import { randomBytes } from 'node:crypto';

export interface MimeInput {
    from: string; to: string; cc?: string; bcc?: string; subject: string;
    text: string; html?: string; inReplyTo?: string; references?: string;
    attachments?: Array<{ filename: string; contentType: string; content: string }>;
}

const CRLF = '\r\n';

/** RFC 2047 "B" encoding for a header value that is not plain ASCII. */
export function encodeHeader(value: string): string {
    return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Base64 wrapped at 76 characters, as MIME requires. */
const wrap = (b64: string) => b64.replace(/.{1,76}/g, (line) => line + CRLF).trimEnd();
const boundary = () => `=_${randomBytes(12).toString('hex')}`;
const quoted = (name: string) => encodeHeader(name).replace(/"/g, '\\"');

function textPart(type: 'text/plain' | 'text/html', body: string): string {
    return [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(body, 'utf8').toString('base64'))].join(CRLF);
}

function bodyPart(input: MimeInput): string {
    if (!input.html) return textPart('text/plain', input.text);
    const b = boundary();
    return [`Content-Type: multipart/alternative; boundary="${b}"`, '', `--${b}`, textPart('text/plain', input.text), `--${b}`, textPart('text/html', input.html), `--${b}--`].join(CRLF);
}

/** The whole RFC 822 message, with CRLF line endings, ready to base64url-encode for Gmail's `raw`. */
export function buildMime(input: MimeInput): string {
    const headers = [
        `From: ${input.from}`,
        `To: ${input.to}`,
        ...(input.cc ? [`Cc: ${input.cc}`] : []),
        ...(input.bcc ? [`Bcc: ${input.bcc}`] : []),
        `Subject: ${encodeHeader(input.subject)}`,
        ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
        ...(input.references ? [`References: ${input.references}`] : []),
        'MIME-Version: 1.0',
    ];
    if (!input.attachments?.length) return [...headers, bodyPart(input)].join(CRLF);
    const b = boundary();
    const parts = input.attachments.map((a) => [
        `Content-Type: ${a.contentType}; name="${quoted(a.filename)}"`,
        `Content-Disposition: attachment; filename="${quoted(a.filename)}"`,
        'Content-Transfer-Encoding: base64', '', wrap(a.content),
    ].join(CRLF));
    return [...headers, `Content-Type: multipart/mixed; boundary="${b}"`, '', `--${b}`, bodyPart(input), ...parts.flatMap((p) => [`--${b}`, p]), `--${b}--`].join(CRLF);
}
