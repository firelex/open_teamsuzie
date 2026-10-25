/** The only job values a route may refer to. */
export const PLACEHOLDERS = [
    '$draft.to',
    '$draft.cc',
    '$draft.bcc',
    '$draft.subject',
    '$draft.body',
    '$query',
    '$message_id',
    '$thread_id',
    '$account',
] as const;

export type PlaceholderName = typeof PLACEHOLDERS[number];

/** Values for an operation's placeholders. */
export type Params = Partial<Record<PlaceholderName, string>>;

const PLACEHOLDER_PATTERN = /\$[a-z_]+(?:\.[a-z_]+)?/g;

/** Every `$name` or `$name.part` in `text`, known or not. */
export function findPlaceholders(text: string): string[] {
    return text.match(PLACEHOLDER_PATTERN) ?? [];
}

export function isPlaceholder(name: string): name is PlaceholderName {
    return (PLACEHOLDERS as readonly string[]).includes(name);
}

export type PlaceholderEncoding = 'none' | 'url' | 'css';

/**
 * Replace each placeholder in `text` with its value. `url` encodes the value for a URL path or fragment; `css`
 * escapes it for use inside a quoted CSS attribute value. A placeholder with no value throws.
 */
export function substitute(text: string, params: Params, encoding: PlaceholderEncoding): string {
    return text.replace(PLACEHOLDER_PATTERN, (name) => {
        if (!isPlaceholder(name)) throw new Error(`Unknown placeholder ${name}`);
        const value = params[name];
        if (value === undefined) throw new Error(`No value for placeholder ${name}`);
        if (encoding === 'url') return encodeURIComponent(value);
        if (encoding === 'css') return value.replace(/["\\]/g, (ch) => `\\${ch}`).replace(/\n/g, '\\a ');
        return value;
    });
}
