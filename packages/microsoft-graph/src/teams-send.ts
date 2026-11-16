import { GraphError, MICROSOFT_CHAT_SEND_SCOPES, missingScopes, type GraphSession } from './session.js';

/**
 * Posting a message in one of the signed-in user's Teams chats, as that user
 * (POST /chats/{id}/messages). Needs the delegated permission ChatMessage.Send
 * (MICROSOFT_CHAT_SEND_SCOPES) on the session. Ported from Suzie Desk
 * (suzie_desk/chat_alerts.py, TeamsChannel.send and teams_html). This is the
 * package's only Teams write; hosts decide when a message may go out.
 */

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const BULLET = /^[-•*] /;

/**
 * Plain text as Teams shows it with its line breaks (sent as plain text,
 * Teams runs the lines together): a paragraph where blank lines are, a list
 * where every line of a paragraph begins "- " or "• ", and a line break for
 * each other line. Nothing in the text is taken as markup.
 */
export function teamsHtml(text: string): string {
    const out: string[] = [];
    for (const block of text.trim().split(/\n\s*\n/)) {
        const lines = block
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        if (!lines.length) continue;
        if (lines.every((l) => BULLET.test(l))) {
            out.push(`<ul>${lines.map((l) => `<li>${escape(l.slice(2).trim())}</li>`).join('')}</ul>`);
        } else {
            out.push(`<p>${lines.map((l) => (BULLET.test(l) ? `• ${escape(l.slice(2).trim())}` : escape(l))).join('<br>')}</p>`);
        }
    }
    return out.join('');
}

/** The chat-posting scope (ChatMessage.Send) a list of granted scopes lacks. */
export function missingChatSendScopes(granted: readonly string[]): string[] {
    return missingScopes(granted, MICROSOFT_CHAT_SEND_SCOPES);
}

/**
 * Post `text` in the chat as the signed-in user. Returns the new message's id
 * and its address in Teams when Graph gives one. An empty text is refused.
 */
export async function sendChatMessage(session: GraphSession, chatId: string, text: string): Promise<{ id: string; webUrl: string | null }> {
    if (!text.trim()) throw new GraphError('invalid_request', 'A Teams message needs some text');
    const sent = await session.request<{ id?: string; webUrl?: string | null }>('POST', `/chats/${encodeURIComponent(chatId)}/messages`, {
        body: { body: { contentType: 'html', content: teamsHtml(text) } },
    });
    if (!sent.id) throw new GraphError('internal_error', `Microsoft Graph did not say which message it posted in chat ${chatId}`);
    return { id: sent.id, webUrl: sent.webUrl ?? null };
}
