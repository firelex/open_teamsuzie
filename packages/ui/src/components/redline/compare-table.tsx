import * as React from "react"
import { Download } from "lucide-react"
import type {
  DocumentDiffResult,
  ParagraphDiffEvent,
} from "@teamsuzie/docx-diff"

import { cn } from "../../lib/utils"

/**
 * One row of the topic-based comparison. The host (compare_documents
 * tool's LLM summarizer) groups raw paragraph events into topics with
 * plain-English summaries of each side. Shape mirrors the server-side
 * `CompareTopic` from @teamsuzie/agent-runtime.
 */
export interface CompareTopic {
  topic: string
  left: string
  right: string
}

/**
 * Two-column side-by-side comparison table.
 *
 * Two render modes, chosen by the host's data:
 *
 *  1. **Topic mode** (preferred) — host passes `topics`, each rendered
 *     as one row with a sticky topic header + plain-English left/right
 *     summaries. This is what users normally want: "what changed"
 *     grouped by subject, not by paragraph.
 *
 *  2. **Mechanical mode** (fallback) — host passes only `result` (a
 *     `DocumentDiffResult` from @teamsuzie/docx-diff). The table
 *     renders one row per non-`unchanged` paragraph event with
 *     word-level diff inline. Use this when no LLM summarizer is
 *     configured.
 *
 * Sister artifact to `<RedlinePanelContent>` (continuous-flow inline
 * redline). Use this for analytical "what changed" review; use the
 * redline panel for the literal tracked-change reading view.
 */
export interface CompareTableProps {
  result: DocumentDiffResult
  /** Topic-grouped rows when the host has them up-front. When present
   *  (and no streaming callback fires), the topic-row layout is used
   *  and events are ignored. */
  topics?: CompareTopic[]
  /**
   * Optional async iterator the panel subscribes to on mount. Each
   * yielded topic is appended to the table in arrival order; while the
   * stream is open the header shows "Synthesizing topics…" and the
   * mechanical event-per-row view is shown as a fallback for any
   * rows not yet covered by a topic. When the iterator completes,
   * the topic view takes over fully.
   */
  onLoadTopics?: (signal: AbortSignal) => AsyncIterable<CompareTopic>
  /** Optional download URL for the blackline DOCX (if the host has one). */
  downloadHref?: string
  /** Override the displayed name for the left side. */
  headerLeft?: string
  /** Override the displayed name for the right side. */
  headerRight?: string
  className?: string
}

