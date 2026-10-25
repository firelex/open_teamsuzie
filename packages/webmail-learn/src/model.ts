import { chatOnce } from '@teamsuzie/models';

/** The model that proposes route repairs. `complete` returns its whole reply as text. */
export interface RouteModel {
    /** Recorded on learned routes as `learner:<id>`. */
    id: string;
    complete(prompt: string, signal?: AbortSignal): Promise<string>;
}

export interface OpenAiCompatibleModelOptions {
    /** The runtime's OpenAI-compatible base URL, e.g. `http://gpu-box:8000/v1`. */
    baseUrl: string;
    model: string;
    apiKey?: string;
    maxTokens: number;
    fetchImpl?: typeof fetch;
}

/** A model served by an OpenAI-compatible runtime (vLLM, llama.cpp, LM Studio, Ollama…), asked for a JSON reply. */
export function openAiCompatibleRouteModel(opts: OpenAiCompatibleModelOptions): RouteModel {
    const baseUrl = opts.baseUrl.replace(/\/+$/, '');
    return {
        id: opts.model,
        complete: (prompt, signal) => chatOnce({
            config: { id: 'openai-compatible', format: 'openai', baseUrl },
            apiKey: opts.apiKey,
            model: opts.model,
            messages: [{ role: 'user', content: prompt }],
            maxTokens: opts.maxTokens,
            fetchImpl: opts.fetchImpl ?? fetch,
            json: true,
            signal,
        }),
    };
}
