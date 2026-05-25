/**
 * Client-side counterpart to `createProgressiveArtifactHandler` /
 * `parseNdjsonFromLlm` from `@teamsuzie/agent-runtime`. Subscribes to
 * an SSE endpoint and exposes each `data:` chunk as an async-iterable
 * item.
 *
 * Returns a *factory* `(signal: AbortSignal) => AsyncIterable<TChunk>`
 * rather than a hook so it slots straight into component props that
 * accept the same shape (e.g. `<CompareTable onLoadTopics={…}>`).
 * Components own the React lifecycle (effect, abort, state); this
 * helper owns the network + parsing.
 *
 * Frame contract (matches the server helper):
 *
 *   data: {<chunk fields>}\n\n        — one chunk
 *   data: {"done": true, "total": N}\n\n   — terminal success
 *   data: {"error": "…"}\n\n          — terminal failure (throws)
 *
 * Abort handling: passes the supplied signal to fetch; if the consumer
 * stops iterating early (or its component unmounts) the reader is
 * cancelled and the underlying HTTP stream closes — the server's
 * `res.on('close')` handler then aborts upstream work.
 */
export interface ProgressiveArtifactStreamOptions<TChunk> {
  /** SSE endpoint URL. Always POST. */
  url: string
  /** JSON body sent in the POST. */
  body: unknown
  /**
   * Parse one chunk payload into a typed object. Return `null` to
   * skip the chunk silently (e.g. it parsed but the shape's wrong).
   */
  parseChunk(raw: unknown): TChunk | null
  /** Optional request init overrides (headers, credentials, etc.). */
  init?: Omit<RequestInit, "body" | "method" | "signal">
}

/**
 * Build an async-iterable factory for a progressive-artifact endpoint.
 *
 * ```tsx
 * const loadTopics = progressiveArtifactStream({
 *   url: '/api/documents/compare/summary',
 *   body: { leftFileId, rightFileId, sessionId },
 *   parseChunk: (raw) => isCompareTopic(raw) ? raw : null,
 * })
 * <CompareTable onLoadTopics={loadTopics} ... />
 * ```
 */
export function progressiveArtifactStream<TChunk>(
  opts: ProgressiveArtifactStreamOptions<TChunk>,
): (signal: AbortSignal) => AsyncIterable<TChunk> {
  return async function* (signal: AbortSignal) {
    const res = await fetch(opts.url, {
      ...opts.init,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.init?.headers ?? {}),
      },
      body: JSON.stringify(opts.body),
      signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `progressive artifact stream failed: ${res.status} ${text}`,
      )
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split("\n\n")
        buffer = frames.pop() ?? ""
        for (const frame of frames) {
          const line = frame
            .split("\n")
            .find((l) => l.startsWith("data: "))
          if (!line) continue
          let payload: unknown
          try {
            payload = JSON.parse(line.slice(6))
          } catch {
            // Frame couldn't be parsed; skip silently — the server
            // shouldn't emit these but the contract tolerates malformed
            // frames so a stray chunk never kills the stream.
            continue
          }
          if (payload && typeof payload === "object") {
            const p = payload as { error?: unknown; done?: unknown }
            if (typeof p.error === "string") throw new Error(p.error)
            if (p.done === true) return
          }
          const parsed = opts.parseChunk(payload)
          if (parsed !== null) yield parsed
        }
      }
    } finally {
      try { await reader.cancel() } catch { /* noop */ }
    }
  }
}
