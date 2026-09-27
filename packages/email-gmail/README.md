# @teamsuzie/email-gmail

Gmail for `@teamsuzie/email`. `auth.ts` signs a user in with Google (PKCE), refreshes and revokes tokens.
`GmailClient` implements `EmailClient` over the Gmail REST API; it is handed a function that returns a
current access token and never stores tokens. Label ids are turned into names on the way in and back on
the way out. Errors: `EmailAuthError` when Google refuses the sign-in, `EmailCursorExpiredError` when a
history id is too old.
