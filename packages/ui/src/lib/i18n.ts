import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { createI18n, I18nContext, type Resources } from '@teamsuzie/i18n';
import en from '../locales/en/ui.json' with { type: 'json' };
import de from '../locales/de/ui.json' with { type: 'json' };
import fr from '../locales/fr/ui.json' with { type: 'json' };

export const uiResources: Resources = { en: { ui: en }, de: { ui: de }, fr: { ui: fr } };

// Apps that have not adopted translation mount no I18nProvider; for them the shared
// components stay English (a documented default, decided 2026-11-13 — see the
// @teamsuzie/i18n README). Inside a provider, missing keys log and show the key.
let englishOnly: ReturnType<typeof createI18n> | null = null;

export function useUiT() {
  const appInstance = useContext(I18nContext);
  englishOnly ??= createI18n({ resources: uiResources, lng: 'en' });
  return useTranslation('ui', { i18n: appInstance ?? englishOnly });
}
