import { afterEach, describe, expect, it } from 'vitest';
import { currencyMinorDigits, formatCalendarDate, formatDate, formatMoney, formatNumber } from '../format.js';

const d = new Date(Date.UTC(2026, 10, 13, 12));

describe('formatters', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('formats a timestamp in the viewer\'s local time zone, not forced to UTC', () => {
    // 2026-11-13T12:00:00Z is still the 13th everywhere reasonable, so pick a timestamp
    // near midnight UTC where the local calendar day actually differs by time zone.
    const nearMidnight = new Date(Date.UTC(2026, 10, 13, 3)); // 03:00 UTC
    process.env.TZ = 'America/Los_Angeles'; // UTC-8 in November: still the 12th locally
    expect(formatDate(nearMidnight, 'en')).toBe('Nov 12, 2026');
    process.env.TZ = 'Asia/Tokyo'; // UTC+9: already the 13th locally
    expect(formatDate(nearMidnight, 'en')).toBe('Nov 13, 2026');
  });

  it('formats dates per locale in a fixed UTC zone for the assertions below', () => {
    process.env.TZ = 'UTC';
    expect(formatDate(d, 'en')).toBe('Nov 13, 2026');
    expect(formatDate(d, 'de')).toBe('13. Nov. 2026');
    expect(formatDate(d, 'fr')).toBe('13 nov. 2026');
  });

  it('formatCalendarDate renders a date-only value the same everywhere, regardless of the viewer\'s time zone', () => {
    const calendarDate = new Date('2026-11-13'); // midnight UTC, the ISO date-only convention
    process.env.TZ = 'America/Los_Angeles';
    expect(formatCalendarDate(calendarDate, 'en')).toBe('Nov 13, 2026');
    process.env.TZ = 'Asia/Tokyo';
    expect(formatCalendarDate(calendarDate, 'en')).toBe('Nov 13, 2026');
    expect(formatCalendarDate(calendarDate, 'de')).toBe('13. Nov. 2026');
    expect(formatCalendarDate(calendarDate, 'fr')).toBe('13 nov. 2026');
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
  it('currencyMinorDigits exposes the same lookup formatMoney uses internally', () => {
    expect(currencyMinorDigits('EUR')).toBe(2);
    expect(currencyMinorDigits('JPY')).toBe(0);
    expect(currencyMinorDigits('KWD')).toBe(3);
    expect(() => currencyMinorDigits('not-a-currency')).toThrow();
  });
});
