export interface VolumeLimits {
    opensPerMinute: number;
    opensPerHour: number;
    minSecondsBetweenSends: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Keeps one account's activity at a human scale. `acquire` waits until another message open (or send) fits inside
 * the limits; it never refuses.
 */
export class VolumeLimiter {
    private opens: number[] = [];
    private lastSend: number | null = null;

    constructor(
        private readonly limits: VolumeLimits,
        private readonly now: () => number = Date.now,
        private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    ) {
        for (const [key, value] of Object.entries(limits)) {
            if (!Number.isFinite(value) || value <= 0) throw new Error(`Volume limit ${key} must be a positive number`);
        }
    }

    async acquire(kind: 'open' | 'send'): Promise<void> {
        for (;;) {
            const wait = kind === 'open' ? this.openWait() : this.sendWait();
            if (wait <= 0) break;
            await this.sleep(wait);
        }
        if (kind === 'open') this.opens.push(this.now());
        else this.lastSend = this.now();
    }

    private openWait(): number {
        const now = this.now();
        this.opens = this.opens.filter((t) => now - t < HOUR);
        const lastMinute = this.opens.filter((t) => now - t < MINUTE);
        let wait = 0;
        if (lastMinute.length >= this.limits.opensPerMinute) {
            wait = Math.max(wait, lastMinute[lastMinute.length - this.limits.opensPerMinute]! + MINUTE - now);
        }
        if (this.opens.length >= this.limits.opensPerHour) {
            wait = Math.max(wait, this.opens[this.opens.length - this.limits.opensPerHour]! + HOUR - now);
        }
        return wait;
    }

    private sendWait(): number {
        if (this.lastSend === null) return 0;
        return this.lastSend + this.limits.minSecondsBetweenSends * 1000 - this.now();
    }
}
