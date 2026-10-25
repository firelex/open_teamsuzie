import type { DatabaseInstance } from './db.js';

/** The inbox layout fingerprint last accepted for each account. A different one means the webmail changed its layout. */
export class LayoutBaselineStore {
    constructor(private readonly db: DatabaseInstance, private readonly now: () => Date) {}

    get(account: string): string | null {
        const row = this.db.prepare<[string], { fingerprint: string }>('SELECT fingerprint FROM layout_baseline WHERE account = ?').get(account);
        return row ? row.fingerprint : null;
    }

    set(account: string, fingerprint: string): void {
        this.db.prepare(`
            INSERT INTO layout_baseline (account, fingerprint, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (account) DO UPDATE SET fingerprint = excluded.fingerprint, updated_at = excluded.updated_at
        `).run(account, fingerprint, this.now().toISOString());
    }
}
