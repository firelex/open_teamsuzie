export interface JwksLike { keys: any[]; }

export class JwksCache {
    private fresh: { value: JwksLike; at: number } | null = null;
    private inflight: Promise<JwksLike> | null = null;

    constructor(
        private fetcher: () => Promise<JwksLike>,
        private opts: { freshMs: number } = { freshMs: 60 * 60 * 1000 },
    ) {}

    async get(): Promise<JwksLike> {
        const now = Date.now();
        if (this.fresh && now - this.fresh.at < this.opts.freshMs) return this.fresh.value;
        if (this.inflight) return this.inflight;
        this.inflight = (async () => {
            const value = await this.fetcher();
            this.fresh = { value, at: Date.now() };
            this.inflight = null;
            return value;
        })();
        return this.inflight;
    }
}
