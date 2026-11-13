import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createI18n } from '../core.js';
import { I18nProvider, useSetLocale, useT } from '../react.js';

afterEach(() => {
  cleanup();
  document.documentElement.lang = '';
});

const resources = {
  en: { common: { save: 'Save', items_one: '{{count}} item', items_other: '{{count}} items' } },
  de: { common: { save: 'Speichern', items_one: '{{count}} Element', items_other: '{{count}} Elemente' } },
  fr: { common: { save: 'Enregistrer' } },
};

function SaveLabel() {
  const { t } = useT('common');
  return <span>{t('save')}</span>;
}

function SaveLabelWithLocaleSwitch() {
  const { t } = useT('common');
  const setLocale = useSetLocale();
  return (
    <div>
      <span>{t('save')}</span>
      <button onClick={() => setLocale('fr')}>switch to fr</button>
    </div>
  );
}

describe('I18nProvider / useT', () => {
  it('renders the translation for the active locale', () => {
    const i18n = createI18n({ resources, lng: 'de', defaultNS: 'common' });
    render(
      <I18nProvider i18n={i18n}>
        <SaveLabel />
      </I18nProvider>,
    );
    expect(screen.getByText('Speichern')).toBeTruthy();
  });

  it('useSetLocale re-renders with the new locale and sets document.documentElement.lang', async () => {
    const i18n = createI18n({ resources, lng: 'de', defaultNS: 'common' });
    render(
      <I18nProvider i18n={i18n}>
        <SaveLabelWithLocaleSwitch />
      </I18nProvider>,
    );
    expect(screen.getByText('Speichern')).toBeTruthy();

    await act(async () => {
      screen.getByRole('button', { name: 'switch to fr' }).click();
    });

    expect(screen.getByText('Enregistrer')).toBeTruthy();
    expect(document.documentElement.lang).toBe('fr');
  });

  it('useT throws outside <I18nProvider>', () => {
    const renderOutsideProvider = () => render(<SaveLabel />);
    expect(renderOutsideProvider).toThrow(/outside <I18nProvider>/);
  });
});
