/**
 * Whimsical present-progressive verbs for the live tool-use indicator. One is
 * picked per assistant turn and stays stable until the turn finishes, so the
 * user sees "Flibbertigibbeting…" not a flickering verb-of-the-frame.
 */
export const WHIMSICAL_VERBS = [
  'Flibbertigibbeting',
  'Pondering',
  'Cogitating',
  'Ruminating',
  'Sleuthing',
  'Distilling',
  'Untangling',
  'Marshalling',
  'Whittling',
  'Concocting',
  'Calibrating',
  'Spelunking',
  'Foraging',
  'Tinkering',
  'Bushwhacking',
  'Triangulating',
  'Wrangling',
  'Unspooling',
  'Hobnobbing',
  'Conjuring',
  'Fossicking',
  'Burnishing',
  'Reticulating',
  'Confabulating',
  'Disambiguating',
  'Mulling',
  'Brainstorming',
  'Wayfinding',
  'Beavering',
  'Percolating',
];

/** snake_case → "Sentence case" — generic enough for any tool in the registry. */
export function prettyToolName(name: string): string {
  const spaced = name.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Pull a short, human-readable label out of a tool's arguments — the one
 * thing a user would most want to see at a glance ("Wrote section:
 * Background" rather than just "Wrote section"). Falls back to array-length
 * summaries for tools that pass collections (e.g. set_outline with 5
 * headings).
 */
export function summarizeArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  const labelKeys = ['title', 'heading', 'name', 'query', 'message', 'path', 'file_id', 'doc_id'];
  for (const key of labelKeys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      const trimmed = v.trim();
      return trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed;
    }
  }
  for (const [key, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length > 0) {
      return `${v.length} ${key.replace(/_/g, ' ')}`;
    }
  }
  return null;
}