export function CompareTable({
  result,
  topics,
  onLoadTopics,
  downloadHref,
  headerLeft,
  headerRight,
  className,
}: CompareTableProps): React.ReactElement {
  const visible = result.events.filter((e) => e.kind !== "unchanged")
  const leftName = headerLeft ?? result.left.name
  const rightName = headerRight ?? result.right.name
  const stats = formatStatsLine(result)

  // Streaming state. If onLoadTopics is provided, subscribe on mount;
  // accumulate topics as they arrive; mark "loading" while open.
  const [streamedTopics, setStreamedTopics] = React.useState<CompareTopic[]>([])
  const [streamError, setStreamError] = React.useState<string | null>(null)
  const [isStreaming, setIsStreaming] = React.useState(Boolean(onLoadTopics))
  React.useEffect(() => {
    if (!onLoadTopics) return
    const ac = new AbortController()
    setStreamedTopics([])
    setStreamError(null)
    setIsStreaming(true)
    let cancelled = false
    void (async () => {
      try {
        for await (const t of onLoadTopics(ac.signal)) {
          if (cancelled) return
          setStreamedTopics((prev) => [...prev, t])
        }
      } catch (err) {
        if (cancelled) return
        setStreamError(err instanceof Error ? err.message : "stream failed")
      } finally {
        if (!cancelled) setIsStreaming(false)
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [onLoadTopics])

  const effectiveTopics = streamedTopics.length > 0 ? streamedTopics : topics
  const useTopics = (effectiveTopics?.length ?? 0) > 0

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">
              {leftName} → {rightName}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {stats}
              {isStreaming && (
                <span className="ml-2 inline-flex items-center gap-1 text-foreground">
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-saffron-400" />
                  Synthesizing topics…
                </span>
              )}
              {streamError && (
                <span className="ml-2 text-destructive">
                  topic synthesis failed — showing paragraph view
                </span>
              )}
            </div>
          </div>
          {downloadHref && (
            <a
              href={downloadHref}
              download
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent/40"
              title="Download a tracked-change .docx (accept-all reproduces right)"
            >
              <Download className="size-3.5" aria-hidden />
              Download blackline
            </a>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {useTopics ? (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm">
              <tr>
                <th className="w-1/2 border-b border-border px-3 py-2 text-left font-semibold">
                  <span className="block truncate" title={leftName}>
                    {leftName}
                  </span>
                </th>
                <th className="w-1/2 border-b border-l border-border px-3 py-2 text-left font-semibold">
                  <span className="block truncate" title={rightName}>
                    {rightName}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {effectiveTopics!.map((t, idx) => (
                <TopicRows key={idx} topic={t} />
              ))}
            </tbody>
          </table>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            The two documents are identical (after paragraph-level alignment).
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm">
              <tr>
                <th className="w-1/2 border-b border-border px-3 py-2 text-left font-semibold">
                  <span className="block truncate" title={leftName}>
                    {leftName}
                  </span>
                </th>
                <th className="w-1/2 border-b border-l border-border px-3 py-2 text-left font-semibold">
                  <span className="block truncate" title={rightName}>
                    {rightName}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event, idx) => (
                <CompareRow key={idx} event={event} />
              ))}
            </tbody>
          </table>
        )}
        {!useTopics && result.stats.unchanged > 0 && visible.length > 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            {result.stats.unchanged} paragraph
            {result.stats.unchanged === 1 ? "" : "s"} unchanged (hidden).
          </p>
        )}
      </div>
    </div>
  )
}

function TopicRows({ topic }: { topic: CompareTopic }) {
  // Each topic = two rows: a topic-name header spanning both columns,
  // then a content row with the left/right plain-English summaries.
  // Visually distinct so users scan topics first, then drill into the
  // side-by-side text for the current topic.
  const isAbsentLeft = /^\s*\(\s*absent\s*\)\s*$/i.test(topic.left)
  const isAbsentRight = /^\s*\(\s*absent\s*\)\s*$/i.test(topic.right)
  return (
    <>
      <tr className="border-t border-border bg-muted/30">
        <td
          colSpan={2}
          className="px-3 py-1.5 text-[12px] font-semibold tracking-tight"
        >
          {topic.topic}
        </td>
      </tr>
      <tr className="border-b border-border align-top">
        <td
          className={cn(
            "px-3 py-2.5 leading-relaxed",
            isAbsentLeft && "bg-muted/20 text-xs italic text-muted-foreground",
          )}
        >
          {topic.left || "—"}
        </td>
        <td
          className={cn(
            "border-l border-border px-3 py-2.5 leading-relaxed",
            isAbsentRight && "bg-muted/20 text-xs italic text-muted-foreground",
          )}
        >
          {topic.right || "—"}
        </td>
      </tr>
    </>
  )
}

function CompareRow({ event }: { event: ParagraphDiffEvent }) {
  if (event.kind === "modified") {
    const tag = event.moved ? "modified · moved" : "modified"
    return (
      <tr className="border-b border-border align-top">
        <td className="px-3 py-2.5 leading-relaxed">
          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            ¶{event.leftIndex + 1} · {tag}
          </div>
          <div className="whitespace-pre-wrap">
            {event.ops.map((op, i) =>
              op.kind === "insert" ? null : (
                <DiffOpSpan key={i} kind={op.kind} text={op.text} />
              ),
            )}
          </div>
        </td>
        <td className="border-l border-border px-3 py-2.5 leading-relaxed">
          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            ¶{event.rightIndex + 1} · {Math.round(event.similarity * 100)}%
            match
          </div>
          <div className="whitespace-pre-wrap">
            {event.ops.map((op, i) =>
              op.kind === "delete" ? null : (
                <DiffOpSpan key={i} kind={op.kind} text={op.text} />
              ),
            )}
          </div>
        </td>
      </tr>
    )
  }
  if (event.kind === "deleted") {
    return (
      <tr className="border-b border-border align-top">
        <td className="bg-destructive/5 px-3 py-2.5 leading-relaxed">
          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            ¶{event.leftIndex + 1} · deleted
          </div>
          <p className="whitespace-pre-wrap text-destructive line-through decoration-destructive/60">
            {event.text}
          </p>
        </td>
        <td className="border-l border-border bg-muted/20 px-3 py-2.5 text-xs italic text-muted-foreground">
          (removed)
        </td>
      </tr>
    )
  }
  // inserted
  return (
    <tr className="border-b border-border align-top">
      <td className="bg-muted/20 px-3 py-2.5 text-xs italic text-muted-foreground">
        (not in left)
      </td>
      <td className="border-l border-border bg-emerald-500/5 px-3 py-2.5 leading-relaxed">
        <div className="mb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
          ¶{event.rightIndex + 1} · inserted
        </div>
        <p className="whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">
          {event.text}
        </p>
      </td>
    </tr>
  )
}

function DiffOpSpan({
  kind,
  text,
}: {
  kind: "equal" | "insert" | "delete"
  text: string
}) {
  if (kind === "equal") return <span>{text}</span>
  if (kind === "delete") {
    return (
      <span className="rounded-sm bg-destructive/15 px-0.5 text-destructive line-through decoration-destructive/60">
        {text}
      </span>
    )
  }
  return (
    <span className="rounded-sm bg-emerald-500/15 px-0.5 text-emerald-700 dark:text-emerald-300">
      {text}
    </span>
  )
}

function formatStatsLine(result: DocumentDiffResult): string {
  const { unchanged, modified, deleted, inserted, moved } = result.stats
  const parts: string[] = []
  if (modified) parts.push(`${modified} modified`)
  if (deleted) parts.push(`${deleted} deleted`)
  if (inserted) parts.push(`${inserted} inserted`)
  if (moved) parts.push(`${moved} moved`)
  parts.push(`${unchanged} unchanged`)
  return parts.join(" · ")
}
