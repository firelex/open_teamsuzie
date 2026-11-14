export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The first supported locale in an Accept-Language header or a navigator.languages
 * list, matched on the primary subtag (de-CH → de). Null when none is supported:
 * the caller decides what that means.
 */
export function detectLocale(input: string | readonly string[]): Locale | null {
  const ranked: string[] = typeof input === 'string' ? rankHeader(input) : [...input];
  for (const tag of ranked) {
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

function rankHeader(header: string): string[] {
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag, q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((x) => x.tag);
}
