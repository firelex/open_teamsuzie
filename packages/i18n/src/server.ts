import { createI18n, type Resources } from './core.js';
import { SUPPORTED_LOCALES, type Locale } from './locales.js';

export type { Resources } from './core.js';
export { detectLocale, isLocale, SUPPORTED_LOCALES, type Locale } from './locales.js';
export { formatDate, formatDateTime, formatNumber, formatMoney, currencyMinorDigits } from './format.js';

/** Translator for server code: one instance per locale, keys written "<namespace>.<path>". */
export function createServerI18n(resources: Resources) {
  const byLocale = Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, createI18n({ resources, lng: l })])) as Record<
    Locale,
    ReturnType<typeof createI18n>
  >;
  return {
    t(locale: Locale, key: string, vars?: Record<string, unknown>): string {
      const dot = key.indexOf('.');
      if (dot <= 0) throw new Error(`translation key "${key}" has no namespace (expected "<namespace>.<key>")`);
      const ns = key.slice(0, dot);
      const path = key.slice(dot + 1);
      const instance = byLocale[locale];
      // i18next's t() call (below) already triggers the missingKeyHandler log as a side
      // effect when the key is absent. exists() then tells us, unambiguously, whether to
      // hand back that translation or the full "<ns>.<path>" key the caller passed in,
      // since t() on a missing key otherwise returns only the bare path, not the full key.
      const translated = instance.t(path, { ns, ...vars });
      return instance.exists(path, { ns }) ? translated : key;
    },
  };
}
