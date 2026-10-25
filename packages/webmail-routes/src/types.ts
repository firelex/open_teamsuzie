/** The webmail providers a route can describe. */
export type ProviderKey = 'gmail' | 'outlook';

export const PROVIDER_KEYS: readonly ProviderKey[] = ['gmail', 'outlook'];

/** Every operation a route must define. */
export const OPERATION_NAMES = [
    'read_account',
    'list_inbox',
    'open_message',
    'read_thread',
    'search',
    'compose_send',
    'reply',
    'check_sent',
] as const;

export type OperationName = typeof OPERATION_NAMES[number];

/**
 * One element on the page. `role` (+ `name` or `name_pattern`) is an accessibility locator; `css` is for elements
 * with no accessible name. `within` scopes the search to a named state's `container`; `has` keeps only elements that
 * contain a match for another target. A target must match exactly one visible element unless `each` is true.
 */
export interface Target {
    role?: string;
    name?: string;
    /** Case-insensitive regular expression matched against the accessible name. */
    name_pattern?: string;
    css?: string;
    within?: string;
    has?: Target;
    each?: boolean;
}

/** A named condition on the page: a URL pattern and/or elements that must be visible. */
export interface PageState {
    /** Regular expression matched against the full URL. */
    url_matches?: string;
    visible: Target[];
    /** The element that `within: <this state>` scopes to. */
    container?: Target;
}

/** Where a field's value comes from: the element's text, its accessible name, or one attribute. */
export type FieldSource = 'text' | 'name' | `attr:${string}`;

export type FieldFormat = 'email' | 'emails' | 'date' | 'nonempty' | 'id' | 'text' | 'flag';

export interface FieldSpec {
    /** Relative to the item (for lists) or the page. Omitted: the item itself. */
    target?: Target;
    from: FieldSource;
    /** Regular expression with exactly one capture group; the value is the captured text. */
    pattern?: string;
    format: FieldFormat;
    required: boolean;
}

export interface ExtractSpec {
    /** When set, one record per matching element; the target must have `each: true`. */
    items?: Target;
    fields: Record<string, FieldSpec>;
}

export interface RecipientCheck {
    /** The recipient chips, one element per address. Each target must have `each: true`. */
    to: Target;
    cc?: Target;
    bcc?: Target;
    from: FieldSource;
}

export type Step =
    | { goto: string; expect?: string }
    | { click: Target; commits?: boolean; expect?: string }
    | { fill: Target; value: string; expect?: string }
    | { type: Target; value: string; each_address?: boolean; then_press?: string; expect?: string }
    | { press: string; commits?: boolean; expect?: string }
    | { scroll: Target | 'page' }
    | { wait_for: string }
    | { extract: ExtractSpec; as: string }
    | { verify_recipients: RecipientCheck };

export const STEP_ACTIONS = ['goto', 'click', 'fill', 'type', 'press', 'scroll', 'wait_for', 'extract', 'verify_recipients'] as const;

export type StepAction = typeof STEP_ACTIONS[number];

export interface Operation {
    steps: Step[];
    /** Runs instead of the commit step in test mode (e.g. discard the draft). Required when a step commits. */
    test_end?: Step[];
}

export interface Route {
    schema_version: 1;
    provider: ProviderKey;
    /** `YYYY-MM-DD.N`. */
    route_version: string;
    /** `seed`, or `learner:<model id>`. */
    learned_by: string;
    learned_at: string;
    /** Hosts the webmail is served from. `goto` may only visit these. */
    domains: string[];
    /** Hosts of the provider's sign-in pages. Landing on one means the account must sign in again. */
    login_domains: string[];
    home_url: string;
    /** Hash of the inbox layout, set when the route is learned. */
    fingerprint: string | null;
    states: Record<string, PageState>;
    operations: Record<OperationName, Operation>;
}

export function stepAction(step: Step): StepAction {
    const keys = Object.keys(step).filter((key) => (STEP_ACTIONS as readonly string[]).includes(key));
    if (keys.length !== 1) throw new Error(`A step must have exactly one action, found: ${keys.join(', ') || 'none'}`);
    return keys[0] as StepAction;
}
