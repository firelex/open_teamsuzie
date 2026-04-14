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
}
