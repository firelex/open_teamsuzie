import * as React from "react"
import { cn } from "../../lib/utils"

/**
 * Single leaf renderer for an inline redline run.
 *
 * Kinds use upstream nomenclature (`'insert' | 'delete' | 'equal'`) — the same
 * vocabulary as `@teamsuzie/docx-diff.WordDiffOp`. Suzielaw historically used
 * `'ins' | 'del'` in its own `RedlineRun`; consumers porting from there need to
 * normalize at the boundary.
 */
export interface RedlineSpanProps {
  kind: 'equal' | 'insert' | 'delete'
  text: string
  /** Optional id for hover/click handlers (suzielaw passes the w:id revision; drafter can pass deviation idx or label). */
  revisionId?: number | string
  /** Truthy when the consumer wants the run to be clickable (e.g. side-panel focus sync). */
  onSelect?: (revisionId: number | string) => void
}

export function RedlineSpan({ kind, text, revisionId, onSelect }: RedlineSpanProps) {
  if (kind === 'equal') return <span>{text}</span>
  const clickable = onSelect != null && revisionId != null
  return (
    <span
      data-revision-id={revisionId}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelect(revisionId) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(revisionId)
              }
            }
          : undefined
      }
      className={cn(
        'rounded-sm px-0.5 transition-colors',
        kind === 'insert'
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-destructive/15 text-destructive line-through decoration-destructive/60',
        clickable && 'cursor-pointer hover:ring-1 hover:ring-amber-400/60',
      )}
    >
      {text}
    </span>
  )
}
