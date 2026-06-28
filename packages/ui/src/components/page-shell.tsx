import * as React from "react"

import {
  PageHeroBand,
  type PageHeroBandIcon,
  type PageHeroBandStatusPill,
} from "./page-hero-band"
import { cn } from "../lib/utils"

/**
 * Re-exported for back-compat. Prefer importing `PageHeroBandStatusPill`
 * (and `PageHeroBandIcon`) directly from `page-hero-band`.
 */
export type PageShellStatusPill = PageHeroBandStatusPill
export type PageShellIcon = PageHeroBandIcon

export interface PageShellProps {
  icon: PageShellIcon
  /** Tracked-uppercase kicker rendered inside the brand pill (e.g. "Operations"). */
  kicker: string
  /** Main title (e.g. "Dashboard", "Models"). */
  title: string
  /** Subtitle paragraph below the title. */
  tagline?: string
  /** Optional status pill rendered inline with the title. */
  statusPill?: PageShellStatusPill
  /** Right-side action slot (buttons, model picker, etc.). */
  actions?: React.ReactNode
  /** Clear-history handler. Chat surfaces wire this through. */
  onClear?: () => void
  clearPending?: boolean
  clearLabel?: string
  /**
   * Whether the body region scrolls (default true). Pass `false` when the
   * children own scrolling — Tabs that take full height, chat surfaces,
   * sidebar splits.
   */
  bodyScrolls?: boolean
  /** Extra className applied to the body wrapper. */
  bodyClassName?: string
  /**
   * If true (default) the header reserves space at top-right for a
   * floating usage widget. Set false for pages whose header lives below
   * the widget (e.g. inside a tab content area), or for apps without
   * such a widget.
   */
  reserveUsageArea?: boolean
  /**
   * Background watermark image url. Two copies are rendered (top-right
   * rotated, bottom-left tilted) at low opacity to give the hero band
   * its layered texture. Defaults to `/assets/graph-effect.png`; pass
   * `null` to disable the watermark for a flat hero.
   */
  watermarkSrc?: string | null
  children: React.ReactNode
}

/**
 * Standardized full-height page shell. Top-level pages share an editorial
 * hero band — cyan brand gradient with a watermark image, a brand kicker
 * pill, and a bold title — so every Suzie department app reads as one
 * product family.
 *
 * Internally composes `<PageHeroBand>` over a scrollable body region. For
 * pages embedded inside an existing AppShell that need just the hero band,
 * use `<PageHeroBand>` directly.
 */
export function PageShell({
  icon,
  kicker,
  title,
  tagline,
  statusPill,
  actions,
  onClear,
  clearPending,
  clearLabel,
  bodyScrolls = true,
  bodyClassName,
  reserveUsageArea = true,
  watermarkSrc = "/assets/graph-effect.png",
  children,
}: PageShellProps) {
  return (
    <div data-slot="page-shell" className="relative flex h-full min-h-0 flex-col bg-white">
      <PageHeroBand
        icon={icon}
        kicker={kicker}
        title={title}
        tagline={tagline}
        statusPill={statusPill}
        actions={actions}
        onClear={onClear}
        clearPending={clearPending}
        clearLabel={clearLabel}
        reserveUsageArea={reserveUsageArea}
        watermarkSrc={watermarkSrc}
      />
      <div
        className={cn(
          "relative flex-1 min-h-0",
          bodyScrolls ? "overflow-auto" : "flex flex-col overflow-hidden",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
