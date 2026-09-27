import { describe, expect, it } from 'vitest';
import { FixtureEmailClient, type FixtureMailbox } from './index.js';

const mailbox = (): FixtureMailbox => ({
    account: 'me@firm.com',
    threads: [
        {
            id: 't1',
            labels: ['INBOX'],
            messages: [
                { id: 'm1', threadId: 't1', subject: 'SPA mark-up', from: 'anna@sterlingrowe.com', to: 'me@firm.com', date: '2026-09-20T09:00:00Z', bodyText: 'Please see attached.', unread: false, attachments: [{ filename: 'SPA v3.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 4, content: 'UEsDBA==' }] },
                { id: 'm2', threadId: 't1', subject: 'RE: SPA mark-up', from: 'me@firm.com', to: 'anna@sterlingrowe.com', date: '2026-09-21T09:00:00Z', bodyText: 'Thanks.', unread: false },
            ],
        },
        {
            id: 't2',
            labels: ['INBOX'],
            messages: [
                { id: 'm3', threadId: 't2', subject: 'Signing', from: 'ben@hawk.com', to: 'me@firm.com', date: '2026-09-25T09:00:00Z', bodyText: 'Can we sign Friday?', unread: true },
            ],
        },
    ],
});

describe('FixtureEmailClient', () => {
    it('loads a mailbox and lists its threads newest first', async () => {
        const client = new FixtureEmailClient(mailbox());
        const { threads, nextPageToken } = await client.listThreads();
        expect(threads.map((t) => t.id)).toEqual(['t2', 't1']);
        expect(threads[0]).toMatchObject({ unread: true, lastMessageAt: '2026-09-25T09:00:00Z', messageIds: ['m3'], participants: ['ben@hawk.com', 'me@firm.com'] });
        expect(nextPageToken).toBeNull();
    });

    it('names the thread and message at fault when the file is wrong', () => {
        const bad = mailbox();
        bad.threads[1]!.messages[0]!.date = 'last Tuesday';
        expect(() => new FixtureEmailClient(bad)).toThrow('thread t2 message m3: date is not an ISO date');
        const dup = mailbox();
        dup.threads[1]!.messages[0]!.id = 'm1';
        expect(() => new FixtureEmailClient(dup)).toThrow('message id m1 is used more than once');
    });

    it('reports a delivered message as exactly one change after the previous cursor', async () => {
        const client = new FixtureEmailClient(mailbox());
        const start = await client.changesSince(null);
        expect(start.changes).toEqual([]);
        client.deliver('t2', { id: 'm4', subject: 'RE: Signing', from: 'ben@hawk.com', to: 'me@firm.com', date: '2026-09-26T09:00:00Z', bodyText: 'Or Monday.', unread: true });
        const next = await client.changesSince(start.cursor);
        expect(next.changes).toEqual([{ kind: 'message_added', threadId: 't2', messageId: 'm4' }]);
        expect((await client.changesSince(next.cursor)).changes).toEqual([]);
        expect((await client.getThread('t2')).messages.map((m) => m.id)).toEqual(['m3', 'm4']);
    });

    it('records read and label changes', async () => {
        const client = new FixtureEmailClient(mailbox());
        const { cursor } = await client.changesSince(null);
        await client.setRead(['m3'], true);
        await client.modifyLabels('t1', ['Deal/Falcon'], []);
        const { changes } = await client.changesSince(cursor);
        expect(changes).toEqual([
            { kind: 'read_changed', threadId: 't2', messageId: 'm3', unread: false },
            { kind: 'labels_changed', threadId: 't1', messageId: 'm1', labels: ['INBOX', 'Deal/Falcon'] },
            { kind: 'labels_changed', threadId: 't1', messageId: 'm2', labels: ['INBOX', 'Deal/Falcon'] },
        ]);
    });

    it('appends a reply to the same thread as an outbound message and records the call', async () => {
        const client = new FixtureEmailClient(mailbox());
        const result = await client.reply({ messageId: 'm3', body: 'Friday works.' });
        expect(result).toMatchObject({ queued: true, direct: true });
        const thread = await client.getThread('t2');
        expect(thread.messages.at(-1)).toMatchObject({ from: 'me@firm.com', to: 'ben@hawk.com', subject: 'RE: Signing', bodyText: 'Friday works.', inReplyToId: 'm3' });
        expect(client.sent).toEqual([{ kind: 'reply', input: { messageId: 'm3', body: 'Friday works.' } }]);
    });

    it('replies to everyone on reply-all, except the account itself', async () => {
        const box = mailbox();
        box.threads[1]!.messages[0]!.cc = 'cara@hawk.com, me@firm.com';
        const client = new FixtureEmailClient(box);
        await client.replyAll({ messageId: 'm3', body: 'Friday works.' });
        expect((await client.getThread('t2')).messages.at(-1)).toMatchObject({ to: 'ben@hawk.com', cc: 'cara@hawk.com' });
    });

    it('pages through every thread exactly once', async () => {
        const client = new FixtureEmailClient(mailbox());
        const first = await client.listThreads({ limit: 1 });
        const second = await client.listThreads({ limit: 1, pageToken: first.nextPageToken });
        expect([...first.threads, ...second.threads].map((t) => t.id)).toEqual(['t2', 't1']);
        expect(second.nextPageToken).toBeNull();
    });

    it('opens an attachment with its content, and fails loudly when there is none', async () => {
        const client = new FixtureEmailClient(mailbox());
        expect((await client.openAttachment('m1', 'SPA v3.docx')).content).toBe('UEsDBA==');
        await expect(client.openAttachment('m1', 'missing.pdf')).rejects.toThrow('message m1 has no attachment missing.pdf');
    });

    it('never exposes attachment content in thread listings', async () => {
        const client = new FixtureEmailClient(mailbox());
        const thread = await client.getThread('t1');
        expect(thread.messages[0]!.attachments![0]).not.toHaveProperty('content');
    });
});
