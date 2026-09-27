import { describe, expect, it } from 'vitest';
import { buildMime, encodeHeader } from './mime.js';
import { decodeWords } from './parse.js';

describe('building a message', () => {
    it('encodes non-ASCII headers as RFC 2047 and leaves ASCII alone', () => {
        expect(encodeHeader('SPA mark-up')).toBe('SPA mark-up');
        expect(decodeWords(encodeHeader('Übernahme – SPA'))).toBe('Übernahme – SPA');
    });

    it('builds a plain message with threading headers and a base64 UTF-8 body', () => {
        const raw = buildMime({ from: 'me@firm.test', to: 'anna@x.test', subject: 'Re: Preis', text: 'Price is 5 €.', inReplyTo: '<a@x>', references: '<z@x> <a@x>' });
        expect(raw).toContain('From: me@firm.test\r\n');
        expect(raw).toContain('To: anna@x.test\r\n');
        expect(raw).toContain('Subject: Re: Preis\r\n');
        expect(raw).toContain('In-Reply-To: <a@x>\r\n');
        expect(raw).toContain('References: <z@x> <a@x>\r\n');
        expect(raw).toContain('MIME-Version: 1.0\r\n');
        expect(raw).toContain('Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n');
        expect(raw).toContain(Buffer.from('Price is 5 €.', 'utf8').toString('base64'));
        expect(raw).not.toMatch(/[^\r]\n/);
    });

    it('builds text plus HTML plus attachments as multipart/mixed around multipart/alternative', () => {
        const raw = buildMime({ from: 'me@firm.test', to: 'a@x.test', cc: 'b@x.test', subject: 'Docs', text: 'See attached', html: '<p>See attached</p>', attachments: [{ filename: 'SPA v3.pdf', contentType: 'application/pdf', content: 'JVBERg==' }] });
        expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="([^"]+)"/);
        expect(raw).toMatch(/Content-Type: multipart\/alternative; boundary="([^"]+)"/);
        expect(raw).toContain('Content-Type: application/pdf; name="SPA v3.pdf"\r\nContent-Disposition: attachment; filename="SPA v3.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERg==');
        expect(raw).toContain('Cc: b@x.test\r\n');
    });
});

describe('header safety', () => {
    it('refuses a header value with a line break, so an email cannot smuggle in a Bcc', () => {
        expect(() => buildMime({ from: 'me@firm.test', to: 'x\r\nBcc: spy@evil.test', subject: 'Re: hi', text: 'ok' })).toThrow(/line break/);
        expect(() => buildMime({ from: 'me@firm.test', to: 'a@x.test', subject: 'Re: hi', text: 'ok', inReplyTo: '<a@x>\nBcc: spy@evil.test' })).toThrow(/line break/);
    });
    it('encodes non-ASCII display names in address headers', () => {
        const raw = buildMime({ from: 'me@firm.test', to: '"Jürgen Müller" <jm@x.de>', subject: 'Hallo', text: 'ok' });
        expect(raw).toMatch(/To: =\?UTF-8\?B\?[^?]+\?= <jm@x\.de>\r\n/);
        expect(decodeWords(raw.match(/To: (.*)\r\n/)![1]!)).toBe('Jürgen Müller <jm@x.de>');
    });
});
