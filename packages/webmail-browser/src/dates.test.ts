import { describe, expect, it } from 'vitest';
import { parseWebmailDate, type DateContext } from './dates.js';

// Monday 26 October 2026, 10:00 in London (GMT, UTC+0 after the clocks went back on the 25th).
const now = new Date('2026-10-26T10:00:00Z');
const gb: DateContext = { locale: 'en-GB', timeZone: 'Europe/London', now: () => now };
const us: DateContext = { locale: 'en-US', timeZone: 'America/New_York', now: () => now };

describe('parseWebmailDate', () => {
    it('reads day/month/year for a British locale, with or without a weekday', () => {
        expect(parseWebmailDate('Sun 25/10/2026 09:22', gb)).toBe('2026-10-25T09:22:00.000Z');
        expect(parseWebmailDate('25/10/2026 09:22', gb)).toBe('2026-10-25T09:22:00.000Z');
        expect(parseWebmailDate('25/10/2026', gb)).toBe('2026-10-24T23:00:00.000Z'); // midnight is still summer time
        expect(parseWebmailDate('Sat 24/10/2026 09:22', gb)).toBe('2026-10-24T08:22:00.000Z'); // British Summer Time
        expect(parseWebmailDate('24.10.26 9:22', gb)).toBe('2026-10-24T08:22:00.000Z');
    });

    it('reads month/day/year for a US locale', () => {
        expect(parseWebmailDate('Sat 10/24/2026 1:02 PM', us)).toBe('2026-10-24T17:02:00.000Z');
        expect(parseWebmailDate('10/24/2026', us)).toBe('2026-10-24T04:00:00.000Z');
    });

    it('reads a time alone as today', () => {
        expect(parseWebmailDate('09:22', gb)).toBe('2026-10-26T09:22:00.000Z');
        expect(parseWebmailDate('9:22 am', gb)).toBe('2026-10-26T09:22:00.000Z');
    });

    it('reads a weekday and time as the most recent such day before today', () => {
        expect(parseWebmailDate('Fri 14:05', gb)).toBe('2026-10-23T13:05:00.000Z');
        expect(parseWebmailDate('Sunday 18:30', gb)).toBe('2026-10-25T18:30:00.000Z');
        expect(parseWebmailDate('Mon 08:00', gb)).toBe('2026-10-19T07:00:00.000Z');
    });

    it('reads yesterday and today', () => {
        expect(parseWebmailDate('Yesterday 18:30', gb)).toBe('2026-10-25T18:30:00.000Z');
        expect(parseWebmailDate('Today 07:15', gb)).toBe('2026-10-26T07:15:00.000Z');
        expect(parseWebmailDate('Yesterday', gb)).toBe('2026-10-24T23:00:00.000Z');
    });

    it('reads month names, with or without a year', () => {
        expect(parseWebmailDate('Fri, Oct 24, 2026, 9:15 AM', gb)).toBe('2026-10-24T08:15:00.000Z');
        expect(parseWebmailDate('Fri, Oct 24, 2026, 9:15 AM', gb)).toBe('2026-10-24T08:15:00.000Z');
        expect(parseWebmailDate('24 October 2026 at 09:15', gb)).toBe('2026-10-24T08:15:00.000Z');
        expect(parseWebmailDate('Oct 24', gb)).toBe('2026-10-23T23:00:00.000Z');
        expect(parseWebmailDate('Dec 30', gb)).toBe('2025-12-30T00:00:00.000Z'); // no year and in the future: last year
    });

    it('reads month and weekday names in the account language', () => {
        const de: DateContext = { locale: 'de-DE', timeZone: 'Europe/Berlin', now: () => now };
        expect(parseWebmailDate('Sa., 24. Okt. 2026, 09:15', de)).toBe('2026-10-24T07:15:00.000Z');
        expect(parseWebmailDate('Gestern 18:30', de)).toBe('2026-10-25T17:30:00.000Z');
        expect(parseWebmailDate('24.10.2026 09:15', de)).toBe('2026-10-24T07:15:00.000Z');
    });

    it('reads ISO timestamps as they are', () => {
        expect(parseWebmailDate('2026-10-24T09:15:00+02:00', gb)).toBe('2026-10-24T07:15:00.000Z');
    });

    it('returns null for anything else', () => {
        for (const text of ['', 'soon', '31/02/2026', '25/13/2026', '25:99', 'Fri', 'Quarterly numbers', '13/25/2026 10:00']) {
            expect(parseWebmailDate(text, gb), text).toBeNull();
        }
    });
});
