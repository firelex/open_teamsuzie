function minutesOf(clock: string): number {
    const [h, m] = clock.split(':').map(Number);
    return h! * 60 + m!;
}

/** Minutes since local midnight in `timezone`. */
function localMinutes(now: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return get('hour') * 60 + get('minute');
}

/**
 * When quiet hours are in force at `now`, the moment they end; otherwise null. Quiet hours may run past midnight
 * (start later than end).
 */
export function quietUntil(now: Date, quiet: { start: string; end: string } | null, timezone: string): Date | null {
    if (quiet === null) return null;
    const start = minutesOf(quiet.start);
    const end = minutesOf(quiet.end);
    const current = localMinutes(now, timezone);
    const inside = start <= end ? current >= start && current < end : current >= start || current < end;
    if (!inside) return null;
    const minutesLeft = (end - current + 1440) % 1440;
    const ms = minutesLeft * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
    return new Date(now.getTime() + ms);
}
