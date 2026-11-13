import { describe, expect, it, vi } from 'vitest';
import { createServerI18n } from '../server.js';

const resources = {
  en: { errors: { forbidden: 'Only an admin can do that.', hold: 'Matter {{name}} is on hold.' } },
  de: { errors: { forbidden: 'Das darf nur ein Administrator.', hold: 'Für das Mandat {{name}} gilt eine Aufbewahrungspflicht.' } },
  fr: { errors: { forbidden: 'Seul un administrateur peut le faire.' } },
};

describe('createServerI18n', () => {
  const { t } = createServerI18n(resources);
  it('translates per call, with variables, without sharing state between locales', () => {
    expect(t('de', 'errors.hold', { name: 'Acme' })).toBe('Für das Mandat Acme gilt eine Aufbewahrungspflicht.');
    expect(t('en', 'errors.forbidden')).toBe('Only an admin can do that.');
    expect(t('fr', 'errors.forbidden')).toBe('Seul un administrateur peut le faire.');
  });
  it('logs and returns the key when missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(t('fr', 'errors.hold', { name: 'Acme' })).toBe('errors.hold');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('missing translation: fr/errors.hold'));
    spy.mockRestore();
  });
  it('rejects a key without a namespace', () => {
    expect(() => t('en', 'forbidden')).toThrow(/namespace/);
  });
});
