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
}
