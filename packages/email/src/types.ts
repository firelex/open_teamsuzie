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
