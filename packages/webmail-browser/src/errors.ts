/** Ways a route can fail on the page. Each means the route no longer matches the webmail and may need relearning. */
export type RouteErrorCode =
    | 'target_not_found'
    | 'target_ambiguous'
    | 'state_not_reached'
    | 'extract_invalid'
    | 'recipients_mismatch';

export class RouteError extends Error {
    override readonly name = 'RouteError';
    constructor(
        readonly code: RouteErrorCode,
        readonly operation: string,
        /** Index in the operation's steps (or test_end steps when `phase` is `test_end`); -1 when not tied to a step. */
        readonly stepIndex: number,
        readonly detail: string,
        readonly phase: 'steps' | 'test_end' = 'steps',
    ) {
        super(`${operation} ${phase}[${stepIndex}]: ${code}: ${detail}`);
    }
}

/** The page is on the provider's sign-in page: the account must sign in again. Not a route problem. */
export class NeedsLoginError extends Error {
    override readonly name = 'NeedsLoginError';
}

/** The page could not be loaded (network error or navigation timeout). Not a route problem. */
export class NavigationError extends Error {
    override readonly name = 'NavigationError';
}
