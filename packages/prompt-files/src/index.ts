import { readFileSync } from 'node:fs';

/**
 * Prompts kept as plain-text files, one per prompt, grouped in folders by
 * area, as in Jeff Desk (jeff_desk/prompts): `[[include area/name]]` takes
 * in another prompt, `{name}` placeholders are filled by `fill`, and a
 * literal brace is written twice. Every file ends with a line break, which
 * is not part of the text.
 *
 *     const prompt = promptLoader(new URL('./prompts/', import.meta.url));
 *     fill(prompt('triage/classify'), { account, about, ... });
 */

const INCLUDE = /\[\[include ([\w/-]+)\]\]/g;

/** A loader for the prompt files under `folder` (a file URL ending in a slash). Texts are read once and kept. */
export function promptLoader(folder: URL): (name: string) => string {
    if (!folder.href.endsWith('/')) throw new Error(`the prompts folder URL must end with a slash: ${folder.href}`);
    const cache = new Map<string, string>();
    const load = (name: string, chain: string[]): string => {
        if (chain.includes(name)) throw new Error(`prompt ${name} includes itself (${[...chain, name].join(' > ')})`);
        const kept = cache.get(name);
        if (kept !== undefined) return kept;
        const url = new URL(`${name}.txt`, folder);
        let text: string;
        try {
            text = readFileSync(url, 'utf-8');
        } catch (err) {
            throw new Error(`there is no prompt ${name} (${url.pathname}): ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!text.endsWith('\n')) throw new Error(`${url.pathname} does not end with a line break; every prompt file does`);
        const out = text.slice(0, -1).replace(INCLUDE, (_m, inner: string) => load(inner, [...chain, name]));
        cache.set(name, out);
        return out;
    };
    return (name) => load(name, []);
}

/** Fill `{name}` placeholders (Python str.format rules: `{{` and `}}` are literal braces). Every placeholder must be given. */
export function fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, key: string | undefined) => {
        if (m === '{{') return '{';
        if (m === '}}') return '}';
        if (!(key! in values)) throw new Error(`the prompt needs a value for {${key}}`);
        return values[key!]!;
    });
}
