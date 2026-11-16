const API = 'https://slack.com/api';

/** The most items Slack gives in one page of a listing (it may give fewer). */
const PAGE = 200;

/**
 * Slack refused a call. Slack's Web API answers most failures with HTTP 200 and
 * `{ ok: false, error }`; those, a 429 (Slack asks to slow down) and any other
 * HTTP failure all end here. `code` is Slack's own error code (for example
 * `invalid_auth`, `not_in_channel`, `missing_scope`), `ratelimited` for a 429,
 * or `http_<status>` for another HTTP failure.
 */
export class SlackApiError extends Error {
    override readonly name = 'SlackApiError';
    constructor(
        /** The Web API method called, e.g. `conversations.history`. */
        readonly method: string,
        readonly code: string,
        /** The HTTP status Slack answered with (200 for `{ ok: false }`). */
        readonly status: number,
        /** For a 429: the seconds Slack asks to wait (its Retry-After header); null otherwise. */
        readonly retryAfter: number | null,
        /** For `missing_scope`: the scopes the call needed, as Slack names them. */
        readonly needed: string | null = null,
    ) {
        super(
            code === 'ratelimited'
                ? `Slack asked to slow down on ${method}${retryAfter !== null ? ` (try again in ${retryAfter} s)` : ''}`
                : `Slack refused ${method}: ${code}${needed ? ` (needs ${needed})` : ''}`,
        );
    }
    /** Slack asks to slow down (HTTP 429). */
    get rateLimited(): boolean {
        return this.code === 'ratelimited';
    }
    /** The token no longer works: wrong, revoked, or the app was removed from the workspace. */
    get tokenRejected(): boolean {
        return ['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired'].includes(this.code);
    }
}

/** Who the token is: the workspace and the app's bot user (from `auth.test`). */
export interface SlackIdentity {
    teamId: string;
    /** The workspace's name. */
    team: string;
    /** The workspace's address, e.g. https://acme.slack.com/. */
    url: string;
    /** The app's bot user id: messages mention the app as `<@botUserId>`. */
    botUserId: string;
    /** The bot's user name in the workspace. */
    botName: string;
    /** The bot id its own messages carry (`bot_id`); null when Slack gives none (a user token). */
    botId: string | null;
}

/** A conversation the token can see: a direct message (`im`), a group direct message (`mpim`) or a channel. */
export interface SlackConversation {
    id: string;
    kind: 'im' | 'mpim' | 'public_channel' | 'private_channel';
    /** A channel's name (without '#'); null for a direct message. */
    name: string | null;
    /** Whether the app is in it. Always true for a direct message with the app. */
    isMember: boolean;
    /** For a direct message: the other person's user id. */
    userId: string | null;
}

/** A message as `conversations.history` and `conversations.replies` give it. */
export interface SlackMessage {
    /** The message's id in its conversation, a time stamp such as "1763290000.000100". */
    ts: string;
    /** The thread it belongs to (the thread's first message's ts); null when it is not in a thread. */
    threadTs: string | null;
    /** The person who wrote it; null for messages from apps and some system messages. */
    user: string | null;
    /** Set when an app or bot wrote it. */
    botId: string | null;
    /** Slack's subtype (e.g. channel_join, message_changed, bot_message); null for an ordinary message. */
    subtype: string | null;
    /** The text in Slack's own markup (see plainText). */
    text: string;
}

/** A person in the workspace (from `users.info`). */
export interface SlackUser {
    id: string;
    /** The name shown in Slack: the display name, else the real name, else the user name. */
    name: string;
    /** Their address, when the token has users:read.email and Slack has one. */
    email: string | null;
    isBot: boolean;
}

export interface SlackClientOptions {
    /** A bot token (xoxb-…) of the app installed in the workspace. */
    token: string;
    fetch?: typeof fetch;
}

type Params = Record<string, string | number | boolean | undefined>;
type Answer = Record<string, unknown> & { ok: boolean; error?: string; needed?: string; response_metadata?: { next_cursor?: string } };

interface ApiConversation {
    id: string;
    name?: string;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
    is_member?: boolean;
    user?: string;
}
interface ApiMessage {
    ts: string;
    thread_ts?: string;
    user?: string;
    bot_id?: string;
    subtype?: string;
    text?: string;
}

