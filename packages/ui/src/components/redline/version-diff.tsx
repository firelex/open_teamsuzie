import * as React from "react"
import { Download } from "lucide-react"
import type {
  DocumentDiffResult,
  ParagraphDiffEvent,
} from "@teamsuzie/docx-diff"

import { cn } from "../../lib/utils"
import { RedlineSpan } from "./redline-span"

/**
 * Whole-document diff renderer for a `DocumentDiffResult` produced by
 * `@teamsuzie/docx-diff`. Renders:
 *   - a header with left/right names and a roll-up stats line,
 *   - an optional "Download DOCX" anchor when a tracked-change export URL
 *     is available on the host,
 *   - one block per non-`unchanged` paragraph event, with inline word-level
 *     ins/del runs for `modified` events.
 *
 * Unchanged paragraphs are intentionally summarized by count, not rendered —
 * legal/contract redlines need to focus on what's different; the rest is noise.
 */
export interface VersionDiffProps {
  result: DocumentDiffResult
  /** Optional download URL. If omitted, no download button is shown. */
  downloadHref?: string
  /** Override the displayed name for the left side. */
  headerLeft?: string
  /** Override the displayed name for the right side. */
  headerRight?: string
  className?: string
}

export function VersionDiff({
  result,
  downloadHref,
  headerLeft,
  headerRight,
  className,
}: VersionDiffProps): React.ReactElement {
  const stats = formatStatsLine(result)
  const visible = result.events.filter((e) => e.kind !== "unchanged")
  const leftName = headerLeft ?? result.left.name
  const rightName = headerRight ?? result.right.name

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
              title="Download a tracked-change .docx Word can accept-all"
            >
              <Download className="size-3.5" aria-hidden />
              Download DOCX
            </a>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {visible.length === 0 ? (
          <p className="text-muted-foreground">
            The two documents are identical (after paragraph-level alignment).
          </p>
        ) : (
          visible.map((event, idx) => <DiffEventBlock key={idx} event={event} />)
        )}
        {result.stats.unchanged > 0 && visible.length > 0 && (
          <p className="pt-2 text-xs text-muted-foreground">
            {result.stats.unchanged} paragraph
            {result.stats.unchanged === 1 ? "" : "s"} unchanged.
          </p>
        )}
      </div>
    </div>
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

function DiffEventBlock({ event }: { event: ParagraphDiffEvent }) {
  if (event.kind === "modified") {
    const tag = event.moved ? "modified · moved" : "modified"
    return (
      <div className="rounded-md border border-border bg-card p-3">
        <div className="mb-1 text-xs text-muted-foreground">
          ¶{event.leftIndex + 1} → ¶{event.rightIndex + 1} ·{" "}
          {Math.round(event.similarity * 100)}% match · {tag}
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">
          {event.ops.map((op, i) => (
            <RedlineSpan key={i} kind={op.kind} text={op.text} />
          ))}
        </p>
      </div>
    )
  }
  if (event.kind === "deleted") {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
        <div className="mb-1 text-xs text-muted-foreground">
          ¶{event.leftIndex + 1} of left · deleted
        </div>
        <p className="whitespace-pre-wrap leading-relaxed text-destructive line-through decoration-destructive/60">
          {event.text}
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="mb-1 text-xs text-muted-foreground">
        ¶{event.rightIndex + 1} of right · inserted
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-emerald-700 dark:text-emerald-300">
        {event.text}
      </p>
    </div>
  )
}
