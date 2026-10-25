/** How to read the dates a webmail shows: in the account's language and day/month order, in the user's time zone. */
export interface DateContext {
    /** BCP 47 locale the webmail is shown in, e.g. `en-GB`. Sets day/month order and the words for months and days. */
    locale: string;
    /** IANA time zone the webmail shows times in, e.g. `Europe/London`. */
    timeZone: string;
    now: () => Date;
}

interface Vocabulary {
    months: Map<string, number>;
    weekdays: Map<string, number>;
    today: Set<string>;
    yesterday: Set<string>;
    order: 'DMY' | 'MDY' | 'YMD';
}

const FILLER = new Set(['at', 'on', 'the', 'um', 'à', 'om', 'am']);
const vocabularies = new Map<string, Vocabulary>();

function word(text: string): string {
    return text.toLowerCase().replace(/\./g, '').trim();
}

function vocabulary(locale: string): Vocabulary {
    const cached = vocabularies.get(locale);
    if (cached) return cached;
    const languages = [...new Set([locale, 'en'])];
    const months = new Map<string, number>();
    const weekdays = new Map<string, number>();
    const today = new Set<string>();
    const yesterday = new Set<string>();
    for (const language of languages) {
        for (const style of ['long', 'short'] as const) {
            const monthFormat = new Intl.DateTimeFormat(language, { month: style, timeZone: 'UTC' });
            for (let m = 0; m < 12; m++) months.set(word(monthFormat.format(Date.UTC(2026, m, 15))), m + 1);
            const dayFormat = new Intl.DateTimeFormat(language, { weekday: style, timeZone: 'UTC' });
            // 4 January 2026 is a Sunday.
            for (let d = 0; d < 7; d++) weekdays.set(word(dayFormat.format(Date.UTC(2026, 0, 4 + d))), d);
        }
        const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
        today.add(word(relative.format(0, 'day')));
        yesterday.add(word(relative.format(-1, 'day')));
    }
    // English abbreviations Intl does not produce.
    for (const [abbr, m] of [['sept', 9]] as const) months.set(abbr, m);
    for (const [abbr, d] of [['tues', 2], ['thur', 4], ['thurs', 4]] as const) weekdays.set(abbr, d);
    const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(Date.UTC(2026, 9, 25));
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type[0]!.toUpperCase()).join('');
    if (order !== 'DMY' && order !== 'MDY' && order !== 'YMD') throw new Error(`Unsupported date order "${order}" for locale ${locale}`);
    const vocab: Vocabulary = { months, weekdays, today, yesterday, order };
    vocabularies.set(locale, vocab);
    return vocab;
}

/** How far `timeZone` is ahead of UTC at the instant `ms`, in milliseconds. */
function zoneOffset(ms: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms;
}

/** The UTC instant of a wall-clock time in `timeZone`. */
function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, s: number, timeZone: string): number {
    const wall = Date.UTC(y, m - 1, d, h, mi, s);
    const first = wall - zoneOffset(wall, timeZone);
    return wall - zoneOffset(first, timeZone);
}

/** Today's calendar date in `timeZone`. */
function today(ctx: DateContext): { y: number; m: number; d: number; weekday: number } {
    const shifted = new Date(ctx.now().getTime() + zoneOffset(ctx.now().getTime(), ctx.timeZone));
    return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

function addDays(date: { y: number; m: number; d: number }, days: number): { y: number; m: number; d: number } {
    const shifted = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
    return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function validDate(y: number, m: number, d: number): boolean {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function fullYear(text: string): number {
    const n = Number(text);
    return text.length <= 2 ? 2000 + n : n;
}

const TIME = /(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s?m\.?)?(?![\w:])/;
const NUMERIC_DATE = /(?<![\d:])(\d{1,4})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?![\d:])/;

/**
 * The instant a webmail date text stands for, as an ISO timestamp, or null when it is not a date this can read.
 *
 * Reads: ISO timestamps; numeric dates in the locale's day/month order (`25/10/2026`, `24.10.26`, `10/24/2026` for
 * en-US), with or without a weekday and time; month names in the locale's language or English, with or without a
 * year (a date without a year that would lie in the future is taken as last year); a time alone (today); the word
 * for yesterday or today with or without a time; and a weekday with a time (its most recent occurrence before today).
 */
export function parseWebmailDate(text: string, ctx: DateContext): string | null {
    const raw = text.replace(/[\s  -​  　]+/g, ' ').trim();
    if (raw === '') return null;
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
        const ms = Date.parse(raw);
        return Number.isNaN(ms) ? null : new Date(ms).toISOString();
    }
    const vocab = vocabulary(ctx.locale);
    let rest = raw.toLowerCase().replace(/,/g, ' ');

    let time: { h: number; mi: number; s: number } | null = null;
    const timeMatch = TIME.exec(rest);
    if (timeMatch) {
        let h = Number(timeMatch[1]);
        const mi = Number(timeMatch[2]);
        const s = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
        const half = timeMatch[4];
        if (half !== undefined) {
            if (h < 1 || h > 12) return null;
            h = (h % 12) + (half === 'p' ? 12 : 0);
        }
        if (h > 23 || mi > 59 || s > 59) return null;
        time = { h, mi, s };
        rest = rest.replace(timeMatch[0], ' ');
    }

    let y: number | null = null;
    let m: number | null = null;
    let d: number | null = null;
    const numeric = NUMERIC_DATE.exec(rest);
    if (numeric) {
        const [a, b, c] = [numeric[1]!, numeric[2]!, numeric[3]];
        if (a.length === 4) {
            [y, m, d] = [Number(a), Number(b), c === undefined ? NaN : Number(c)];
        } else if (vocab.order === 'MDY') {
            [m, d] = [Number(a), Number(b)];
            if (c !== undefined) y = fullYear(c);
        } else {
            [d, m] = [Number(a), Number(b)];
            if (c !== undefined) y = fullYear(c);
        }
        if (Number.isNaN(d)) return null;
        rest = rest.replace(numeric[0], ' ');
    }

    let weekday: number | null = null;
    let relative: 'today' | 'yesterday' | null = null;
    for (const token of rest.split(' ').map(word).filter((t) => t.length > 0)) {
        if (vocab.months.has(token) && m === null) m = vocab.months.get(token)!;
        else if (vocab.weekdays.has(token)) weekday = vocab.weekdays.get(token)!;
        else if (vocab.today.has(token)) relative = 'today';
        else if (vocab.yesterday.has(token)) relative = 'yesterday';
        else if (/^\d{4}$/.test(token) && y === null) y = Number(token);
        else if (/^\d{1,2}$/.test(token) && d === null) d = Number(token);
        else if (!FILLER.has(token)) return null;
    }

    const now = today(ctx);
    let date: { y: number; m: number; d: number };
    if (m !== null || d !== null) {
        if (m === null || d === null) return null;
        if (y === null) {
            y = now.y;
            if (Date.UTC(y, m - 1, d) > Date.UTC(now.y, now.m - 1, now.d)) y -= 1;
        }
        if (!validDate(y, m, d)) return null;
        date = { y, m, d };
    } else if (relative !== null) {
        date = relative === 'today' ? now : addDays(now, -1);
    } else if (weekday !== null) {
        if (time === null) return null;
        const back = (now.weekday - weekday + 7) % 7 || 7;
        date = addDays(now, -back);
    } else if (time !== null) {
        date = now;
    } else {
        return null;
    }
    const t = time ?? { h: 0, mi: 0, s: 0 };
    return new Date(zonedToUtc(date.y, date.m, date.d, t.h, t.mi, t.s, ctx.timeZone)).toISOString();
}
