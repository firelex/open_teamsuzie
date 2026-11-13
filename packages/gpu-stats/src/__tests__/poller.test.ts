import { describe, expect, it } from 'vitest';
import { createGpuPoller } from '../poller.js';
import type { GpuSnapshot } from '../parse.js';

const snap = (at: string): GpuSnapshot => ({ at, gpus: [], processes: [] });

describe('createGpuPoller', () => {
    it('keeps only samples inside keepMs and records the latest', async () => {
        let n = 0;
        const times = ['2026-11-13T12:00:00Z', '2026-11-13T12:00:05Z', '2026-11-13T12:00:10Z'];
        const p = createGpuPoller({ intervalMs: 5000, keepMs: 6000, read: async () => snap(times[n++]!) });
        await p.tick(); await p.tick(); await p.tick();
        expect(p.state().history.map((s) => s.at)).toEqual(['2026-11-13T12:00:05Z', '2026-11-13T12:00:10Z']);
        expect(p.state().latest?.at).toBe('2026-11-13T12:00:10Z');
    });

    it('records the error with its first time, logs only on change, and clears it on recovery', async () => {
        const logs: string[] = [];
        let fail = true;
        const p = createGpuPoller({ intervalMs: 5000, keepMs: 60000, log: (l) => logs.push(l),
            read: async () => { if (fail) throw new Error('nvidia-smi: command not found'); return snap(new Date().toISOString()); } });
        await p.tick(); await p.tick();
        expect(p.state().error?.message).toBe('nvidia-smi: command not found');
        expect(p.state().latest).toBeNull();
        expect(logs).toHaveLength(1);
        fail = false;
        await p.tick();
        expect(p.state().error).toBeNull();
        expect(logs).toHaveLength(2);
    });
});
