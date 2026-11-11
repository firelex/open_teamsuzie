/**
 * Name matching for conflict checks. Names are compared after removing
 * case, accents, punctuation, a leading "the" and legal-form words (Ltd,
 * LLC, GmbH, plc, ...), so "Acme Holdings Ltd." matches "ACME HOLDINGS
 * LIMITED". Words are then matched one by one (Jaro-Winkler, so small
 * typos still match) in any order, and a name wholly contained in the
 * other counts as a possible match.
 */

const LEGAL_FORMS = new Set([
    'ltd', 'limited', 'llc', 'llp', 'lp', 'plc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
    'gmbh', 'ag', 'kg', 'sa', 'sas', 'sarl', 'srl', 'spa', 'bv', 'nv', 'ab', 'as', 'oy', 'pte', 'pty', 'kk', 'sl',
    'holding', 'holdings', 'group',
]);

/** Comparable form of a name: lower case, no accents or punctuation, no legal-form words. */
export function normalizeName(name: string): string {
    const words = name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        // "S.A." and "Ltd." become "sa" and "ltd".
        .replace(/\./g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    const kept = words.filter((w, i) => !(i === 0 && w === 'the') && !LEGAL_FORMS.has(w));
    // A name made only of legal-form words (e.g. "Holdings Ltd") keeps them.
    return (kept.length > 0 ? kept : words).join(' ');
}

function jaro(a: string, b: string): number {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    const aMatched = new Array<boolean>(a.length).fill(false);
    const bMatched = new Array<boolean>(b.length).fill(false);
    let matches = 0;
    for (let i = 0; i < a.length; i++) {
        for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
            if (bMatched[j] || a[i] !== b[j]) continue;
            aMatched[i] = bMatched[j] = true;
            matches++;
            break;
        }
    }
    if (matches === 0) return 0;
    let t = 0;
    let k = 0;
    for (let i = 0; i < a.length; i++) {
        if (!aMatched[i]) continue;
        while (!bMatched[k]) k++;
        if (a[i] !== b[k]) t++;
        k++;
    }
    return (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
    const j = jaro(a, b);
    let prefix = 0;
    while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    return j + prefix * 0.1 * (1 - j);
}

/** Similarity of two names between 0 and 1. */
export function nameSimilarity(a: string, b: string): number {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const ta = na.split(' ');
    const tb = nb.split(' ');
    // Word by word: each word's best Jaro-Winkler against the other name's
    // words, counted when it is at least 0.9 (a typo, not a different word).
    const best = (word: string, others: string[]) => {
        const s = Math.max(...others.map((o) => jaroWinkler(word, o)));
        return s >= 0.9 ? s : 0;
    };
    const soft = (ta.reduce((n, w) => n + best(w, tb), 0) + tb.reduce((n, w) => n + best(w, ta), 0)) / (ta.length + tb.length);
    // A name wholly contained in the other ("Acme" in "Acme Widgets") is a
    // possible match: conflict checks prefer a false alarm to a miss.
    const [shorter, longer] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
    const contained = shorter.every((w) => longer.has(w)) ? (shorter.length >= 2 ? 0.95 : 0.9) : 0;
    return Math.max(soft, contained);
}
