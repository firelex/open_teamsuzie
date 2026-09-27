/**
 * Splits a header address list at the commas between addresses, not the ones
 * inside quoted display names ("Reed, Anna" <anna@x.com>) or angle brackets.
 */
export function splitAddressList(list: string | null | undefined): string[] {
    const out: string[] = [];
    let current = '';
    let quoted = false;
    let angle = 0;
    for (const ch of list ?? '') {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch === '<') angle++;
        else if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
        if (ch === ',' && !quoted && angle === 0) {
            if (current.trim()) out.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) out.push(current.trim());
    return out;
}

/** The bare address in lower case: the part in angle brackets when there is one, otherwise the whole text. */
export function addressOf(entry: string): string {
    const bracketed = /<([^<>]+)>\s*$/.exec(entry);
    return (bracketed ? bracketed[1]! : entry).trim().toLowerCase();
}
