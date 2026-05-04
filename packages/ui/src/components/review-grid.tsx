import * as React from "react"
import {
  SENTINEL_OPEN,
  type Citation,
} from "@teamsuzie/citations"
import { WHIMSICAL_VERBS } from "../lib/tool-display"
import type {
  CellStatus,
  Review,
  ReviewCell,
  ReviewColumn,
  ReviewDocument,
  ReviewSnapshot,
} from "@teamsuzie/grid-review"

import { cn } from "../lib/utils"
import { CitationChip } from "./citation-chip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog"

export type { Review, ReviewCell, ReviewColumn, ReviewDocument, ReviewSnapshot }

export interface RunningCellLive {
  columnId: string
  rowId: string
  /** Live token stream for the active cell; preempts the snapshot's value. */
  partialText: string
  retrievedSummary?: string
  retrievedChunks?: Array<{ content: string; distance?: number }>
  /** Effective retrieval query — when query rewriting (HyDE) is in play, this
   *  differs from the column prompt. Surfaced in the modal for debugging. */
  retrievalQuery?: string
}

export interface ReviewGridProps {
  snapshot: ReviewSnapshot
  /** Optional: column titles can be edited inline once G6 lands. */
  onColumnClick?: (column: ReviewColumn) => void
  /** When provided, columns get a hover ⋯ remove button. */
  onColumnRemove?: (column: ReviewColumn) => void
  /** When provided, rows get a hover ⋯ remove button. */
  onRowRemove?: (document: ReviewDocument) => void
  /** When provided, the cell expand modal gets a Regenerate button. */
  onCellRegenerate?: (column: ReviewColumn, document: ReviewDocument) => void | Promise<void>
  /** When true, the Regenerate button shows a busy state and is disabled. */
  busy?: boolean
  /** Cell currently running (drives the active-cell ring + modal live view). */
  runningCell?: RunningCellLive | null
  /** Map of doc handle → display label, used by citation chips. Optional. */
  docLabels?: Record<string, string>
  /** Click a citation chip in the expand modal. Host opens the preview surface. */
  onCitationJump?: (citation: Citation) => void
  className?: string
}

interface ExpandedCell {
  cell: ReviewCell | null  // null = empty cell (no run yet)
  column: ReviewColumn
  document: ReviewDocument
}

function StatusDot({ status }: { status: CellStatus | "empty" }) {
  if (status === "empty") return null
  if (status === "streaming") {
    return (
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
    )
  }
  if (status === "error") {
    return <span className="inline-block size-1.5 rounded-full bg-destructive" />
  }
  if (status === "pending") {
    return <span className="inline-block size-1.5 rounded-full bg-muted-foreground/40" />
  }
  return null
}

function truncateAtSentinel(text: string): string {
  const idx = text.indexOf(SENTINEL_OPEN)
  if (idx < 0) return text
  return text.slice(0, idx).trimEnd()
}

/** Pick a stable whimsical verb per (col, row) so it doesn't flicker. */
function whimsicalVerbFor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % WHIMSICAL_VERBS.length
  return WHIMSICAL_VERBS[idx]!
}

function parseCitations(raw: string | null): Citation[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (c): c is Citation =>
        c !== null && typeof c === "object" && typeof (c as Citation).id === "number",
    )
  } catch {
    return []
  }
}

function CellPreview({ cell, status }: { cell: ReviewCell | null; status: CellStatus | "empty" }) {
  if (status === "empty" || status === "pending") {
    return <span className="text-muted-foreground/60">—</span>
  }
  if (status === "error") {
    const msg = cell?.error ?? "Error"
    return <span className="text-destructive">{msg}</span>
  }
  if (!cell?.value) {
    return <span className="text-muted-foreground/60">—</span>
  }
  // Show first ~120 chars; modal shows full content.
  const compact = cell.value.replace(/\s+/g, " ").trim()
  return <span>{compact.length > 120 ? `${compact.slice(0, 120)}…` : compact}</span>
}

/**
 * Tabular review grid. Pure presentation: snapshot in, callbacks out.
 *
 * - Sticky header row with column titles (Z stacking on horizontal scroll).
 * - Sticky first column with document (row) names.
 * - Per-cell status dot (pending / streaming / error). Click expands the cell.
 * - Expand modal shows the full value with citation chips; clicking a chip
 *   bubbles up via `onCitationJump` so the host can open whatever preview
 *   surface it owns.
 *
 * Live updates work through normal React re-renders — pass a fresh snapshot
 * any time data changes.
 */
