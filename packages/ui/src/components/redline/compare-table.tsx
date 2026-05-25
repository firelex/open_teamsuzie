import * as React from "react"
import { Download } from "lucide-react"
import type {
  DocumentDiffResult,
  ParagraphDiffEvent,
} from "@teamsuzie/docx-diff"

import { cn } from "../../lib/utils"

/**
 * Two-column side-by-side comparison table for a `DocumentDiffResult`.
 * One row per non-`unchanged` paragraph event:
 *   - **modified**: left cell shows the left paragraph with deletions
 *     struck through, right cell shows the right paragraph with
 *     insertions highlighted.
 *   - **deleted**: left cell shows the deleted paragraph struck through,
 *     right cell is empty.
 *   - **inserted**: left cell empty, right cell shows the inserted
 *     paragraph highlighted.
 *
 * Sister artifact to `<RedlinePanelContent>` (continuous-flow inline
 * redline). Use this for analytical "what changed" review; use the
 * redline panel for the literal tracked-change reading view.
 */
export interface CompareTableProps {
  result: DocumentDiffResult
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
  downloadHref,
  headerLeft,
  headerRight,
  className,
}: CompareTableProps): React.ReactElement {
  const visible = result.events.filter((e) => e.kind !== "unchanged")
  const leftName = headerLeft ?? result.left.name
  const rightName = headerRight ?? result.right.name
  const stats = formatStatsLine(result)

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">
              {leftName} → {rightName}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{stats}</div>
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
        {visible.length === 0 ? (
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
        {result.stats.unchanged > 0 && visible.length > 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            {result.stats.unchanged} paragraph
            {result.stats.unchanged === 1 ? "" : "s"} unchanged (hidden).
          </p>
        )}
      </div>
    </div>
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
