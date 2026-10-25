import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Route } from '@teamsuzie/webmail-routes';
import { HumanBehaviour } from './behaviour.js';
import { NeedsLoginError, RouteError, UnreadableValueError } from './errors.js';
import { RouteExecutor } from './executor.js';
import { resolveOne } from './locate.js';
import { capturePage } from './capture.js';
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

    it('fails the test when the discard steps leave the draft open', async () => {
        // A test_end that clicks something harmless inside the draft instead of discarding it.
        route.operations.compose_send.test_end = [{ click: { role: 'textbox', name: 'Subject', within: 'compose_open' } }];
        const error = await routeError(executor.run(route, 'compose_send', draft, 'test'));
        expect(error).toMatchObject({ code: 'cleanup_failed', phase: 'test_end' });
        expect(error.detail).toContain('state "compose_open" still holds');
        expect((await fixtureActivity(fixture.page)).sendClicks).toBe(0);
    });

    it('opens compose and sends with keyboard shortcuts, and never presses a sending key in test mode', async () => {
        route.operations.compose_send.steps[1] = { press: 'c', expect: 'compose_open' };
        route.operations.compose_send.steps[6] = { press: 'ControlOrMeta+Enter', commits: true, expect: 'inbox_list' };
        await executor.run(route, 'compose_send', draft, 'test');
        expect(await fixtureActivity(fixture.page)).toMatchObject({ sendClicks: 0, discards: 1 });
        await executor.run(route, 'compose_send', draft, 'live');
        expect((await fixtureActivity(fixture.page)).sent).toEqual([{ to: 'carol@example.com, dan@example.com', subject: 'Hello there', body: 'Line one\nLine two' }]);
    });

    it('discards a draft left open and checks the discard, also when Send and discard are keyboard shortcuts', async () => {
        route.operations.compose_send.steps[6] = { press: 'ControlOrMeta+Enter', commits: true, expect: 'inbox_list' };
        // With Send as a key press, the draft is still recognised through the recipient check's state.
        await fixture.page.getByRole('button', { name: 'Compose' }).click();
        await executor.run(route, 'list_inbox', {}, 'live');
        expect(await fixture.page.getByRole('dialog', { name: 'New Message' }).isVisible()).toBe(false);
        // A test_end that leaves the draft open is caught, though no step clicks inside the draft.
        route.operations.compose_send.test_end = [{ press: 'Tab' }];
        const error = await routeError(executor.run(route, 'compose_send', draft, 'test'));
        expect(error).toMatchObject({ code: 'cleanup_failed' });
    });

    it('puts the caret at the very start of a field, so typing keeps what is there', async () => {
        await fixture.page.getByRole('button', { name: 'Compose' }).click();
        const body = fixture.page.getByRole('textbox', { name: 'Message Body' });
        await body.evaluate((el) => { el.innerText = 'line two\n-- Signature'; });
        await behaviour.caretToStart(fixture.page, body);
        await behaviour.typeText(fixture.page, body, 'Hello. ');
        expect(await body.innerText()).toBe('Hello. line two\n-- Signature');
    });

    it('types the exact text even when it slips onto neighbouring keys', async () => {
        const clumsy = new HumanBehaviour({ rng: () => 0, timeScale: 0, selectAllModifier: 'Meta' }); // a typo on every letter
        const search = fixture.page.getByRole('searchbox', { name: 'Search mail' });
        await clumsy.typeText(fixture.page, search, 'quarterly numbers');
        expect(await search.inputValue()).toBe('quarterly numbers');
    });

    it('does not treat an open message as an open draft', async () => {
        await executor.run(route, 'open_message', { $message_id: 'm1' }, 'live');
        await executor.run(route, 'list_inbox', {}, 'live');
        expect((await fixtureActivity(fixture.page)).discards).toBe(0);
    });

    it('reads the webmail\'s own list of keyboard shortcuts and closes it again', async () => {
        const help = await executor.readShortcutHelp(route, 'compose_send');
        expect(help).toContain('C: new message');
        expect(help).toContain('E: archive');
        expect(await fixture.page.locator('#shortcut-help').count()).toBe(0);
    });

    it('lists the service\'s test drafts and discards only one that carries the marker', async () => {
        const marker = { $marker: 'Route check by email-agent: safe to discard.' };
        const listed = await executor.run(route, 'list_test_drafts', marker, 'live');
        expect((listed.extracted.messages as Array<Record<string, string>>).map((m) => m.id)).toEqual(['d1', 'd3']);
        await executor.run(route, 'discard_draft', { ...marker, $message_id: 'd1' }, 'test');
        expect((await fixtureActivity(fixture.page)).drafts).toEqual(['d1', 'd2', 'd3']);
        await executor.run(route, 'discard_draft', { ...marker, $message_id: 'd1' }, 'live');
        expect((await fixtureActivity(fixture.page)).drafts).toEqual(['d2', 'd3']);
        // The user's own draft has no marker: the check stops before Discard.
        const error = await routeError(executor.run(route, 'discard_draft', { ...marker, $message_id: 'd2' }, 'live'));
        expect(error.code).toBe('verification_failed');
        expect(error.detail).toContain('which does not contain "Route check by email-agent: safe to discard."');
        expect((await fixtureActivity(fixture.page)).drafts).toEqual(['d2', 'd3']);
        // It was closed, not left open: the next operation's clean start must not discard it.
        await executor.run(route, 'list_inbox', {}, 'live');
        expect((await fixtureActivity(fixture.page)).drafts).toEqual(['d2', 'd3']);
    });

    it('discards its draft straight away when a run fails after the draft was opened', async () => {
        route.operations.compose_send.steps[3] = { fill: { role: 'textbox', name: 'Topic', within: 'compose_open' }, value: '$draft.subject' };
        const error = await routeError(executor.run(route, 'compose_send', draft, 'live'));
        expect(error.code).toBe('target_not_found');
        expect(await fixture.page.getByRole('dialog', { name: 'New Message' }).isVisible()).toBe(false);
        expect(await fixtureActivity(fixture.page)).toMatchObject({ sendClicks: 0, discards: 1 });
    });

    it('fails with target_not_found when the button is gone', async () => {
        route.operations.compose_send.steps[1] = { click: { role: 'button', name: 'Write' }, expect: 'compose_open' };
        const error = await routeError(executor.run(route, 'compose_send', draft, 'test'));
        expect(error).toMatchObject({ code: 'target_not_found', operation: 'compose_send', stepIndex: 1 });
    });

    it('fails with state_not_reached when the expected page state never holds', async () => {
        route.states.inbox_list = { url_matches: '#inbox$', visible: [{ role: 'grid', name: 'Primary' }] };
        const error = await routeError(executor.run(route, 'list_inbox', {}, 'live'));
        expect(error).toMatchObject({ code: 'state_not_reached', phase: 'start', stepIndex: -1 });
        expect(error.detail).toContain('at the start of the operation');
        expect(error.detail).toContain('{"role":"grid","name":"Primary"} matches 0 visible elements');
        expect(error.evidence.some((e) => e.includes('aria-label="Inbox"'))).toBe(true);
    });

    it('starts every operation from a clean inbox, discarding a draft left open', async () => {
        await fixture.page.getByRole('button', { name: 'Compose' }).click();
        await fixture.page.getByRole('textbox', { name: 'Subject' }).fill('left over');
        await executor.run(route, 'list_inbox', {}, 'live');
        expect(await fixture.page.getByRole('dialog').isVisible()).toBe(false);
        expect((await fixtureActivity(fixture.page)).discards).toBe(1);
    });

    it('can compose again after a draft was left open, even when the ribbon hides Compose meanwhile', async () => {
        await serveFixture(fixture.context, 'ribbon');
        await fixture.page.goto('about:blank');
        await fixture.page.goto(FIXTURE_HOME);
        await fixture.page.getByRole('button', { name: 'Compose' }).click();
        expect(await fixture.page.getByRole('button', { name: 'Compose' }).isVisible()).toBe(false);
        await executor.run(route, 'compose_send', draft, 'test');
        expect(await fixtureActivity(fixture.page)).toMatchObject({ sendClicks: 0, discards: 2 });
    });

    it('describes every element an ambiguous target matched, with the region it is in', async () => {
        route.operations.open_message.steps[1] = { extract: { fields: { subject: { target: { role: 'heading' }, from: 'text', format: 'nonempty', required: true } } }, as: 'message' };
        const error = await routeError(executor.run(route, 'open_message', { $message_id: 'm1' }, 'live'));
        expect(error.code).toBe('target_ambiguous');
        expect(error.detail).toContain('must match exactly one');
        expect(error.evidence).toEqual(expect.arrayContaining([
            expect.stringMatching(/^<h2 class="subject"> text "Quarterly numbers"/),
            expect.stringMatching(/^<h3 class="sender-name"> text "Alice Example" inside listitem/),
        ]));
    });

    it('lists what is there when a target matches nothing, closest names first, with the selected tab', async () => {
        await serveFixture(fixture.context, 'ribbon');
        await fixture.page.goto('about:blank');
        route.operations.compose_send.steps[1] = { click: { role: 'button', name: 'Compose message' }, expect: 'compose_open' };
        const error = await routeError(executor.run(route, 'compose_send', draft, 'test'));
        expect(error.evidence[0]).toMatch(/^selected tab \(the page is showing this tab's controls\): <button role="tab" aria-selected="true"> text "Home"/);
        expect(error.evidence[1]).toMatch(/^visible button: <button> text "Compose"/);
    });

    it('works when the app marks the visible page hidden from assistive technology, as Outlook does', async () => {
        await fixture.page.evaluate(() => {
            // The whole app hidden from assistive technology behind an invisible modal layer, but still on screen.
            for (const child of Array.from(document.body.children)) child.setAttribute('aria-hidden', 'true');
            const layer = document.createElement('div');
            layer.setAttribute('role', 'dialog');
            layer.setAttribute('aria-modal', 'true');
            layer.setAttribute('aria-label', 'Leftover callout');
            layer.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden';
            document.body.append(layer);
        });
        const inspected = await executor.inspectTarget(route, { role: 'button', name: 'Compose' });
        expect(inspected.matches).toBe(1);
        // The run's clean start reloads the page, so check a live run on a page that stays hidden.
        await fixture.page.addInitScript(() => {
            new MutationObserver(() => document.querySelectorAll('body > :not([aria-modal])').forEach((c) => c.setAttribute('aria-hidden', 'true')))
                .observe(document, { childList: true, subtree: true });
        });
        await executor.run(route, 'compose_send', draft, 'test');
        expect(await fixtureActivity(fixture.page)).toMatchObject({ sendClicks: 0, discards: 1 });
        const capture = await capturePage(fixture.page, 40_000);
        expect(capture.aria).toContain('nearly empty');
        expect(capture.outline).toMatch(/<button id="compose"> Compose/);
        expect(capture.outline).toContain('aria-hidden="true"');
        expect(capture.layers.some((l) => l.startsWith('shown but marked hidden from assistive technology'))).toBe(true);
    });

    it('waits for the accessibility tree and leaves anonymous wrappers out of the outline', async () => {
        await fixture.page.evaluate(() => {
            const deep = document.createElement('div');
            deep.innerHTML = '<div class="QdrUx"><div class="___1n1jw41"><div><button aria-label="Deep action"><span><span>Deep</span></span></button></div></div></div>';
            document.body.append(deep);
            // Like Outlook while it re-renders: the whole page is hidden from assistive technology for a moment.
            const children = Array.from(document.body.children);
            children.forEach((c) => c.setAttribute('aria-hidden', 'true'));
            setTimeout(() => children.forEach((c) => c.removeAttribute('aria-hidden')), 700);
        });
        const capture = await capturePage(fixture.page, 40_000);
        expect(capture.aria).toContain('grid "Inbox"');
        expect(capture.outline).toMatch(/^ *<button aria-label="Deep action"> Deep$/m);
        expect(capture.outline).not.toContain('QdrUx');
        expect(capture.outline).toContain('<tr class="row unread" data-id="m1" data-thread="t1"');
    });

    it('says when a field pattern did not match, rather than calling the value invalid', async () => {
        const list = route.operations.list_inbox.steps[1]!;
        if (!('extract' in list)) throw new Error('fixture changed');
        list.extract.fields.subject = { target: { css: 'td.subject' }, from: 'text', pattern: '^Re: (.+)$', format: 'nonempty', required: true };
        const error = await routeError(executor.run(route, 'list_inbox', {}, 'live'));
        expect(error.detail).toBe('required field "subject" in item 0: the pattern "^Re: (.+)$" did not match the text "Lunch on Tuesday?"');
        expect(error.evidence[0]).toMatch(/^the item: <tr class="row" data-id="m2"/);
    });

    it('says when a field attribute is absent', async () => {
        const list = route.operations.list_inbox.steps[1]!;
        if (!('extract' in list)) throw new Error('fixture changed');
        list.extract.fields.id = { from: 'attr:data-key', format: 'id', required: true };
        const error = await routeError(executor.run(route, 'list_inbox', {}, 'live'));
        expect(error.detail).toBe('required field "id" in item 0: the element has no data-key attribute');
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
