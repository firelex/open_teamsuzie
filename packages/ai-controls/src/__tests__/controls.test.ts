import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { AI_CONTROLS_MIGRATIONS, AbortRegistry, AiControls } from '../index.js';

describe('AiControls', () => {
    it('persists pauses with who and why, and needs a reason to pause', () => {
        const db = openDb({ path: ':memory:', migrations: AI_CONTROLS_MIGRATIONS });
        const c = new AiControls({ db, now: () => 5 });
        expect(c.get('all')).toEqual({ name: 'all', paused: false, reason: '', setBy: null, setAt: null });
        expect(() => c.set('all', true, 'admin', ' ')).toThrow(/say why/);
        expect(c.set('all', true, 'admin', 'Model provider incident')).toMatchObject({ paused: true, setBy: 'admin', setAt: 5 });
        expect(new AiControls({ db }).get('all').paused).toBe(true);
        expect(c.set('all', false, 'admin', '').paused).toBe(false);
    });
});

describe('AbortRegistry', () => {
    it('stops running work by kind, follows a parent signal, and forgets finished work', () => {
        const r = new AbortRegistry();
        const chat = r.start('chat', 'chat 1');
        const task = r.start('task', 'task 1');
        const parent = new AbortController();
        const linked = r.start('chat', 'chat 2', parent.signal);
        parent.abort();
        expect(linked.signal.aborted).toBe(true);
        linked.done();
        expect(r.abortAll('agents paused', ['task']).map((w) => w.label)).toEqual(['task 1']);
        expect(task.signal.aborted).toBe(true);
        expect(chat.signal.aborted).toBe(false);
        chat.done();
        expect(r.list()).toEqual([]);
    });
});
