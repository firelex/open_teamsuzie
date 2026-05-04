import type { CellFormat } from './types.js';

export interface ColumnPreset {
    /**
     * Pattern matched against column titles. A string is treated as a
     * case-insensitive substring; a RegExp is used verbatim — caller
     * controls flags (commonly `i` for case-insensitive).
     */
    match: string | RegExp;
    /** Default prompt to seed when this preset matches. */
    prompt: string;
    /** Default format for the cell runner / coercer. */
    format: CellFormat;
    /** Optional stable identifier — useful for analytics / serialization. */
    id?: string;
}

/**
 * Registry of column presets used by `<ColumnHeaderEditor>` (G6) to autofill
 * prompt + format when a user types a column title. Order matters: the
 * first registered preset whose `match` hits the title wins. The package
 * ships zero presets — apps register their own (e.g. suzielaw's G9 legal
 * preset pack registers parties / governing law / term / termination / ...).
 */
export class ColumnPresetRegistry {
    private presets: ColumnPreset[] = [];

    register(preset: ColumnPreset): this {
        this.presets.push(preset);
        return this;
    }

    registerAll(presets: Iterable<ColumnPreset>): this {
        for (const p of presets) this.presets.push(p);
        return this;
    }

    /**
     * First preset whose `match` fits the title, in registration order.
     * Returns `null` for empty titles or no match.
     */
    match(title: string): ColumnPreset | null {
        if (typeof title !== 'string') return null;
        const trimmed = title.trim();
        if (trimmed.length === 0) return null;
        for (const preset of this.presets) {
            if (matchTitle(preset.match, trimmed)) return preset;
        }
        return null;
    }

    /** Snapshot of all presets in registration order. */
    list(): ColumnPreset[] {
        return [...this.presets];
    }

    clear(): void {
        this.presets = [];
    }
}

function matchTitle(pattern: string | RegExp, title: string): boolean {
    if (typeof pattern === 'string') {
        return title.toLowerCase().includes(pattern.toLowerCase());
    }
    return pattern.test(title);
}
