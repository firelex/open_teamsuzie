import { chatWithTools, type ToolCall, type ToolChatMessage, type ToolDefinition } from '@teamsuzie/models';

export type { ToolCall, ToolChatMessage, ToolDefinition };

/** One model turn: what it wrote and the tools it asked to call. */
export interface ModelTurn {
    text: string;
    toolCalls: ToolCall[];
}

/** The model that repairs routes. It must support tool calls. */
export interface RouteModel {
    /** Recorded on learned routes as `learner:<id>`. */
    id: string;
    chat(messages: ToolChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<ModelTurn>;
}

export interface OpenAiCompatibleModelOptions {
    /** The runtime's OpenAI-compatible base URL, e.g. `http://gpu-box:8000/v1`. */
    baseUrl: string;
    model: string;
    apiKey?: string;
    maxTokens: number;
    fetchImpl?: typeof fetch;
}

/** A tool-calling model served by an OpenAI-compatible runtime (vLLM, llama.cpp, LM Studio, Ollama…). */
export function openAiCompatibleRouteModel(opts: OpenAiCompatibleModelOptions): RouteModel {
    const baseUrl = opts.baseUrl.replace(/\/+$/, '');
    return {
        id: opts.model,
        chat: async (messages, tools, signal) => {
            const turn = await chatWithTools({
                config: { id: 'openai-compatible', format: 'openai', baseUrl },
                apiKey: opts.apiKey,
                model: opts.model,
                messages,
                tools,
                maxTokens: opts.maxTokens,
                fetchImpl: opts.fetchImpl ?? fetch,
                signal,
            });
            return { text: turn.text, toolCalls: turn.toolCalls };
        },
    };
}
