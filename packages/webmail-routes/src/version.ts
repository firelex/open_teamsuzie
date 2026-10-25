const VERSION_PATTERN = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/;

export function isRouteVersion(value: string): boolean {
    return VERSION_PATTERN.test(value);
}

/** The next `YYYY-MM-DD.N` version: N + 1 on the same (UTC) day, `.1` on a new day. */
export function nextRouteVersion(previous: string | null, today: Date): string {
    const day = today.toISOString().slice(0, 10);
    if (previous === null) return `${day}.1`;
    const match = VERSION_PATTERN.exec(previous);
    if (!match) throw new Error(`Not a route version: ${previous}`);
    return match[1] === day ? `${day}.${Number(match[2]) + 1}` : `${day}.1`;
}
