export interface GpuReading { index: number; uuid: string; name: string; utilizationPct: number; memoryUsedMiB: number;
    memoryTotalMiB: number; temperatureC: number | null; powerDrawW: number | null; powerLimitW: number | null }
export interface GpuProcess { gpuUuid: string; pid: number; name: string; usedMemoryMiB: number | null }
export interface GpuSnapshot { at: string; gpus: GpuReading[]; processes: GpuProcess[] }

export const GPU_QUERY = ['--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit',
    '--format=csv,noheader,nounits'];
export const PROC_QUERY = ['--query-compute-apps=gpu_uuid,pid,process_name,used_memory', '--format=csv,noheader,nounits'];

const UNKNOWN = /^\[(N\/A|Not Supported|Unknown Error)\]$/;

function lines(csv: string): string[][] {
    return csv.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(',').map((f) => f.trim()));
}

function required(value: string, field: string, line: string): number {
    const n = Number(value);
    if (value === '' || !Number.isFinite(n)) throw new Error(`nvidia-smi: ${field} is not a number in "${line}"`);
    return n;
}

function optional(value: string, field: string, line: string): number | null {
    return UNKNOWN.test(value) ? null : required(value, field, line);
}

export function parseGpus(csv: string): GpuReading[] {
    return lines(csv).map((f) => {
        const line = f.join(', ');
        if (f.length !== 9) throw new Error(`nvidia-smi: expected 9 fields, got ${f.length} in "${line}"`);
        return {
            index: required(f[0]!, 'index', line), uuid: f[1]!, name: f[2]!,
            utilizationPct: required(f[3]!, 'utilization', line),
            memoryUsedMiB: required(f[4]!, 'memory used', line), memoryTotalMiB: required(f[5]!, 'memory total', line),
            temperatureC: optional(f[6]!, 'temperature', line),
            powerDrawW: optional(f[7]!, 'power draw', line), powerLimitW: optional(f[8]!, 'power limit', line),
        };
    });
}

export function parseProcesses(csv: string): GpuProcess[] {
    return lines(csv).map((f) => {
        const line = f.join(', ');
        if (f.length !== 4) throw new Error(`nvidia-smi: expected 4 process fields, got ${f.length} in "${line}"`);
        return { gpuUuid: f[0]!, pid: required(f[1]!, 'pid', line), name: f[2]!, usedMemoryMiB: optional(f[3]!, 'used memory', line) };
    });
}
