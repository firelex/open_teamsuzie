/**
 * Shared Logger service with service name prefix support.
 * Provides consistent logging across all apps in the monorepo.
 */
export default class Logger {
    private prefix: string;

    constructor(serviceName?: string) {
        this.prefix = serviceName ? `[${serviceName}]` : '';
    }

    log = (type: string, message: string, context?: string | Record<string, unknown>) => {
        const _context = (typeof context === 'object')
            ? JSON.stringify(context)
            : context;

        if (type === 'error') {
            return this.error(message, _context);
        }

        if (type === 'warn') {
            return this.warn(message, _context);
        }

        return this.info(message, _context);
    }

    info = (message: string, context?: unknown) => {
        console.log(this.prefix, '[INFO]', message, ...(context !== undefined ? [context] : []));
    }

    warn = (message: string, context?: unknown) => {
        console.warn(this.prefix, '[WARN]', message, ...(context !== undefined ? [context] : []));
    }

    error = (message: string, context?: unknown) => {
        console.error(this.prefix, '[ERROR]', message, ...(context !== undefined ? [context] : []));
    }
}
