import type { DatabaseInstance } from './db.js';

export interface MailSummary {
    id: string;
    thread_id: string | null;
    from: string;
    subject: string;
    date: string;
    snippet: string | null;
}

export interface NewMailItem extends MailSummary {
    seq: number;
    account: string;
}

interface Row {
    seq: number;
    account: string;
    message_id: string;
    thread_id: string | null;
    sender: string;
    subject: string;
    date: string;
    snippet: string | null;
}

function toItem(row: Row): NewMailItem {
    return {
        seq: row.seq,
        account: row.account,
        id: row.message_id,
        thread_id: row.thread_id,
        from: row.sender,
        subject: row.subject,
        date: row.date,
        snippet: row.snippet,
    };
}

/**
 * Inbox messages the service has seen, each numbered in the order it was first seen. Agents read the feed after
 * a cursor (the last `seq` they saw).
 */
export class NewMailStore {
    constructor(private readonly db: DatabaseInstance, private readonly now: () => Date) {}

    /** Record inbox summaries; returns the ones not seen before. */
    record(account: string, summaries: MailSummary[]): NewMailItem[] {
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO new_mail (account, message_id, thread_id, sender, subject, date, snippet, seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const added: number[] = [];
        const seenAt = this.now().toISOString();
        // Oldest first, so sequence numbers follow arrival order.
        const ordered = [...summaries].sort((a, b) => a.date.localeCompare(b.date));
        this.db.transaction(() => {
            for (const s of ordered) {
                const result = insert.run(account, s.id, s.thread_id, s.from, s.subject, s.date, s.snippet, seenAt);
                if (result.changes === 1) added.push(Number(result.lastInsertRowid));
            }
        })();
        if (added.length === 0) return [];
        return this.db.prepare<number[], Row>(`SELECT * FROM new_mail WHERE seq IN (${added.map(() => '?').join(', ')}) ORDER BY seq`).all(...added).map(toItem);
    }

    list(opts: { after: number; limit: number; account?: string }): { items: NewMailItem[]; cursor: number } {
        const rows = opts.account === undefined
            ? this.db.prepare<[number, number], Row>('SELECT * FROM new_mail WHERE seq > ? ORDER BY seq LIMIT ?').all(opts.after, opts.limit)
            : this.db.prepare<[number, string, number], Row>('SELECT * FROM new_mail WHERE seq > ? AND account = ? ORDER BY seq LIMIT ?').all(opts.after, opts.account, opts.limit);
        const items = rows.map(toItem);
        return { items, cursor: items.length > 0 ? items[items.length - 1]!.seq : opts.after };
    }

    /** The sender of a message the service has seen, or null when it has not seen it. */
    senderOf(account: string, messageId: string): string | null {
        const row = this.db.prepare<[string, string], { sender: string }>('SELECT sender FROM new_mail WHERE account = ? AND message_id = ?').get(account, messageId);
        return row ? row.sender : null;
    }
}
