# @teamsuzie/email-gmail

Gmail for `@teamsuzie/email`. `auth.ts` signs a user in with Google (PKCE), refreshes and revokes tokens;
`authorizationUrl` asks for `GMAIL_SCOPES` unless it is given other scopes (add
`GOOGLE_CALENDAR_READONLY_SCOPE` to read the calendar too).
`GmailClient` implements `EmailClient` over the Gmail REST API; it is handed a function that returns a
current access token and never stores tokens. Label ids are turned into names on the way in and back on
the way out; `findMessages` reads the messages matching a Gmail search. Errors: `EmailAuthError` when Google
refuses the sign-in, `EmailCursorExpiredError` when a history id is too old, `EmailRateLimitError` when Gmail
asks to slow down, `GmailHttpError` for any other error answer.

`GoogleCalendar` reads the user's primary Google calendar, read only: the events overlapping a time range,
recurring ones as single occurrences, in the same terms as `@teamsuzie/microsoft-graph`'s `CalendarEvent`.
It throws `GoogleApiError` (with Google's status and reason codes) when Google answers with an error.
