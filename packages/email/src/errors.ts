/** The provider no longer accepts the account's sign-in (revoked, expired, changed password). The user must sign in again. */
export class EmailAuthError extends Error {
    override readonly name = 'EmailAuthError';
}

/** The sync cursor is older than the provider keeps history for. The host must import afresh. */
export class EmailCursorExpiredError extends Error {
    override readonly name = 'EmailCursorExpiredError';
}
