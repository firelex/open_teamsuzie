import * as React from "react"
import { Eraser } from "lucide-react"

import { Button } from "./button"
import { cn } from "../lib/utils"

export interface PageShellStatusPill {
  tone: "live" | "read" | "beta"
  label: string
}

/**
 * Icon prop shape used by PageShell — intentionally a structural type
 * (not `LucideIcon`) so consumer apps on different lucide-react versions
 * stay assignable across the package boundary. Any component taking a
 * `className` prop and rendering an SVG satisfies it.
 */
export type PageShellIcon = React.ComponentType<{ className?: string }>

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

const PILL_TONES: Record<PageShellStatusPill["tone"], string> = {
  live: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  read: "bg-amber-50 text-amber-800 ring-amber-200/70",
  beta: "bg-ev-50 text-ev-700 ring-ev-200/70",
}

const PILL_DOT: Record<PageShellStatusPill["tone"], string> = {
  live: "bg-emerald-500",
  read: "bg-amber-500",
  beta: "bg-ev-500",
}

/**
 * Standardized full-height page shell. Top-level pages share an editorial
 * hero band — cyan brand gradient with a watermark image, a brand kicker
 * pill, and a bold title — so every Suzie department app reads as one
 * product family.
 */
export function PageShell({
  icon: Icon,
  kicker,
  title,
  tagline,
  statusPill,
  actions,
  onClear,
  clearPending,
  clearLabel = "Clear",
  bodyScrolls = true,
  bodyClassName,
  reserveUsageArea = true,
  watermarkSrc = "/assets/graph-effect.png",
  children,
}: PageShellProps) {
  return (
    <div data-slot="page-shell" className="relative flex h-full min-h-0 flex-col bg-white">
      <section className="relative shrink-0 overflow-hidden border-b border-[#C1D7D7]/60 bg-header-gradient">
        {watermarkSrc && (
          <>
            <img
              src={watermarkSrc}
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -top-32 w-[55%] rotate-[170deg] select-none opacity-25"
            />
            <img
              src={watermarkSrc}
              aria-hidden="true"
              className="pointer-events-none absolute -left-16 -bottom-24 w-[35%] -rotate-[8deg] select-none opacity-15"
            />
          </>
        )}
        <div
          className={cn(
            "relative flex items-start justify-between gap-6 px-8 pt-7 pb-7",
            reserveUsageArea && "pr-[21rem]",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-ev-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ev-700">
              <Icon className="h-3 w-3" />
              <span>{kicker}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-3xl font-bold leading-none tracking-tight text-neutral-900">
                {title}
              </h1>
              {statusPill && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
                    PILL_TONES[statusPill.tone],
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("h-1 w-1 rounded-full", PILL_DOT[statusPill.tone])}
                  />
                  {statusPill.label}
                </span>
              )}
            </div>
            {tagline && <p className="mt-2 max-w-2xl text-sm text-neutral-600">{tagline}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            {onClear && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!!clearPending}
                title={`${clearLabel} chat history`}
                onClick={() => {
                  if (!clearPending) onClear()
                }}
                className="h-8 px-2.5 text-xs"
              >
                <Eraser className="mr-1 h-3.5 w-3.5" />
                {clearLabel}
              </Button>
            )}
          </div>
        </div>
      </section>
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
