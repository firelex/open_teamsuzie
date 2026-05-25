import * as React from 'react'
import { Download } from 'lucide-react'
import { LoadingState } from '../loading-state'
import { RedlineRuns, type RedlineParagraph } from './redline-runs'
import { ensureRedlineStyles } from './redline-styles'

/**
 * Inline redline preview rendered as the body of a side-panel tab.
 *
 * The component is host-agnostic: it asks for paragraphs via the
 * `onLoadRedline` callback, which the host wires to its own server
 * endpoint (suzielaw: `/api/files/:sessionId/:fileId/redline-view`;
 * drafter: its document-runtime equivalent). The host's adapter is
 * responsible for normalizing wire shapes — runs handed to this
 * component MUST use upstream `'equal' | 'insert' | 'delete'` naming.
 *
 * Cross-component sync is done via window CustomEvents that are
 * internal to the redline subsystem (not part of the public API):
 *
 *   - `redline:refresh` — host fires this after an accept/reject
 *     mutates the underlying file. Detail shape:
 *       { sessionId, fileId, paragraphs? }
 *     If `paragraphs` is present we set state directly; otherwise we
 *     re-invoke `onLoadRedline`. Events for other `(sessionId, fileId)`
 *     pairs are ignored.
 *
 *   - `redline:focus-revision` — chat-side cards fire this with
 *     `{ revisionId }`. The panel scrolls to the first inline run
 *     carrying that revision id and ring-flashes it.
 *
 *   - `redline:focus-card` — inline runs fire this with `{ key }`
 *     (the card key produced by `TrackedChangesPanel`). Other panels
 *     listen.
 *
 * These names are stable — chats expect them everywhere. Consumers
 * don't customize them.
 */

export interface FocusCardEventDetail {
  key: string
}

export interface FocusRevisionEventDetail {
  revisionId: number
}

interface RedlineRefreshDetail {
  sessionId: string
  fileId: string
  paragraphs?: RedlineParagraph[]
}

export interface RedlinePanelContentProps {
  sessionId: string
  fileId: string
  fileName: string
  /** Namespace prefix for `redline:focus-card` window events. */
  chatId: string
  /**
   * Optional map from revision id → card focus key, used when
   * dispatching the `redline:focus-card` event. When omitted, the
   * fallback key is `${chatId}:${revisionId}`.
   */
  revisionCardKeys?: Record<number, string>
  /**
   * Host-provided fetcher. Receives session+file ids; returns
   * paragraphs in upstream naming (`'equal' | 'insert' | 'delete'`).
   * May reject with any Error; the component surfaces `error.message`.
   * Should respect the AbortSignal if provided.
   */
  onLoadRedline: (
    sessionId: string,
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<{ paragraphs: RedlineParagraph[] }>
  /** Optional download URL for the header download button. */
  downloadHref?: string
}

export function RedlinePanelContent({
  sessionId,
  fileId,
  fileName,
  chatId,
  revisionCardKeys,
  onLoadRedline,
  downloadHref,
}: RedlinePanelContentProps) {
  ensureRedlineStyles()
  const [paragraphs, setParagraphs] = React.useState<RedlineParagraph[] | null>(
    null,
  )
  const [error, setError] = React.useState<string | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  // Pending revision-id focus that came in before the paragraphs loaded.
  const pendingFocusRef = React.useRef<number | null>(null)

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await onLoadRedline(sessionId, fileId, signal)
        if (signal?.aborted) return
        setParagraphs(data.paragraphs)
        setError(null)
      } catch (err) {
        if (signal?.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load preview')
      }
    },
    [sessionId, fileId, onLoadRedline],
  )

  React.useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  // Listen for refresh (after an accept/reject) and external focus events.
  React.useEffect(() => {
    function onRefresh(ev: Event) {
      const ce = ev as CustomEvent<RedlineRefreshDetail>
      if (ce.detail?.sessionId !== sessionId || ce.detail?.fileId !== fileId)
        return
      if (ce.detail.paragraphs) {
        setParagraphs(ce.detail.paragraphs)
        setError(null)
        return
      }
      void load()
    }
    function onFocusRevision(ev: Event) {
      const ce = ev as CustomEvent<FocusRevisionEventDetail>
      const rid = ce.detail?.revisionId
      if (rid === undefined) return
      if (!paragraphs) {
        pendingFocusRef.current = rid
        return
      }
      focusRevision(rid)
    }
    window.addEventListener('redline:refresh', onRefresh as EventListener)
    window.addEventListener(
      'redline:focus-revision',
      onFocusRevision as EventListener,
    )
    return () => {
      window.removeEventListener('redline:refresh', onRefresh as EventListener)
      window.removeEventListener(
        'redline:focus-revision',
        onFocusRevision as EventListener,
      )
    }
  }, [sessionId, fileId, load, paragraphs])

  // Once paragraphs land, fire any pending focus.
  React.useEffect(() => {
    if (!paragraphs) return
    const rid = pendingFocusRef.current
    if (rid === null) return
    pendingFocusRef.current = null
    // Defer so the DOM has painted.
    window.requestAnimationFrame(() => focusRevision(rid))
  }, [paragraphs])

  function focusRevision(revisionId: number) {
    const root = containerRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(
      `[data-revision-id="${revisionId}"]`,
    )
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.classList.add('redline-flash')
    window.setTimeout(() => target.classList.remove('redline-flash'), 1200)
  }

  function handleSpanClick(revisionId: number | string) {
    const ridNum =
      typeof revisionId === 'number' ? revisionId : Number(revisionId)
    const key = revisionCardKeys?.[ridNum] ?? `${chatId}:${ridNum}`
    window.dispatchEvent(
      new CustomEvent<FocusCardEventDetail>('redline:focus-card', {
        detail: { key },
      }),
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">
            {fileName}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Inline tracked changes — click an edit to find its card
          </div>
        </div>
        {downloadHref && (
          <a
            href={downloadHref}
            download
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent/40"
            title="Download the .docx with native Word tracked changes"
          >
            <Download className="size-3.5" aria-hidden />
            Download
          </a>
        )}
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed"
      >
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!paragraphs && !error && <LoadingState>Loading redline…</LoadingState>}
        {paragraphs && paragraphs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No paragraphs in document.
          </p>
        )}
        {paragraphs && paragraphs.length > 0 && (
          <RedlineRuns
            paragraphs={paragraphs}
            onRunSelect={(revisionId) => handleSpanClick(revisionId)}
          />
        )}
      </div>
    </div>
  )
}
