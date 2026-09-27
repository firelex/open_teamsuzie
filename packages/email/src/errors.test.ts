import { describe, expect, it } from 'vitest';
import { EmailAuthError, EmailCursorExpiredError } from './index.js';

describe('email errors', () => {
    it('are distinct classes a host can test for without knowing the provider', () => {
        const auth = new EmailAuthError('Google no longer accepts this connection');
        const cursor = new EmailCursorExpiredError('History 123 is too old');
        expect(auth).toBeInstanceOf(Error);
        expect(auth).toBeInstanceOf(EmailAuthError);
        expect(auth).not.toBeInstanceOf(EmailCursorExpiredError);
        expect(auth.name).toBe('EmailAuthError');
        expect(cursor.name).toBe('EmailCursorExpiredError');
        expect(cursor.message).toBe('History 123 is too old');
    });
});

describe('not found', () => {
    it('is its own class, for a thread or message the provider no longer has', async () => {
        const { EmailNotFoundError } = await import('./index.js');
        const e = new EmailNotFoundError('Thread t1 no longer exists');
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('EmailNotFoundError');
    });
});
