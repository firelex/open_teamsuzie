import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HumanBehaviour, RouteError, RouteExecutor, VolumeLimiter } from '@teamsuzie/webmail-browser';
import {
    fixtureActivity, fixtureRoute, openFixtureBrowser, serveFixture, FIXTURE_HOME, type FixtureBrowser,
} from '@teamsuzie/webmail-browser/testing';
import type { Route } from '@teamsuzie/webmail-routes';
import { buildTestParams, runCanary } from './canary.js';
import { WebmailEmailClient, WebmailUnsupportedError } from './client.js';

let fixture: FixtureBrowser;
let route: Route;
let client: WebmailEmailClient;

beforeAll(async () => {
    fixture = await openFixtureBrowser();
});

afterAll(async () => {
    await fixture.close();
});

beforeEach(async () => {
    route = fixtureRoute();
    await serveFixture(fixture.context, 'standard');
    await fixture.page.goto('about:blank');
    await fixture.page.goto(FIXTURE_HOME);
    const behaviour = new HumanBehaviour({ rng: Math.random, timeScale: 0, selectAllModifier: 'Meta' });
    client = new WebmailEmailClient({
        account: { address: 'me@example.com', provider: 'gmail' },
        executor: new RouteExecutor({ page: fixture.page, behaviour, stepTimeoutMs: 1500, stateTimeoutMs: 2000, navigationTimeoutMs: 10_000, dates: { locale: 'en-GB', timeZone: 'Europe/London', now: () => new Date() } }),
        routes: { current: () => route },
        limiter: new VolumeLimiter({ opensPerMinute: 100, opensPerHour: 1000, minSecondsBetweenSends: 0.001 }),
        behaviour,
        now: () => new Date(),
    });
});

describe('WebmailEmailClient', () => {
    it('reads the signed-in account', async () => {
        expect(await client.readAccount()).toBe('me@example.com');
    });

    it('lists the inbox and searches', async () => {
        const inbox = await client.listMessages();
        expect(inbox.messages.map((m) => [m.id, m.threadId, m.from, m.unread])).toEqual([
            ['m2', 't2', 'bob@example.org', false],
            ['m1', 't1', 'alice@example.com', true],
        ]);
        expect(inbox.messages[1]!.date).toBe('2026-10-24T08:15:00.000Z');
        const found = await client.listMessages({ search: 'quarterly', limit: 5 });
        expect(found.messages.map((m) => m.id)).toEqual(['m0', 'm1']);
    });

    it('opens a message and a thread', async () => {
        const message = await client.getMessage('m1');
        expect(message).toMatchObject({ id: 'm1', subject: 'Quarterly numbers', from: 'alice@example.com', to: 'me@example.com', cc: 'dan@example.com' });
        expect(message.bodyText).toContain('Revenue is up.');
        const thread = await client.getThread('t1');
        expect(thread.messageIds).toEqual(['m0', 'm1']);
        expect(thread.participants).toEqual(['alice@example.com']);
        expect(thread.lastMessageAt).toBe(message.date);
    });

    it('sends, and confirms the message is in Sent', async () => {
        await client.send({ to: 'carol@example.com', subject: 'Plan', body: 'See you at 3.' });
        expect((await fixtureActivity(fixture.page)).sent).toEqual([{ to: 'carol@example.com', subject: 'Plan', body: 'See you at 3.' }]);
        expect(await client.confirmSent('Plan', 'carol@example.com')).toBe(true);
        expect(await client.confirmSent('Plan', 'someone@else.com')).toBe(false);
        expect(await client.confirmSent('Other', 'carol@example.com')).toBe(false);
        // A Sent list that shows recipients only by name: the subject decides.
        const step = route.operations.check_sent.steps[1]!;
        if (!('extract' in step)) throw new Error('fixture changed');
        step.extract.fields.to = { target: { css: 'td.from [data-email]' }, from: 'text', format: 'text', required: false };
        await fixture.page.evaluate(() => { (window as unknown as { __sent: Array<{ to: string }> }).__sent[0]!.to = 'Carol Example'; });
        expect(await client.confirmSent('Plan', 'carol@example.com')).toBe(true);
        delete step.extract.fields.to;
        await client.reply({ messageId: 'm2', body: 'Yes.' });
        expect(await client.confirmSent('Lunch on Tuesday?', 'bob@example.org')).toBe(true);
    });

    it('replies to the original sender', async () => {
        await client.reply({ messageId: 'm2', body: 'Tuesday works.' });
        expect((await fixtureActivity(fixture.page)).sent).toEqual([{ to: 'bob@example.org', subject: 'Re: Lunch on Tuesday?', body: 'Tuesday works.' }]);
    });

    it('refuses a reply whose recipients differ from what the page shows, without sending', async () => {
        await expect(client.reply({ messageId: 'm2', body: 'x', to: 'carol@example.com' })).rejects.toMatchObject({ code: 'recipients_mismatch' });
        expect((await fixtureActivity(fixture.page)).sendClicks).toBe(0);
    });

    it('refuses what it cannot do through the page', async () => {
        await expect(client.send({ to: 'a@b.com', subject: 's', body: 'b', html: '<p>b</p>' })).rejects.toBeInstanceOf(WebmailUnsupportedError);
        await expect(client.send({ to: 'a@b.com', subject: 's', body: 'b', attachments: [{ filename: 'f', contentType: 'text/plain', content: 'eA==' }] })).rejects.toBeInstanceOf(WebmailUnsupportedError);
        await expect(client.send({ to: 'a@b.com', subject: 's', body: 'b', fromAccount: 'other@example.com' })).rejects.toBeInstanceOf(WebmailUnsupportedError);
        await expect(client.reply({ messageId: 'm2', body: 'x', replyAll: true })).rejects.toBeInstanceOf(WebmailUnsupportedError);
    });

    it('rejects a route whose values do not have the form the output needs, whatever format it declares', async () => {
        const step = route.operations.list_inbox.steps[1]!;
        if (!('extract' in step)) throw new Error('fixture changed');
        // A sender read as a display name, declared as free text to get past the field check.
        step.extract.fields.from = { target: { css: 'td.from [data-email]' }, from: 'text', format: 'text', required: true };
        const error = await client.listMessages().catch((e: unknown) => e);
        expect(error).toMatchObject({ code: 'extract_invalid', detail: expect.stringContaining('"from" of record 0') });
    });

    it('treats a route that does not return a required output as a route error', async () => {
        const step = route.operations.list_inbox.steps[1]!;
        if (!('extract' in step)) throw new Error('fixture changed');
        delete step.extract.fields.subject;
        const error = await client.listMessages().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RouteError);
        expect((error as RouteError).code).toBe('extract_invalid');
    });
});

