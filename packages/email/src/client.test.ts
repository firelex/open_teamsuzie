import { describe, expect, it } from 'vitest';
import { EMAIL_ACTION_TYPES, NullEmailClient } from './index.js';
import type { ChangesResult, EmailClient, EmailThread, EmailThreadDetail } from './index.js';

describe('@teamsuzie/email contracts', () => {
    it('exposes stable approval-gated email action types', () => {
        expect(EMAIL_ACTION_TYPES).toEqual(['email.send', 'email.reply', 'email.reply_all', 'email.forward']);
    });

    it('provides a null client for unconfigured hosts', async () => {
        const client = new NullEmailClient();
        expect(client.status()).toMatchObject({ configured: false, reachable: false });
        await expect(client.send({
            to: 'a@example.com',
            subject: 'Hello',
            body: 'Hi',
        })).rejects.toThrow('No email client configured');
    });

    it('keeps the thread-level members optional, so clients written before them still satisfy the interface', () => {
        const legacy = {
            status: () => ({ configured: true }),
            send: async () => ({ queueId: 'q1', queued: true as const }),
        } satisfies EmailClient;
        expect(legacy.status().configured).toBe(true);
    });

    it('describes threads, their messages and incremental changes', async () => {
        const thread: EmailThread = { id: 't1', subject: 'SPA', participants: ['a@x.com'], messageIds: ['m1'], labels: ['INBOX'], unread: true, lastMessageAt: '2026-09-27T10:00:00Z', snippet: 'Hi' };
        const detail: EmailThreadDetail = { ...thread, messages: [{ id: 'm1', subject: 'SPA', from: 'a@x.com', to: 'b@y.com', threadId: 't1', unread: true, labels: ['INBOX'], messageIdHeader: '<m1@x.com>' }] };
        const changes: ChangesResult = { changes: [{ kind: 'read_changed', threadId: 't1', messageId: 'm1', unread: false }], cursor: '2' };
        const client: EmailClient = {
            status: () => ({ configured: true }),
            send: async () => ({ queueId: 'q', queued: true }),
            getThread: async () => detail,
            changesSince: async () => changes,
        };
        expect((await client.getThread!('t1')).messages[0]!.messageIdHeader).toBe('<m1@x.com>');
        expect((await client.changesSince!(null)).cursor).toBe('2');
    });
});