/** Order two Slack time stamps ("seconds.microseconds"): negative when a is earlier. */
export function compareTs(a: string, b: string): number {
    const [as, au = ''] = a.split('.');
    const [bs, bu = ''] = b.split('.');
    const s = Number(as) - Number(bs);
    if (s !== 0) return s;
    return Number(au.padEnd(6, '0')) - Number(bu.padEnd(6, '0'));
}

/** A Slack time stamp for a moment, to read from (`oldest`). */
export function tsOf(date: Date): string {
    const ms = date.getTime();
    if (Number.isNaN(ms)) throw new Error('tsOf was given an invalid date');
    return `${Math.floor(ms / 1000)}.${String((ms % 1000) * 1000).padStart(6, '0')}`;
}

/** The ISO time of a Slack time stamp. */
export function isoOfTs(ts: string): string {
    const [s, u = '0'] = ts.split('.');
    return new Date(Number(s) * 1000 + Math.floor(Number(u.padEnd(6, '0')) / 1000)).toISOString();
}

/** Whether the text mentions this user (`<@U123>` or `<@U123|name>`). */
export function mentions(text: string, userId: string): boolean {
    return new RegExp(`<@${userId}(\\|[^>]*)?>`).test(text);
}

/**
 * Slack's markup as plain text: mentions of people as `@name` (from `names`,
 * else their id), `<#C123|general>` as `#general`, links as their label and
 * address, and Slack's three escaped characters (&amp; &lt; &gt;) as themselves.
 */
export function plainText(text: string, names: Record<string, string> = {}): string {
    return text
        .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_m, id: string, label?: string) => `@${names[id] ?? label ?? id}`)
        .replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_m, name: string) => `#${name}`)
        .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_m, word: string) => `@${word}`)
        .replace(/<(https?:[^|>]+)\|([^>]+)>/g, (_m, url: string, label: string) => (label === url ? url : `${label} (${url})`))
        .replace(/<(https?:[^>]+)>/g, (_m, url: string) => url)
        .replace(/<mailto:([^|>]+)(?:\|[^>]*)?>/g, (_m, address: string) => address)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/** Plain text made safe to post: Slack reads &, < and > as markup, so they are escaped. */
export function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const messageOf = (m: ApiMessage): SlackMessage => ({
    ts: m.ts,
    threadTs: m.thread_ts ?? null,
    user: m.user ?? null,
    botId: m.bot_id ?? null,
    subtype: m.subtype ?? null,
    text: m.text ?? '',
});

/**
 * The Slack Web API for an app installed in a workspace, with its bot token:
 * read the app's conversations, their messages and threads, people and
 * permalinks, and post in a thread. Every call that Slack refuses throws a
 * SlackApiError; nothing is retried here, so a caller that is told to slow
 * down (`rateLimited`) decides when to try again.
 */
export class SlackClient {
    private readonly fetch: typeof fetch;

    constructor(private readonly opts: SlackClientOptions) {
        if (!opts.token) throw new Error('SlackClient needs a token');
        this.fetch = opts.fetch ?? globalThis.fetch;
    }

    /** One Web API call (a form POST with the bot token); Slack's refusals throw a SlackApiError. */
    private async call(method: string, params: Params): Promise<Answer> {
        const body = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
        const res = await this.fetch(`${API}/${method}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${this.opts.token}`, 'content-type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (res.status === 429) {
            const after = res.headers.get('retry-after');
            throw new SlackApiError(method, 'ratelimited', 429, after !== null && /^\d+$/.test(after) ? Number(after) : null);
        }
        if (!res.ok) throw new SlackApiError(method, `http_${res.status}`, res.status, null);
        const answer = (await res.json()) as Answer;
        if (!answer.ok) {
            if (typeof answer.error !== 'string') throw new Error(`Slack answered ${method} with ok: false and no error code`);
            throw new SlackApiError(method, answer.error, res.status, null, typeof answer.needed === 'string' ? answer.needed : null);
        }
        return answer;
    }

    /** Every page of a listing, following Slack's cursor. */
    private async pages(method: string, params: Params): Promise<Answer[]> {
        const all: Answer[] = [];
        let cursor: string | undefined;
        do {
            const answer = await this.call(method, { ...params, cursor });
            all.push(answer);
            cursor = answer.response_metadata?.next_cursor || undefined;
        } while (cursor);
        return all;
    }

