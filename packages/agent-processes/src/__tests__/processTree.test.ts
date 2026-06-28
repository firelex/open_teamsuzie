import { describe, expect, it } from 'vitest';

import {
    findDescendantProcessGroups,
    findWorkspaceProcessGroups,
    killProcessGroups,
    parseLsofCwds,
    parsePsRows,
    pathIsInsideWorkspace,
    type ProcessRow,
} from '../processTree.js';

describe('parsePsRows', () => {
    it('parses pid/ppid/pgid/command columns and skips blank lines', () => {
        const text = [
            '    1     0     1 /sbin/launchd',
            '  100    50   100 node server.js',
            '',
            'garbage line',
            '  101   100   100 node helper.js arg',
        ].join('\n');
        expect(parsePsRows(text)).toEqual([
            { pid: 1, ppid: 0, pgid: 1, command: '/sbin/launchd' },
            { pid: 100, ppid: 50, pgid: 100, command: 'node server.js' },
            { pid: 101, ppid: 100, pgid: 100, command: 'node helper.js arg' },
        ]);
    });
});

describe('parseLsofCwds', () => {
    it('reads the cwd line that follows the pid/fcwd pair', () => {
        const text = [
            'p100',
            'fcwd',
            'n/Users/me/proj',
            'p101',
            'fcwd',
            'n/tmp',
        ].join('\n');
        const cwds = parseLsofCwds(text);
        expect(cwds.get(100)).toBe('/Users/me/proj');
        expect(cwds.get(101)).toBe('/tmp');
    });

    it('ignores n-lines that are not preceded by fcwd', () => {
        const text = ['p100', 'n/Users/me/other', 'fcwd', 'n/Users/me/proj'].join('\n');
        expect(parseLsofCwds(text).get(100)).toBe('/Users/me/proj');
    });
});

describe('pathIsInsideWorkspace', () => {
    it('returns true for the exact path and for descendants', () => {
        expect(pathIsInsideWorkspace('/a/b', '/a/b')).toBe(true);
        expect(pathIsInsideWorkspace('/a/b/c', '/a/b')).toBe(true);
    });
    it('returns false for siblings with a common prefix', () => {
        expect(pathIsInsideWorkspace('/a/bb', '/a/b')).toBe(false);
    });
    it('returns false when path is undefined', () => {
        expect(pathIsInsideWorkspace(undefined, '/a/b')).toBe(false);
    });
});

describe('findWorkspaceProcessGroups', () => {
    it('matches by cwd, propagates to descendants, and excludes pgid<=1 and self pgid', () => {
        const rows: ProcessRow[] = [
            { pid: 1, ppid: 0, pgid: 1, command: 'init', cwd: '/' },
            // self
            { pid: 9999, ppid: 1, pgid: 9999, command: 'node server', cwd: '/elsewhere' },
            // matching by cwd
            { pid: 100, ppid: 1, pgid: 100, command: 'claude', cwd: '/ws/proj-a' },
            // matching by descendant
            { pid: 101, ppid: 100, pgid: 100, command: 'node helper', cwd: '/tmp' },
            // unrelated
            { pid: 200, ppid: 1, pgid: 200, command: 'safari', cwd: '/Applications' },
            // shares self's pgid → must be filtered out
            { pid: 300, ppid: 9999, pgid: 9999, command: 'node child', cwd: '/ws/proj-a' },
        ];
        const groups = findWorkspaceProcessGroups(rows, ['/ws/proj-a'], 9999);
        expect(groups).toEqual([
            { pgid: 100, workspace: '/ws/proj-a', pids: [100, 101] },
        ]);
    });

    it('matches by substring in command when cwd is unavailable', () => {
        const rows: ProcessRow[] = [
            { pid: 9999, ppid: 1, pgid: 9999, command: 'node server' },
            { pid: 500, ppid: 1, pgid: 500, command: 'claude --cwd /ws/proj-b' },
        ];
        const groups = findWorkspaceProcessGroups(rows, ['/ws/proj-b'], 9999);
        expect(groups).toEqual([
            { pgid: 500, workspace: '/ws/proj-b', pids: [500] },
        ]);
    });
});

describe('findDescendantProcessGroups', () => {
    it('walks the parent→child graph starting at rootPid and groups by pgid', () => {
        const rows: ProcessRow[] = [
            { pid: 1, ppid: 0, pgid: 1, command: 'init' },
            { pid: 100, ppid: 1, pgid: 100, command: 'claude' },
            { pid: 101, ppid: 100, pgid: 100, command: 'node helper' },
            { pid: 102, ppid: 101, pgid: 102, command: 'detached worker' },
            // unrelated branch
            { pid: 200, ppid: 1, pgid: 200, command: 'safari' },
        ];
        const groups = findDescendantProcessGroups(rows, 100, 9999);
        expect(groups).toEqual([
            { pgid: 100, workspace: '', pids: [101] },
            { pgid: 102, workspace: '', pids: [102] },
        ]);
    });

    it('skips the current pid in the descendant walk', () => {
        const rows: ProcessRow[] = [
            { pid: 100, ppid: 1, pgid: 100, command: 'claude' },
            { pid: 9999, ppid: 100, pgid: 100, command: 'self impersonator' },
        ];
        const groups = findDescendantProcessGroups(rows, 100, 9999);
        expect(groups).toEqual([]);
    });
});

describe('killProcessGroups', () => {
    it('signals the negative pgid (process group) for each entry', () => {
        const calls: Array<[number, NodeJS.Signals]> = [];
        const original = process.kill;
        (process as unknown as { kill: typeof process.kill }).kill = ((pid: number, sig?: NodeJS.Signals | number) => {
            calls.push([pid, sig as NodeJS.Signals]);
            return true;
        }) as typeof process.kill;
        try {
            const killed = killProcessGroups(
                [
                    { pgid: 100, workspace: '/ws/a', pids: [100, 101] },
                    { pgid: 200, workspace: '/ws/b', pids: [200] },
                ],
                'SIGTERM',
            );
            expect(killed).toBe(2);
            expect(calls).toEqual([
                [-100, 'SIGTERM'],
                [-200, 'SIGTERM'],
            ]);
        } finally {
            (process as unknown as { kill: typeof process.kill }).kill = original;
        }
    });

    it('falls back to individual pids when the pgid kill throws', () => {
        const calls: Array<[number, NodeJS.Signals]> = [];
        const original = process.kill;
        (process as unknown as { kill: typeof process.kill }).kill = ((pid: number, sig?: NodeJS.Signals | number) => {
            if (pid < 0) throw new Error('ESRCH');
            calls.push([pid, sig as NodeJS.Signals]);
            return true;
        }) as typeof process.kill;
        try {
            const killed = killProcessGroups(
                [{ pgid: 100, workspace: '', pids: [100, 101] }],
                'SIGKILL',
            );
            expect(killed).toBe(2);
            expect(calls).toEqual([
                [100, 'SIGKILL'],
                [101, 'SIGKILL'],
            ]);
        } finally {
            (process as unknown as { kill: typeof process.kill }).kill = original;
        }
    });
});
