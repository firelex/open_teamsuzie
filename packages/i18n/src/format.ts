import type { Locale } from './locales.js';

const TAG: Record<Locale, string> = { en: 'en-US', de: 'de-DE', fr: 'fr-FR' };

export function formatDate(d: Date | number, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG[locale], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}
export function formatDateTime(d: Date | number, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(TAG[locale]).format(n);
}
/**
 * How many digits a currency's minor unit has (2 for EUR/USD, 0 for JPY, 3 for KWD — never
 * assumed to be 2). Throws rather than guessing when Intl can't resolve it for the given currency
 * code, so a typo'd or unsupported currency fails loudly instead of silently defaulting.
 */
export function currencyMinorDigits(currency: string): number {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) {
    throw new Error(`currencyMinorDigits: could not resolve the minor-unit digits for currency "${currency}"`);
  }
  return digits;
}

/**
 * Money held as an integer in the currency's minor unit (cents for EUR/USD, no decimals for JPY,
 * three decimals for KWD — never assumed to be 100). Pass `{ wholeUnits: true }` to drop the
 * fractional part of the display regardless of the currency's usual precision (e.g. a round price
 * like "€7,500" rather than "€7,500.00").
 */
export function formatMoney(minor: number, currency: string, locale: Locale, opts?: { wholeUnits?: boolean }): string {
  const amount = minor / 10 ** currencyMinorDigits(currency);
  const options: Intl.NumberFormatOptions = { style: 'currency', currency };
  if (opts?.wholeUnits) {
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = 0;
  }
  return new Intl.NumberFormat(TAG[locale], options).format(amount);
}
