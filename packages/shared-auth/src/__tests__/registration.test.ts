import { describe, expect, it } from 'vitest';
import { checkRegistration, parseRegistrationPolicy } from '../utils/registration.js';

describe('parseRegistrationPolicy', () => {
    it('is closed when AUTH_REGISTRATION is unset or empty', () => {
        expect(parseRegistrationPolicy({})).toEqual({ mode: 'closed' });
        expect(parseRegistrationPolicy({ AUTH_REGISTRATION: '  ' })).toEqual({ mode: 'closed' });
    });

    it('reads open and closed, ignoring case and spaces', () => {
        expect(parseRegistrationPolicy({ AUTH_REGISTRATION: ' Open ' })).toEqual({ mode: 'open' });
        expect(parseRegistrationPolicy({ AUTH_REGISTRATION: 'CLOSED' })).toEqual({ mode: 'closed' });
    });

    it('reads domains as a lower-case, de-duplicated list', () => {
        expect(parseRegistrationPolicy({
            AUTH_REGISTRATION: 'domains',
            AUTH_REGISTRATION_DOMAINS: 'Example.com, @example.org,,example.com',
        })).toEqual({ mode: 'domains', domains: ['example.com', 'example.org'] });
    });

    it('refuses an unknown mode rather than guessing', () => {
        expect(() => parseRegistrationPolicy({ AUTH_REGISTRATION: 'true' })).toThrow(/AUTH_REGISTRATION must be one of/);
    });

    it('refuses domains without any domain', () => {
        expect(() => parseRegistrationPolicy({ AUTH_REGISTRATION: 'domains' })).toThrow(/AUTH_REGISTRATION_DOMAINS/);
        expect(() => parseRegistrationPolicy({ AUTH_REGISTRATION: 'domains', AUTH_REGISTRATION_DOMAINS: ' , ' }))
            .toThrow(/AUTH_REGISTRATION_DOMAINS/);
    });
});

describe('checkRegistration', () => {
    it('treats a missing policy as closed', () => {
        expect(checkRegistration(undefined, 'a@example.com').allowed).toBe(false);
    });

    it('closed refuses everyone', () => {
        const decision = checkRegistration({ mode: 'closed' }, 'a@example.com');
        expect(decision).toEqual({ allowed: false, message: expect.stringMatching(/closed/) });
    });

    it('open allows anyone', () => {
        expect(checkRegistration({ mode: 'open' }, 'a@anywhere.test')).toEqual({ allowed: true });
    });

    describe('domains', () => {
        const policy = { mode: 'domains' as const, domains: ['example.com'] };

        it('allows an email at a listed domain, in any case', () => {
            expect(checkRegistration(policy, 'a@example.com').allowed).toBe(true);
            expect(checkRegistration(policy, 'A@EXAMPLE.COM').allowed).toBe(true);
        });

        it('refuses other domains, subdomains and look-alikes', () => {
            for (const email of [
                'a@other.com',
                'a@sub.example.com',
                'a@example.com.evil.test',
                'a@notexample.com',
            ]) {
                expect(checkRegistration(policy, email).allowed, email).toBe(false);
            }
        });

        it('refuses malformed addresses that mention the domain', () => {
            for (const email of ['example.com', '@example.com', 'a@example.com@evil.test', 'a@evil.test@example.com', 'a b@example.com', '']) {
                expect(checkRegistration(policy, email).allowed, email).toBe(false);
            }
        });
    });
});
