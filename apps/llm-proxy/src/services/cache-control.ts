interface ContentBlock {
    type: string;
    text?: string;
    cache_control?: { type: string };
    [key: string]: unknown;
}

interface Message {
    role: string;
    content: string | ContentBlock[];
    [key: string]: unknown;
}

/**
 * For DashScope requests, inject cache_control on the system message's last text block.
 * This enables DashScope's prompt caching feature for long system prompts.
 *
 * Mutates the request body in-place.
 */
export function injectDashScopeCacheControl(body: { messages?: Message[]; [key: string]: unknown }): void {
    if (!body.messages || !Array.isArray(body.messages)) return;

    const systemMsg = body.messages.find(m => m.role === 'system');
    if (!systemMsg) {
        console.log('[LLM-PROXY] DashScope cache: no system message found');
        return;
    }

    const contentType = typeof systemMsg.content;
    const contentLen = typeof systemMsg.content === 'string'
        ? systemMsg.content.length
        : Array.isArray(systemMsg.content)
            ? systemMsg.content.reduce((sum, b) => sum + (b.text?.length || 0), 0)
            : 0;

    // Convert string content to content-block array format
    if (typeof systemMsg.content === 'string') {
        systemMsg.content = [{ type: 'text', text: systemMsg.content }];
    }

    if (!Array.isArray(systemMsg.content)) {
        console.log(`[LLM-PROXY] DashScope cache: unexpected content type: ${contentType}`);
        return;
    }

    // Find the last text block and add cache_control
    let injected = false;
    for (let i = systemMsg.content.length - 1; i >= 0; i--) {
        const block = systemMsg.content[i];
        if (block.type === 'text') {
            block.cache_control = { type: 'ephemeral' };
            injected = true;
            break;
        }
    }

    // Log first 80 chars of system prompt to detect changes between requests
    const preview = Array.isArray(systemMsg.content)
        ? (systemMsg.content[0]?.text || '').slice(0, 80)
        : '';
    console.log(`[LLM-PROXY] DashScope cache: contentType=${contentType} chars=${contentLen} blocks=${systemMsg.content.length} injected=${injected} preview="${preview}..."`);
}
