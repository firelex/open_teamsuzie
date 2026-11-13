/**
 * Read a server-sent event stream whose events are one JSON object each
 * (`data: {...}` blocks separated by a blank line), yielding the objects in
 * order. A `data:` line that is not JSON throws: the server and the page
 * agree on the format, so a broken event is a bug to see, not to skip.
 */
export async function* readJsonEvents<T = unknown>(res: Response): AsyncGenerator<T> {
  if (!res.body) throw new Error('The response has no body to read events from');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = function* (block: string): Generator<T> {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    try {
      yield JSON.parse(data) as T;
    } catch (err) {
      throw new Error(`An event in the stream is not JSON (${err instanceof Error ? err.message : String(err)}): ${data.slice(0, 200)}`);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) yield* parse(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield* parse(buffer);
}
