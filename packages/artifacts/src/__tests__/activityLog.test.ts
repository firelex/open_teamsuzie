import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActivityLog, type ActivityEntryShape } from '../activityLog.js';

interface DemoEntry extends ActivityEntryShape {
    author: string;
    createdAt: string;
}

let dir: string;
let log: ActivityLog<DemoEntry>;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'activity-'));
    log = new ActivityLog<DemoEntry>({ dir });
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('ActivityLog', () => {
    it('appends and reads back', () => {
        log.append('ticket-1', { id: 'a1', body: 'hello', author: 'me', createdAt: '2026-01-01' });
        log.append('ticket-1', { id: 'a2', body: 'world', author: 'me', createdAt: '2026-01-02' });
        expect(log.list('ticket-1').map((e) => e.id)).toEqual(['a1', 'a2']);
    });

    it('isolates subjects', () => {
        log.append('ticket-1', { id: 'a1', body: 'x', author: 'me', createdAt: 'now' });
        log.append('ticket-2', { id: 'b1', body: 'y', author: 'me', createdAt: 'now' });
        expect(log.list('ticket-1').map((e) => e.id)).toEqual(['a1']);
        expect(log.list('ticket-2').map((e) => e.id)).toEqual(['b1']);
    });

    it('returns empty list for unknown subjects', () => {
        expect(log.list('missing')).toEqual([]);
    });

    it('tolerates malformed JSON', () => {
        writeFileSync(join(dir, 'broken.json'), 'not json');
        expect(log.list('broken')).toEqual([]);
    });

    it('replaceAll overwrites', () => {
        log.append('s', { id: 'a', body: 'x', author: 'me', createdAt: 'now' });
        log.replaceAll('s', [{ id: 'b', body: 'y', author: 'me', createdAt: 'now' }]);
        expect(log.list('s').map((e) => e.id)).toEqual(['b']);
    });

    it('delete removes the file idempotently', () => {
        log.append('s', { id: 'a', body: 'x', author: 'me', createdAt: 'now' });
        log.delete('s');
        log.delete('s');
        expect(log.list('s')).toEqual([]);
    });

    it('rejects malformed subject ids when path-resolving', () => {
        expect(() => log.list('../escape')).toThrow();
    });
});
