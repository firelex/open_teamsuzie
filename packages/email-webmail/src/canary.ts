import { RouteError, UnreadableValueError, type ExtractedRecord } from '@teamsuzie/webmail-browser';
import { OPERATION_NAMES, type OperationName, type Params } from '@teamsuzie/webmail-routes';
import { checkOutput, type WebmailEmailClient } from './client.js';
import { TEST_DRAFT_MARKER } from './goals.js';

export interface CanaryResult {
    operation: OperationName;
    /**
     * passed; failed with a route error; unreadable when the route worked but a value (such as a date) could not be
     * read, which relearning cannot fix; or skipped because an operation it needs input from failed or the inbox is empty.
     */
    outcome: 'passed' | 'failed' | 'unreadable' | 'skipped';
    error?: { code: string; message: string };
    reason?: string;
}

// Short, so test runs have little to type; "Route check" makes any draft a failed test leaves easy to find.
export const CANARY_SUBJECT = 'Route check';
const CANARY_BODY = TEST_DRAFT_MARKER;

/**
 * Run operations in test mode against the live account: nothing is sent, every draft is discarded. Route errors are
 * reported per operation; sign-out and page-load errors are thrown, since they say nothing about the route.
 */
export async function runCanary(client: WebmailEmailClient, only?: OperationName[]): Promise<CanaryResult[]> {
    const wanted = new Set(only ?? OPERATION_NAMES);
    const results: CanaryResult[] = [];
    let first: ExtractedRecord | null = null;
    let inboxReadable = true;

    // The inbox listing supplies the message ids, sender and subject the other operations are tested with.
    const needsInbox = (['list_inbox', 'open_message', 'read_thread', 'search', 'reply'] as OperationName[]).some((op) => wanted.has(op));
    if (needsInbox) {
        const listing = await attempt('list_inbox', {});
        if (wanted.has('list_inbox')) results.push(listing.result);
        if (listing.records) first = listing.records[0] ?? null;
        else inboxReadable = false;
    }

    // The list of leftover test drafts supplies the draft discard_draft is tested on (in test mode it is kept).
    let draft: ExtractedRecord | null = null;
    let draftsReadable = true;
    if (wanted.has('list_test_drafts') || wanted.has('discard_draft')) {
        const listing = await attempt('list_test_drafts', { $marker: TEST_DRAFT_MARKER });
        if (wanted.has('list_test_drafts')) results.push(listing.result);
        if (listing.records) draft = listing.records[0] ?? null;
        else draftsReadable = false;
    }

    for (const operation of OPERATION_NAMES) {
        if (operation === 'list_inbox' || operation === 'list_test_drafts' || !wanted.has(operation)) continue;
        const params = paramsFor(operation, first, draft, client.account.address);
        if (params === null) {
            const reason = operation === 'discard_draft'
                ? (draftsReadable ? 'there are no leftover test drafts to check it on' : 'list_test_drafts failed, so there is no draft to test with')
                : (inboxReadable ? 'the inbox is empty' : 'list_inbox failed, so there is no message to test with');
            results.push({ operation, outcome: 'skipped', reason });
            continue;
        }
        results.push((await attempt(operation, params)).result);
    }
    return results;

    async function attempt(operation: OperationName, params: Params): Promise<{ result: CanaryResult; records: ExtractedRecord[] | null }> {
        try {
            const result = await client.testOperation(operation, params);
            checkOutput(operation, result);
            const records = operation === 'list_inbox' || operation === 'list_test_drafts' ? result.extracted.messages as ExtractedRecord[] : null;
            return { result: { operation, outcome: 'passed' }, records };
        } catch (error) {
            if (error instanceof RouteError) {
                return { result: { operation, outcome: 'failed', error: { code: error.code, message: withEvidence(error) } }, records: null };
            }
            if (error instanceof UnreadableValueError) {
                return { result: { operation, outcome: 'unreadable', error: { code: 'unreadable_value', message: error.message } }, records: null };
            }
            throw error;
        }
    }
}

