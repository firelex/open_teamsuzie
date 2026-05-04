import * as React from "react"
import { X } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "./button"
import { cn } from "../lib/utils"

export interface SidePanelTab {
  /**
   * Stable identifier. Re-opening with the same id focuses the existing
   * tab instead of creating a duplicate; passing a new `render` swaps
   * what's rendered in the same slot. Pick an id that uniquely names
   * the *thing* shown — e.g. `doc:<matterId>:<fileId>`.
   */
  id: string
  title: string
  icon?: LucideIcon
  /**
   * Function that returns the tab's content. Called every render, so
   * it should reference state from a hook (or a stable closure) rather
   * than capturing values that change. For payloads that update
   * frequently (e.g. a citation quote that changes on each click),
   * have the render return a small wrapper component that pulls its
   * latest state from a host-controlled context — not from the
   * closure here.
   */
  render: () => React.ReactNode
}

export interface SidePanelContextValue {
  tabs: SidePanelTab[]
  activeTabId: string | null
  isOpen: boolean
  /**
   * Add or update a tab. If `id` already exists the render slot is
   * replaced and the tab gains focus. If the panel was closed, opening
   * a tab also opens the panel.
   */
  openTab: (tab: SidePanelTab) => void
  closeTab: (id: string) => void
  focusTab: (id: string) => void
  /** Hide the panel without dropping the open tab list. */
  close: () => void
  /** Re-show the panel after a `close()` while preserving tab state. */
  reopen: () => void
}

const SidePanelContext = React.createContext<SidePanelContextValue | null>(null)

/**
 * Mount once near the root of the app. Owns the side-panel tab state —
 * which tabs are open, which is active, whether the panel is showing.
 * Pair with `<SidePanelSurface>` (rendered alongside the main content
 * area) to get the visible panel; `useSidePanel()` exposes the
 * imperative API.
 */
export function SidePanelProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = React.useState<SidePanelTab[]>([])
  const [activeTabId, setActiveTabId] = React.useState<string | null>(null)
  const [isOpen, setIsOpen] = React.useState(false)

  const openTab = React.useCallback((tab: SidePanelTab) => {
    setTabs((current) => {
      const idx = current.findIndex((t) => t.id === tab.id)
      if (idx === -1) return [...current, tab]
      const next = current.slice()
      next[idx] = tab
      return next
    })
    setActiveTabId(tab.id)
    setIsOpen(true)
  }, [])

  const closeTab = React.useCallback((id: string) => {
    setTabs((current) => {
      const next = current.filter((t) => t.id !== id)
      // If the closed tab was active, focus the previous-by-position.
      setActiveTabId((active) => {
        if (active !== id) return active
        if (next.length === 0) return null
        const prevIdx = Math.max(0, current.findIndex((t) => t.id === id) - 1)
        return next[Math.min(prevIdx, next.length - 1)]?.id ?? null
      })
      // Auto-close the panel when no tabs remain.
      if (next.length === 0) setIsOpen(false)
      return next
    })
  }, [])

  const focusTab = React.useCallback((id: string) => {
    setActiveTabId(id)
    setIsOpen(true)
  }, [])

  const close = React.useCallback(() => setIsOpen(false), [])
  const reopen = React.useCallback(() => {
    if (tabs.length > 0) setIsOpen(true)
  }, [tabs.length])

  const value = React.useMemo<SidePanelContextValue>(
    () => ({
      tabs,
      activeTabId,
      isOpen,
      openTab,
      closeTab,
      focusTab,
      close,
      reopen,
    }),
    [tabs, activeTabId, isOpen, openTab, closeTab, focusTab, close, reopen],
  )

  return (
    <SidePanelContext.Provider value={value}>
      {children}
    </SidePanelContext.Provider>
  )
}

export function useSidePanel(): SidePanelContextValue {
  const ctx = React.useContext(SidePanelContext)
  if (!ctx) {
    throw new Error(
      "useSidePanel() requires <SidePanelProvider> mounted near the app root.",
    )
  }
  return ctx
}

export interface SidePanelSurfaceProps {
  /**
   * Width when open. Default 640px — wide enough to read a typical
   * legal contract page comfortably while leaving room for an
   * 800px+ main column at common 1440+ viewport widths.
   */
  width?: number
  /** Tailwind class merged onto the panel container. */
  className?: string
}

/**
 * The visible panel. Mount as a flex sibling of the main content so the
 * two share the row layout — the panel slides into the row when open
 * and the main column reflows. Hidden entirely when no tabs exist or
 * the panel is closed.
 *
 * The panel's own scrolling is per-tab; the wrapping `min-h-0 flex
 * flex-col` keeps the tab content area from overflowing the screen.
 */
export function SidePanelSurface({
  width = 640,
  className,
}: SidePanelSurfaceProps = {}) {
  const { tabs, activeTabId, isOpen, closeTab, focusTab, close } = useSidePanel()

  // Expose the panel's effective width as a CSS variable on the body
  // while open, so other surfaces (centered modals, full-bleed banners)
  // can re-center themselves inside the visible main column instead of
  // being hidden behind the panel. Cleared when the panel closes.
  React.useEffect(() => {
    if (!isOpen || tabs.length === 0) {
      document.body.style.removeProperty("--side-panel-width")
      return
    }
    document.body.style.setProperty("--side-panel-width", `${width}px`)
    return () => {
      document.body.style.removeProperty("--side-panel-width")
    }
  }, [isOpen, tabs.length, width])

  // Escape closes the panel — but only if no other dismissable surface
  // (Radix Dialog / Sheet / Popover) is open above it. Those mount with
  // [role=dialog] data-state="open", so we defer to them when they're
  // visible and let them handle Escape first; a second Escape closes
  // the panel.
  React.useEffect(() => {
    if (!isOpen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const openSurface = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      )
      if (openSurface) return
      event.preventDefault()
      close()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [isOpen, close])

  if (!isOpen || tabs.length === 0) return null

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  return (
    <aside
      data-slot="side-panel"
      className={cn(
        "flex h-screen flex-col border-l border-border bg-background",
        className,
      )}
      style={{ width: `${width}px`, minWidth: `${width}px` }}
      aria-label="Side panel"
    >
      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-1.5">
        <div
          role="tablist"
          aria-label="Open side-panel tabs"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab.id
            const Icon = tab.icon
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "group flex min-w-0 max-w-[18rem] shrink-0 items-center gap-1.5 rounded-t-md border-x border-t px-2 py-1.5 text-xs transition-colors",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-background/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => focusTab(tab.id)}
                  className="flex min-w-0 items-center gap-1.5 text-left outline-none"
                  aria-label={`Focus ${tab.title}`}
                >
                  {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
                  <span className="truncate font-medium">{tab.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(tab.id)}
                  className={cn(
                    "rounded-sm p-0.5 opacity-60 transition-opacity hover:bg-muted hover:opacity-100",
                    isActive && "opacity-100",
                  )}
                  aria-label={`Close ${tab.title}`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 shrink-0"
          onClick={close}
          aria-label="Hide side panel"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      {/* Per-tab content: re-renders whenever the active tab changes
          OR the active tab's render reference updates (re-openTab with
          the same id swaps render and triggers this).  */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab.render()}
      </div>
    </aside>
  )
}
