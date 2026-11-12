import { htmlToText } from '@teamsuzie/email-sync';
import type { GraphSession } from './session.js';

/**
 * Outlook calendar and Teams chats through Microsoft Graph, read only.
 * Ported from Jeff Desk (jeff_desk/tools/outlook_calendar.py,
 * jeff_desk/tools/teams.py and TeamsChannel in jeff_desk/chat_alerts.py).
 * Changing a calendar or posting in Teams is left to hosts, behind their
 * approvals.
 */

export interface CalendarEvent {
    id: string;
    subject: string;
    /** ISO times in UTC. */
    start: string;
    end: string;
    isAllDay: boolean;
    isCancelled: boolean;
    isOnlineMeeting: boolean;
    /** How the user answered: organizer, accepted, tentativelyAccepted, declined, notResponded, none. */
    response: string;
    showAs: string;
    organizer: { name: string | null; address: string | null };
    attendees: Array<{ name: string | null; address: string; type: string; response: string }>;
    location: string | null;
    bodyPreview: string | null;
}

interface GraphEvent {
    id: string;
    subject?: string;
    start?: { dateTime?: string; timeZone?: string };
    end?: { dateTime?: string; timeZone?: string };
    isAllDay?: boolean;
    isCancelled?: boolean;
    isOnlineMeeting?: boolean;
    responseStatus?: { response?: string };
    showAs?: string;
    organizer?: { emailAddress?: { name?: string; address?: string } };
    attendees?: Array<{ type?: string; status?: { response?: string }; emailAddress?: { name?: string; address?: string } }>;
    location?: { displayName?: string };
    bodyPreview?: string;
}

/** Graph's dateTime in UTC (asked for with the outlook.timezone header) as ISO with a Z. */
const utc = (v?: string) => (v ? (v.endsWith('Z') ? v : `${v.replace(/\.\d+$/, '')}Z`) : '');

export class OutlookCalendar {
    constructor(private readonly session: GraphSession) {}

    /** Events overlapping [start, end) (ISO), each occurrence of a series separately, in start order. */
    async events(start: string, end: string, limit = 250): Promise<CalendarEvent[]> {
        const found = await this.session.all<GraphEvent>('/me/calendarView', {
            query: {
                startDateTime: start,
                endDateTime: end,
                $top: 100,
                $orderby: 'start/dateTime',
                $select: 'id,subject,start,end,isAllDay,isCancelled,isOnlineMeeting,responseStatus,showAs,organizer,attendees,location,bodyPreview',
            },
            headers: { prefer: 'outlook.timezone="UTC"' },
            limit,
        });
        return found.map((e) => ({
            id: e.id,
            subject: e.subject ?? '',
            start: utc(e.start?.dateTime),
            end: utc(e.end?.dateTime),
            isAllDay: !!e.isAllDay,
            isCancelled: !!e.isCancelled,
            isOnlineMeeting: !!e.isOnlineMeeting,
            response: e.responseStatus?.response ?? 'none',
            showAs: e.showAs ?? 'unknown',
            organizer: { name: e.organizer?.emailAddress?.name ?? null, address: e.organizer?.emailAddress?.address ?? null },
            attendees: (e.attendees ?? [])
                .filter((a) => a.emailAddress?.address)
                .map((a) => ({
                    name: a.emailAddress?.name ?? null,
                    address: a.emailAddress!.address!,
                    type: a.type ?? 'required',
                    response: a.status?.response ?? 'none',
                })),
            location: e.location?.displayName || null,
            bodyPreview: e.bodyPreview || null,
        }));
    }
}

export interface TeamsChat {
    id: string;
    /** oneOnOne, group or meeting. */
    kind: string;
    topic: string | null;
    members: Array<{ userId: string | null; name: string | null; email: string | null }>;
    lastMessageAt: string | null;
}

export interface TeamsMessage {
    id: string;
    chatId: string;
    at: string;
    senderId: string | null;
    senderName: string | null;
    fromMe: boolean;
    text: string;
}

interface GraphChat {
    id: string;
    chatType?: string;
    topic?: string | null;
    members?: Array<{ userId?: string; displayName?: string; email?: string }>;
    lastMessagePreview?: { createdDateTime?: string };
}

interface GraphChatMessage {
    id: string;
    messageType?: string;
    createdDateTime?: string;
    from?: { user?: { id?: string; displayName?: string }; application?: { displayName?: string } };
    body?: { contentType?: string; content?: string };
    attachments?: Array<{ name?: string }>;
}

export class TeamsChats {
    private meId: string | null = null;

    constructor(private readonly session: GraphSession) {}

    /** The signed-in user's Graph id, to tell their messages apart. */
    async me(): Promise<string> {
        this.meId ??= (await this.session.request<{ id: string }>('GET', '/me', { query: { $select: 'id' } })).id;
        return this.meId;
    }

    /** The user's chats, most recently active first, with members. */
    async chats(limit = 50): Promise<TeamsChat[]> {
        const found = await this.session.all<GraphChat>('/me/chats', {
            query: { $top: Math.min(limit, 50), $expand: 'members,lastMessagePreview', $orderby: 'lastMessagePreview/createdDateTime desc' },
            limit,
        });
        return found.map((c) => ({
            id: c.id,
            kind: c.chatType ?? 'unknown',
            topic: c.topic ?? null,
            members: (c.members ?? []).map((m) => ({ userId: m.userId ?? null, name: m.displayName ?? null, email: m.email ?? null })),
            lastMessageAt: c.lastMessagePreview?.createdDateTime ?? null,
        }));
    }

    /**
     * A chat's messages, oldest first, at most `limit` (newest ones). System
     * messages are left out; a message with only a file shows the file name.
     */
    async messages(chatId: string, limit = 50): Promise<TeamsMessage[]> {
        const me = await this.me();
        const found = await this.session.all<GraphChatMessage>(`/me/chats/${encodeURIComponent(chatId)}/messages`, {
            query: { $top: Math.min(limit, 50) },
            limit,
        });
        return found
            .filter((m) => (m.messageType ?? 'message') === 'message' && m.createdDateTime)
            .map((m) => {
                const content = m.body?.content ?? '';
                const text = [m.body?.contentType === 'html' ? htmlToText(content) : content.trim(), ...(m.attachments ?? []).map((a) => (a.name ? `[file: ${a.name}]` : ''))]
                    .filter(Boolean)
                    .join('\n');
                const senderId = m.from?.user?.id ?? null;
                return {
                    id: m.id,
                    chatId,
                    at: m.createdDateTime!,
                    senderId,
                    senderName: m.from?.user?.displayName ?? m.from?.application?.displayName ?? null,
                    fromMe: senderId !== null && senderId === me,
                    text,
                };
            })
            .sort((a, b) => a.at.localeCompare(b.at));
    }
}
