import { describe, expect, it } from 'vitest';
import { FixtureMailNetwork } from './index.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('FixtureMailNetwork', () => {
    it('delivers a sent email, with its attachment, to a recipient mailbox on the network', async () => {
        const net = new FixtureMailNetwork();
        const a = net.mailbox('agent@firm-a.test');
        const b = net.mailbox('agent@firm-b.test');
        const { cursor } = await b.changesSince!(null);
        await a.send({ to: 'agent@firm-b.test', subject: 'NDA', body: 'Please find our draft attached.', attachments: [{ filename: 'NDA v1.docx', contentType: DOCX, content: 'UEsDBA==' }] });

        const { changes } = await b.changesSince!(cursor);
        expect(changes).toHaveLength(1);
        const thread = await b.getThread!(changes[0]!.threadId);
        const message = thread.messages[0]!;
        expect(message).toMatchObject({ from: 'agent@firm-a.test', to: 'agent@firm-b.test', subject: 'NDA', bodyText: 'Please find our draft attached.', unread: true, labels: ['INBOX'] });
        expect(message.attachments).toEqual([{ id: expect.any(String), filename: 'NDA v1.docx', contentType: DOCX, size: 4 }]);
        const opened = await b.openAttachment!(message.id, message.attachments![0]!.id!);
        expect(opened.content).toBe('UEsDBA==');

        const sent = await a.getThread!(changes[0]!.threadId);
        expect(sent.messages[0]).toMatchObject({ from: 'agent@firm-a.test', unread: false, labels: ['SENT'] });
    });

    it('keeps a reply, and its attachment, in the same conversation for both sides', async () => {
        const net = new FixtureMailNetwork();
        const a = net.mailbox('agent@firm-a.test');
        const b = net.mailbox('agent@firm-b.test');
        const first = await a.send({ to: 'agent@firm-b.test', subject: 'NDA', body: 'Draft attached.' });
        const inB = await b.getThread!(first.threadId!);
        const reply = await b.reply!({ messageId: inB.messages[0]!.id, body: 'Our mark-up attached.', attachments: [{ filename: 'NDA v2.docx', contentType: DOCX, content: 'UEsDBA==' }] });
        expect(reply.threadId).toBe(first.threadId);

        const inA = await a.getThread!(first.threadId!);
        expect(inA.messages.map((m) => m.from)).toEqual(['agent@firm-a.test', 'agent@firm-b.test']);
        expect(inA.messages[1]).toMatchObject({ subject: 'RE: NDA', to: 'agent@firm-a.test', unread: true });
        expect(inA.messages[1]!.attachments?.map((x) => x.filename)).toEqual(['NDA v2.docx']);
    });

    it('lists a mailbox\'s conversations newest first, and delivers nothing to an address not on the network', async () => {
        const net = new FixtureMailNetwork();
        const a = net.mailbox('agent@firm-a.test');
        await a.send({ to: 'someone@elsewhere.test', subject: 'One', body: 'x' });
        await a.send({ to: 'someone@elsewhere.test', subject: 'Two', body: 'y' });
        const { threads } = await a.listThreads!();
        expect(threads.map((t) => t.subject)).toEqual(['Two', 'One']);
    });

    it('refuses a reply to a message the mailbox does not hold', async () => {
        const net = new FixtureMailNetwork();
        const a = net.mailbox('agent@firm-a.test');
        await expect(a.reply!({ messageId: 'nope', body: 'x' })).rejects.toThrow(/nope is not in agent@firm-a.test/);
    });

    it('gives each address one mailbox', () => {
        const net = new FixtureMailNetwork();
        expect(net.mailbox('agent@firm-a.test')).toBe(net.mailbox('Agent@Firm-A.test'));
    });
});
