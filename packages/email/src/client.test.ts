import { describe, expect, it } from 'vitest';
import { EMAIL_ACTION_TYPES, NullEmailClient } from './index.js';

describe('@teamsuzie/email contracts', () => {
    it('exposes stable approval-gated email action types', () => {
        expect(EMAIL_ACTION_TYPES).toEqual(['email.send', 'email.reply', 'email.forward']);
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
});
