export type EmailProvider = 'gmail' | 'outlook' | 'smtp' | 'sendgrid' | 'resend' | (string & {});

export type EmailApprovalPolicy =
    | 'default'
    | 'require_approval'
    | 'bypass_approval';

export interface EmailStatus {
    configured: boolean;
    baseUrl?: string | null;
    fromAccount?: string | null;
    reachable?: boolean | null;
    reachableCheckedAt?: string | null;
    lastError?: string | null;
}

export interface EmailAccount {
    email: string;
    provider: EmailProvider;
    displayName?: string | null;
    owner?: 'user' | 'agent' | 'system' | (string & {});
    label?: 'human' | 'agent' | 'system' | (string & {});
}

export interface EmailAttachment {
    /** The provider's id for this attachment on its message. File names are not unique (Outlook repeats image001.png). */
    id?: string;
    filename: string;
    contentType: string;
    size?: number;
    /** Base64 payload for outbound messages or downloaded attachments. */
    content?: string;
}

export interface EmailMessage {
    id: string;
    subject: string | null;
    from: string | null;
    to: string | null;
    bodyText?: string | null;
    bodyHtml?: string | null;
    bodyPreview?: string | null;
    cc?: string | null;
    bcc?: string | null;
    account?: string | null;
    providerMessageId?: string | null;
    threadId?: string | null;
    inReplyToId?: string | null;
    date?: string | Date | null;
    attachments?: EmailAttachment[];
    status?: 'pending' | 'approved' | 'rejected' | 'sent' | 'delivered' | (string & {});
    /** Provider labels or folders on this message (Gmail: INBOX, UNREAD, user labels). */
    labels?: string[];
    unread?: boolean;
    /** The RFC 822 Message-ID header, used for threading replies. */
    messageIdHeader?: string | null;
}

/** A conversation: every message that belongs to one provider thread. */
export interface EmailThread {
    id: string;
    subject: string | null;
    participants: string[];
    messageIds: string[];
    labels: string[];
    unread: boolean;
    /** ISO date of the newest message. */
    lastMessageAt: string;
    snippet: string | null;
}

export interface EmailThreadDetail extends EmailThread {
    messages: EmailMessage[];
}

export interface ListThreadsInput {
    account?: string;
    labels?: string[];
    pageToken?: string | null;
    limit?: number;
}

export interface ListThreadsResult {
    threads: EmailThread[];
    nextPageToken: string | null;
}

/** One change in the mailbox since a sync cursor. */
export type EmailChange =
    | { kind: 'message_added'; threadId: string; messageId: string }
    | { kind: 'message_deleted'; threadId: string; messageId: string }
    | { kind: 'labels_changed'; threadId: string; messageId: string; labels: string[] }
    | { kind: 'read_changed'; threadId: string; messageId: string; unread: boolean };

export interface ChangesResult {
    changes: EmailChange[];
    /** Pass back to the next changesSince call. */
    cursor: string;
}

export interface CreateDraftInput {
    threadId?: string;
    inReplyToId?: string;
    to: string;
    cc?: string;
    subject: string;
    body: string;
    html?: string;
}

export interface ListEmailMessagesInput {
    account?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export interface ListEmailMessagesResult {
    messages: EmailMessage[];
    total?: number;
    page?: number;
    limit?: number;
    nextPageToken?: string | null;
}

export interface EmailDeliveryOptions {
    /**
     * Defaults to the adapter's normal behavior. `bypass_approval` should only
     * be accepted by trusted hosts and may fail when the backing provider cannot
     * dispatch directly.
     */
    approvalPolicy?: EmailApprovalPolicy;
}

export interface SendEmailInput extends EmailDeliveryOptions {
    to: string;
    subject: string;
    body: string;
    html?: string;
    cc?: string;
    bcc?: string;
    fromAccount?: string;
    fromName?: string;
    attachments?: EmailAttachment[];
    /** Optional bearer/access token for hosted adapters that authenticate per user. */
    accessToken?: string;
}

export interface ReplyEmailInput extends EmailDeliveryOptions {
    messageId: string;
    body: string;
    html?: string;
    replyAll?: boolean;
    fromAccount?: string;
    fromName?: string;
    accessToken?: string;
}

export interface ForwardEmailInput extends EmailDeliveryOptions {
    messageId: string;
    to: string;
    body?: string;
    html?: string;
    cc?: string;
    fromAccount?: string;
    fromName?: string;
    accessToken?: string;
}

export interface QueuedEmailResult {
    queueId: string;
    queued: true;
    message?: string;
    direct?: boolean;
}
