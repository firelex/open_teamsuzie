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
  /** Renders the text wrapped in `<strong>`. Composes with `italic`. Does not override kind-based color/strikethrough. */
  bold?: boolean
  /** Renders the text wrapped in `<em>`. Composes with `bold`. */
  italic?: boolean
}

/**
 * Wrap `text` in `<strong>`/`<em>` per the formatting flags. Kept
 * outside the component body so both the equal and non-equal branches
 * share the same composition rules: bold/italic add font-weight/style
 * but never replace the kind-based color or strikethrough.
 */
function applyFormatting(
  text: string,
  bold: boolean | undefined,
  italic: boolean | undefined,
): React.ReactNode {
  let inner: React.ReactNode = text
  if (bold) inner = <strong>{inner}</strong>
  if (italic) inner = <em>{inner}</em>
  return inner
}

export function RedlineSpan({ kind, text, revisionId, onSelect, bold, italic }: RedlineSpanProps) {
  const inner = applyFormatting(text, bold, italic)
  if (kind === 'equal') return <span>{inner}</span>
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
      {inner}
    </span>
  )
}
