import { describe, expect, it } from 'vitest';
import { detectLocale, isLocale } from '../locales.js';

describe('detectLocale', () => {
  it('matches an Accept-Language header by primary subtag, in preference order', () => {
    expect(detectLocale('de-CH,de;q=0.9,en;q=0.8')).toBe('de');
    expect(detectLocale('es-ES,fr;q=0.8,en;q=0.5')).toBe('fr');
  });
  it('matches navigator.languages', () => {
    expect(detectLocale(['fr-BE', 'en-US'])).toBe('fr');
  });
  it('honours q-values rather than header order', () => {
    expect(detectLocale('en;q=0.3,de;q=0.9')).toBe('de');
  });
  it('returns null when nothing is supported', () => {
    expect(detectLocale('es-ES,ja;q=0.8')).toBeNull();
    expect(detectLocale([])).toBeNull();
    expect(detectLocale('')).toBeNull();
  });
});

describe('isLocale', () => {
  it('accepts only the three supported codes', () => {
    expect(isLocale('de')).toBe(true);
    expect(isLocale('de-DE')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
