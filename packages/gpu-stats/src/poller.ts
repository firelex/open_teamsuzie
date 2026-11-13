import { readGpus } from './read.js';
import type { GpuSnapshot } from './parse.js';

export interface GpuPollerState { latest: GpuSnapshot | null; history: GpuSnapshot[]; error: { message: string; since: string } | null }

export function createGpuPoller(opts: { intervalMs: number; keepMs: number; read?: () => Promise<GpuSnapshot>; log?: (line: string) => void }) {
    const read = opts.read ?? (() => readGpus());
    const log = opts.log ?? ((l: string) => console.log(l));
    let history: GpuSnapshot[] = [];
    let latest: GpuSnapshot | null = null;
    let error: GpuPollerState['error'] = null;
    let timer: NodeJS.Timeout | null = null;

    async function tick(): Promise<void> {
        try {
            const s = await read();
            if (error) log(`[gpu] readings back after error: ${error.message}`);
            error = null;
            latest = s;
            const cutoff = Date.parse(s.at) - opts.keepMs;
            history = [...history, s].filter((h) => Date.parse(h.at) > cutoff);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (!error || error.message !== message) {
                log(`[gpu] cannot read GPUs: ${message}`);
                error = { message, since: new Date().toISOString() };
            }
            latest = null;
        }
    }

    return {
        tick,
        start() { if (!timer) { void tick(); timer = setInterval(() => void tick(), opts.intervalMs); timer.unref(); } },
        stop() { if (timer) clearInterval(timer); timer = null; },
        state: (): GpuPollerState => ({ latest, history, error }),
    };
}
