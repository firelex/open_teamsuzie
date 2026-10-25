import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkOutput, describeOutput, OPERATION_GOALS } from '@teamsuzie/email-webmail';
import { computeFingerprint, HumanBehaviour, RouteExecutor } from '@teamsuzie/webmail-browser';
import { fixtureActivity, fixtureRoute, openFixtureBrowser, serveFixture, type FixtureBrowser } from '@teamsuzie/webmail-browser/testing';
import type { OperationName, Params } from '@teamsuzie/webmail-routes';
import { RouteLearner, type LearnerRound } from './learner.js';
import type { ModelTurn, RouteModel, ToolChatMessage } from './model.js';

let fixture: FixtureBrowser;
let executor: RouteExecutor;
const logs: string[] = [];
const rounds: LearnerRound[] = [];

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

let callId = 0;
const call = (name: string, args: unknown): ModelTurn => ({ text: '', toolCalls: [{ id: `call-${++callId}`, name, arguments: JSON.stringify(args) }] });
const say = (text: string): ModelTurn => ({ text, toolCalls: [] });

type Script = Array<ModelTurn | ((messages: ToolChatMessage[]) => ModelTurn)>;

/** A tool-calling model that follows a script; a step may look at the conversation so far. Records every request. */
function scriptedModel(script: Script): RouteModel & { requests: ToolChatMessage[][] } {
    const requests: ToolChatMessage[][] = [];
    return {
        id: 'scripted',
        requests,
        chat: async (messages) => {
            requests.push(structuredClone(messages));
            const next = script.shift();
            if (next === undefined) throw new Error('The scripted model has no more turns');
            return typeof next === 'function' ? next(messages) : next;
        },
    };
}

/** The tool results the model has been sent so far, parsed. */
function toolResults(messages: ToolChatMessage[]): Array<Record<string, unknown>> {
    return messages
        .filter((m): m is { role: 'tool'; toolCallId: string; content: string } => m.role === 'tool')
        .map((m) => JSON.parse(m.content) as Record<string, unknown>);
}

function fixedCompose(composeName: string) {
    const op = structuredClone(fixtureRoute().operations.compose_send);
    op.steps[1] = { click: { role: 'button', name: composeName }, expect: 'compose_open' };
    return op;
}

function learner(model: RouteModel, limits: { maxSubmissions?: number; maxToolCalls?: number } = {}): RouteLearner {
    return new RouteLearner({
        model, executor, maxSubmissions: limits.maxSubmissions ?? 3, maxToolCalls: limits.maxToolCalls ?? 25,
        log: (m) => logs.push(m), record: (r) => rounds.push(r), now: () => new Date('2026-10-26T09:00:00Z'),
    });
}

const alternateParams: Partial<Record<OperationName, Params>> = {
    open_message: { $message_id: 'm2' },
    read_thread: { $thread_id: 't2' },
    search: { $query: 'quarterly' },
    reply: { $message_id: 'm2', '$draft.to': 'bob@example.org', '$draft.body': 'Discarded.' },
};

function input(operation: OperationName = 'compose_send') {
    return { route: fixtureRoute(), operation, goal: OPERATION_GOALS[operation], outputs: describeOutput(operation), params, alternateParams, checkResult: checkOutput };
}

beforeAll(async () => {
    fixture = await openFixtureBrowser('renamed');
    const behaviour = new HumanBehaviour({ rng: Math.random, timeScale: 0, selectAllModifier: 'Meta' });
    executor = new RouteExecutor({ page: fixture.page, behaviour, stepTimeoutMs: 800, stateTimeoutMs: 1500, navigationTimeoutMs: 10_000, dates: { locale: 'en-GB', timeZone: 'Europe/London', now: () => new Date() } });
});

afterAll(async () => {
    await fixture.close();
});

beforeEach(async () => {
    logs.length = 0;
    rounds.length = 0;
    await serveFixture(fixture.context, 'renamed');
    await fixture.page.goto('about:blank');
});

