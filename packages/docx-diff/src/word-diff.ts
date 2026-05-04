/**
 * Word-level diff: given two paragraph strings, produce the minimal sequence
 * of equal/insert/delete runs that turns A into B. Used to render the "what
 * changed inside this paragraph" view for matched-but-not-identical pairs
 * coming out of `alignParagraphs`.
 *
 * Algorithm:
 *   1. Tokenize each side into atoms. Each atom is one of:
 *        — a pure-whitespace run (only at the very start of the string),
 *        — a word run (Unicode letters/digits/underscore/apostrophe) plus
 *          its trailing whitespace,
 *        — a single non-word non-whitespace character (punctuation) plus
 *          its trailing whitespace.
 *      Attaching trailing whitespace to its preceding content keeps a
 *      whitespace token from pairing with a far-away whitespace token in
 *      the LCS — that's what causes "use" + (insert " reasonable") + (equal
 *      " ") + "efforts" instead of the more readable "use " + (insert
 *      "reasonable ") + "efforts".
 *   2. Run a standard LCS DP over the atoms.
 *   3. Backtrace, biasing toward emitting deletes before inserts at any
 *      tie so renderers see "old then new" — the conventional redline
 *      reading order.
 *   4. Coalesce adjacent ops of the same kind into single runs.
 *
 * Comparison is case-sensitive and whitespace-exact. A capitalisation change
 * or a stray double-space is a real change in a contract; the redline should
 * surface it. Callers that want looser matching can normalise upstream.
 */

export type WordDiffKind = 'equal' | 'insert' | 'delete';

export interface WordDiffOp {
    kind: WordDiffKind;
    /** The atoms' original text, concatenated. Whitespace and casing preserved. */
    text: string;
}

// Pure-whitespace run | (word | single-punct) followed by optional trailing whitespace.
// The leading \s+ branch only fires at positions where no content has been
// consumed yet (i.e. leading whitespace) since after any content token its
// trailing \s* will have eaten the following whitespace.
const ATOM_RE = /\s+|(?:[\p{L}\p{N}_']+|[^\p{L}\p{N}_'\s])\s*/gu;

function tokenize(s: string): string[] {
    return s.match(ATOM_RE) ?? [];
}

export function diffWords(a: string, b: string): WordDiffOp[] {
    if (a === b) {
        return a.length === 0 ? [] : [{ kind: 'equal', text: a }];
    }

    const aToks = tokenize(a);
    const bToks = tokenize(b);

    if (aToks.length === 0) {
        return b.length === 0 ? [] : [{ kind: 'insert', text: b }];
    }
    if (bToks.length === 0) {
        return [{ kind: 'delete', text: a }];
    }

    const N = aToks.length;
    const M = bToks.length;

    // dp[i][j] = LCS length of aToks[0..i) and bToks[0..j)
    const dp: number[][] = Array.from({ length: N + 1 }, () =>
        new Array(M + 1).fill(0),
    );
    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= M; j++) {
            dp[i][j] =
                aToks[i - 1] === bToks[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    // Backtrace. We push ops in reverse order and reverse at the end.
    // To produce delete-before-insert in the final output, push insert
    // first in the reverse pass when the move is ambiguous (i.e.
    // dp[i][j-1] >= dp[i-1][j]).
    const reversed: WordDiffOp[] = [];
    let i = N;
    let j = M;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && aToks[i - 1] === bToks[j - 1]) {
            reversed.push({ kind: 'equal', text: aToks[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            reversed.push({ kind: 'insert', text: bToks[j - 1] });
            j--;
        } else {
            reversed.push({ kind: 'delete', text: aToks[i - 1] });
            i--;
        }
    }
    reversed.reverse();

    return coalesce(reversed);
}

function coalesce(ops: WordDiffOp[]): WordDiffOp[] {
    const out: WordDiffOp[] = [];
    for (const op of ops) {
        const last = out[out.length - 1];
        if (last && last.kind === op.kind) {
            last.text += op.text;
        } else {
            out.push({ ...op });
        }
    }
    return out;
}