describe('runCanary', () => {
    it('passes every operation on a matching route without sending anything', async () => {
        const results = await runCanary(client);
        expect(results.map((r) => [r.operation, r.outcome])).toEqual([
            ['list_inbox', 'passed'],
            ['read_account', 'passed'],
            ['open_message', 'passed'],
            ['read_thread', 'passed'],
            ['search', 'passed'],
            ['compose_send', 'passed'],
            ['reply', 'passed'],
            ['check_sent', 'passed'],
        ]);
        expect(await fixtureActivity(fixture.page)).toMatchObject({ sendClicks: 0, discards: 2 });
    });

    it('reports a broken operation and skips those that depend on the inbox when it cannot be read', async () => {
        route.states.inbox_list = { url_matches: '#inbox$', visible: [{ role: 'grid', name: 'Primary' }] };
        const results = await runCanary(client, ['list_inbox', 'open_message', 'check_sent']);
        // Every operation starts from the inbox, so a broken inbox state fails check_sent too.
        expect(results.map((r) => [r.operation, r.outcome])).toEqual([
            ['list_inbox', 'failed'],
            ['open_message', 'skipped'],
            ['check_sent', 'failed'],
        ]);
        expect(results[0]!.error?.code).toBe('state_not_reached');
    });

    it('reports a date it cannot read as unreadable, not as a route failure', async () => {
        const own = await openFixtureBrowser();
        try {
            // Every load of the page shows a date the reader cannot read.
            await own.page.addInitScript(() => {
                new MutationObserver(() => document.querySelectorAll('td.date [title]').forEach((el) => el.setAttribute('title', 'sometime')))
                    .observe(document, { subtree: true, childList: true });
            });
            const behaviour = new HumanBehaviour({ rng: Math.random, timeScale: 0, selectAllModifier: 'Meta' });
            const ownClient = new WebmailEmailClient({
                account: { address: 'me@example.com', provider: 'gmail' },
                executor: new RouteExecutor({ page: own.page, behaviour, stepTimeoutMs: 1500, stateTimeoutMs: 2000, navigationTimeoutMs: 10_000, dates: { locale: 'en-GB', timeZone: 'Europe/London', now: () => new Date() } }),
                routes: { current: () => route },
                limiter: new VolumeLimiter({ opensPerMinute: 100, opensPerHour: 1000, minSecondsBetweenSends: 0.001 }),
                behaviour,
                now: () => new Date(),
            });
            const results = await runCanary(ownClient, ['list_inbox', 'check_sent']);
            expect(results[0]).toMatchObject({ operation: 'list_inbox', outcome: 'unreadable', error: { code: 'unreadable_value' } });
            expect(results[1]!.outcome).toBe('passed');
        } finally {
            await own.close();
        }
    });

    it('runs only the operations asked for', async () => {
        await serveFixture(fixture.context, 'renamed');
        await fixture.page.goto('about:blank');
        const results = await runCanary(client, ['compose_send']);
        expect(results).toEqual([expect.objectContaining({ operation: 'compose_send', outcome: 'failed', error: expect.objectContaining({ code: 'target_not_found' }) })]);
    });
});

describe('buildTestParams', () => {
    it('takes parameters from the first inbox message', async () => {
        const { params, inboxError } = await buildTestParams(client);
        expect(inboxError).toBeNull();
        expect(params.open_message).toEqual({ $message_id: 'm2' });
        expect(params.reply).toMatchObject({ $message_id: 'm2', '$draft.to': 'bob@example.org' });
        expect(params.compose_send).toMatchObject({ '$draft.to': 'me@example.com' });
    });

    it('leaves out operations that need a message when the inbox cannot be listed, and says why', async () => {
        route.states.inbox_list = { url_matches: '#inbox$', visible: [{ role: 'grid', name: 'Primary' }] };
        const { params, inboxError } = await buildTestParams(client);
        expect(inboxError?.code).toBe('state_not_reached');
        expect(Object.keys(params).sort()).toEqual(['check_sent', 'compose_send', 'list_inbox', 'read_account']);
    });
});
