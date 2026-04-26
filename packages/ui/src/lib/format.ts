/** Format byte counts compactly for chip labels and tooltips. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build a download-safe filename. Replaces non-`\w`/`-`/`.` characters with
 * underscores, collapses leading/trailing underscores, and ensures the given
 * extension is appended exactly once.
 */
export function safeFilename(input: string, ext: string): string {
  const cleaned = input.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'document';
  return cleaned.endsWith(ext) ? cleaned : `${cleaned}${ext}`;
}
