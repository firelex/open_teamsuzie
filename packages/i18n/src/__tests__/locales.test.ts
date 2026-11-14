import { describe, expect, it } from 'vitest';
import { detectLocale, isLocale } from '../locales.js';

describe('detectLocale', () => {
  it('matches an Accept-Language header by primary subtag, in preference order', () => {
    expect(detectLocale('de-CH,de;q=0.9,en;q=0.8')).toBe('de');
    expect(detectLocale('ja-JP,fr;q=0.8,en;q=0.5')).toBe('fr');
  });
  it('matches navigator.languages', () => {
    expect(detectLocale(['fr-BE', 'en-US'])).toBe('fr');
  });
  it('honours q-values rather than header order', () => {
    expect(detectLocale('en;q=0.3,de;q=0.9')).toBe('de');
  });
  it('matches Spanish and Italian regional tags by primary subtag', () => {
    expect(detectLocale('es-MX,en;q=0.5')).toBe('es');
    expect(detectLocale('it-CH,en;q=0.5')).toBe('it');
  });
  it('matches both Brazilian and European Portuguese tags to the single "pt" locale', () => {
    expect(detectLocale('pt-BR,en;q=0.5')).toBe('pt');
    expect(detectLocale('pt-PT,en;q=0.5')).toBe('pt');
  });
  it('returns null when nothing is supported', () => {
    expect(detectLocale('ja-JP,ko;q=0.8')).toBeNull();
    expect(detectLocale([])).toBeNull();
    expect(detectLocale('')).toBeNull();
  });
});

describe('isLocale', () => {
  it('accepts only the six supported codes', () => {
    expect(isLocale('de')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('it')).toBe(true);
    expect(isLocale('pt')).toBe(true);
    expect(isLocale('de-DE')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
