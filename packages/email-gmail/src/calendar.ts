const API = 'https://www.googleapis.com/calendar/v3';

/**
 * One event of the user's primary Google calendar, in the same terms as
 * @teamsuzie/microsoft-graph's CalendarEvent so a host can treat both alike.
 */
export interface GoogleCalendarEvent {
    id: string;
    subject: string;
    /** ISO times in UTC. An all-day event runs from midnight UTC of its first day to midnight UTC after its last. */
    start: string;
    end: string;
    isAllDay: boolean;
    isCancelled: boolean;
    /** Whether the event has a video call (Google Meet or another conference). */
    isOnlineMeeting: boolean;
    /** How the user answered: organizer, accepted, tentativelyAccepted, declined, notResponded, none. */
    response: string;
    /** free when the event does not block time ("Show as available"), busy otherwise. */
    showAs: 'free' | 'busy';
    organizer: { name: string | null; address: string | null };
    attendees: Array<{ name: string | null; address: string; type: 'required' | 'optional' | 'resource'; response: string }>;
    location: string | null;
    bodyPreview: string | null;
}

interface ApiTime { dateTime?: string; date?: string; timeZone?: string }
interface ApiPerson { email?: string; displayName?: string; self?: boolean }
interface ApiAttendee extends ApiPerson { responseStatus?: string; optional?: boolean; resource?: boolean; organizer?: boolean }
interface ApiEvent {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: ApiTime;
    end?: ApiTime;
    transparency?: string;
    hangoutLink?: string;
    conferenceData?: unknown;
    organizer?: ApiPerson;
    attendees?: ApiAttendee[];
}

/** A Google API (Calendar, Drive) answered with an error; `status` is its HTTP status and `reasons` Google's own reason codes. */
export class GoogleApiError extends Error {
    constructor(readonly status: number, readonly reasons: string[], message: string) { super(message); }
    /** Google's "slow down" answers: 429, and 403 with a rate-limit reason. */
    get rateLimited(): boolean {
        return this.status === 429 || (this.status === 403 && this.reasons.some((r) => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded'));
    }
    /** The access token lacks a scope the call needs (a connection made before the scope was asked for): 403 insufficientPermissions. */
    get insufficientScope(): boolean {
        return this.status === 403 && this.reasons.includes('insufficientPermissions');
    }
}

/** Google's answers (needsAction, accepted, tentative, declined) in CalendarEvent's words. */
const RESPONSE: Record<string, string> = { accepted: 'accepted', tentative: 'tentativelyAccepted', declined: 'declined', needsAction: 'notResponded' };

function response(status: string | undefined, eventId: string): string {
    if (status === undefined) return 'none';
    const r = RESPONSE[status];
    if (!r) throw new Error(`Google Calendar event ${eventId} has an answer this reader does not know: "${status}"`);
    return r;
}

/** An event time as an ISO time in UTC; an all-day date counts from midnight UTC. */
function utc(t: ApiTime | undefined, eventId: string, which: 'start' | 'end'): string {
    if (t?.dateTime) return new Date(t.dateTime).toISOString();
    if (t?.date) return new Date(`${t.date}T00:00:00Z`).toISOString();
    throw new Error(`Google Calendar event ${eventId} has no ${which} time`);
}

/**
 * Reads the signed-in user's primary Google calendar (scope
 * GOOGLE_CALENDAR_READONLY_SCOPE). It is handed a function that returns a
 * current access token and never stores tokens; it never changes anything.
 */
export class GoogleCalendar {
    constructor(private readonly opts: { accessToken: () => Promise<string>; fetch?: typeof fetch }) {}

    /**
     * Events overlapping the time from `start` to `end` (ISO times), recurring
     * ones as their single occurrences, in order of start, at most `limit`.
     */
    async events(start: string, end: string, limit = 250): Promise<GoogleCalendarEvent[]> {
        const found: ApiEvent[] = [];
        let pageToken: string | undefined;
        do {
            const url = new URL(`${API}/calendars/primary/events`);
            url.searchParams.set('timeMin', new Date(start).toISOString());
            url.searchParams.set('timeMax', new Date(end).toISOString());
            url.searchParams.set('singleEvents', 'true');
            url.searchParams.set('orderBy', 'startTime');
            url.searchParams.set('maxResults', String(Math.min(limit - found.length, 250)));
            if (pageToken) url.searchParams.set('pageToken', pageToken);
            const res = await (this.opts.fetch ?? fetch)(url, { headers: { authorization: `Bearer ${await this.opts.accessToken()}` } });
            const text = await res.text();
            if (!res.ok) {
                const parsed = (() => { try { return (JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }).error; } catch { return undefined; } })();
                const reasons = (parsed?.errors ?? []).map((e) => e.reason).filter((r): r is string => Boolean(r));
                throw new GoogleApiError(res.status, reasons, `Google Calendar answered ${res.status}: ${parsed?.message ?? text}`);
            }
            const page = JSON.parse(text) as { items?: ApiEvent[]; nextPageToken?: string };
            found.push(...(page.items ?? []));
            pageToken = page.nextPageToken;
        } while (pageToken && found.length < limit);
        return found.slice(0, limit).map((e) => {
            const me = e.attendees?.find((a) => a.self);
            return {
                id: e.id,
                subject: e.summary ?? '',
                start: utc(e.start, e.id, 'start'),
                end: utc(e.end, e.id, 'end'),
                isAllDay: Boolean(e.start?.date),
                isCancelled: e.status === 'cancelled',
                isOnlineMeeting: Boolean(e.hangoutLink || e.conferenceData),
                // An event the user organised has them as organiser even when they are also listed as an attendee.
                response: e.organizer?.self ? 'organizer' : response(me?.responseStatus, e.id),
                showAs: e.transparency === 'transparent' ? 'free' : 'busy',
                organizer: { name: e.organizer?.displayName ?? null, address: e.organizer?.email ?? null },
                attendees: (e.attendees ?? [])
                    .filter((a) => a.email)
                    .map((a) => ({
                        name: a.displayName ?? null,
                        address: a.email!,
                        type: a.resource ? 'resource' as const : a.optional ? 'optional' as const : 'required' as const,
                        response: response(a.responseStatus, e.id),
                    })),
                location: e.location ?? null,
                bodyPreview: e.description ? e.description.slice(0, 255) : null,
            };
        });
    }
}
