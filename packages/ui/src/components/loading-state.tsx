import * as React from "react"
import { Loader2 } from "lucide-react"

import { cn } from "../lib/utils"

export interface LoadingStateProps {
  /** Children render as the loading label, e.g. "Loading reviews…". */
  children?: React.ReactNode
  /**
   * `inline` — left-aligned, single line, for in-flow placeholder use.
   * `block`  — centered in the full available height, for page-level loads.
   * Defaults to `inline`.
   */
  variant?: "inline" | "block"
  /** Tailwind size for the spinner. Defaults to `size-4`. */
  iconClassName?: string
  className?: string
}

/**
 * Standard "we're waiting" cue. Always pairs a spinner with a label —
 * a bare "Loading…" paragraph is banned by the UI guide, because it
 * trains users to wonder whether the page is broken.
 *
 * Defaults to `inline` (suitable for replacing a list / card body
 * while it loads); set `variant="block"` for full-height centered
 * placeholders (e.g. while a chat history loads).
 */
export function LoadingState({
  children = "Loading…",
  variant = "inline",
  iconClassName,
  className,
}: LoadingStateProps) {
  if (variant === "block") {
    return (
      <div
        className={cn(
          "flex h-full min-h-32 w-full items-center justify-center",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className={cn("size-4 animate-spin", iconClassName)} aria-hidden />
          <span>{children}</span>
        </span>
      </div>
    )
  }
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 text-sm text-muted-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className={cn("size-4 animate-spin", iconClassName)} aria-hidden />
      <span>{children}</span>
    </p>
  )
}
