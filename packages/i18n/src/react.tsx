import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { I18nextProvider, useTranslation, Trans } from 'react-i18next';
import type { i18n } from 'i18next';
import { isLocale, type Locale } from './locales.js';

export const I18nContext = createContext<i18n | null>(null);
export { Trans };

export function I18nProvider({ i18n, children }: { i18n: i18n; children: ReactNode }) {
  return (
    <I18nContext.Provider value={i18n}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </I18nContext.Provider>
  );
}

function useInstance(): i18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error('useT/useLocale used outside <I18nProvider>');
  return i18n;
}

export function useT(ns: string) {
  return useTranslation(ns, { i18n: useInstance() });
}

export function useLocale(): Locale {
  const { i18n } = useTranslation(undefined, { i18n: useInstance() });
  if (!isLocale(i18n.language)) throw new Error(`active language "${i18n.language}" is not a supported locale`);
  return i18n.language;
}

export function useSetLocale(): (l: Locale) => Promise<void> {
  const i18n = useInstance();
  return useCallback(async (l: Locale) => {
    await i18n.changeLanguage(l);
    document.documentElement.lang = l;
  }, [i18n]);
}
