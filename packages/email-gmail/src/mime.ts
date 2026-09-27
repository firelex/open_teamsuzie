import { randomBytes } from 'node:crypto';
import { splitAddressList } from '@teamsuzie/email';

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

/** A header value must stay on one line: a line break would let the text add headers of its own (a hidden Bcc). */
function oneLine(name: string, value: string): string {
    if (/[\r\n]/.test(value)) throw new Error(`The ${name} header contains a line break, which could add headers to the message, so it was not sent`);
    return value;
}

/** An address list with any non-ASCII display name encoded ("Jürgen Müller" <jm@x.de> becomes =?UTF-8?B?...?= <jm@x.de>). */
function addresses(name: string, list: string): string {
    return splitAddressList(oneLine(name, list)).map((entry) => {
        const m = /^\s*"?(.*?)"?\s*<([^<>]+)>\s*$/.exec(entry);
        if (!m || /^[\x20-\x7e]*$/.test(m[1]!)) return entry.trim();
        return `${encodeHeader(m[1]!)} <${m[2]}>`;
    }).join(', ');
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
        `From: ${addresses('From', input.from)}`,
        `To: ${addresses('To', input.to)}`,
        ...(input.cc ? [`Cc: ${addresses('Cc', input.cc)}`] : []),
        ...(input.bcc ? [`Bcc: ${addresses('Bcc', input.bcc)}`] : []),
        `Subject: ${encodeHeader(oneLine('Subject', input.subject))}`,
        ...(input.inReplyTo ? [`In-Reply-To: ${oneLine('In-Reply-To', input.inReplyTo)}`] : []),
        ...(input.references ? [`References: ${oneLine('References', input.references)}`] : []),
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
