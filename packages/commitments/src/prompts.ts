import { readFileSync } from 'node:fs';

/**
 * The instruction texts, one plain-text file each under prompts/, as in
 * Jeff Desk (jeff_desk/prompts): `[[include area/name]]` takes in another
 * prompt, `{name}` is filled in by `fill`, and a literal brace is written
 * twice. Every file ends with a line break, which is not part of the text.
 */

const INCLUDE = /\[\[include ([\w/]+)\]\]/g;
const cache = new Map<string, string>();

export function prompt(name: string): string {
    const kept = cache.get(name);
    if (kept !== undefined) return kept;
    const url = new URL(`./prompts/${name}.txt`, import.meta.url);
    let text: string;
    try {
        text = readFileSync(url, 'utf-8');
    } catch (err) {
        throw new Error(`there is no prompt ${name} (${url.pathname}): ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!text.endsWith('\n')) throw new Error(`${url.pathname} does not end with a line break; every prompt file does`);
    const out = text.slice(0, -1).replace(INCLUDE, (_m, inner: string) => prompt(inner));
    cache.set(name, out);
    return out;
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
