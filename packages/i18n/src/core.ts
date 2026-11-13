import i18next, { type i18n } from 'i18next';
import type { Locale } from './locales.js';

export type Resources = Record<Locale, Record<string, Record<string, unknown>>>;

/** An i18next instance with no fallback language; a missing key is logged and shown as the key. */
export function createI18n(opts: { resources: Resources; lng: Locale; defaultNS?: string }): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    resources: opts.resources,
    lng: opts.lng,
    defaultNS: opts.defaultNS,
    ns: Object.keys(opts.resources.en),
    fallbackLng: false,
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
    saveMissing: true,
    missingKeyHandler: (lngs, ns, key) => {
      console.error(`missing translation: ${lngs.join(',')}/${ns}.${key}`);
    },
  });
  return instance;
}
