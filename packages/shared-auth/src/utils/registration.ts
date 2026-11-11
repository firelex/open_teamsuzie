/**
 * Who may create an account with `POST /register`.
 *
 *   closed  - nobody: accounts are made by an admin (the default)
 *   open    - anyone
 *   domains - only emails at one of `domains` (exact match, case-insensitive)
 */
export type RegistrationMode = 'closed' | 'open' | 'domains';

export interface RegistrationPolicy {
    mode: RegistrationMode;
    /** Lower-case email domains, used when mode is 'domains'. */
    domains?: string[];
}

export const CLOSED_REGISTRATION: RegistrationPolicy = Object.freeze({ mode: 'closed' }) as RegistrationPolicy;

const MODES: readonly RegistrationMode[] = ['closed', 'open', 'domains'];

/**
 * Read the policy from AUTH_REGISTRATION and AUTH_REGISTRATION_DOMAINS (comma-separated). Unset means closed. A mode
 * that is not recognised, or 'domains' with no domains, throws: a typo must not silently open (or close) sign-up.
 */
export function parseRegistrationPolicy(env: Record<string, string | undefined>): RegistrationPolicy {
    const raw = (env.AUTH_REGISTRATION ?? '').trim().toLowerCase();
    if (!raw) return { mode: 'closed' };
    if (!MODES.includes(raw as RegistrationMode)) {
        throw new Error(`AUTH_REGISTRATION must be one of ${MODES.join(', ')} (got '${env.AUTH_REGISTRATION}')`);
    }
    const mode = raw as RegistrationMode;
    if (mode !== 'domains') return { mode };

    const domains = (env.AUTH_REGISTRATION_DOMAINS ?? '')
        .split(',')
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
    if (domains.length === 0) {
        throw new Error('AUTH_REGISTRATION=domains needs AUTH_REGISTRATION_DOMAINS (comma-separated email domains)');
    }
    return { mode, domains: [...new Set(domains)] };
}

export type RegistrationDecision = { allowed: true } | { allowed: false; message: string };

/** Whether `email` may register under `policy`. A missing policy is treated as closed. */
export function checkRegistration(policy: RegistrationPolicy | undefined, email: string): RegistrationDecision {
    const effective = policy ?? CLOSED_REGISTRATION;
    if (effective.mode === 'open') return { allowed: true };
    if (effective.mode === 'closed') {
        return { allowed: false, message: 'Registration is closed: ask an administrator to create your account' };
    }

    // Exactly one '@' and no whitespace, so 'a@allowed.com@other.com' cannot pass on either domain.
    const match = /^[^\s@]+@([^\s@]+)$/.exec(email.trim());
    const domain = match ? match[1].toLowerCase() : '';
    if (domain && (effective.domains ?? []).includes(domain)) return { allowed: true };
    return { allowed: false, message: 'Registration is not open for this email address' };
}
