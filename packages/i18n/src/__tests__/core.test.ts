import { describe, expect, it, vi } from 'vitest';
import { createI18n } from '../core.js';

const resources = {
  en: { common: { save: 'Save', items_one: '{{count}} item', items_other: '{{count}} items' } },
  de: { common: { save: 'Speichern', items_one: '{{count}} Element', items_other: '{{count}} Elemente' } },
  fr: { common: { save: 'Enregistrer' } },
};

describe('createI18n', () => {
  it('translates and pluralises in the chosen locale', () => {
    const i18n = createI18n({ resources, lng: 'de', defaultNS: 'common' });
    expect(i18n.t('save')).toBe('Speichern');
    expect(i18n.t('items', { count: 3 })).toBe('3 Elemente');
  });
  it('has no fallback: a key missing in fr shows the key and logs an error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const i18n = createI18n({ resources, lng: 'fr', defaultNS: 'common' });
    expect(i18n.t('items', { count: 2 })).toBe('items');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('missing translation: fr/common.items'));
    spy.mockRestore();
  });
});
