import * as React from "react"

import { cn } from "../lib/utils"

export interface TabHeaderBarProps {
  /**
   * Optional top row rendered above the tab pills — e.g. a set of primary
   * group buttons in a two-tier tab bar. Wrapped in a fixed-height flex row.
   */
  groups?: React.ReactNode
  /** The tab pills row, typically a `<TabsList>`. */
  children: React.ReactNode
  className?: string
}

/**
 * Bordered header for a tab bar. Owns the spacing between the tab pills and
 * the bottom divider so the pills never sit flush against the line — a bug
 * that recurs whenever this header is hand-rolled per screen. Renders an
 * optional `groups` row above the pills for two-tier navigation.
 *
 * Pair with `TabScroll` for the content panels so a whole tabbed screen
 * derives its spacing from one place.
 */
export function TabHeaderBar({ groups, children, className }: TabHeaderBarProps) {
  return (
    <div
      data-slot="tab-header-bar"
      className={cn(
        "border-b border-neutral-200 bg-white/60 px-4 pb-2 backdrop-blur-sm",
        className,
      )}
    >
      {groups != null && (
        <div className="flex h-10 items-center gap-1">{groups}</div>
      )}
      {children}
    </div>
  )
}

export interface TabScrollProps {
  children: React.ReactNode
  /** Optional companion panel rendered beside the scrolling main column. */
  aside?: React.ReactNode
  /** Extra classes for the scrolling `<main>` (e.g. to tweak padding). */
  className?: string
}

/**
 * Standard scroll container for a tab's content. Tab panels are typically
 * mounted inside an `overflow-hidden` region that hands the panel its full
 * height but neither scrolls nor pads — so every panel has to supply its own
 * scrolling region and padding. Centralizing that here keeps tabs visually
 * consistent instead of each re-deriving the pattern (which is how tabs end
 * up with no padding and clipped content).
 */
export function TabScroll({ children, aside, className }: TabScrollProps) {
  return (
    <div className="flex h-full min-h-0">
      <main className={cn("flex-1 min-w-0 overflow-auto p-6", className)}>
        {children}
      </main>
      {aside}
    </div>
  )
}
