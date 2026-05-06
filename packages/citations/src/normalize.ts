export function normalize(s: string): string {
    return s
        .replace(/[‘’‚‛′]/g, "'")
        .replace(/[“”„‟″]/g, '"')
        .replace(/[–—−]/g, '-')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export type NormalizedWithMap = {
    text: string;
    map: number[];
};

/**
 * Like {@link normalize}, but also returns a map from each character of the
 * normalized string back to its offset in the original input. `map.length`
 * always equals `text.length`. Useful when you've located a substring in
 * normalized text and need to highlight the corresponding original-text span.
 */
export function normalizeWithMap(s: string): NormalizedWithMap {
    const out: string[] = [];
    const map: number[] = [];
    let lastWasSpace = true;
    let pendingTrailingSpaceCount = 0;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        const replacement = remap(ch);

        if (replacement === ' ') {
            if (lastWasSpace) {
                pendingTrailingSpaceCount += 1;
                continue;
            }
            out.push(' ');
            map.push(i);
            lastWasSpace = true;
        } else {
            out.push(replacement);
            map.push(i);
            lastWasSpace = false;
            pendingTrailingSpaceCount = 0;
        }
    }

    while (out.length > 0 && out[out.length - 1] === ' ') {
        out.pop();
        map.pop();
    }

    if (out.length > 0 && out[0] === ' ') {
        out.shift();
        map.shift();
    }

    void pendingTrailingSpaceCount;

    return { text: out.join(''), map };
}

function remap(ch: string): string {
    switch (ch) {
        case '‘':
        case '’':
        case '‚':
        case '‛':
        case '′':
            return "'";
        case '“':
        case '”':
        case '„':
        case '‟':
        case '″':
            return '"';
        case '–':
        case '—':
        case '−':
            return '-';
        case ' ':
        case ' ':
        case '\t':
        case '\n':
        case '\r':
        case '\f':
        case '\v':
            return ' ';
        default:
            return ch.toLowerCase();
    }
}
