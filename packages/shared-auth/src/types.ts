import type { RegistrationPolicy } from './utils/registration.js';

export interface SharedAuthConfig {
    node_env: string;
    redis: {
        uri: string;
        key_prefix: string;
    };
    postgres: {
        uri: string;
        logging?: boolean;
    };
    cookie: {
        name: string;
        secret: string;
        domain?: string;
        maxAge?: number;
    };
    csrf: {
        cookie_name: string;
    };
    default_user_id: string;
    /** Who may create an account with POST /register. Unset means closed: only an admin creates accounts. */
    registration?: RegistrationPolicy;
    /**
     * Another place that checks passwords, e.g. a gateway's users file on the same machine. Sign-in asks it when
     * what was typed is not an email address, or when the email and password do not match a local account. It
     * answers with the email of the local account to sign in (which it has made sure exists), or null when the
     * password is wrong or the person may not sign in here. A throw fails the sign-in with that error.
     */
    externalPasswords?: (signInName: string, password: string) => Promise<string | null>;
}
