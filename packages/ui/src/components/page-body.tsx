import * as React from "react"

import { cn } from "../lib/utils"

export interface PageBodyProps extends React.ComponentProps<"div"> {
  /**
   * Tailwind max-width utility for the body container. Default `max-w-none`
   * stretches edge-to-edge under the hero band so wide tables and grids
   * breathe; pass `'max-w-7xl'` or `'max-w-6xl'` to cap width for
   * text-heavy pages.
   */
  maxWidth?: string
  /** Override the default `px-8 py-6` padding. */
  padding?: string
}

/**
 * The single canonical content container for a page body. Owns the page's
 * horizontal + top inset (`px-8 py-6`) so every screen aligns identically with
 * the `PageHeroBand` above it. Put page content in here (or a canonical pattern,
 * which is itself inset-transparent and relies on this container). Do NOT
 * hand-roll a `<div className="… px-1/px-4/px-6 …">` around page content — that
 * is what causes ragged, inconsistent indents. Forwards `data-testid` and other
 * div props so it is a drop-in for a plain wrapper.
 */
export function PageBody({
  maxWidth = "max-w-none",
  padding = "px-8 py-6",
  className,
  children,
  ...props
}: PageBodyProps) {
  return (
    <div
      data-slot="page-body"
      className={cn("mx-auto w-full", maxWidth, padding, className)}
      {...props}
    >
      {children}
    </div>
  )
}
