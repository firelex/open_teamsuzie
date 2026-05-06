import * as React from "react"
import {
  ArrowLeftRight,
  Maximize2,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react"
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
import { MarkdownMessage } from "./markdown-message"
import { useSidePanelOptional } from "./side-panel"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu"
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
  /** Run pending cells in a row (right-click row header). */
  onRowRun?: (document: ReviewDocument) => void | Promise<void>
  /** Re-run every cell in a row (right-click row header). */
  onRowRegenerate?: (document: ReviewDocument) => void | Promise<void>
  /** Run pending cells in a column (right-click column header). */
  onColumnRun?: (column: ReviewColumn) => void | Promise<void>
  /** Re-run every cell in a column (right-click column header). */
  onColumnRegenerate?: (column: ReviewColumn) => void | Promise<void>
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

// Turn `[N]` footnote markers in cell text into markdown links pointing at
// the corresponding citation row in the expand-dialog citations list.
// Escaped brackets keep the visible text as `[6]` while the link target
// becomes `#cell-citation-6`. The negative lookahead avoids interfering with
// genuine `[label](url)` markdown links.
function linkifyCitations(text: string): string {
  return text.replace(/\[(\d+)\](?!\()/g, "[\\[$1\\]](#cell-citation-$1)")
}

function handleCellMarkdownClick(e: React.MouseEvent<HTMLDivElement>) {
  const anchor = (e.target as HTMLElement).closest("a")
  if (!anchor) return
  const href = anchor.getAttribute("href") || ""
  const match = href.match(/#cell-citation-(\d+)$/)
  if (!match) return
  e.preventDefault()
  const el = document.getElementById(`cell-citation-${match[1]}`)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.classList.add("ring-2", "ring-primary", "rounded", "ring-offset-2")
  window.setTimeout(() => {
    el.classList.remove("ring-2", "ring-primary", "rounded", "ring-offset-2")
  }, 1200)
}

// Strip markdown markers so the inline cell preview doesn't show literal
// `**`, `[1]`, etc. Bullet markers (`-`, `*`, `+`) are converted to `•` so a
// list collapsed to a single line still reads as `• foo • bar` rather than
// `foo bar`. The expand dialog renders the full markdown via MarkdownMessage.
function stripMarkdownForPreview(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*>\s?/gm, "")
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
  const compact = stripMarkdownForPreview(cell.value).replace(/\s+/g, " ").trim()
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
  onRowRun,
  onRowRegenerate,
  onColumnRun,
  onColumnRegenerate,
  busy = false,
  runningCell,
  docLabels,
  onCitationJump,
  className,
}: ReviewGridProps) {
  const [expanded, setExpanded] = React.useState<ExpandedCell | null>(null)
  // Transpose toggle: docs as rows (default) ↔ docs as columns. Cell lookup
  // is unchanged either way (`cellsByKey` is keyed by column.id::doc.id);
  // only the table header/row axes swap.
  const [transposed, setTransposed] = React.useState(false)
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

  const hasCellMenu = !!onCellRegenerate
  const hasColumnMenu =
    !!(onColumnClick || onColumnRun || onColumnRegenerate || onColumnRemove)
  const hasRowMenu = !!(onRowRun || onRowRegenerate || onRowRemove)

  // Pure-presentation cell renderer — used by both the normal and transposed
  // table layouts. Cell lookup is keyed by column.id::doc.id either way.
  function renderCell(col: ReviewColumn, doc: ReviewDocument): React.ReactElement {
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
    const liveValue = isActive
      ? truncateAtSentinel(runningCell?.partialText ?? "")
      : null
    const tdInner = (
      <div className="flex items-start gap-1.5">
        <span className="mt-1.5">
          <StatusDot status={status} />
        </span>
        <div className="min-w-0 flex-1">
          {liveValue !== null ? (
            (() => {
              const stripped = stripMarkdownForPreview(liveValue)
                .replace(/\s+/g, " ")
                .trim()
              return (
                <span>
                  {stripped.length > 120
                    ? `${stripped.slice(0, 120)}…`
                    : stripped || (
                        <span className="text-muted-foreground/60">…</span>
                      )}
                </span>
              )
            })()
          ) : (
            <CellPreview cell={cell} status={status} />
          )}
        </div>
      </div>
    )
    return (
      <td
        key={`${doc.id}-${col.id}`}
        className={cn(
          "min-w-[200px] border-b border-r border-border px-3 py-2 align-top",
          "cursor-pointer hover:bg-primary/5",
          isActive && "outline outline-2 outline-primary/60 bg-primary/5",
        )}
        onClick={() => setExpanded({ cell, column: col, document: doc })}
      >
        {hasCellMenu ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div>{tdInner}</div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuLabel>Cell</ContextMenuLabel>
              <ContextMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setExpanded({ cell, column: col, document: doc })
                }}
              >
                <Maximize2 />
                Open
              </ContextMenuItem>
              {onCellRegenerate && (
                <ContextMenuItem
                  disabled={busy || isActive}
                  onSelect={(e) => {
                    e.preventDefault()
                    void onCellRegenerate(col, doc)
                  }}
                >
                  <RefreshCw />
                  {!cell || cell.status === "pending" ? "Run cell" : "Regenerate"}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          tdInner
        )}
      </td>
    )
  }

  function columnHeaderInner(col: ReviewColumn): React.ReactElement {
    return (
      <div className="group flex items-start justify-between gap-1">
        {onColumnClick ? (
          <button
            type="button"
            onClick={() => onColumnClick(col)}
            className="block flex-1 min-w-0 text-left hover:underline underline-offset-2"
          >
            <span className="block truncate text-foreground">{col.title}</span>
            <span className="block truncate text-[10px] font-normal text-muted-foreground">
              {col.format}
            </span>
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <span className="block truncate text-foreground">{col.title}</span>
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
    )
  }

  function renderColumnHeader(col: ReviewColumn): React.ReactElement {
    if (!hasColumnMenu) return columnHeaderInner(col)
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>{columnHeaderInner(col)}</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Column</ContextMenuLabel>
          {onColumnRun && (
            <ContextMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault()
                void onColumnRun(col)
              }}
            >
              <Play />
              Run column
            </ContextMenuItem>
          )}
          {onColumnRegenerate && (
            <ContextMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault()
                void onColumnRegenerate(col)
              }}
            >
              <RefreshCw />
              Regenerate column
            </ContextMenuItem>
          )}
          {onColumnClick && (
            <ContextMenuItem
              onSelect={(e) => {
                e.preventDefault()
                onColumnClick(col)
              }}
            >
              <Pencil />
              Edit prompt
            </ContextMenuItem>
          )}
          {onColumnRemove && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault()
                  onColumnRemove(col)
                }}
              >
                <Trash2 />
                Remove column
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  function docHeaderInner(doc: ReviewDocument): React.ReactElement {
    return (
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
            aria-label={`Remove ${doc.name}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
          >
            ×
          </button>
        )}
      </div>
    )
  }

  function renderDocHeader(doc: ReviewDocument): React.ReactElement {
    if (!hasRowMenu) return docHeaderInner(doc)
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>{docHeaderInner(doc)}</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Row</ContextMenuLabel>
          {onRowRun && (
            <ContextMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault()
                void onRowRun(doc)
              }}
            >
              <Play />
              Run row
            </ContextMenuItem>
          )}
          {onRowRegenerate && (
            <ContextMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault()
                void onRowRegenerate(doc)
              }}
            >
              <RefreshCw />
              Regenerate row
            </ContextMenuItem>
          )}
          {onRowRemove && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault()
                  onRowRemove(doc)
                }}
              >
                <Trash2 />
                Remove row
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <>
      <div
        className={cn(
          "relative rounded-md border border-border bg-card",
          className,
        )}
      >
        <div className="flex items-center justify-end border-b border-border bg-muted/20 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setTransposed((t) => !t)}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={transposed ? "Show documents as rows" : "Show documents as columns"}
            title={transposed ? "Show documents as rows" : "Show documents as columns"}
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
            <span>{transposed ? "Docs as rows" : "Docs as columns"}</span>
          </button>
        </div>
        <div className="overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-20 min-w-[200px] max-w-[280px] border-b border-r border-border bg-muted/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {transposed ? "Question" : "Document"}
              </th>
              {transposed
                ? docsSorted.map((doc) => (
                    <th
                      key={doc.id}
                      scope="col"
                      className="sticky top-0 z-10 min-w-[200px] border-b border-r border-border bg-muted/40 px-3 py-2 text-left text-xs font-semibold tracking-tight"
                    >
                      {renderDocHeader(doc)}
                    </th>
                  ))
                : columnsSorted.map((col) => (
                    <th
                      key={col.id}
                      scope="col"
                      className="sticky top-0 z-10 min-w-[200px] border-b border-r border-border bg-muted/40 px-3 py-2 text-left text-xs font-semibold tracking-tight"
                    >
                      {renderColumnHeader(col)}
                    </th>
                  ))}
            </tr>
          </thead>
          <tbody>
            {transposed
              ? columnsSorted.map((col) => (
                  <tr key={col.id} className="hover:bg-accent/20">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 min-w-[200px] max-w-[280px] border-b border-r border-border bg-card px-3 py-2 text-left align-top font-medium text-foreground"
                    >
                      {renderColumnHeader(col)}
                    </th>
                    {docsSorted.map((doc) => renderCell(col, doc))}
                  </tr>
                ))
              : docsSorted.map((doc) => (
                  <tr key={doc.id} className="hover:bg-accent/20">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 min-w-[200px] max-w-[280px] border-b border-r border-border bg-card px-3 py-2 text-left align-top font-medium text-foreground"
                    >
                      {renderDocHeader(doc)}
                    </th>
                    {columnsSorted.map((col) => renderCell(col, doc))}
                  </tr>
                ))}
          </tbody>
        </table>
        </div>
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
          // Keep the cell modal open while the host opens the citation source
          // in its side panel. The dialog handles Escape specially so the
          // user can close the panel first, then the modal.
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

  const sidePanel = useSidePanelOptional()
  // Set synchronously the moment a citation click fires `onCitationJump`,
  // before React commits the side panel's `isOpen=true` state. Radix can
  // call `onOpenChange(false)` synchronously during the same tick (focus
  // moves to the side panel as it mounts), at which point a closure read
  // of `sidePanel.isOpen` would still see `false`. The ref bridges that
  // gap. Cleared once the side panel state has caught up.
  const recentJumpAtRef = React.useRef(0)
  React.useEffect(() => {
    if (sidePanel?.isOpen) recentJumpAtRef.current = 0
  }, [sidePanel?.isOpen])

  const handleCitationJumpWithGuard = React.useCallback(
    (c: Citation) => {
      recentJumpAtRef.current = Date.now()
      onCitationJump?.(c)
    },
    [onCitationJump],
  )

  return (
    // `modal={false}` so clicking a citation chip can open the side
    // panel without the dim-overlay hiding it — the user keeps the
    // cell's full context visible alongside the source document.
    // Without modal-mode there's no outside-click-to-close, so the
    // user dismisses via Escape or the X button. The inline `left`
    // calc re-centers the dialog into the visible main column when
    // the side panel is open (the panel sets `--side-panel-width`
    // on the body).
    <Dialog
      open={open}
      modal={false}
      // While the side panel is open (or just opening — see the ref above)
      // the user is drilling into citations and wants the cell modal to
      // stay put alongside the source doc. Catch all close paths here so
      // the modal only dismisses when the side panel isn't claiming the
      // user's attention. ESC (handled below) gives them a way out: first
      // ESC closes the panel, second ESC closes the modal.
      onOpenChange={(o) => {
        if (o) return
        if (sidePanel?.isOpen) return
        if (Date.now() - recentJumpAtRef.current < 500) return
        onClose()
      }}
    >
      <DialogContent
        className="max-w-2xl"
        showOverlay={false}
        style={{
          left: 'calc((100vw - var(--side-panel-width, 0px)) / 2)',
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        // First Escape: close the side panel, keep the modal open with
        // its scroll position preserved. Second Escape: Radix's default
        // close behavior dismisses the modal.
        onEscapeKeyDown={(e) => {
          if (sidePanel?.isOpen) {
            e.preventDefault()
            sidePanel.close()
          }
        }}
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
            <div className="text-foreground" onClick={handleCellMarkdownClick}>
              {liveText ? (
                <MarkdownMessage content={linkifyCitations(liveText)} />
              ) : (
                <span className="text-sm text-muted-foreground">
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
            <div className="text-foreground" onClick={handleCellMarkdownClick}>
              {truncateAtSentinel(cell.value ?? "") ? (
                <MarkdownMessage
                  content={linkifyCitations(truncateAtSentinel(cell.value ?? ""))}
                />
              ) : (
                <span className="text-sm text-muted-foreground">…</span>
              )}
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
            </div>
          ) : (
            <div className="text-foreground" onClick={handleCellMarkdownClick}>
              {truncateAtSentinel(cell.value ?? "") ? (
                <MarkdownMessage
                  content={linkifyCitations(truncateAtSentinel(cell.value ?? ""))}
                />
              ) : (
                <span className="text-sm text-muted-foreground">(empty)</span>
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
                  <li
                    key={c.id}
                    id={`cell-citation-${c.id}`}
                    className="flex gap-2 ring-offset-background transition-shadow"
                  >
                    <CitationChip
                      id={c.id}
                      citation={c}
                      onJump={handleCitationJumpWithGuard}
                      docLabel={docLabels?.[c.doc]}
                    />
                    <button
                      type="button"
                      onClick={() => handleCitationJumpWithGuard(c)}
                      className="min-w-0 flex-1 rounded p-1 -m-1 text-left hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Open citation ${c.id} in source document`}
                    >
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {docLabels?.[c.doc] ?? c.doc}
                        {c.locator ? ` · ${c.locator}` : ""}
                      </div>
                      <div className="italic">&ldquo;{c.quote}&rdquo;</div>
                    </button>
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
