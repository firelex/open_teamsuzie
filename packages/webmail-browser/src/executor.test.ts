import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Route } from '@teamsuzie/webmail-routes';
import { HumanBehaviour } from './behaviour.js';
import { NeedsLoginError, RouteError, UnreadableValueError } from './errors.js';
import { RouteExecutor } from './executor.js';
import { resolveOne } from './locate.js';
import {
    fixtureActivity, fixtureRoute, openFixtureBrowser, serveFixture, setAutocomplete, FIXTURE_HOME,
    type FixtureBrowser,
} from './testing/fixture.js';

let fixture: FixtureBrowser;
let executor: RouteExecutor;
let route: Route;

const behaviour = new HumanBehaviour({ rng: Math.random, timeScale: 0, selectAllModifier: 'Meta' });
const draft = { '$draft.to': 'carol@example.com, dan@example.com', '$draft.subject': 'Hello there', '$draft.body': 'Line one\nLine two' };

async function routeError(promise: Promise<unknown>): Promise<RouteError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof RouteError) return error;
        throw error;
    }
    throw new Error('expected a RouteError');
}

beforeAll(async () => {
    fixture = await openFixtureBrowser();
    executor = new RouteExecutor({ page: fixture.page, behaviour, stepTimeoutMs: 1500, stateTimeoutMs: 2000, navigationTimeoutMs: 10_000, dates: { locale: 'en-GB', timeZone: 'Europe/London', now: () => new Date() } });
});

afterAll(async () => {
    await fixture.close();
});

beforeEach(async () => {
    route = fixtureRoute();
    await serveFixture(fixture.context, 'standard');
    // A fresh document each test, so recorded sends start at zero.
    await fixture.page.goto('about:blank');
    await fixture.page.goto(FIXTURE_HOME);
});

