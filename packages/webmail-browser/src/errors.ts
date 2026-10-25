/** Ways a route can fail on the page. Each means the route no longer matches the webmail and may need relearning. */
export type RouteErrorCode =
    | 'target_not_found'
    | 'target_ambiguous'
    | 'state_not_reached'
    | 'extract_invalid'
    | 'recipients_mismatch'
    | 'cleanup_failed'
    | 'verification_failed';

/**
 * Where in an operation a failure happened: its steps, its test_end steps, or `start`, the return to a clean inbox
 * that comes before every operation.
 */
export type RoutePhase = 'steps' | 'test_end' | 'start';

export class RouteError extends Error {
    override readonly name = 'RouteError';
    constructor(
        readonly code: RouteErrorCode,
        readonly operation: string,
        /** Index in the operation's steps (or test_end steps when `phase` is `test_end`); -1 when not tied to a step. */
        readonly stepIndex: number,
        readonly detail: string,
        readonly phase: RoutePhase = 'steps',
        /**
         * What was on the page: the elements a target matched when it matched too many, or the nearest candidates
         * when it matched none. Each is a one-line description (tag, attributes, text, and the regions it is in).
         */
        readonly evidence: string[] = [],
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

/**
 * The route found the right element, but its text is not a value this package can read (for example a date in a
 * format the date reader does not know). Relearning cannot fix this: the steps are right, the reader is not.
 */
export class UnreadableValueError extends Error {
    override readonly name = 'UnreadableValueError';
    constructor(
        readonly operation: string,
        readonly field: string,
        readonly format: string,
        readonly text: string,
    ) {
        super(`${operation}: the ${field} field shows ${JSON.stringify(text)}, which is not a ${format} this service can read`);
    }
}
