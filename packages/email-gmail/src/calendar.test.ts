import { describe, expect, it } from 'vitest';
import { GoogleApiError, GoogleCalendar } from './calendar.js';

/** A fetch that records each call and answers with `reply`, as the Calendar API answers. */
function fakeCalendar(reply: (url: URL) => { status?: number; json: unknown }) {
    const calls: Array<{ url: URL; auth: string | null }> = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
        const r = reply(url);
        return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { f, calls };
}

const calendar = (f: typeof fetch) => new GoogleCalendar({ accessToken: async () => 'at-1', fetch: f });

// Shaped as the Calendar API's events.list answers (https://developers.google.com/calendar/api/v3/reference/events).
const meeting = {
    kind: 'calendar#event', id: 'ev1', status: 'confirmed', summary: 'Call with Widget',
    start: { dateTime: '2026-11-12T15:00:00+01:00', timeZone: 'Europe/Berlin' },
    end: { dateTime: '2026-11-12T15:45:00+01:00', timeZone: 'Europe/Berlin' },
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    organizer: { email: 'tom@widget.com', displayName: 'Tom' },
    attendees: [
        { email: 'tom@widget.com', displayName: 'Tom', organizer: true, responseStatus: 'accepted' },
        { email: 'jane@firm.test', self: true, responseStatus: 'tentative' },
        { email: 'room-1@resource.calendar.google.com', resource: true, responseStatus: 'accepted' },
        { email: 'ann@widget.com', optional: true, responseStatus: 'needsAction' },
    ],
};
const ownAllDay = {
    id: 'ev2', status: 'confirmed', summary: 'Closing', transparency: 'transparent',
    start: { date: '2026-11-12' }, end: { date: '2026-11-13' },
    organizer: { email: 'jane@firm.test', self: true },
};

describe('GoogleCalendar', () => {
    it('asks for the single events overlapping the range in order of start, with the access token', async () => {
        const g = fakeCalendar(() => ({ json: { kind: 'calendar#events', items: [] } }));
        await calendar(g.f).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z');
        const url = g.calls[0]!.url;
        expect(url.origin + url.pathname).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            timeMin: '2026-11-12T00:00:00.000Z', timeMax: '2026-11-13T00:00:00.000Z', singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
        });
        expect(g.calls[0]!.auth).toBe('Bearer at-1');
    });

    it('turns events into UTC times, the user\'s answer, the organizer and the attendees', async () => {
        const g = fakeCalendar(() => ({ json: { items: [meeting, ownAllDay] } }));
        const [m, d] = await calendar(g.f).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z');
        expect(m).toEqual({
            id: 'ev1', subject: 'Call with Widget', start: '2026-11-12T14:00:00.000Z', end: '2026-11-12T14:45:00.000Z',
            isAllDay: false, isCancelled: false, isOnlineMeeting: true, response: 'tentativelyAccepted', showAs: 'busy',
            organizer: { name: 'Tom', address: 'tom@widget.com' },
            attendees: [
                { name: 'Tom', address: 'tom@widget.com', type: 'required', response: 'accepted' },
                { name: null, address: 'jane@firm.test', type: 'required', response: 'tentativelyAccepted' },
                { name: null, address: 'room-1@resource.calendar.google.com', type: 'resource', response: 'accepted' },
                { name: null, address: 'ann@widget.com', type: 'optional', response: 'notResponded' },
            ],
            location: null, bodyPreview: null,
        });
        expect(d).toMatchObject({ start: '2026-11-12T00:00:00.000Z', end: '2026-11-13T00:00:00.000Z', isAllDay: true, response: 'organizer', showAs: 'free', isOnlineMeeting: false, attendees: [] });
    });

    it('reports a cancelled occurrence as cancelled', async () => {
        const g = fakeCalendar(() => ({ json: { items: [{ ...meeting, status: 'cancelled' }] } }));
        expect((await calendar(g.f).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z'))[0]!.isCancelled).toBe(true);
    });

    it('follows pages up to the limit', async () => {
        const g = fakeCalendar((url) => url.searchParams.get('pageToken')
            ? { json: { items: [{ ...meeting, id: 'ev3' }, { ...meeting, id: 'ev4' }] } }
            : { json: { items: [meeting, { ...meeting, id: 'ev2' }], nextPageToken: 'p2' } });
        const found = await calendar(g.f).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z', 3);
        expect(found.map((e) => e.id)).toEqual(['ev1', 'ev2', 'ev3']);
        expect(g.calls.map((c) => c.url.searchParams.get('maxResults'))).toEqual(['3', '1']);
        expect(g.calls[1]!.url.searchParams.get('pageToken')).toBe('p2');
    });

    it('throws Google\'s error with its status and reasons, and knows a rate limit', async () => {
        const denied = fakeCalendar(() => ({ status: 401, json: { error: { code: 401, message: 'Request had invalid authentication credentials.', errors: [{ reason: 'authError' }] } } }));
        const err = await calendar(denied.f).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GoogleApiError);
        expect(err).toMatchObject({ status: 401, reasons: ['authError'], rateLimited: false });
        expect(String(err)).toMatch(/401: Request had invalid authentication credentials/);
        const slow = fakeCalendar(() => ({ status: 403, json: { error: { code: 403, message: 'Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } } }));
        expect(await calendar(slow.f).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z').catch((e: unknown) => e)).toMatchObject({ rateLimited: true });
    });

    it('refuses an answer it does not know rather than guessing', async () => {
        const g = fakeCalendar(() => ({ json: { items: [{ ...meeting, attendees: [{ email: 'jane@firm.test', self: true, responseStatus: 'maybe' }] }] } }));
        await expect(calendar(g.f).events('2026-11-12T00:00:00Z', '2026-11-13T00:00:00Z')).rejects.toThrow(/"maybe"/);
    });
});
