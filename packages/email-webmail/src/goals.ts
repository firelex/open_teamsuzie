import type { OperationName } from '@teamsuzie/webmail-routes';

/**
 * What each operation is for, in plain English. The relearning model is given this goal, so it can rebuild an
 * operation even when none of its old steps match the page any more.
 */
export const OPERATION_GOALS: Record<OperationName, string> = {
    read_account:
        'Find the email address of the account that is signed in to this webmail, usually shown on the account or '
        + 'profile button in the page header. Do not open any menus.',
    list_inbox:
        'Go to the inbox and read the list of conversations shown on the first page: for each row, the message id the '
        + 'page uses for it, the sender\'s email address, the subject and the date. Do not open any message.',
    open_message:
        'Open the message whose id is given as $message_id (the same id list_inbox reads), and read its subject, the '
        + 'sender\'s email address, the date, the recipients if shown, and the full body text of that message.',
    read_thread:
        'Open the conversation whose id is given as $thread_id and read every message in it: for each, the id the page '
        + 'uses for that message, the sender\'s email address, the date and, where the message is expanded, its body text.',
    search:
        'Search the mailbox for the words given as $query using the webmail\'s own search box, then read the list of '
        + 'results the same way list_inbox reads the inbox.',
    compose_send:
        'Start a new message, put each address from $draft.to in the To field (as separate recipients), put '
        + '$draft.subject in the Subject field and $draft.body in the message body, check that the recipients shown '
        + 'on the page are exactly the ones given, then press Send. The Send step must be marked as the commit step, '
        + 'and test_end must discard the unsent draft.',
    reply:
        'Open the message whose id is given as $message_id, start a reply to it (Reply, not Reply all or Forward), put '
        + '$draft.body in the reply\'s message body, check that the recipients shown on the reply are exactly '
        + '$draft.to, then press Send. The Send step must be marked as the commit step, and test_end must discard the '
        + 'unsent reply.',
    check_sent:
        'Go to the Sent folder and read the list of sent messages on the first page: for each, the message id the page '
        + 'uses, the recipients\' email addresses and the subject.',
};

/** What a returned value must look like, checked on the value itself whatever format the route declares. */
export type OutputFormat = 'id' | 'email' | 'emails' | 'date' | 'nonempty' | 'text' | 'flag';

export interface OperationOutput {
    /** The `as` name of the extract step that produces it. */
    as: string;
    list: boolean;
    /** Fields that must be present (non-null) in every record. */
    required: string[];
    /** Fields the client uses when present. */
    optional: string[];
    /** The form each field's value must have. */
    formats: Record<string, OutputFormat>;
}

const MESSAGE_ROW: Record<string, OutputFormat> = {
    id: 'id', thread_id: 'id', from: 'email', subject: 'nonempty', date: 'date', snippet: 'text', unread: 'flag',
};

/** What each operation must return, so `WebmailEmailClient` can build its results. */
export const OPERATION_OUTPUTS: Record<OperationName, OperationOutput | null> = {
    read_account: { as: 'account', list: false, required: ['address'], optional: [], formats: { address: 'email' } },
    list_inbox: { as: 'messages', list: true, required: ['id', 'from', 'subject', 'date'], optional: ['thread_id', 'snippet', 'unread'], formats: MESSAGE_ROW },
    open_message: {
        as: 'message', list: false, required: ['subject', 'from', 'date', 'body'], optional: ['to', 'cc', 'thread_id'],
        formats: { subject: 'nonempty', from: 'email', date: 'date', body: 'nonempty', to: 'emails', cc: 'emails', thread_id: 'id' },
    },
    read_thread: { as: 'messages', list: true, required: ['id', 'from', 'date'], optional: ['body'], formats: { id: 'id', from: 'email', date: 'date', body: 'text' } },
    search: { as: 'messages', list: true, required: ['id', 'from', 'subject', 'date'], optional: ['thread_id', 'snippet', 'unread'], formats: MESSAGE_ROW },
    compose_send: null,
    reply: null,
    check_sent: { as: 'messages', list: true, required: ['id', 'to', 'subject'], optional: [], formats: { id: 'id', to: 'emails', subject: 'nonempty' } },
};

const FORMAT_WORDS: Record<OutputFormat, string> = {
    id: 'an id the page uses for it (format "id": letters, digits and : . # + = / - _ only)',
    email: 'one email address (format "email")',
    emails: 'one or more email addresses (format "emails")',
    date: 'a date (format "date")',
    nonempty: 'non-empty text (format "nonempty")',
    text: 'text (format "text")',
    flag: 'a flag (format "flag")',
};

/** The output contract in plain English, for the relearning prompt. */
export function describeOutput(operation: OperationName): string {
    const output = OPERATION_OUTPUTS[operation];
    if (output === null) return 'This operation returns nothing; it must not include an extract step.';
    const shape = output.list ? `a list of records (one extract step with items, each: true)` : 'one record (one extract step without items)';
    const fieldLine = (name: string) => `"${name}": ${FORMAT_WORDS[output.formats[name]!]}`;
    return `This operation must return ${shape} under the name "${output.as}". Required fields: ${output.required.map(fieldLine).join('; ')}.`
        + (output.optional.length > 0 ? ` Optional fields: ${output.optional.map(fieldLine).join('; ')}.` : '')
        + ' The program checks each value: an id that is really a name, or a sender that is a name instead of an address, is rejected. If the value is in an attribute (for example data-*, title or datetime), read it from that attribute.';
}
