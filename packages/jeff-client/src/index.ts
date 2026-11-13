/**
 * A client for a Jeff decision server (`jeff-serve`, `POST /v1/systemone`).
 * A request names a model (the base or an adapter such as
 * `playbook-rule-match`), a state (text, or named fields of text) and one or
 * more questions; the answer gives each question's probabilities and the
 * most likely choice. Calls fail loudly: a server error, a refused key or an
 * answer without the question asked all throw a JeffError.
 */

export interface ChoiceQuestion {
    type: 'choice';
    instructions?: string;
    /** Each option's name and what it means. */
    criteria: Record<string, string | null>;
}

export interface ChoiceAnswer {
    type: 'choice';
    probabilities: Record<string, number>;
    choice: string;
    confidence: number;
}

export interface JeffResponse {
    model: string;
    answers: Record<string, ChoiceAnswer | { type: string; [key: string]: unknown }>;
    usage: { input_tokens: number; output_tokens: number; orders: number };
    timing: { model_ms: number; server_ms: number };
}

export class JeffError extends Error {
    constructor(
        readonly status: number | null,
        message: string,
    ) {
        super(message);
        this.name = 'JeffError';
    }
}

export interface JeffClientOptions {
    /** The server's address, e.g. https://api.jeffhub.ai */
    baseUrl: string;
    /** Bearer key; null for a server that needs none. */
    apiKey: string | null;
    fetch?: typeof fetch;
    /** Milliseconds before a call is abandoned (default 60 000). */
    timeoutMs?: number;
}

export class JeffClient {
    private readonly base: string;
    private readonly doFetch: typeof fetch;
    private readonly timeoutMs: number;

    constructor(private readonly opts: JeffClientOptions) {
        if (!/^https?:\/\//.test(opts.baseUrl)) throw new JeffError(null, `The Jeff server address must start with http:// or https://, not "${opts.baseUrl}"`);
        this.base = opts.baseUrl.replace(/\/$/, '');
        this.doFetch = opts.fetch ?? fetch;
        this.timeoutMs = opts.timeoutMs ?? 60_000;
    }

    /** Ask questions about a state; `orders: 2` asks each twice with the options reversed and averages. */
    async ask(request: { model: string; state: string | Record<string, string>; questions: Record<string, ChoiceQuestion>; orders?: 1 | 2 }): Promise<JeffResponse> {
        const res = await this.doFetch(`${this.base}/v1/systemone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}) },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new JeffError(res.status, `The Jeff server refused ${request.model} (${res.status}): ${body.slice(0, 300)}`);
        }
        const answer = (await res.json()) as JeffResponse;
        for (const key of Object.keys(request.questions)) {
            if (!answer.answers?.[key]) throw new JeffError(res.status, `The Jeff server answered without question "${key}"`);
        }
        return answer;
    }

    /** One choice question; returns the choice and its probability. */
    async choose(model: string, state: string | Record<string, string>, question: ChoiceQuestion, orders: 1 | 2 = 1): Promise<ChoiceAnswer & { usage: JeffResponse['usage'] }> {
        const r = await this.ask({ model, state, questions: { q: question }, orders });
        const a = r.answers.q!;
        if (a.type !== 'choice') throw new JeffError(null, `The Jeff server answered a choice question with ${a.type}`);
        return { ...(a as ChoiceAnswer), usage: r.usage };
    }
}
