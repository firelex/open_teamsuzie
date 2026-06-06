import * as React from "react"
import { Loader2 } from "lucide-react"

export interface GenerateBatch {
  /** Current batch index, 1-based. */
  current: number
  /** Total number of batches. */
  total: number
  /** Optional label for the batch currently running (e.g. topic name). */
  runningTitle?: string | null
}

export interface GeneratingPanelProps {
  /** Whether the agent is currently generating. Panel renders nothing when false. */
  active: boolean
  /** Short label like "Claude is developing the plan…". */
  label: string
  /** Optional second line. e.g. "Topic: Auth · Delivery plan". */
  detail?: string
  /** Wall-clock starting time. Defaults to "now" on first activation. */
  startedAt?: number
  /** Optional structured batch progress. */
  batch?: GenerateBatch
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s` : `${secs}s`
}

/**
 * Shared "agent is working" panel. Designed to live next to a Develop /
 * Generate button so the user's eyes are already on it after the click.
 * NON-blocking — the user can keep reading other panes, switching tabs,
 * or chatting while the agent runs.
 *
 * If `batch` is provided, a determinate bar reflects batch progress;
 * otherwise an indeterminate shimmer shows that work is happening
 * without lying about how far along it is.
 */
export function GeneratingPanel({ active, label, detail, startedAt, batch }: GeneratingPanelProps) {
  const [now, setNow] = React.useState(() => Date.now())
  const [internalStart, setInternalStart] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!active) {
      setInternalStart(null)
      return
    }
    setInternalStart((prev) => prev ?? startedAt ?? Date.now())
    const tick = () => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [active, startedAt])

  if (!active) return null

  const start = startedAt ?? internalStart ?? Date.now()
  const elapsed = Math.max(0, Math.floor((now - start) / 1000))

  const fraction =
    batch && batch.total > 0
      ? Math.min(1, Math.max(0, batch.current / batch.total))
      : null

  return (
    <div
      data-slot="generating-panel"
      className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-neutral-700"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-emerald-900">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          {label}
        </span>
        <span className="tabular-nums text-neutral-500">{formatElapsed(elapsed)}</span>
      </div>
      {detail && (
        <div className="mt-1 text-neutral-600 truncate" title={detail}>
          {detail}
        </div>
      )}
      {batch && (
        <div className="mt-1 text-neutral-500 truncate">
          Batch {batch.current} / {batch.total}
          {batch.runningTitle ? ` · ${batch.runningTitle}` : ""}
        </div>
      )}
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-emerald-100">
        {fraction !== null ? (
          <div
            className="h-full bg-emerald-600 transition-all duration-300"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        ) : (
          <div className="h-full w-1/2 animate-pulse rounded bg-emerald-600" />
        )}
      </div>
    </div>
  )
}
