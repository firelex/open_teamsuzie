# @teamsuzie/deadlines

Deadlines and key dates per subject (e.g. a matter): a calendar date with an optional local time, a kind, notes,
the source it came from (document, word-for-word quote, whether the date was worked out), reminder lead times, and a
status (open, done, dismissed).

- `upcoming(until, subjects?)` and `remindersFor(today, subjects?)` (due, overdue, or inside a reminder window).
- `toIcs(deadlines, { calendarName, productId })`: iCalendar with all-day or timed events and an alarm per reminder.
- Dates are plain `YYYY-MM-DD` strings; there is no time-zone arithmetic.
