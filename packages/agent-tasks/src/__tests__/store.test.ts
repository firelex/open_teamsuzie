import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { AGENT_TASKS_MIGRATIONS, AgentTaskStore, TaskTransitionError } from '../index.js';

function setup() {
    let t = 1_000;
    const db = openDb({ path: ':memory:', migrations: AGENT_TASKS_MIGRATIONS });
    const store = new AgentTaskStore({ db, now: () => ++t });
    return { store };
}

const base = {
    subjectType: 'matter',
    subjectId: 'm1',
    title: 'Letter before action',
    instructions: 'Draft a letter before action to Widget Ltd.',
    ownerId: 'partner@firm.test',
    createdBy: 'associate@firm.test',
    agent: 'litigation',
};

describe('AgentTaskStore', () => {
    it('runs a task through review, changes and sign-off', () => {
        const { store } = setup();
        const task = store.create({ ...base, signOffRequired: true });
        expect(task.status).toBe('queued');
        expect(task.nextPrompt).toBe(base.instructions);

        const claimed = store.claimNext()!;
        expect(claimed).toMatchObject({ id: task.id, status: 'running', runCount: 1 });
        expect(store.claimNext()).toBeNull();

        store.addOutput(task.id, { kind: 'file', id: 'f1', name: 'letter.docx' });
        expect(store.finishRun(task.id, 'Drafted the letter.').status).toBe('in_review');

        const back = store.requestChanges(task.id, 'partner@firm.test', 'Add the 14-day deadline.');
        expect(back).toMatchObject({ status: 'queued', nextPrompt: 'Add the 14-day deadline.' });
        expect(store.claimNext()!.runCount).toBe(2);
        store.addOutput(task.id, { kind: 'file', id: 'f1', name: 'letter.docx' });
        store.addOutput(task.id, { kind: 'file', id: 'f2', name: 'letter v2.docx' });
        store.finishRun(task.id, 'Added the deadline.');

        const done = store.signOff(task.id, 'partner@firm.test', 'Approved to send.', { outputs: [{ id: 'f2', sha256: 'abc' }] });
        expect(done).toMatchObject({ status: 'done', signedOffBy: 'partner@firm.test' });
        expect(store.outputs(task.id).map((o) => o.id)).toEqual(['f1', 'f2']);
        expect(store.events(task.id).map((e) => e.kind)).toEqual([
            'created',
            'run_started',
            'output',
            'run_finished',
            'changes_requested',
            'run_started',
            'output',
            'output',
            'run_finished',
            'signed_off',
        ]);
        expect(() => store.cancel(task.id, 'x', '')).toThrow(TaskTransitionError);
    });

    it('finishes straight to done when no sign-off is required', () => {
        const { store } = setup();
        const task = store.create({ ...base, signOffRequired: false });
        store.claimNext();
        expect(store.finishRun(task.id, 'ok').status).toBe('done');
        expect(() => store.signOff(task.id, 'p', '', {})).toThrow(/is done, so it cannot be signed off/);
    });

    it('blocks on a question and continues with the answer', () => {
        const { store } = setup();
        const task = store.create({ ...base, signOffRequired: true });
        store.claimNext();
        expect(store.block(task.id, 'Which entity is the client?')).toMatchObject({
            status: 'blocked',
            blocker: 'Which entity is the client?',
        });
        expect(() => store.answer(task.id, 'p', ' ')).toThrow(/answer is required/);
        expect(store.answer(task.id, 'partner@firm.test', 'Acme Holdings Ltd.')).toMatchObject({
            status: 'queued',
            blocker: null,
            nextPrompt: 'Acme Holdings Ltd.',
        });
    });

    it('fails interrupted runs and lets the supervisor retry them', () => {
        const { store } = setup();
        const task = store.create({ ...base, signOffRequired: true });
        store.claimNext();
        expect(store.failInterrupted('The server restarted during this run.').map((t) => t.id)).toEqual([task.id]);
        expect(store.get(task.id)).toMatchObject({ status: 'failed', error: 'The server restarted during this run.' });
        expect(store.retry(task.id, 'partner@firm.test')).toMatchObject({ status: 'queued', error: null, nextPrompt: base.instructions });
    });

    it('lists by subject, owner and status, and deletes a subject’s tasks', () => {
        const { store } = setup();
        const a = store.create({ ...base, signOffRequired: true });
        store.create({ ...base, subjectId: 'm2', ownerId: 'other@firm.test', signOffRequired: true });
        store.cancel(a.id, 'partner@firm.test', 'Not needed');
        expect(store.list({ subjectId: 'm1' }).map((t) => t.status)).toEqual(['cancelled']);
        expect(store.list({ ownerId: 'OTHER@firm.test', status: ['queued'] })).toHaveLength(1);
        expect(store.list({ createdBy: 'Associate@firm.test' })).toHaveLength(2);
        expect(() => store.list({ status: 'bogus' as never })).toThrow(/unknown task status/);
        expect(store.deleteFor('matter', 'm1')).toBe(1);
        expect(store.events(a.id)).toEqual([]);
    });
});
