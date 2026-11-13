import { execFile } from 'node:child_process';
import { GPU_QUERY, PROC_QUERY, parseGpus, parseProcesses, type GpuSnapshot } from './parse.js';

export type Exec = (cmd: string, args: string[]) => Promise<string>;

const execNode: Exec = (cmd, args) =>
    new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 10_000 }, (err, stdout, stderr) => {
            if (err) {
                const why = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'nvidia-smi not found on this machine' : `${err.message} ${stderr}`.trim();
                reject(new Error(`${cmd} ${args[0]}: ${why}`));
            } else resolve(stdout);
        });
    });

export async function readGpus(exec: Exec = execNode): Promise<GpuSnapshot> {
    const [gpuCsv, procCsv] = await Promise.all([exec('nvidia-smi', GPU_QUERY), exec('nvidia-smi', PROC_QUERY)]);
    return { at: new Date().toISOString(), gpus: parseGpus(gpuCsv), processes: parseProcesses(procCsv) };
}
