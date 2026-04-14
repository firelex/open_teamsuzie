import type { SkillRenderContext } from './types.js';

/**
 * Replace `{{KEY}}` tokens in `template` with values from `context`.
 *
 * Also matches `{{KEY\\_WITH\\_UNDERSCORES}}` — useful when the template
 * has been run through a Markdown renderer that escaped underscores.
 *
 * Keys missing from the context (or with undefined values) render as empty strings.
 * Callers that want a different fallback (e.g. `$KEY` so the agent reads from env)
 * should pre-fill the context with those values.
 */
export function interpolate(template: string, context: SkillRenderContext): string {
    let output = template;
    for (const [key, raw] of Object.entries(context)) {
        const value = raw ?? '';
        const escapedUnderscoreKey = key.replace(/_/g, '\\\\_');
        const pattern = new RegExp(`\\{\\{(?:${key}|${escapedUnderscoreKey})\\}\\}`, 'g');
        output = output.replace(pattern, value);
    }
    return output;
}
