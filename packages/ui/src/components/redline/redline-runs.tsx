import * as React from "react"
import { cn } from "../../lib/utils"
import { RedlineSpan } from "./redline-span"

/**
 * One inline run inside a paragraph. Produced by OOXML walkers
 * (suzielaw's tracked-changes parser) or by structured-redline tool
 * output (drafter's `apply_playbook`).
 *
 * `kind` uses upstream nomenclature (`'insert'` / `'delete'` / `'equal'`).
 */
export interface RedlineRun {
  kind: 'equal' | 'insert' | 'delete'
  text: string
  revisionId?: number | string
}

export interface RedlineParagraph {
  index: number
  runs: RedlineRun[]
}

export interface RedlineRunsProps {
  paragraphs: RedlineParagraph[]
  /** Fired when a non-equal run is clicked. Optional. */
  onRunSelect?: (revisionId: number | string) => void
  /** Optional ref on the scroll container; hosts use this for focus/scroll sync. */
  scrollRef?: React.Ref<HTMLDivElement>
  className?: string
  /** Rendered when `paragraphs` is empty. Defaults to no element. */
  emptyState?: React.ReactNode
}

/**
 * Paragraph-list redline renderer. Each paragraph is one `<p>` carrying a
 * `data-paragraph-index` attribute consumers can target for scroll-sync.
 */
export function RedlineRuns({
  paragraphs,
  onRunSelect,
  scrollRef,
  className,
  emptyState,
}: RedlineRunsProps) {
  if (paragraphs.length === 0 && emptyState != null) {
    return (
      <div ref={scrollRef} className={className}>
        {emptyState}
      </div>
    )
  }
  return (
    <div ref={scrollRef} className={className}>
      {paragraphs.map((p) => (
        <p
          key={p.index}
          data-paragraph-index={p.index}
          className={cn('whitespace-pre-wrap leading-relaxed', 'mb-3 last:mb-0')}
        >
          {p.runs.length === 0 ? (
            <span className="text-muted-foreground">·</span>
          ) : (
            p.runs.map((run, i) => (
              <RedlineSpan
                key={i}
                kind={run.kind}
                text={run.text}
                revisionId={run.revisionId}
                onSelect={
                  run.kind !== 'equal' && run.revisionId != null
                    ? onRunSelect
                    : undefined
                }
              />
            ))
          )}
        </p>
      ))}
    </div>
  )
}
