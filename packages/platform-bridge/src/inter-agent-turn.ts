/**
 * runWebhookChatTurn
 *
 * Helper for serving inter-agent DMs that arrive via the mothership webhook.
 *
 * The mothership POSTs `{type:'dm', from_agent, message, context?}` and expects
 * a single `{response: string}` reply (non-streaming). Reference apps already
 * have all the pieces — `runChatTurn` from `@teamsuzie/agent-loop`, their own
 * tool registry, their own system prompt — but the boilerplate to:
 *
 *   - frame the prompt with "you're talking to another agent"
 *   - prepend a meeting transcript when one is supplied
 *   - drain `runChatTurn`'s stream into a single string
 *   - convert error events to thrown errors so callers can `try/catch`
 *
 * is the same in every app. This helper consolidates that.
 */

import {
    runChatTurn,
    type AgentTarget,
    type AnyToolDefinition,
    type ChatMessage,
    type ToolContext,
} from '@teamsuzie/agent-loop';

export interface RunWebhookChatTurnOptions {
    /** Resolved chat target (model + base URL + key + extraBody). */
    agent: AgentTarget;
    /** Tools available for this turn. */
    tools: AnyToolDefinition[];
    /** Tool execution context (vector DB, approvals, allowed hosts, etc.). */
    toolCtx: ToolContext;
    /**
     * Base system prompt — the app's normal "who you are" prompt. The helper
     * appends an addendum saying the responder is talking to another agent
     * (not a human) and should reply concisely.
     */
    systemPrompt: string;
    /** Display name of the agent that sent the DM (e.g. "Suzie Nice"). */
    fromAgentName: string;
    /** The actual message text. */
    message: string;
    /**
     * Optional running transcript when the DM is part of a multi-agent
     * conversation (e.g. mothership-orchestrated video conference). When
     * supplied, prepended to the user message so the responder has context.
     */
    transcript?: Array<{ from: string; text: string }>;
    /** Tool-call iteration cap. Defaults to runChatTurn's own default. */
    maxIterations?: number;
    /** Custom fetch (for token metering, etc.). Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Abort signal. */
    signal?: AbortSignal;
}

/**
 * Run a single non-streaming agent turn for a webhook DM and return the
 * accumulated assistant text.
 *
 * Throws if the agent loop emits an `error` event. Returns
 * `'[empty response]'` (literal string) if the loop emits `done` without any
 * `chunk` events — this is non-fatal so the caller can decide whether to
 * surface it to the user or treat it as silent.
 */
export async function runWebhookChatTurn(opts: RunWebhookChatTurnOptions): Promise<string> {
    const augmentedSystemPrompt = `${opts.systemPrompt}\n\nYou are responding to another AI agent (${opts.fromAgentName}), not a human end user. Reply concisely and directly.`;

    const messages: ChatMessage[] = [];
    if (opts.transcript && opts.transcript.length > 0) {
        const transcriptText = opts.transcript.map((t) => `${t.from}: ${t.text}`).join('\n');
        messages.push({
            role: 'user',
            content: `Conversation so far:\n${transcriptText}\n\n${opts.fromAgentName}: ${opts.message}`,
        });
    } else {
        messages.push({
            role: 'user',
            content: `${opts.fromAgentName} says: ${opts.message}`,
        });
    }

    let assistantText = '';
    for await (const event of runChatTurn({
        agent: opts.agent,
        messages,
        tools: opts.tools,
        toolCtx: opts.toolCtx,
        systemPrompt: augmentedSystemPrompt,
        maxIterations: opts.maxIterations,
        fetchImpl: opts.fetchImpl,
        signal: opts.signal,
    })) {
        if (event.type === 'chunk') {
            assistantText += event.text;
        } else if (event.type === 'error') {
            throw new Error(event.message);
        } else if (event.type === 'done') {
            break;
        }
    }
    return assistantText.trim() || '[empty response]';
}