describe('RouteExecutor', () => {
    it('reads the signed-in account', async () => {
        const result = await executor.run(route, 'read_account', {}, 'live');
        expect(result.extracted.account).toEqual({ address: 'me@example.com' });
    });

    it('lists the inbox with every field in its normal form', async () => {
        const result = await executor.run(route, 'list_inbox', {}, 'live');
        const messages = result.extracted.messages as Array<Record<string, string | null>>;
        expect(messages.map((m) => m.id)).toEqual(['m2', 'm1']);
        expect(messages[1]).toMatchObject({ thread_id: 't1', from: 'alice@example.com', subject: 'Quarterly numbers', unread: 'true' });
        expect(messages[0]!.unread).toBe('false');
        expect(messages[1]!.date).toBe('2026-10-24T08:15:00.000Z');
        expect(result.steps.map((s) => s.action)).toEqual(['goto', 'extract']);
    });

    it('opens a message by id', async () => {
        const result = await executor.run(route, 'open_message', { $message_id: 'm1' }, 'live');
        expect(result.extracted.message).toMatchObject({
            subject: 'Quarterly numbers', from: 'alice@example.com', to: 'me@example.com', cc: 'dan@example.com',
            body: 'Here are the quarterly numbers. Revenue is up.',
        });
    });

    it('reads a thread', async () => {
        const result = await executor.run(route, 'read_thread', { $thread_id: 't1' }, 'live');
        expect((result.extracted.messages as Array<Record<string, string>>).map((m) => m.id)).toEqual(['m0', 'm1']);
    });

    it('searches', async () => {
        const result = await executor.run(route, 'search', { $query: 'lunch' }, 'live');
        expect((result.extracted.messages as Array<Record<string, string>>).map((m) => m.id)).toEqual(['m2']);
    });

    it('in test mode fills the draft, never presses Send, and discards it', async () => {
        await executor.run(route, 'compose_send', draft, 'test');
        const activity = await fixtureActivity(fixture.page);
        expect(activity.sendClicks).toBe(0);
        expect(activity.discards).toBe(1);
    });

    it('in live mode sends exactly once, with real recipient chips', async () => {
        await executor.run(route, 'compose_send', draft, 'live');
        const activity = await fixtureActivity(fixture.page);
        expect(activity.sendClicks).toBe(1);
        expect(activity.sent).toEqual([{ to: 'carol@example.com, dan@example.com', subject: 'Hello there', body: 'Line one\nLine two' }]);
    });

    it('stops before Send when the recipients shown differ from the draft', async () => {
        await setAutocomplete(fixture.page, 'carol@example.com', 'caroline@example.net');
        const error = await routeError(executor.run(route, 'compose_send', draft, 'live'));
        expect(error.code).toBe('recipients_mismatch');
        expect(error.detail).toContain('caroline@example.net');
        expect((await fixtureActivity(fixture.page)).sendClicks).toBe(0);
    });

    it('stops when the draft has cc recipients the route cannot see', async () => {
        const error = await routeError(executor.run(route, 'compose_send', { ...draft, '$draft.cc': 'eve@example.com' }, 'test'));
        expect(error.code).toBe('recipients_mismatch');
    });

    it('replies in the thread, and in test mode discards the reply', async () => {
        await executor.run(route, 'reply', { $message_id: 'm1', '$draft.to': 'alice@example.com', '$draft.body': 'Thanks!' }, 'test');
        expect(await fixtureActivity(fixture.page)).toMatchObject({ sendClicks: 0, discards: 1 });
        await executor.run(route, 'reply', { $message_id: 'm1', '$draft.to': 'alice@example.com', '$draft.body': 'Thanks!' }, 'live');
        expect((await fixtureActivity(fixture.page)).sent).toEqual([{ to: 'alice@example.com', subject: 'Re: Quarterly numbers', body: 'Thanks!' }]);
    });

    it('lists sent mail', async () => {
        await executor.run(route, 'compose_send', draft, 'live');
        const result = await executor.run(route, 'check_sent', {}, 'live');
        expect(result.extracted.messages).toEqual([{ id: 's0', to: 'carol@example.com, dan@example.com', subject: 'Hello there' }]);
    });

    it('fails with target_ambiguous when two visible elements match', async () => {
        await executor.run(route, 'reply', { $message_id: 'm1', '$draft.to': 'alice@example.com', '$draft.body': 'x' }, 'test');
        await fixture.page.getByRole('button', { name: 'Reply' }).click();
        await fixture.page.getByRole('button', { name: 'Compose' }).click();
        const ctx = { page: fixture.page, states: route.states, params: {}, timeoutMs: 500, operation: 'test', stepIndex: 0, phase: 'steps' as const };
        const error = await routeError(resolveOne({ role: 'button', name: 'Send' }, ctx));
        expect(error.code).toBe('target_ambiguous');
        // Scoped to the compose dialog it is exactly one.
        await expect(resolveOne({ role: 'button', name: 'Send', within: 'compose_open' }, ctx)).resolves.toBeDefined();
    });

    it('fails with target_not_found when the button is gone', async () => {
        route.operations.compose_send.steps[1] = { click: { role: 'button', name: 'Write' }, expect: 'compose_open' };
        const error = await routeError(executor.run(route, 'compose_send', draft, 'test'));
        expect(error).toMatchObject({ code: 'target_not_found', operation: 'compose_send', stepIndex: 1 });
    });

    it('fails with state_not_reached when the expected page state never holds', async () => {
        route.states.inbox_list = { url_matches: '#inbox$', visible: [{ role: 'grid', name: 'Primary' }] };
        const error = await routeError(executor.run(route, 'list_inbox', {}, 'live'));
        expect(error).toMatchObject({ code: 'state_not_reached', stepIndex: 0 });
    });

    it('fails with extract_invalid when a required field is missing', async () => {
        const list = route.operations.list_inbox.steps[1]!;
        if (!('extract' in list)) throw new Error('fixture changed');
        list.extract.fields.subject = { target: { css: 'td.title' }, from: 'text', format: 'nonempty', required: true };
        const error = await routeError(executor.run(route, 'list_inbox', {}, 'live'));
        expect(error.code).toBe('extract_invalid');
        expect(error.detail).toContain('"subject"');
    });

    it('reads dates in the account locale', async () => {
        await fixture.page.evaluate(() => document.querySelectorAll('td.date [title]').forEach((el) => el.setAttribute('title', 'Sun 25/10/2026 09:22')));
        const result = await executor.run(route, 'list_inbox', {}, 'live');
        expect((result.extracted.messages as Array<Record<string, string>>)[0]!.date).toBe('2026-10-25T09:22:00.000Z');
    });

    it('reports a date it cannot read as UnreadableValueError, not a route failure', async () => {
        await fixture.page.evaluate(() => document.querySelectorAll('td.date [title]').forEach((el) => el.setAttribute('title', 'sometime last week')));
        const error = await executor.run(route, 'list_inbox', {}, 'live').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(UnreadableValueError);
        expect(error).toMatchObject({ operation: 'list_inbox', field: 'date', text: 'sometime last week' });
    });

    it('reports a sign-out as NeedsLoginError, not a route failure', async () => {
        await serveFixture(fixture.context, 'expire');
        await fixture.page.goto('about:blank');
        await expect(executor.run(route, 'compose_send', draft, 'test')).rejects.toBeInstanceOf(NeedsLoginError);
    });

    it('refuses to visit a host outside the route', async () => {
        route.operations.search.steps[0] = { goto: 'https://evil.example.org/' };
        await expect(executor.run(route, 'search', { $query: 'x' }, 'live')).rejects.toThrow(/not one of the route's domains/);
    });

    it('checks whether a state holds', async () => {
        expect(await executor.stateHolds(route, 'inbox_list')).toBe(true);
        expect(await executor.stateHolds(route, 'compose_open')).toBe(false);
    });
});
