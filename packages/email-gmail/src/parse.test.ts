import { describe, expect, it } from 'vitest';
import { parseGmailMessage, type GmailApiMessage } from './parse.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const names: Record<string, string> = { Label_7: 'Deal/Falcon' };
const labelName = (id: string) => names[id] ?? id;

const message: GmailApiMessage = {
    id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD', 'Label_7'], internalDate: String(Date.parse('2026-09-22T08:00:00Z')),
    payload: {
        mimeType: 'multipart/mixed',
        headers: [
            { name: 'From', value: '"Anna Reed" <anna@sterlingrowe.test>' },
            { name: 'To', value: 'me@firm.test' },
            { name: 'Cc', value: 'bob@firm.test' },
            { name: 'Subject', value: '=?UTF-8?B?w5xiZXJuYWhtZSDigJMgU1BB?=' },
            { name: 'Message-ID', value: '<abc@mail.test>' },
        ],
        parts: [
            { mimeType: 'multipart/alternative', parts: [
                { mimeType: 'text/plain', body: { data: b64('Price is 5 €.') } },
                { mimeType: 'text/html', body: { data: b64('<p>Price is 5 €.</p>') } },
            ] },
            { mimeType: 'application/pdf', filename: 'SPA v3.pdf', body: { attachmentId: 'att-1', size: 1234 } },
        ],
    },
};

describe('parsing a Gmail message', () => {
    it('reads headers, both bodies, attachments, read state and label names', () => {
        expect(parseGmailMessage(message, labelName)).toEqual({
            id: 'm1', threadId: 't1',
            subject: 'Übernahme – SPA',
            from: '"Anna Reed" <anna@sterlingrowe.test>', to: 'me@firm.test', cc: 'bob@firm.test',
            bodyText: 'Price is 5 €.', bodyHtml: '<p>Price is 5 €.</p>',
            date: '2026-09-22T08:00:00.000Z',
            unread: true, labels: ['INBOX', 'UNREAD', 'Deal/Falcon'],
            messageIdHeader: '<abc@mail.test>',
            attachments: [{ id: 'att-1', filename: 'SPA v3.pdf', contentType: 'application/pdf', size: 1234 }],
        });
    });

    it('reads a message that is a single text part', () => {
        const single: GmailApiMessage = { id: 'm2', threadId: 't2', labelIds: ['SENT'], internalDate: '0', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'me@firm.test' }], body: { data: b64('Hi') } } };
        expect(parseGmailMessage(single, labelName)).toMatchObject({ bodyText: 'Hi', bodyHtml: null, unread: false, subject: null, attachments: [] });
    });
});

describe('character sets', () => {
    it('decodes a body in the charset its part declares', () => {
        const latin1 = Buffer.from([0x50, 0x72, 0x65, 0x69, 0x73, 0x3a, 0x20, 0x35, 0x20, 0x80, 0x2c, 0x20, 0xfc]).toString('base64url'); // "Preis: 5 €, ü" in windows-1252
        const m: GmailApiMessage = { id: 'm9', threadId: 't9', labelIds: [], internalDate: '0', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'a@x.de' }, { name: 'Content-Type', value: 'text/plain; charset="windows-1252"' }], body: { data: latin1 } } };
        expect(parseGmailMessage(m, labelName).bodyText).toBe('Preis: 5 €, ü');
    });
    it('names the message and charset when it cannot decode one', () => {
        const m: GmailApiMessage = { id: 'm10', threadId: 't9', labelIds: [], internalDate: '0', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'a@x.de' }, { name: 'Content-Type', value: 'text/plain; charset=unknown-8bit' }], body: { data: b64('x') } } };
        expect(() => parseGmailMessage(m, labelName)).toThrow(/m10.*unknown-8bit/);
    });
});
