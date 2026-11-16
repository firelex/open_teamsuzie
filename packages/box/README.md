# @teamsuzie/box

Box for Team Suzie apps, read only. `auth.ts` signs a user in with the firm's Box app (a "Custom App" with user
authentication, OAuth 2.0, in the Box developer console): `authorizationUrl` asks for `BOX_READONLY_SCOPE`
(`root_readonly`, "Read all files and folders stored in Box") unless it is given other scopes, `exchangeCode` turns
the code Box sends back into tokens, `refreshAccessToken` renews the access token and `revokeToken` ends the
connection. Box has no PKCE, so the caller checks the `state` it sent. Box gives a new refresh token with every token
answer and the one used stops working: the caller stores `refreshToken` each time, and must not refresh twice at once
with the same token. `BoxAuthError` means Box no longer accepts the refresh token (revoked, already used, or unused
for 60 days): the user signs in again.

`BoxFiles` reads the user's Box: a folder's folders, files and bookmarks (`children('0')` is the top), a search for
files, one file, the signed-in user (`me`, their address in `login`) and a file's bytes. It is handed a function that
returns a current access token and never stores tokens. A file's size is known before downloading it, and `download`
refuses a file larger than the caller allows before fetching anything (`BoxFileError` `too_large`, checked again while
reading), a folder or bookmark (`not_a_file`), a Box Note or Box Canvas, which exist only in Box
(`not_downloadable`, `BOX_NATIVE_EXTENSIONS`), and a file Box is still preparing (`not_ready`). Box answers a
download with a redirect to a short-lived address, which `download` follows without the access token; it is meant
for a server. Box's error answers are `BoxApiError`, with Box's status and error code (`rateLimited`,
`insufficientScope`). Each item carries its address in Box (`https://app.box.com/file/<id>`) for a person to open.
