import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { cn } from "../lib/utils"

/**
 * Tiny popover menu — anchored under the trigger.
 *
 * The menu content is rendered through a `document.body` portal with
 * `position: fixed`, so the dropdown escapes any `overflow: hidden|auto`
 * ancestor. Without the portal, anchoring with `position: absolute`
 * inside a Trello-style column (the column scrolls, the board scrolls)
 * clips the dropdown the moment it tries to extend past the column
 * edge — only the first row or two are visible. This is the gap it fills
 * versus the Radix `DropdownMenu`, which clips inside scroll containers.
 *
 * Position is recomputed on scroll and resize so the dropdown stays
 * pinned to its trigger as the user navigates around. Closes on
 * outside-click (checking BOTH the anchor and the portal element so
 * clicks inside the menu don't count as "outside"), on Escape, and
 * after a menu item runs.
 *
 * No focus trap — these are small toolbar/card dropdowns; the real
 * Dialog layer handles modal focus needs.
 */
export function OverflowMenu({
  trigger,
  align = "right",
  children,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  align?: "left" | "right"
  children: (close: () => void) => ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number; minWidth: number } | null>(null)

  // Position the popover under the anchor. Uses fixed coords against
  // the viewport, so any scroll listener will need to re-run this.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      if (!a) return
      const width = popoverRef.current?.offsetWidth ?? 224 // ~min-w-[14rem]
      const top = a.bottom + 4
      const left = align === "right" ? a.right - width : a.left
      // Clamp horizontally so the menu never bleeds off the viewport
      // edge on narrow widths (mobile, side-by-side panels).
      const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      setCoords({ top, left: clampedLeft, minWidth: a.width })
    }
    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (anchorRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={anchorRef} className={cn("relative inline-block", className)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && coords && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, left: coords.left, minWidth: 224 }}
            className="z-50 rounded-xl border border-border bg-popover py-1 shadow-lg"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  )
}

export function OverflowMenuItem({
  onClick,
  disabled,
  destructive,
  icon,
  children,
  hint,
}: {
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  icon?: ReactNode
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon && <span className="size-4 shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  )
}

export function OverflowMenuSeparator() {
  return <div className="my-1 border-t border-border" />
}

export function OverflowMenuHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </div>
  )
}
