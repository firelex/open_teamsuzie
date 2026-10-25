import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DatabaseInstance } from './db.js';

export type AlertKind =
    | 'route_broken'
    | 'route_relearned'
    | 'needs_login'
    | 'account_mismatch'
    | 'send_unconfirmed'
    | 'approval_needed'
    | 'handler_failed';

export interface Alert {
    seq: number;
    account: string;
    kind: AlertKind;
    message: string;
    created_at: string;
}

/** Somewhere an alert is shown to the user. */
export interface Notifier {
    notify(alert: Alert): Promise<void>;
}

const run = promisify(execFile);

function appleScriptString(text: string): string {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const TITLES: Record<AlertKind, string> = {
    route_broken: 'Email agent: a mail action is broken',
    route_relearned: 'Email agent: a mail action was relearned',
    needs_login: 'Email agent: sign-in needed',
    account_mismatch: 'Email agent: wrong account signed in',
    send_unconfirmed: 'Email agent: a send could not be confirmed',
    approval_needed: 'Email agent: a send needs your approval',
    handler_failed: 'Email agent: an account stopped',
};

/** macOS Notification Center, through `osascript`. */
export class MacNotifier implements Notifier {
    async notify(alert: Alert): Promise<void> {
        await run('osascript', ['-e', `display notification ${appleScriptString(alert.message)} with title ${appleScriptString(TITLES[alert.kind])} subtitle ${appleScriptString(alert.account)}`]);
    }
}

interface Row extends Omit<Alert, 'kind'> { kind: AlertKind }

/** Alerts kept in SQLite (so agents and the CLI can list them) and pushed to every notifier. */
export class AlertStore {
    constructor(
        private readonly db: DatabaseInstance,
        private readonly notifiers: Notifier[],
        private readonly now: () => Date,
    ) {}

    async raise(account: string, kind: AlertKind, message: string): Promise<Alert> {
        const created_at = this.now().toISOString();
        const result = this.db.prepare('INSERT INTO alerts (account, kind, message, created_at) VALUES (?, ?, ?, ?)').run(account, kind, message, created_at);
        const alert: Alert = { seq: Number(result.lastInsertRowid), account, kind, message, created_at };
        for (const notifier of this.notifiers) await notifier.notify(alert);
        return alert;
    }

    /** Alerts after `after` (a seq), oldest first. */
    list(opts: { after: number; limit: number; account?: string }): Alert[] {
        const rows = opts.account === undefined
            ? this.db.prepare<[number, number], Row>('SELECT * FROM alerts WHERE seq > ? ORDER BY seq LIMIT ?').all(opts.after, opts.limit)
            : this.db.prepare<[number, string, number], Row>('SELECT * FROM alerts WHERE seq > ? AND account = ? ORDER BY seq LIMIT ?').all(opts.after, opts.account, opts.limit);
        return rows;
    }
}
