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
/** Money held as integer cents. */
export function formatMoney(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(TAG[locale], { style: 'currency', currency }).format(cents / 100);
}
