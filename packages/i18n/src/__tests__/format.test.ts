import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatNumber } from '../format.js';

const d = new Date(Date.UTC(2026, 10, 13, 12));
describe('formatters', () => {
  it('formats dates per locale', () => {
    expect(formatDate(d, 'en')).toBe('Nov 13, 2026');
    expect(formatDate(d, 'de')).toBe('13. Nov. 2026');
    expect(formatDate(d, 'fr')).toBe('13 nov. 2026');
  });
  it('formats numbers and money per locale', () => {
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
    // Intl may render the amount/currency-symbol gap as a narrow no-break space (U+202F)
    // rather than a plain space, depending on the ICU data bundled with this Node version.
    // Normalise whitespace on both sides rather than changing the formatter.
    expect(formatMoney(14900, 'EUR', 'de').replace(/\s/g, ' ')).toBe('149,00 €'.replace(/\s/g, ' '));
    expect(formatMoney(14900, 'EUR', 'en').replace(/\s/g, ' ')).toBe('€149.00'.replace(/\s/g, ' '));
  });
  it('uses the currency\'s own minor-unit digits, not a fixed 100', () => {
    // JPY has no minor unit (digits = 0): 1500 minor units is already 1500 yen.
    expect(formatMoney(1500, 'JPY', 'en').replace(/\s/g, ' ')).toBe('¥1,500');
    // KWD has three minor-unit digits: 1500 fils is 1.500 dinars.
    expect(formatMoney(1500, 'KWD', 'en').replace(/\s/g, ' ')).toMatch(/1\.500/);
  });
  it('wholeUnits drops the fractional part regardless of the currency\'s usual precision', () => {
    expect(formatMoney(750000, 'EUR', 'en', { wholeUnits: true }).replace(/\s/g, ' ')).toBe('€7,500');
    expect(formatMoney(750000, 'EUR', 'de', { wholeUnits: true }).replace(/\s/g, ' ')).toBe('7.500 €'.replace(/\s/g, ' '));
  });
});