    /** Who the token is: the workspace and the app's bot user. */
    async authTest(): Promise<SlackIdentity> {
        const a = await this.call('auth.test', {});
        const need = (field: string): string => {
            const v = a[field];
            if (typeof v !== 'string' || !v) throw new Error(`Slack's auth.test gave no ${field}`);
            return v;
        };
        return {
            teamId: need('team_id'),
            team: need('team'),
            url: need('url'),
            botUserId: need('user_id'),
            botName: need('user'),
            botId: typeof a.bot_id === 'string' ? a.bot_id : null,
        };
    }

    /** The conversations of these kinds the token can see (archived ones left out). */
    async conversations(kinds: Array<SlackConversation['kind']>): Promise<SlackConversation[]> {
        const answers = await this.pages('conversations.list', { types: kinds.join(','), exclude_archived: true, limit: PAGE });
        return answers.flatMap((a) =>
            ((a.channels ?? []) as ApiConversation[]).map((c): SlackConversation => {
                const kind = c.is_im ? 'im' : c.is_mpim ? 'mpim' : c.is_private ? 'private_channel' : 'public_channel';
                return { id: c.id, kind, name: c.is_im ? null : (c.name ?? null), isMember: c.is_im ? true : c.is_member === true, userId: c.user ?? null };
            }),
        );
    }

    /**
     * The conversation's messages after `oldest` (a time stamp, not included),
     * oldest first. Replies inside threads are not among them: read a thread
     * with `replies`.
     */
    async history(channel: string, oldest: string): Promise<SlackMessage[]> {
        const answers = await this.pages('conversations.history', { channel, oldest, inclusive: false, limit: PAGE });
        return answers
            .flatMap((a) => (a.messages ?? []) as ApiMessage[])
            .map(messageOf)
            .sort((a, b) => compareTs(a.ts, b.ts));
    }

    /**
     * The replies in a thread after `oldest` (not included), oldest first.
     * Slack always gives the thread's first message too; it is left out here
     * unless it is itself after `oldest`.
     */
    async replies(channel: string, threadTs: string, oldest: string): Promise<SlackMessage[]> {
        const answers = await this.pages('conversations.replies', { channel, ts: threadTs, oldest, inclusive: false, limit: PAGE });
        return answers
            .flatMap((a) => (a.messages ?? []) as ApiMessage[])
            .map(messageOf)
            .filter((m) => compareTs(m.ts, oldest) > 0)
            .sort((a, b) => compareTs(a.ts, b.ts));
    }

    /** A person in the workspace; `email` needs the users:read.email scope. */
    async user(id: string): Promise<SlackUser> {
        const a = await this.call('users.info', { user: id });
        const u = a.user as { id?: string; name?: string; is_bot?: boolean; profile?: { display_name?: string; real_name?: string; email?: string } } | undefined;
        if (!u?.id) throw new Error(`Slack's users.info gave no user for ${id}`);
        const name = u.profile?.display_name || u.profile?.real_name || u.name;
        if (!name) throw new Error(`Slack's users.info gave no name for ${id}`);
        return { id: u.id, name, email: u.profile?.email || null, isBot: u.is_bot === true };
    }

    /** A message's address in Slack, for a person to open. */
    async permalink(channel: string, ts: string): Promise<string> {
        const a = await this.call('chat.getPermalink', { channel, message_ts: ts });
        if (typeof a.permalink !== 'string') throw new Error(`Slack's chat.getPermalink gave no permalink for ${channel} ${ts}`);
        return a.permalink;
    }

    /**
     * Post plain text as the app, in a thread when `threadTs` is given. The text
     * is escaped (escapeText), so it shows as written.
     */
    async postMessage(channel: string, text: string, threadTs: string | null): Promise<{ channel: string; ts: string }> {
        const a = await this.call('chat.postMessage', { channel, text: escapeText(text), thread_ts: threadTs ?? undefined, unfurl_links: false, unfurl_media: false });
        if (typeof a.ts !== 'string' || typeof a.channel !== 'string') throw new Error('Slack\'s chat.postMessage gave no ts or channel');
        return { channel: a.channel, ts: a.ts };
    }
}
