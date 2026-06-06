import * as React from "react"

import { cn } from "../lib/utils"

export interface PageBodyProps {
  /**
   * Tailwind max-width utility for the body container. Default `max-w-none`
   * stretches edge-to-edge under the hero band so wide tables and grids
   * breathe; pass `'max-w-7xl'` or `'max-w-6xl'` to cap width for
   * text-heavy pages.
   */
  maxWidth?: string
  /** Override the default `px-8 py-6` padding. */
  padding?: string
  /** Extra className applied to the outer wrapper. */
  className?: string
  children: React.ReactNode
}

/**
 * Standardized content container used inside `PageShell`. Stretches to
 * the full main-area width by default so wide tables and grids breathe;
 * pages that want a centered reading column can opt into a max-width.
 */
export function PageBody({
  maxWidth = "max-w-none",
  padding = "px-8 py-6",
  className,
  children,
}: PageBodyProps) {
  return (
    <div
      data-slot="page-body"
      className={cn("mx-auto w-full", maxWidth, padding, className)}
    >
      {children}
    </div>
  )
}
