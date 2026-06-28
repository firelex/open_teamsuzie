import * as React from "react"

import { cn } from "../lib/utils"

export interface LongRunningEntry {
  readonly token: number
  readonly label: string
  readonly startedAt: number
}

export interface LongRunningContextValue {
  /** Register a new in-flight operation. Returns a token for `stop()`. */
  start(label?: string): number
  /** Mark an operation as finished. Safe to call with an unknown token. */
  stop(token: number): void
  readonly activeCount: number
  readonly activeEntries: ReadonlyArray<LongRunningEntry>
}

const NOOP_CONTEXT: LongRunningContextValue = {
  start: () => -1,
  stop: () => {},
  activeCount: 0,
  activeEntries: [],
}

const LongRunningContext = React.createContext<LongRunningContextValue | null>(null)

/**
 * Wrap the app so any `useAsyncAction` (or manual `useLongRunning` call) can
 * contribute to a shared "something is happening" registry. The registry is
 * deliberately minimal — it counts in-flight ops and tracks labels for the
 * <TopProgressBar /> and any activity-tray UI built later. Re-mounting the
 * provider resets the registry, which is the right behavior on a route
 * change because abandoned async work would not surface anyway.
 */
export function LongRunningProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<LongRunningEntry[]>([])
  const nextToken = React.useRef(1)

  const start = React.useCallback((label = "Working…") => {
    const token = nextToken.current++
    const entry: LongRunningEntry = { token, label, startedAt: Date.now() }
    setEntries((prev) => [...prev, entry])
    return token
  }, [])

  const stop = React.useCallback((token: number) => {
    setEntries((prev) => prev.filter((e) => e.token !== token))
  }, [])

  const value = React.useMemo<LongRunningContextValue>(
    () => ({ start, stop, activeCount: entries.length, activeEntries: entries }),
    [start, stop, entries],
  )

  return <LongRunningContext.Provider value={value}>{children}</LongRunningContext.Provider>
}

/**
 * Read the long-running registry. Returns a no-op context when used outside a
 * provider so feature pages don't need to know whether the host wired one up.
 */
export function useLongRunning(): LongRunningContextValue {
  return React.useContext(LongRunningContext) ?? NOOP_CONTEXT
}

export interface TopProgressBarProps {
  /**
   * Render even when nothing is active (kept in DOM, just transparent). Useful
   * for layouts that need a stable header height. Defaults to `false` so the
   * bar reserves no space at all when idle.
   */
  alwaysMount?: boolean
  className?: string
}

/**
 * Slim indeterminate progress bar pinned to the top of its scroll container.
 * Visible whenever the registry has at least one active entry — covers any
 * `useAsyncAction` call across the app without needing per-page wiring.
 */
export function TopProgressBar({ alwaysMount = false, className }: TopProgressBarProps) {
  const { activeCount } = useLongRunning()
  const visible = activeCount > 0
  if (!visible && !alwaysMount) return null
  return (
    <div
      role="progressbar"
      aria-busy={visible}
      aria-label={visible ? "Working" : undefined}
      data-active={visible || undefined}
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity",
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <div className="long-running-indeterminate h-full w-1/3 bg-primary" />
      <style>{`
        @keyframes long-running-indeterminate-keyframes {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(350%); }
        }
        .long-running-indeterminate {
          animation: long-running-indeterminate-keyframes 1.4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .long-running-indeterminate { animation-duration: 4s; }
        }
      `}</style>
    </div>
  )
}
