import * as React from "react"

import { cn } from "../lib/utils"

/**
 * Cmd-F-style find bar overlaid on a document preview. Stateless wrt the
 * document — the parent owns the preview ref and routes find calls into
 * it; this component is the input + match-counter + Prev/Next/close UI.
 *
 * Open/close is the parent's call (typically via a Cmd+F keybinding on
 * the side-panel container). On Escape, the bar requests close via
 * `onClose`. Enter advances to the next match; Shift+Enter to prev.
 */

export interface DocFindBarHandle {
  focus: () => void
}

export interface DocFindBarProps {
  query: string
  onQueryChange: (q: string) => void
  /** Total matches in the rendered document. */
  count: number
  /**
   * 1-based index of the currently focused match. 0 means "no current"
   * (e.g. before any search has run). Display uses this directly.
   */
  currentIndex: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  className?: string
}

export const DocFindBar = React.forwardRef<DocFindBarHandle, DocFindBarProps>(
  function DocFindBar(
    { query, onQueryChange, count, currentIndex, onPrev, onNext, onClose, className },
    ref,
  ) {
    const inputRef = React.useRef<HTMLInputElement | null>(null)
    React.useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus()
        inputRef.current?.select()
      },
    }))

    return (
      <div
        className={cn(
          "absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-border bg-background/95 px-2 py-1 shadow-md backdrop-blur",
          className,
        )}
        role="search"
        aria-label="Find in document"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              onClose()
            } else if (e.key === "Enter") {
              e.preventDefault()
              if (e.shiftKey) onPrev()
              else onNext()
            }
          }}
          placeholder="Find in document"
          className="w-44 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          aria-label="Find query"
        />
        <span className="min-w-12 text-right text-[11px] tabular-nums text-muted-foreground">
          {query.length === 0
            ? ""
            : count === 0
              ? "No matches"
              : `${currentIndex} / ${count}`}
        </span>
        <button
          type="button"
          onClick={onPrev}
          disabled={count === 0}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m18 15-6-6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={count === 0}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next match"
          title="Next match (Enter)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          aria-label="Close find"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18 18 6" />
          </svg>
        </button>
      </div>
    )
  },
)