export interface TestParams {
    params: Partial<Record<OperationName, Params>>;
    /**
     * The same operations' parameters for a second, different message (another subject and sender where the inbox
     * has one), so a repair can be checked to work for any message, not only the one it was tested on.
     */
    alternate: Partial<Record<OperationName, Params>>;
    /** Why the inbox could not be listed, when it could not; operations that need a message then have no parameters. */
    inboxError: RouteError | UnreadableValueError | null;
    /** Why the leftover test drafts could not be listed, when they could not; discard_draft then has no parameters. */
    draftsError: RouteError | UnreadableValueError | null;
}

/**
 * Test parameters for every operation, taken from the live inbox (read only). When the inbox cannot be listed, or
 * is empty, operations that need a message are left out.
 */
export async function buildTestParams(client: WebmailEmailClient): Promise<TestParams> {
    let first: ExtractedRecord | null = null;
    let second: ExtractedRecord | null = null;
    let inboxError: RouteError | UnreadableValueError | null = null;
    try {
        const listing = await client.testOperation('list_inbox', {});
        checkOutput('list_inbox', listing);
        const messages = listing.extracted.messages as ExtractedRecord[];
        first = messages[0] ?? null;
        // Prefer a message that differs from the first in both subject and sender.
        second = messages.slice(1).find((m) => m.subject !== first!.subject && m.from !== first!.from)
            ?? messages.slice(1).find((m) => m.subject !== first!.subject)
            ?? null;
    } catch (error) {
        if (!(error instanceof RouteError || error instanceof UnreadableValueError)) throw error;
        inboxError = error;
    }
    let draft: ExtractedRecord | null = null;
    let draftsError: RouteError | UnreadableValueError | null = null;
    try {
        const drafts = await client.testOperation('list_test_drafts', { $marker: TEST_DRAFT_MARKER });
        checkOutput('list_test_drafts', drafts);
        draft = (drafts.extracted.messages as ExtractedRecord[])[0] ?? null;
    } catch (error) {
        if (!(error instanceof RouteError || error instanceof UnreadableValueError)) throw error;
        draftsError = error;
    }
    const params: Partial<Record<OperationName, Params>> = {};
    const alternate: Partial<Record<OperationName, Params>> = {};
    for (const operation of OPERATION_NAMES) {
        const p = paramsFor(operation, first, draft, client.account.address);
        if (p !== null) params[operation] = p;
        if (!MESSAGE_OPERATIONS.has(operation)) continue;
        const a = paramsFor(operation, second, draft, client.account.address);
        if (a !== null) alternate[operation] = a;
    }
    return { params, alternate, inboxError, draftsError };
}

/** Operations whose parameters come from a particular message. */
const MESSAGE_OPERATIONS = new Set<OperationName>(['open_message', 'read_thread', 'search', 'reply']);

function paramsFor(operation: OperationName, first: ExtractedRecord | null, draft: ExtractedRecord | null, account: string): Params | null {
    switch (operation) {
        case 'list_test_drafts':
            return { $marker: TEST_DRAFT_MARKER };
        case 'discard_draft':
            return draft ? { $marker: TEST_DRAFT_MARKER, $message_id: draft.id! } : null;
        case 'read_account':
        case 'check_sent':
            return {};
        case 'compose_send':
            // The account is also in Cc, so every test also proves the steps that enter and check Cc recipients.
            return { '$draft.to': account, '$draft.cc': account, '$draft.subject': CANARY_SUBJECT, '$draft.body': CANARY_BODY };
        case 'open_message':
            return first ? { $message_id: first.id! } : null;
        case 'read_thread':
            return first ? { $thread_id: first.thread_id ?? first.id! } : null;
        case 'search':
            return first ? { $query: first.subject!.split(/\s+/).slice(0, 3).join(' ') } : null;
        case 'reply':
            // No $draft.to: in a test the reply's recipients are only read (the webmail may use a reply-to address).
            return first ? { $message_id: first.id!, '$draft.body': CANARY_BODY } : null;
        case 'list_inbox':
            return {};
    }
}

/** A route error's message followed by what the page showed, so a stored failure can be understood later. */
function withEvidence(error: RouteError): string {
    if (error.evidence.length === 0) return error.message;
    return `${error.message}\nWhat the page showed:\n${error.evidence.join('\n')}`;
}