export function ReviewGrid({
  snapshot,
  onColumnClick,
  onColumnRemove,
  onRowRemove,
  onCellRegenerate,
  busy = false,
  runningCell,
  docLabels,
  onCitationJump,
  className,
}: ReviewGridProps) {
  const [expanded, setExpanded] = React.useState<ExpandedCell | null>(null)
  // Auto-follow the active cell during a run. Reset when a new run starts;
  // sticky-disable when the user manually closes the modal mid-run.
  const lastRunningKeyRef = React.useRef<string | null>(null)
  const userClosedDuringRunRef = React.useRef(false)

  // Build a lookup by (columnId, reviewDocumentId) → cell.
  const cellsByKey = React.useMemo(() => {
    const map = new Map<string, ReviewCell>()
    for (const cell of snapshot.cells) {
      map.set(`${cell.columnId}::${cell.reviewDocumentId}`, cell)
    }
    return map
  }, [snapshot.cells])

  // Auto-open / advance the modal as the running cell changes.
  React.useEffect(() => {
    const currentKey = runningCell
      ? `${runningCell.columnId}::${runningCell.rowId}`
      : null
    if (currentKey && runningCell && currentKey !== lastRunningKeyRef.current) {
      if (lastRunningKeyRef.current === null) {
        // Run just started after an idle period — re-enable auto-follow.
        userClosedDuringRunRef.current = false
      }
      if (!userClosedDuringRunRef.current) {
        const col = snapshot.columns.find((c) => c.id === runningCell.columnId)
        const doc = snapshot.documents.find((d) => d.id === runningCell.rowId)
        if (col && doc) {
          setExpanded({
            cell: cellsByKey.get(currentKey) ?? null,
            column: col,
            document: doc,
          })
        }
      }
    }
    lastRunningKeyRef.current = currentKey
  }, [runningCell, snapshot.columns, snapshot.documents, cellsByKey])

  const columnsSorted = React.useMemo(
    () =>
      [...snapshot.columns].sort(
        (a, b) => a.position - b.position || a.title.localeCompare(b.title),
      ),
    [snapshot.columns],
  )
  const docsSorted = React.useMemo(
    () =>
      [...snapshot.documents].sort(
        (a, b) => a.position - b.position || a.name.localeCompare(b.name),
      ),
    [snapshot.documents],
  )

  if (columnsSorted.length === 0 || docsSorted.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        {columnsSorted.length === 0 && docsSorted.length === 0
          ? "Add documents and columns to populate this review."
          : columnsSorted.length === 0
            ? "Add a column to start extracting answers."
            : "Add documents to populate the rows."}
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          "relative overflow-auto rounded-md border border-border bg-card",
          className,
        )}
      >
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-20 min-w-[200px] max-w-[280px] border-b border-r border-border bg-muted/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Document
              </th>
              {columnsSorted.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className="sticky top-0 z-10 min-w-[200px] border-b border-r border-border bg-muted/40 px-3 py-2 text-left text-xs font-semibold tracking-tight"
                >
                  <div className="group flex items-start justify-between gap-1">
                    {onColumnClick ? (
                      <button
                        type="button"
                        onClick={() => onColumnClick(col)}
                        className="block flex-1 min-w-0 text-left hover:underline underline-offset-2"
                      >
                        <span className="block truncate text-foreground">
                          {col.title}
                        </span>
                        <span className="block truncate text-[10px] font-normal text-muted-foreground">
                          {col.format}
                        </span>
                      </button>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <span className="block truncate text-foreground">
                          {col.title}
                        </span>
                        <span className="block truncate text-[10px] font-normal text-muted-foreground">
                          {col.format}
                        </span>
                      </div>
                    )}
                    {onColumnRemove && (
                      <button
                        type="button"
                        onClick={() => onColumnRemove(col)}
                        aria-label={`Remove ${col.title}`}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docsSorted.map((doc) => (
              <tr key={doc.id} className="hover:bg-accent/20">
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[200px] max-w-[280px] border-b border-r border-border bg-card px-3 py-2 text-left align-top font-medium text-foreground"
                >
                  <div className="group flex items-start justify-between gap-1">
                    <div className="flex-1 min-w-0">
                      <span className="block truncate">{doc.name}</span>
                      {doc.mimeType && (
                        <span className="block truncate text-[10px] font-normal text-muted-foreground">
                          {doc.mimeType}
                        </span>
                      )}
                    </div>
                    {onRowRemove && (
                      <button
                        type="button"
                        onClick={() => onRowRemove(doc)}
                        aria-label={`Remove row ${doc.name}`}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </th>
                {columnsSorted.map((col) => {
                  const cell = cellsByKey.get(`${col.id}::${doc.id}`) ?? null
                  const isActive =
                    !!runningCell &&
                    runningCell.columnId === col.id &&
                    runningCell.rowId === doc.id
                  const status: CellStatus | "empty" = isActive
                    ? "streaming"
                    : cell
                      ? cell.status
                      : "empty"
                  // While a cell is actively running, prefer the live token
                  // stream over the persisted cell value (which lags behind).
                  // Truncate at the citation sentinel so the JSON block
                  // doesn't leak into the visible cell preview.
                  const liveValue = isActive
                    ? truncateAtSentinel(runningCell?.partialText ?? "")
                    : null
                  return (
                    <td
                      key={`${doc.id}-${col.id}`}
                      className={cn(
                        "min-w-[200px] border-b border-r border-border px-3 py-2 align-top",
                        "cursor-pointer hover:bg-primary/5",
                        isActive &&
                          "outline outline-2 outline-primary/60 bg-primary/5",
                      )}
                      onClick={() =>
                        setExpanded({ cell, column: col, document: doc })
                      }
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="mt-1.5">
                          <StatusDot status={status} />
                        </span>
                        <div className="min-w-0 flex-1">
                          {liveValue !== null ? (
                            <span>
                              {liveValue.length > 120
                                ? `${liveValue.slice(0, 120)}…`
                                : liveValue || (
                                    <span className="text-muted-foreground/60">
                                      …
                                    </span>
                                  )}
                            </span>
                          ) : (
                            <CellPreview cell={cell} status={status} />
                          )}
                        </div>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CellExpandDialog
        expanded={expanded}
        runningCell={runningCell}
        onClose={() => {
          // If the user closes mid-run, stop auto-following until the next run.
          if (runningCell) userClosedDuringRunRef.current = true
          setExpanded(null)
        }}
        docLabels={docLabels}
        onCitationJump={(citation) => {
          // Close the modal first so the preview surface isn't stacked on top.
          setExpanded(null)
          onCitationJump?.(citation)
        }}
        onCellRegenerate={
          onCellRegenerate
            ? async (column, document) => {
                await onCellRegenerate(column, document)
              }
            : undefined
        }
        busy={busy}
      />
    </>
  )
}

function CellExpandDialog({
  expanded,
  runningCell,
  onClose,
  docLabels,
  onCitationJump,
  onCellRegenerate,
  busy,
}: {
  expanded: ExpandedCell | null
  runningCell?: RunningCellLive | null
  onClose: () => void
  docLabels?: Record<string, string>
  onCitationJump: (citation: Citation) => void
  onCellRegenerate?: (column: ReviewColumn, document: ReviewDocument) => void | Promise<void>
  busy?: boolean
}) {
  const open = expanded !== null
  const cell = expanded?.cell ?? null
  const citations = parseCitations(cell?.citations ?? null)
  const byId = React.useMemo(() => {
    const map = new Map<number, Citation>()
    for (const c of citations) map.set(c.id, c)
    return map
  }, [citations])

  const isThisCellActive =
    !!runningCell &&
    !!expanded &&
    runningCell.columnId === expanded.column.id &&
    runningCell.rowId === expanded.document.id
  const isStreaming = cell?.status === "streaming" || isThisCellActive
  const showRegenerate = !!onCellRegenerate && !!expanded
  const regenLabel =
    !cell || cell.status === "pending"
      ? "Run cell"
      : cell.status === "error"
        ? "Retry"
        : "Regenerate"
  const liveText = isThisCellActive
    ? truncateAtSentinel(runningCell?.partialText ?? "")
    : null
  const liveSummary = isThisCellActive
    ? runningCell?.retrievedSummary
    : undefined
  const liveChunks = isThisCellActive ? runningCell?.retrievedChunks : undefined
  const livePrompt = isThisCellActive
    ? expanded?.column.prompt
    : undefined
  const liveRetrievalQuery =
    isThisCellActive &&
    runningCell?.retrievalQuery &&
    runningCell.retrievalQuery !== expanded?.column.prompt
      ? runningCell.retrievalQuery
      : undefined

  return (
    // `modal={false}` so clicking a citation chip can open the side
    // panel without the dim-overlay hiding it — the user keeps the
    // cell's full context visible alongside the source document.
    // Without modal-mode there's no outside-click-to-close, so the
    // user dismisses via Escape or the X button. The inline `left`
    // calc re-centers the dialog into the visible main column when
    // the side panel is open (the panel sets `--side-panel-width`
    // on the body).
    <Dialog open={open} modal={false} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="max-w-2xl"
        style={{
          left: 'calc((100vw - var(--side-panel-width, 0px)) / 2)',
        }}
        // `modal={false}` on Dialog doesn't actually stop Radix from
        // calling `onOpenChange(false)` when the user interacts outside
        // the dialog — clicks on a citation chip's tooltip portal, on
        // the side panel, etc. all count. Block those here so the
        // user can drill from chip to chip without losing the cell's
        // context. Escape and the built-in X close still work.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="truncate">
            {expanded?.column.title ?? ""}
          </DialogTitle>
          <DialogDescription className="truncate">
            {expanded?.document.name ?? ""}
          </DialogDescription>
        </DialogHeader>
        {showRegenerate && (
          <div className="flex items-center justify-end gap-2 border-b border-border pb-3">
            <button
              type="button"
              onClick={() => {
                if (!expanded || !onCellRegenerate) return
                void onCellRegenerate(expanded.column, expanded.document)
              }}
              disabled={busy || isStreaming}
              className={cn(
                "rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {busy || isStreaming ? "Running…" : regenLabel}
            </button>
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {livePrompt && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="mb-0.5 font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
                Question
              </div>
              <div className="text-foreground">{livePrompt}</div>
            </div>
          )}
          {liveRetrievalQuery && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="mb-0.5 font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
                HyDE retrieval probe
              </div>
              <div className="text-foreground italic">{liveRetrievalQuery}</div>
            </div>
          )}
          {liveSummary && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-primary">
              {liveSummary}
            </div>
          )}
          {liveChunks && liveChunks.length > 0 && (
            <details className="rounded-md border border-border bg-card">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground">
                Retrieved passages ({liveChunks.length})
              </summary>
              <ul className="space-y-2 border-t border-border px-3 py-2">
                {liveChunks.map((c, i) => (
                  <li key={i} className="text-xs">
                    <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span>Excerpt {i + 1}</span>
                      {typeof c.distance === 'number' && (
                        <span>· distance {c.distance.toFixed(3)}</span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap rounded bg-muted/40 p-2 leading-snug text-foreground">
                      {c.content}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {liveText !== null ? (
            <div className="space-y-3 whitespace-pre-wrap text-sm text-foreground">
              {liveText || (
                <span className="text-muted-foreground">
                  {whimsicalVerbFor(
                    `${expanded?.column.id ?? ''}::${expanded?.document.id ?? ''}`,
                  )}
                  …
                </span>
              )}
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
            </div>
          ) : !cell || cell.status === "pending" ? (
            <p className="text-sm text-muted-foreground">No answer yet.</p>
          ) : cell.status === "error" ? (
            <p className="text-sm text-destructive">{cell.error ?? "Error"}</p>
          ) : cell.status === "streaming" ? (
            <div className="space-y-3 whitespace-pre-wrap text-sm text-foreground">
              {truncateAtSentinel(cell.value ?? "") || (
                <span className="text-muted-foreground">…</span>
              )}
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
            </div>
          ) : (
            <div className="space-y-3 whitespace-pre-wrap text-sm text-foreground">
              {truncateAtSentinel(cell.value ?? "") || (
                <span className="text-muted-foreground">(empty)</span>
              )}
            </div>
          )}
          {citations.length > 0 && (
            <div className="border-t border-border pt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Citations
              </div>
              <ul className="space-y-2 text-xs">
                {citations.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <CitationChip
                      id={c.id}
                      citation={c}
                      onJump={onCitationJump}
                      docLabel={docLabels?.[c.doc]}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {docLabels?.[c.doc] ?? c.doc}
                        {c.locator ? ` · ${c.locator}` : ""}
                      </div>
                      <div className="italic">&ldquo;{c.quote}&rdquo;</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cell?.status === "done" && byId.size === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No citations supplied for this cell.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
