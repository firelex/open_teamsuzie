/** Price of one model, per million tokens, in the price book's currency. */
export interface ModelPrice {
    inputPerMillion: number;
    outputPerMillion: number;
}

/** Thrown when a cost is needed for a model the price book does not list. */
export class UnpricedModelError extends Error {
    readonly code = 'unpriced_model';
    constructor(readonly model: string) {
        super(`No price is configured for the model ${model}, so its cost cannot be worked out.`);
    }
}

/**
 * Model prices in one currency. Costs are kept in micro-units (millionths
 * of the currency unit) as integers, so sums are exact.
 */
export class PriceBook {
    private readonly prices: Map<string, ModelPrice>;

    constructor(
        readonly currency: string,
        prices: Record<string, ModelPrice>,
    ) {
        if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`currency must be a three-letter code such as USD, not "${currency}"`);
        this.prices = new Map();
        for (const [model, p] of Object.entries(prices)) {
            for (const [k, v] of Object.entries(p)) {
                if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
                    throw new Error(`price ${k} for ${model} must be a number of at least 0`);
                }
            }
            if (typeof p.inputPerMillion !== 'number' || typeof p.outputPerMillion !== 'number') {
                throw new Error(`price for ${model} needs inputPerMillion and outputPerMillion`);
            }
            this.prices.set(model, { inputPerMillion: p.inputPerMillion, outputPerMillion: p.outputPerMillion });
        }
    }

    /**
     * Parse `{"model": {"inputPerMillion": 0.8, "outputPerMillion": 2.4}, ...}`.
     * Throws with a plain message on malformed input.
     */
    static parse(currency: string, json: string): PriceBook {
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch (err) {
            throw new Error(`model prices are not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('model prices must be a JSON object keyed by model id');
        }
        return new PriceBook(currency, parsed as Record<string, ModelPrice>);
    }

    has(model: string): boolean {
        return this.prices.has(model);
    }

    models(): string[] {
        return [...this.prices.keys()];
    }

    /** Cost in micro-units. Throws UnpricedModelError for an unknown model. */
    costMicros(model: string, inputTokens: number, outputTokens: number): number {
        const p = this.prices.get(model);
        if (!p) throw new UnpricedModelError(model);
        return Math.round(inputTokens * p.inputPerMillion + outputTokens * p.outputPerMillion);
    }
}

export const toMicros = (amount: number) => Math.round(amount * 1_000_000);
export const fromMicros = (micros: number) => micros / 1_000_000;
