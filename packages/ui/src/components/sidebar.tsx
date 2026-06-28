import * as React from "react"
import { LogOut } from "lucide-react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "../lib/utils"

interface SidebarContextValue {
  gradient: boolean
}

const SidebarContext = React.createContext<SidebarContextValue>({ gradient: false })

/**
 * Top-level sidebar shell.
 *
 * `gradient` — when true, paints the header-gradient (vertical) and swaps the
 * border for the header-edge token. It also flips descendant `SidebarSection`
 * labels, `SidebarNavItem` active state, and the `SidebarFooter` border to
 * the brand palette via context, so apps only need this one prop to opt in.
 *
 * `watermarkSrc` — when set (and gradient is true), two rotated copies of
 * the image are rendered behind the sidebar contents at low opacity for the
 * department-app texture. Pass `null` (default) for a flat gradient.
 */
function Sidebar({
  className,
  gradient = false,
  watermarkSrc = null,
  children,
  ...props
}: React.ComponentProps<"aside"> & {
  gradient?: boolean
  watermarkSrc?: string | null
}) {
  return (
    <SidebarContext.Provider value={{ gradient }}>
      <aside
        data-slot="sidebar"
        data-gradient={gradient ? "" : undefined}
        aria-label="Sidebar"
        className={cn(
          "relative hidden w-64 shrink-0 flex-col overflow-x-hidden border-r font-inter antialiased md:flex",
          gradient
            ? "bg-header-gradient-v border-[var(--color-header-edge)]/60"
            : "bg-muted border-border",
          className
        )}
        {...props}
      >
        {gradient && watermarkSrc && (
          <>
            <img
              src={watermarkSrc}
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-16 -left-12 w-[140%] rotate-[8deg] select-none opacity-[0.18]"
            />
            <img
              src={watermarkSrc}
              aria-hidden="true"
              className="pointer-events-none absolute -top-20 -right-16 w-[110%] -rotate-[14deg] select-none opacity-[0.10]"
            />
          </>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </SidebarContext.Provider>
  )
}

/**
 * Sidebar header row. Two ways to use it:
 *
 *   1. Pass `children` for full control (back-compat).
 *   2. Pass `brand`, `title`, and optional `subtitle` for the standard
 *      logo + workspace-name layout. When `title` is set, structured mode
 *      renders and `children` is ignored.
 *
 * `card` — when true, structured mode wraps brand + title in a translucent
 * white card that lifts off a gradient sidebar. Defaults to true inside a
 * gradient sidebar, false otherwise.
 */
function SidebarHeader({
  className,
  brand,
  title,
  subtitle,
  card,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  brand?: React.ReactNode
  title?: React.ReactNode
  subtitle?: React.ReactNode
  card?: boolean
}) {
  const { gradient } = React.useContext(SidebarContext)
  const structured = title !== undefined
  const showCard = card ?? (gradient && structured)
  return (
    <div
      data-slot="sidebar-header"
      className={cn(
        "flex min-h-14 px-4 py-3",
        structured ? (showCard ? "flex-col gap-3" : "items-center gap-3") : "items-center",
        className
      )}
      {...props}
    >
      {structured ? (
        <div
          className={cn(
            "flex items-center gap-3",
            showCard &&
              "rounded-lg border border-white/80 bg-white/65 px-2.5 py-2 backdrop-blur-sm"
          )}
        >
          {brand && (
            <div className="flex shrink-0 items-center justify-center">{brand}</div>
          )}
          <div className="min-w-0 flex-1">
            {subtitle && (
              <p
                className={cn(
                  "text-[10px] font-bold uppercase leading-tight tracking-[0.14em]",
                  gradient ? "text-ev-700/70" : "text-muted-foreground"
                )}
              >
                {subtitle}
              </p>
            )}
            <p
              className={cn(
                "truncate text-sm font-semibold leading-tight",
                gradient ? "text-neutral-800" : "text-foreground"
              )}
            >
              {title}
            </p>
          </div>
        </div>
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
      className={cn("relative flex-1 space-y-0.5 overflow-y-auto px-4 py-5", className)}
      {...props}
    />
  )
}

/**
 * Thin horizontal rule for separating major nav groups inside a sidebar.
 * Uses a gradient fade so it reads as decoration, not a hard divider.
 */
function SidebarDivider({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { gradient } = React.useContext(SidebarContext)
  return (
    <div
      data-slot="sidebar-divider"
      aria-hidden
      className={cn(
        "mx-3 my-3 h-px",
        gradient
          ? "bg-gradient-to-r from-transparent via-[var(--color-header-edge)] to-transparent"
          : "bg-border",
        className
      )}
      {...props}
    />
  )
}

/**
 * Visual group inside `SidebarNav`. Renders an uppercase section label above
 * its children, with consistent spacing. Use when a sidebar has 2+ groups of
 * nav items — saves apps from rolling their own `<p className="uppercase…">`.
 *
 * `divider` — render a fading horizontal rule above the section. Convenient
 * shorthand for placing a `<SidebarDivider />` before the section.
 */
function SidebarSection({
  className,
  title,
  divider = false,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode
  divider?: boolean
}) {
  const { gradient } = React.useContext(SidebarContext)
  return (
    <>
      {divider && <SidebarDivider className="mt-10 mb-3" />}
      <div
        data-slot="sidebar-section"
        className={cn("mb-4 last:mb-0", className)}
        {...props}
      >
        {title && (
          <p
            className={cn(
              "mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em]",
              gradient ? "text-ev-700/60" : "text-muted-foreground"
            )}
          >
            {title}
          </p>
        )}
        <div className="flex flex-col gap-0.5">{children}</div>
      </div>
    </>
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
 * Inside a gradient `Sidebar`, the active state automatically uses the
 * fancy-gradient pill + violet glow. Outside one, it falls back to the
 * subtle `bg-background shadow-sm` treatment.
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
  const { gradient } = React.useContext(SidebarContext)
  const decorated = icon !== undefined || badge !== undefined || activityDot != null
  const itemClassName = cn(
    "block rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
    gradient
      ? "text-neutral-700 hover:bg-white/70 hover:text-ev-700 aria-[current=page]:bg-fancy-gradient aria-[current=page]:text-white aria-[current=page]:shadow-violet-glow"
      : "text-muted-foreground hover:bg-background/60 hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm",
    className
  )

  const decorate = (labelNode: React.ReactNode) => (
    <span className="flex items-center gap-3">
      {icon && (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{labelNode}</span>
      {activityDot && (
        <span
          aria-hidden
          className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full animate-pulse", activityDot)}
        />
      )}
      {badge && (
        <span className="shrink-0 text-[10px] tabular-nums opacity-70 aria-[current=page]:opacity-100">
          {badge}
        </span>
      )}
    </span>
  )

  if (asChild) {
    // The consumer's element (e.g. NavLink) must be the rendered DOM node —
    // that's how routers set `aria-current="page"` for active styling. We
    // inject the decoration as new children of that element so the badge /
    // icon / dot still appear inside the active pill.
    const child = React.Children.only(children) as React.ReactElement<{ children?: React.ReactNode }>
    const innerChildren = decorated ? decorate(child.props.children) : child.props.children
    return (
      <Slot data-slot="sidebar-nav-item" className={itemClassName} {...props}>
        {React.cloneElement(child, undefined, innerChildren)}
      </Slot>
    )
  }

  return (
    <a data-slot="sidebar-nav-item" className={itemClassName} {...props}>
      {decorated ? decorate(children) : children}
    </a>
  )
}

function SidebarFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { gradient } = React.useContext(SidebarContext)
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        "px-4 py-3 text-xs",
        gradient
          ? "border-t border-[var(--color-header-edge)]/60 bg-white/40 backdrop-blur-sm text-neutral-600"
          : "border-t border-border text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export interface SidebarUserProfileProps {
  /** User name (shown bold). */
  name?: React.ReactNode
  /** Secondary identifier (e.g. email). */
  email?: React.ReactNode
  /** Avatar element. If omitted, a violet-gradient initial circle is rendered from `initial`. */
  avatar?: React.ReactNode
  /** Single character shown inside the default gradient avatar. Ignored when `avatar` is set. */
  initial?: string
  /** Optional small status dot in the bottom-right of the avatar (e.g. `"bg-emerald-500"`). */
  statusDot?: string | null
  /** Sign-out handler. Renders the trailing button when provided. */
  onSignOut?: () => void | Promise<void>
  /** Disables the sign-out button — useful while the promise is in flight. */
  signOutPending?: boolean
  signOutLabel?: string
  className?: string
}

/**
 * Conventional bottom-of-sidebar user profile: avatar (with optional status
 * dot) + name + email + sign-out button. Drop inside `<SidebarFooter>` for
 * the department-app look.
 */
function SidebarUserProfile({
  name,
  email,
  avatar,
  initial,
  statusDot,
  onSignOut,
  signOutPending,
  signOutLabel = "Sign out",
  className,
}: SidebarUserProfileProps) {
  const defaultAvatar = (
    <div className="relative">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-fancy-gradient text-sm font-bold text-white shadow-violet-glow ring-2 ring-white">
        {initial?.charAt(0).toUpperCase() ?? "U"}
      </div>
      {statusDot && (
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white",
            statusDot
          )}
        />
      )}
    </div>
  )

  return (
    <div data-slot="sidebar-user-profile" className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3 px-1">
        {avatar ?? defaultAvatar}
        <div className="min-w-0 flex-1">
          {name && (
            <p className="truncate text-sm font-semibold leading-tight text-neutral-800">
              {name}
            </p>
          )}
          {email && (
            <p className="truncate text-[11px] text-neutral-500">{email}</p>
          )}
        </div>
      </div>
      {onSignOut && (
        <button
          type="button"
          onClick={() => void onSignOut()}
          disabled={signOutPending}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white/80 text-sm font-medium text-neutral-700 transition hover:bg-white hover:text-ev-700 disabled:opacity-60"
        >
          <LogOut className="h-3.5 w-3.5" />
          {signOutLabel}
        </button>
      )}
    </div>
  )
}

export {
  Sidebar,
  SidebarHeader,
  SidebarNav,
  SidebarSection,
  SidebarDivider,
  SidebarNavItem,
  SidebarFooter,
  SidebarUserProfile,
}