describe('RouteLearner with tools', () => {
    it('investigates with tools, tests the candidate, and submits a repair that is accepted', async () => {
        const fixed = fixedCompose('New message');
        const model = scriptedModel([
            call('try_target', { target: { role: 'button', name: 'Compose' } }),
            (messages) => {
                const [result] = toolResults(messages);
                expect(result).toMatchObject({ ok: true, matches: 0 });
                expect(JSON.stringify(result!.nearest_on_page)).toContain('New message');
                return call('run_operation', fixed);
            },
            (messages) => {
                expect(toolResults(messages)[1]).toMatchObject({ ok: true, next: expect.stringContaining('Call submit_repair now') });
                return call('submit_repair', { ...fixed, notes: 'Compose is now called New message.' });
            },
        ]);
        const outcome = await learner(model).relearn(input());
        expect(outcome.ok && outcome.changed).toBe(true);
        if (!outcome.ok || !outcome.changed) return;
        expect(outcome.route.operations.compose_send.steps[1]).toEqual({ click: { role: 'button', name: 'New message' }, expect: 'compose_open' });
        expect(outcome.route).toMatchObject({ route_version: '2026-10-26.1', learned_by: 'learner:scripted' });
        expect(outcome.route.fingerprint).toBe(await computeFingerprint(fixture.page));
        expect(outcome.notes).toEqual(['Compose is now called New message.']);
        expect(rounds.map((r) => r.calls.map((c) => c.name))).toEqual([['try_target'], ['run_operation'], ['submit_repair']]);
        expect(rounds[0]!.prompt).toContain('HOW TO WORK');
        // The shortcut list was read before the model was asked anything.
        expect(rounds[0]!.prompt).toContain('C: new message');
        expect(model.requests[0]![1]!.content).toContain('no visible element matches {"role":"button","name":"Compose"}');
        expect((await fixtureActivity(fixture.page)).sendClicks).toBe(0);
    });

    it('reports no change when the operation already works, without asking the model', async () => {
        const model = scriptedModel([]);
        expect(await learner(model).relearn(input('list_inbox'))).toEqual({ ok: true, changed: false });
        expect(model.requests).toHaveLength(0);
    });

    it('returns rule problems from the tools, and a failed submission\'s reason, so the model can correct itself', async () => {
        const fixed = fixedCompose('New message');
        const model = scriptedModel([
            call('try_target', { target: { css: '#116-group' } }),
            call('submit_repair', { ...fixedCompose('Write'), notes: 'guess' }),
            (messages) => {
                const results = toolResults(messages);
                expect(results[0]).toMatchObject({ ok: false, error: 'the target breaks the rules' });
                expect(JSON.stringify(results[0])).toContain('generated numeric id');
                expect(results[1]).toMatchObject({ accepted: false, submissions_left: 2 });
                expect(String(results[1]!.problem)).toContain('target_not_found');
                expect(String(results[1]!.problem)).toContain('found on the page');
                return call('submit_repair', { ...fixed, notes: 'Renamed.' });
            },
        ]);
        const outcome = await learner(model).relearn(input());
        expect(outcome.ok && outcome.changed).toBe(true);
    });

    it('lets the model check states and extracts, and answers bad arguments plainly', async () => {
        const model = scriptedModel([
            call('check_state', { state: 'compose_open' }),
            call('check_state', { state: { visible: [{ role: 'grid', name: 'Inbox' }] } }),
            call('try_extract', { extract: { items: { css: 'tr.row', each: true }, fields: { subject: { target: { css: 'td.subject' }, from: 'text', pattern: '^Re: (.+)$', format: 'nonempty', required: true } } } }),
            call('try_extract', { extract: { items: { css: 'tr.row', each: true }, fields: { id: { from: 'attr:data-id', format: 'id', required: true } } } }),
            { text: '', toolCalls: [{ id: 'bad', name: 'try_target', arguments: '{not json' }] },
            call('look_around', {}),
            call('read_shortcut_help', {}),
            (messages) => {
                const [closed, inbox, badPattern, ids, badJson, unknown, shortcuts] = toolResults(messages);
                expect(shortcuts).toMatchObject({ ok: true, shortcuts: expect.stringContaining('Ctrl+Enter or Cmd+Enter: send') });
                expect(closed).toMatchObject({ ok: true, holds: false });
                expect(JSON.stringify(closed!.why_not)).toContain('matches 0 visible elements');
                expect(inbox).toMatchObject({ ok: true, holds: true });
                expect(badPattern).toMatchObject({ ok: false, error: 'extract_invalid' });
                expect(String(badPattern!.detail)).toContain('the pattern "^Re: (.+)$" did not match the text "Lunch on Tuesday?"');
                expect(ids).toMatchObject({ ok: true, records_read: 2, first_records: [{ id: 'm2' }, { id: 'm1' }] });
                expect(String(badJson!.error)).toContain('not valid JSON');
                expect(unknown).toMatchObject({ ok: false, error: 'there is no tool named "look_around"' });
                return call('submit_repair', { ...fixedCompose('New message'), notes: 'Renamed.' });
            },
        ]);
        const outcome = await learner(model).relearn(input());
        expect(outcome.ok && outcome.changed).toBe(true);
    });

    it('runs a candidate in test mode only, and reports a discard that leaves the draft open', async () => {
        const broken = fixedCompose('New message');
        broken.test_end = [{ click: { role: 'textbox', name: 'Subject', within: 'compose_open' } }];
        const model = scriptedModel([
            call('run_operation', broken),
            (messages) => {
                expect(toolResults(messages)[0]).toMatchObject({ ok: false, error: 'cleanup_failed', where: 'test_end[0]' });
                return call('submit_repair', { ...fixedCompose('New message'), notes: 'Renamed.' });
            },
        ]);
        expect((await learner(model).relearn(input())).ok).toBe(true);
        expect((await fixtureActivity(fixture.page)).sendClicks).toBe(0);
    });

    it('nudges a model that answers in text, and gives up when it keeps doing so', async () => {
        const model = scriptedModel([say('I think it is renamed.'), say('Still thinking.'), say('Done.')]);
        expect(await learner(model).relearn(input())).toEqual({ ok: false, reason: expect.stringContaining('stopped calling tools') });
        expect(model.requests[1]!.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Answer by calling a tool') });
    });

    it('stops at the tool-call budget', async () => {
        const model = scriptedModel(Array.from({ length: 10 }, () => call('try_target', { target: { role: 'button', name: 'Compose' } })));
        expect(await learner(model, { maxToolCalls: 4 }).relearn(input())).toEqual({ ok: false, reason: expect.stringContaining('within 4 tool calls') });
        expect(model.requests).toHaveLength(4);
    });

    it('stops after the last allowed submission', async () => {
        const model = scriptedModel([
            call('submit_repair', { ...fixedCompose('Write'), notes: 'a' }),
            call('submit_repair', { ...fixedCompose('Draft'), notes: 'b' }),
        ]);
        expect(await learner(model, { maxSubmissions: 2 }).relearn(input())).toEqual({ ok: false, reason: expect.stringContaining('after 2 submissions') });
    });

    it('rejects a submission that breaks another operation using a state it changed', async () => {
        const brokenReplyState = { reply_open: { visible: [{ role: 'region', name: 'Answer' }], container: { role: 'region', name: 'Answer' } } };
        const model = scriptedModel([
            call('submit_repair', { ...fixedCompose('New message'), states: brokenReplyState, notes: 'x' }),
            (messages) => {
                expect(String(toolResults(messages)[0]!.problem)).toContain('broke another task');
                return call('submit_repair', { ...fixedCompose('New message'), notes: 'Renamed.' });
            },
        ]);
        expect((await learner(model).relearn(input())).ok).toBe(true);
    });

    it('rejects a repair that only works for the message it was tested on', async () => {
        const route = fixtureRoute();
        const step = route.operations.open_message.steps[1]!;
        if ('extract' in step) step.extract.fields.subject = { target: { role: 'heading' }, from: 'text', format: 'nonempty', required: true };
        const overfitted = structuredClone(fixtureRoute().operations.open_message);
        const fixedStep = overfitted.steps[1]!;
        if (!('extract' in fixedStep)) throw new Error('fixture changed');
        fixedStep.extract.fields.subject = { target: { role: 'heading', name: 'Quarterly numbers' }, from: 'text', format: 'nonempty', required: true };
        const general = structuredClone(fixtureRoute().operations.open_message);
        const model = scriptedModel([
            call('run_operation', overfitted),
            (messages) => {
                const [result] = toolResults(messages);
                expect(result).toMatchObject({ ok: false, error: 'target_not_found' });
                expect(String(result!.note)).toContain('worked for the first test message but failed for another message');
                return call('submit_repair', { ...overfitted, notes: 'overfitted' });
            },
            (messages) => {
                expect(String(toolResults(messages)[1]!.problem)).toContain('worked for one message but failed for another');
                return call('submit_repair', { ...general, notes: 'The subject is the h2 heading.' });
            },
        ]);
        const outcome = await learner(model).relearn({ ...input('open_message'), route });
        expect(outcome.ok && outcome.changed).toBe(true);
    });

    it('hands back an operation sharing a changed state that was already failing before the repair', async () => {
        const route = fixtureRoute();
        route.operations.search.steps[1] = { type: { role: 'searchbox', name: 'Find mail' }, value: '$query', then_press: 'Enter', expect: 'search_results' };
        const model = scriptedModel([
            call('submit_repair', { ...fixedCompose('New message'), states: { inbox_list: { url_matches: '#inbox$', visible: [{ role: 'grid', name: 'Inbox' }] } }, notes: 'x' }),
        ]);
        const outcome = await learner(model).relearn({ ...input(), route });
        expect(outcome.ok && outcome.changed && outcome.untested).toEqual(['search']);
    });
});
