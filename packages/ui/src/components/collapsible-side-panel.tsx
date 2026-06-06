import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

export interface CollapsibleSidePanelProps {
  side: "left" | "right"
  /** Short label shown vertically on the collapsed rail (e.g. "Refine", "Plans"). */
  label: string
  /** localStorage key; omit for non-persistent collapse state. */
  storageKey?: string
  defaultOpen?: boolean
  /** Open-state renderer. Wires `collapse` into a button in your header. */
  children: (api: { collapse: () => void }) => React.ReactNode
}

/**
 * Wraps a side panel so the user can collapse it down to a thin rail
 * to reclaim screen real estate. Different from `<SidePanelSurface>` —
 * that one is a tabbed imperative surface owned by `SidePanelProvider`;
 * this one is a per-region render-prop wrapper for surfaces that own
 * their own header.
 *
 * Open state is rendered via a render prop so the wrapped content
 * keeps its existing header/layout intact — it just receives a
 * `collapse()` callback to wire into a chevron button. Closed state
 * is a 28 px-wide strip with an expand button and a vertical text
 * label, so users can still tell which panel is hiding behind the
 * rail.
 *
 * The open/closed choice is persisted to `localStorage` under the
 * supplied `storageKey` so the user's preference survives reloads.
 */
export function CollapsibleSidePanel({
  side,
  label,
  storageKey,
  defaultOpen = true,
  children,
}: CollapsibleSidePanelProps) {
  const [open, setOpen] = React.useState<boolean>(() => {
    if (!storageKey || typeof window === "undefined") return defaultOpen
    const stored = window.localStorage.getItem(storageKey)
    if (stored === "open") return true
    if (stored === "closed") return false
    return defaultOpen
  })

  React.useEffect(() => {
    if (!storageKey || typeof window === "undefined") return
    window.localStorage.setItem(storageKey, open ? "open" : "closed")
  }, [open, storageKey])

  if (open) return <>{children({ collapse: () => setOpen(false) })}</>

  // Closed rail. The border sits on the panel's *inner* edge so the rail
  // visually anchors to the rest of the workspace, matching the open
  // panel's border.
  const borderClass = side === "left" ? "border-r" : "border-l"
  const ExpandIcon = side === "left" ? ChevronRight : ChevronLeft

  return (
    <aside
      data-slot="collapsible-side-panel-rail"
      className={`shrink-0 w-7 ${borderClass} border-neutral-200 bg-neutral-50 flex flex-col items-center py-2 gap-2`}
      aria-label={`${label} (collapsed)`}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-1 rounded text-neutral-500 hover:text-ev-700 hover:bg-ev-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ev-300"
        title={`Expand ${label}`}
        aria-label={`Expand ${label}`}
      >
        <ExpandIcon className="w-4 h-4" />
      </button>
      <span
        className="mt-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500 select-none"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </aside>
  )
}
