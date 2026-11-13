import { describe, expect, it } from 'vitest';
import { parseGpus, parseProcesses } from '../parse.js';

describe('parseGpus', () => {
    it('reads two GPUs', () => {
        const csv = '0, GPU-aaa, NVIDIA GeForce RTX 4090, 87, 20480, 24564, 71, 312.45, 450.00\n'
                  + '1, GPU-bbb, NVIDIA GeForce RTX 4090, 0, 1, 24564, 38, 21.10, 450.00\n';
        expect(parseGpus(csv)).toEqual([
            { index: 0, uuid: 'GPU-aaa', name: 'NVIDIA GeForce RTX 4090', utilizationPct: 87, memoryUsedMiB: 20480,
              memoryTotalMiB: 24564, temperatureC: 71, powerDrawW: 312.45, powerLimitW: 450 },
            { index: 1, uuid: 'GPU-bbb', name: 'NVIDIA GeForce RTX 4090', utilizationPct: 0, memoryUsedMiB: 1,
              memoryTotalMiB: 24564, temperatureC: 38, powerDrawW: 21.1, powerLimitW: 450 },
        ]);
    });

    it('treats [N/A] and [Not Supported] as unknown for optional fields', () => {
        const [g] = parseGpus('0, GPU-aaa, NVIDIA A10, 5, 100, 23028, [N/A], [Not Supported], [N/A]\n');
        expect(g).toMatchObject({ temperatureC: null, powerDrawW: null, powerLimitW: null });
    });

    it('throws on a line with the wrong number of fields or a missing required number', () => {
        expect(() => parseGpus('0, GPU-aaa, NVIDIA A10, 5\n')).toThrow(/expected 9 fields/);
        expect(() => parseGpus('0, GPU-aaa, NVIDIA A10, [N/A], 100, 23028, 40, 50, 150\n')).toThrow(/utilization/);
    });

    it('reads no GPUs from empty output', () => {
        expect(parseGpus('')).toEqual([]);
    });
});

describe('parseProcesses', () => {
    it('reads processes, and none from empty output', () => {
        expect(parseProcesses('GPU-aaa, 4242, /usr/bin/llama-server, 18000\n')).toEqual([
            { gpuUuid: 'GPU-aaa', pid: 4242, name: '/usr/bin/llama-server', usedMemoryMiB: 18000 },
        ]);
        expect(parseProcesses('')).toEqual([]);
    });
});
