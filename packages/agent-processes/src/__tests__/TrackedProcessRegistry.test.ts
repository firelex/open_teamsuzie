import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { TrackedProcessRegistry, type SpawnFn } from '../TrackedProcessRegistry.js';
import type { ProcessRow, WorkspaceProcessGroup } from '../processTree.js';

interface FakeChild extends EventEmitter {
    pid: number | undefined;
    kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(pid: number | undefined): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.pid = pid;
    child.kill = vi.fn(() => true);
    return child;
}

function makeRegistry(opts: {
    child?: FakeChild;
    spawnImpl?: SpawnFn;
    rows?: ProcessRow[];
    killGroupsImpl?: (groups: WorkspaceProcessGroup[], signal: NodeJS.Signals) => number;
    killPidImpl?: (pid: number, signal: NodeJS.Signals) => void;
    now?: () => number;
} = {}) {
    const child = opts.child ?? makeFakeChild(1234);
    const spawnFn = vi.fn(((cmd, args, _spawnOpts) => {
        return child as unknown as ChildProcess;
    }) as SpawnFn);
    const listRows = vi.fn(() => opts.rows ?? []);
    const killGroups = vi.fn(opts.killGroupsImpl ?? (() => 0));
    const killPid = vi.fn(opts.killPidImpl ?? (() => undefined));
    const registry = new TrackedProcessRegistry(opts.spawnImpl ?? spawnFn, {
        currentPid: 9999,
        now: opts.now,
        listProcessRows: listRows,
        killProcessGroups: killGroups,
        killPid,
    });
    return { registry, spawnFn, child, listRows, killGroups, killPid };
}

describe('TrackedProcessRegistry.spawn', () => {
    it('forces detached: true and tracks the child', () => {
        const { registry, spawnFn, child } = makeRegistry();
        registry.spawn('claude', ['--help'], { stdio: 'pipe' });
        expect(spawnFn).toHaveBeenCalledTimes(1);
        const passedOpts = spawnFn.mock.calls[0]![2] as { detached: boolean; stdio: string };
        expect(passedOpts.detached).toBe(true);
        expect(passedOpts.stdio).toBe('pipe');
        expect(registry.size()).toBe(1);
        const snap = registry.snapshot();
        expect(snap).toEqual([
            expect.objectContaining({ pid: child.pid, command: 'claude' }),
        ]);
    });

    it('treats undefined opts as an empty object (no crash)', () => {
        const { registry } = makeRegistry();
        expect(() => registry.spawn('codex', [], undefined)).not.toThrow();
        expect(registry.size()).toBe(1);
    });

    it('removes the child from the registry on exit', () => {
        const { registry, child } = makeRegistry();
        registry.spawn('claude', [], {});
        expect(registry.size()).toBe(1);
        child.emit('exit', 0, null);
        expect(registry.size()).toBe(0);
    });

    it('removes the child from the registry on close', () => {
        const { registry, child } = makeRegistry();
        registry.spawn('claude', [], {});
        child.emit('close', 0, null);
        expect(registry.size()).toBe(0);
    });
});

describe('TrackedProcessRegistry.snapshot', () => {
    it('reports ageMs relative to startedAt using the injected clock', () => {
        let t = 1_000;
        const { registry } = makeRegistry({ now: () => t });
        registry.spawn('claude', [], {});
        t = 1_750;
        const [snap] = registry.snapshot();
        expect(snap!.ageMs).toBe(750);
    });

    it('returns null pid when the child has no pid yet', () => {
        const child = makeFakeChild(undefined);
        const { registry } = makeRegistry({ child });
        registry.spawn('claude', [], {});
        const [snap] = registry.snapshot();
        expect(snap!.pid).toBeNull();
    });
});

describe('TrackedProcessRegistry.shutdownAll', () => {
    it('walks the descendant tree and sends SIGTERM to detached groups', () => {
        const rows: ProcessRow[] = [
            { pid: 1234, ppid: 1, pgid: 1234, command: 'claude' },
            { pid: 1235, ppid: 1234, pgid: 1234, command: 'node helper' },
        ];
        const { registry, child, killGroups, killPid } = makeRegistry({ rows });
        registry.spawn('claude', [], {});

        registry.shutdownAll();

        expect(killGroups).toHaveBeenCalledTimes(1);
        const [groups, signal] = killGroups.mock.calls[0]!;
        expect(signal).toBe('SIGTERM');
        // Descendants of pid 1234 — i.e. pid 1235, which sits in pgid 1234.
        // The root pid itself is not added to the selected set.
        expect(groups).toEqual([
            expect.objectContaining({ pgid: 1234, pids: [1235] }),
        ]);
        // Detached fast path: process.kill(-pid, signal) on the leader pgid.
        expect(killPid).toHaveBeenCalledWith(-1234, 'SIGTERM');
        // Fast path returns before child.kill().
        expect(child.kill).not.toHaveBeenCalled();
    });

    it('falls back to child.kill when killPid throws (detached path failed)', () => {
        const { registry, child } = makeRegistry({
            killPidImpl: () => {
                throw new Error('EPERM');
            },
        });
        registry.spawn('claude', [], {});
        registry.shutdownAll();
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('still attempts the group kill even if listProcessRows throws', () => {
        const { registry, child, killPid } = makeRegistry();
        // Override listRows after construction by building a fresh registry.
        const failingRegistry = new TrackedProcessRegistry((() => child as unknown as ChildProcess) as SpawnFn, {
            currentPid: 9999,
            listProcessRows: () => {
                throw new Error('ps failed');
            },
            killProcessGroups: () => 0,
            killPid,
        });
        failingRegistry.spawn('claude', [], {});
        expect(() => failingRegistry.shutdownAll()).not.toThrow();
        // Detached fast path still runs because pid was set.
        expect(killPid).toHaveBeenCalledWith(-1234, 'SIGTERM');
    });
});

describe('TrackedProcessRegistry.killAllHard', () => {
    it('sends SIGKILL through the same path as shutdownAll', () => {
        const { registry, killGroups, killPid } = makeRegistry({
            rows: [{ pid: 1234, ppid: 1, pgid: 1234, command: 'claude' }],
        });
        registry.spawn('claude', [], {});
        registry.killAllHard();
        expect(killGroups.mock.calls[0]![1]).toBe('SIGKILL');
        expect(killPid).toHaveBeenCalledWith(-1234, 'SIGKILL');
    });
});
