import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "../lib/utils"

/**
 * Top-level sidebar shell.
 *
 * `gradient` — when true, paints the header-gradient (vertical) and swaps
 * the border for the header-edge token. Matches the "department app" look.
 */
function Sidebar({
  className,
  gradient = false,
  ...props
}: React.ComponentProps<"aside"> & { gradient?: boolean }) {
  return (
    <aside
      data-slot="sidebar"
      data-gradient={gradient ? "" : undefined}
      aria-label="Sidebar"
      className={cn(
        "hidden w-60 shrink-0 flex-col border-r md:flex",
        gradient
          ? "bg-header-gradient-v border-[var(--color-header-edge)]/60"
          : "bg-muted border-border",
        className
      )}
      {...props}
    />
  )
}

/**
 * Sidebar header row. Two ways to use it:
 *
 *   1. Pass `children` for full control (back-compat).
 *   2. Pass `brand`, `title`, and optional `subtitle` for the standard
 *      logo + workspace-name layout. When `title` is set, structured mode
 *      renders and `children` is ignored.
 */
function SidebarHeader({
  className,
  brand,
  title,
  subtitle,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  brand?: React.ReactNode
  title?: React.ReactNode
  subtitle?: React.ReactNode
}) {
  const structured = title !== undefined
  return (
    <div
      data-slot="sidebar-header"
      className={cn(
        "flex min-h-14 px-4 py-3",
        structured ? "items-center gap-3" : "items-center",
        className
      )}
      {...props}
    >
      {structured ? (
        <>
          {brand && (
            <div className="flex shrink-0 items-center justify-center">{brand}</div>
          )}
          <div className="min-w-0 flex-1">
            {subtitle && (
              <p className="text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-muted-foreground">
                {subtitle}
              </p>
            )}
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {title}
            </p>
          </div>
        </>
      ) : (
        children
      )}
    </div>
  )
}

function SidebarNav({
  className,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="sidebar-nav"
      className={cn("flex-1 px-2 py-2", className)}
      {...props}
    />
  )
}

/**
 * Visual group inside `SidebarNav`. Renders an uppercase section label above
 * its children, with consistent spacing. Use when a sidebar has 2+ groups of
 * nav items — saves apps from rolling their own `<p className="uppercase…">`.
 */
function SidebarSection({
  className,
  title,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode
}) {
  return (
    <div
      data-slot="sidebar-section"
      className={cn("mb-4 last:mb-0", className)}
      {...props}
    >
      {title && (
        <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </p>
      )}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

/**
 * A single sidebar nav row. Active state is driven by `aria-current="page"`,
 * which is set automatically by routers like react-router's NavLink.
 *
 * Use `asChild` to wrap a router link: `<SidebarNavItem asChild><NavLink .../></SidebarNavItem>`.
 *
 * Optional decoration props:
 * - `icon` — leading icon (any ReactNode; lucide icons fit by default)
 * - `badge` — trailing badge or count (right-aligned)
 * - `activityDot` — color class for a small pulsing dot before the badge
 *   (e.g. `"bg-emerald-500"`). Pass `null`/undefined to omit.
 *
 * When any decoration prop is set, the item lays out as a flex row and
 * wraps the consumer's `children` (typically the label text) in a span.
 * Without decoration props the item is a plain block — identical to before.
 */
function SidebarNavItem({
  className,
  asChild = false,
  icon,
  badge,
  activityDot,
  children,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  icon?: React.ReactNode
  badge?: React.ReactNode
  activityDot?: string | null
}) {
  const Comp = asChild ? Slot : "a"
  const decorated = icon !== undefined || badge !== undefined || activityDot != null
  const content = decorated ? (
    <span className="flex items-center gap-2">
      {icon && (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {activityDot && (
        <span
          aria-hidden
          className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", activityDot)}
        />
      )}
      {badge && (
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{badge}</span>
      )}
    </span>
  ) : (
    children
  )

  return (
    <Comp
      data-slot="sidebar-nav-item"
      className={cn(
        "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
        "text-muted-foreground hover:bg-background/60 hover:text-foreground",
        "aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm",
        className
      )}
      {...props}
    >
      {content}
    </Comp>
  )
}

function SidebarFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        "border-t border-border px-4 py-3 text-xs text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarHeader,
  SidebarNav,
  SidebarSection,
  SidebarNavItem,
  SidebarFooter,
}
