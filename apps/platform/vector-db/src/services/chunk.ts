/** Split text into windows of `chunkSize` words, each starting `chunkSize - overlap` words after the previous one. */
export function chunkContent(content: string, chunkSize: number, overlap: number): string[] {
    if (overlap < 0 || overlap >= chunkSize) {
        throw new Error(`chunkContent: overlap must be at least 0 and less than chunkSize (got ${overlap} and ${chunkSize})`);
    }
    const chunks: string[] = [];
    const words = content.split(/\s+/);

    let start = 0;
    while (start < words.length) {
        const end = Math.min(start + chunkSize, words.length);
        chunks.push(words.slice(start, end).join(' '));
        if (end >= words.length) break;
        start = end - overlap;
    }

    return chunks;
}
