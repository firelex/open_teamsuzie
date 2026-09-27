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
