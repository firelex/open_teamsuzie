import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkOutput, describeOutput, OPERATION_GOALS } from '@teamsuzie/email-webmail';
import { computeFingerprint, HumanBehaviour, RouteExecutor } from '@teamsuzie/webmail-browser';
import { fixtureActivity, fixtureRoute, openFixtureBrowser, serveFixture, type FixtureBrowser } from '@teamsuzie/webmail-browser/testing';
import type { OperationName, Params } from '@teamsuzie/webmail-routes';
import { RouteLearner } from './learner.js';
import type { RouteModel } from './model.js';

let fixture: FixtureBrowser;
let executor: RouteExecutor;
const logs: string[] = [];

const params: Partial<Record<OperationName, Params>> = {
    read_account: {},
    list_inbox: {},
    open_message: { $message_id: 'm1' },
    read_thread: { $thread_id: 't1' },
    search: { $query: 'lunch' },
    compose_send: { '$draft.to': 'me@example.com', '$draft.subject': 'Route check', '$draft.body': 'Discarded.' },
    reply: { $message_id: 'm1', '$draft.to': 'alice@example.com', '$draft.body': 'Discarded.' },
    check_sent: {},
};

/** A model that replies from a script, recording each prompt. */
function scriptedModel(replies: string[]): RouteModel & { prompts: string[] } {
    const prompts: string[] = [];
    return {
        id: 'scripted',
        prompts,
        complete: async (prompt) => {
            prompts.push(prompt);
            const reply = replies.shift();
            if (reply === undefined) throw new Error('The scripted model has no more replies');
            return reply;
        },
    };
}

function composeFix(composeName: string, extraStates: Record<string, unknown> = {}): string {
    const steps = structuredClone(fixtureRoute().operations.compose_send);
    steps.steps[1] = { click: { role: 'button', name: composeName }, expect: 'compose_open' };
    return JSON.stringify({ ...steps, states: extraStates, notes: `The Compose button is now called "${composeName}".` });
}

function learner(model: RouteModel, maxStepFixes = 3): RouteLearner {
    return new RouteLearner({ model, executor, maxStepFixes, log: (m) => logs.push(m), now: () => new Date('2026-10-26T09:00:00Z') });
}

function input(operation: OperationName = 'compose_send') {
    return {
        route: fixtureRoute(),
        operation,
        goal: OPERATION_GOALS[operation],
        outputs: describeOutput(operation),
        params,
        checkResult: checkOutput,
    };
}

beforeAll(async () => {
    fixture = await openFixtureBrowser('renamed');
    const behaviour = new HumanBehaviour({ rng: Math.random, timeScale: 0, selectAllModifier: 'Meta' });
    executor = new RouteExecutor({ page: fixture.page, behaviour, stepTimeoutMs: 800, stateTimeoutMs: 1500, navigationTimeoutMs: 10_000 });
});

afterAll(async () => {
    await fixture.close();
});

beforeEach(async () => {
    logs.length = 0;
    await serveFixture(fixture.context, 'renamed');
    await fixture.page.goto('about:blank');
});

describe('RouteLearner', () => {
    it('repairs an operation whose button was renamed, and versions the route', async () => {
        const model = scriptedModel([composeFix('New message')]);
        const outcome = await learner(model).relearn(input());
        expect(outcome.ok && outcome.changed).toBe(true);
        if (!outcome.ok || !outcome.changed) return;
        expect(outcome.route.operations.compose_send.steps[1]).toEqual({ click: { role: 'button', name: 'New message' }, expect: 'compose_open' });
        expect(outcome.route).toMatchObject({ route_version: '2026-10-26.1', learned_by: 'learner:scripted', learned_at: '2026-10-26T09:00:00.000Z' });
        expect(outcome.route.fingerprint).toBe(await computeFingerprint(fixture.page));
        expect(outcome.notes).toEqual(['The Compose button is now called "New message".']);
        expect(model.prompts).toHaveLength(1);
        expect(model.prompts[0]).toContain('button "New message"');
        expect(model.prompts[0]).toContain('step 1 of its "steps" list failed');
        // Testing the repair never sends.
        expect((await fixtureActivity(fixture.page)).sendClicks).toBe(0);
    });

    it('reports no change when the operation already works', async () => {
        const model = scriptedModel([]);
        expect(await learner(model).relearn(input('list_inbox'))).toEqual({ ok: true, changed: false });
        expect(model.prompts).toHaveLength(0);
    });

    it('feeds unusable replies back to the model and gives up after the limit', async () => {
        const model = scriptedModel([
            'Click the New message button.',
            JSON.stringify({ steps: [{ click: { css: '#116-group' } }] }),
        ]);
        const outcome = await learner(model, 2).relearn(input());
        expect(outcome).toEqual({ ok: false, reason: expect.stringContaining('still fails after 2 repairs') });
        expect(model.prompts[1]).toContain('1. The reply did not contain a JSON object.');
        expect(logs.some((l) => l.includes('generated numeric id'))).toBe(true);
    });

    it('recovers after an unusable reply', async () => {
        const model = scriptedModel(['not json', composeFix('New message')]);
        const outcome = await learner(model).relearn(input());
        expect(outcome.ok && outcome.changed).toBe(true);
    });

    it('rejects a repair that breaks another operation using a state it changed', async () => {
        const brokenReplyState = { reply_open: { visible: [{ role: 'region', name: 'Answer' }], container: { role: 'region', name: 'Answer' } } };
        const model = scriptedModel([composeFix('New message', brokenReplyState)]);
        const outcome = await learner(model).relearn(input());
        expect(outcome).toEqual({ ok: false, reason: expect.stringContaining('broke reply') });
    });
});
