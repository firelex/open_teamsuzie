import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createI18n, I18nProvider } from '@teamsuzie/i18n';
import { uiResources, useUiT } from './i18n.js';

function Probe() {
  const { t } = useUiT();
  return <span>{t('common.cancel')}</span>;
}

describe('useUiT', () => {
  it('uses English when the app mounts no I18nProvider', () => {
    render(<Probe />);
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
  it('uses the app provider when one is mounted', () => {
    // German supplied inline: the generated de/ui.json is only filled by Task 5.
    const i18n = createI18n({ resources: { ...uiResources, de: { ui: { common: { cancel: 'Abbrechen' } } } }, lng: 'de' });
    render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>);
    expect(screen.getByText('Abbrechen')).toBeTruthy();
  });
});
