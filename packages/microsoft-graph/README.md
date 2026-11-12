# @teamsuzie/microsoft-graph

Microsoft 365 through Microsoft Graph, as the signed-in user, with delegated permissions of an app registered in the
user's Microsoft Entra tenant. Ported from Jeff Desk (`jeff_desk/microsoft.py`, `tools/teams.py`,
`tools/outlook_calendar.py`, `chat_alerts.TeamsChannel`).

- **Sign-in:** `authorizationUrl` + `exchangeCode` (authorization code with PKCE, public client, no secret). The app
  registration needs the platform "Mobile and desktop applications" with the host's redirect URI. Scopes:
  `MICROSOFT_SCOPES` (mail, calendar, Teams chats), plus `MICROSOFT_FILE_SCOPES` for SharePoint and OneDrive.
- **`GraphSession`:** access tokens refreshed on demand (one refresh at a time); Microsoft may rotate the refresh
  token, which is handed to the host's `saveRefreshToken`. Errors are `GraphError` with Graph's own message
  (`needs_login`, `throttled`, `refused`, `not_found`, ...); nothing is retried silently.
- **`OutlookMailClient`:** an `@teamsuzie/email` `EmailClient` (list, read, thread, send, reply, forward), plus
  `between(folder, from, to)` with each email's people. Errors map to the email package's (`EmailAuthError`, ...).
  Sends go out at once: hosts put them behind their approvals.
- **`OutlookCalendar.events(start, end)`** and **`TeamsChats`** (`chats`, `messages`, the user's own messages marked):
  read only.
