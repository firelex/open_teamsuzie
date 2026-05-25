import * as React from "react"

import { cn } from "../../lib/utils"
import { RedlineSpan } from "./redline-span"

/**
 * One inline run inside a paragraph. Produced by OOXML walkers
 * (`extractRedlineParagraphs` from `@teamsuzie/docx`) or by drafter's
 * output (drafter's `apply_playbook`).
 *
 * `kind` uses upstream nomenclature (`'insert'` / `'delete'` / `'equal'`).
 *
 * `bold` and `italic` reflect direct run-level formatting present on the
 * source `<w:rPr>`. They're advisory; the redline-flavored span styles
 * never override the kind-based color/strikethrough. Omitted (undefined)
 * for plain runs to keep the wire payload compact — the OOXML walker
 * checks the presence of `<w:b>` / `<w:i>` and surfaces them as
 * absent rather than emit `false` for every plain run.
 */
export interface RedlineRun {
  kind: "equal" | "insert" | "delete"
  text: string
  revisionId?: number
  bold?: boolean
  italic?: boolean
}

/**
 * Paragraph-level structural style mapped from `<w:pPr><w:pStyle/>`.
 * The renderer maps this to an `h1`/`h2`/`h3`/`p` element. Heading
 * levels deeper than 3 fall back to `'normal'`. We don't currently
 * style anything below h3 in chrome.
 */
export type RedlineParagraphStyle =
  | "heading1"
  | "heading2"
  | "heading3"
  | "normal"

export interface RedlineParagraph {
  index: number
  runs: RedlineRun[]
  /** Paragraph style. Defaults to `'normal'` when absent. */
  style?: RedlineParagraphStyle
}

export interface RedlineRunsProps {
  paragraphs: RedlineParagraph[]
  /** Fired when a non-equal run is clicked. Optional. */
  onRunSelect?: (revisionId: string | number) => void
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
      {paragraphs.map((p) => {
        const isEmpty = p.runs.length === 0
        const Tag =
          p.style === "heading1"
            ? "h1"
            : p.style === "heading2"
              ? "h2"
              : p.style === "heading3"
                ? "h3"
                : "p"
        // Empty paragraphs (spacer lines between contract sections) get
        // tight styling: no margin, fixed small height. Otherwise N
        // consecutive empties stack their mb-3 margins and blow out
        // the layout — contracts routinely have 4-6 blank <w:p>s in a
        // row. Each still renders as its own element so the
        // data-paragraph-index stays addressable for scroll-sync.
        const tagClass = isEmpty
          ? "h-2 m-0"
          : p.style === "heading1"
            ? "text-xl font-semibold mt-4 mb-2 first:mt-0"
            : p.style === "heading2"
              ? "text-lg font-semibold mt-3 mb-2 first:mt-0"
              : p.style === "heading3"
                ? "text-base font-semibold mt-2 mb-1 first:mt-0"
                : "mb-3 last:mb-0 leading-relaxed"
        return (
          <Tag
            key={p.index}
            data-paragraph-index={p.index}
            className={cn("whitespace-pre-wrap", tagClass)}
            aria-hidden={isEmpty ? true : undefined}
          >
            {isEmpty ? (
              ""
            ) : (
              p.runs.map((run, i) => (
                <RedlineSpan
                  key={i}
                  kind={run.kind}
                  text={run.text}
                  revisionId={run.revisionId}
                  bold={run.bold}
                  italic={run.italic}
                  onSelect={
                    run.kind !== "equal" && run.revisionId != null
                      ? onRunSelect
                      : undefined
                  }
                />
              ))
            )}
          </Tag>
        )
      })}
    </div>
  )
}
