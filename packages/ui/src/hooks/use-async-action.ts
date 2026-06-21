import * as React from "react"

import { useLongRunning } from "../components/long-running.js"

export interface UseAsyncActionOptions {
  /**
   * Label shown in the global registry (`TopProgressBar`, activity tray) while
   * the action is in flight. Defaults to "Working…".
   */
  label?: string
  /**
   * If `true`, calls to `run` while a previous invocation is in flight are
   * ignored. Defaults to `true` because double-clicks on a network action are
   * almost always a bug. Set to `false` for fire-and-forget cases where each
   * call must run.
   */
  ignoreReentrant?: boolean
  /** Tick interval for the elapsed-ms timer, in ms. Defaults to 250. */
  tickMs?: number
}

export interface UseAsyncActionResult<TArgs extends readonly unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>
  busy: boolean
  /** Milliseconds since the current invocation started; 0 when idle. */
  elapsedMs: number
  error: Error | null
  result: TResult | null
  /** Clear `error` and `result` without invoking the wrapped function. */
  reset: () => void
}

/**
 * Wrap an async function with everything a click handler typically needs:
 * busy state, elapsed timer, error capture, and auto-registration with the
 * `LongRunningProvider` so the global progress bar lights up. Replaces the
 * scattered `[busy, setBusy] = useState(false)` boilerplate.
 *
 * Pair with `<PendingButton pending={action.busy} pendingLabel={...}>` for
 * (A) per-button feedback, and rely on `<TopProgressBar />` for (B) the
 * global bar.
 */
export function useAsyncAction<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: UseAsyncActionOptions = {},
): UseAsyncActionResult<TArgs, TResult> {
  const { label, ignoreReentrant = true, tickMs = 250 } = options
  const registry = useLongRunning()

  const [busy, setBusy] = React.useState(false)
  const [elapsedMs, setElapsedMs] = React.useState(0)
  const [error, setError] = React.useState<Error | null>(null)
  const [result, setResult] = React.useState<TResult | null>(null)

  // Keep the wrapped fn in a ref so callers don't have to memoize it.
  const fnRef = React.useRef(fn)
  React.useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const startedAtRef = React.useRef<number | null>(null)

  // Drive the elapsed-ms timer with setInterval, but only while busy. Cleared
  // on unmount so leftover intervals never tick after a route change.
  React.useEffect(() => {
    if (!busy) return undefined
    const id = setInterval(() => {
      const startedAt = startedAtRef.current
      if (startedAt !== null) setElapsedMs(Date.now() - startedAt)
    }, tickMs)
    return () => clearInterval(id)
  }, [busy, tickMs])

  // Track mount status so we can swallow state updates that resolve after
  // unmount (e.g. user navigates away mid-request).
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = React.useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (busy && ignoreReentrant) return undefined
      const token = registry.start(label ?? "Working…")
      startedAtRef.current = Date.now()
      setBusy(true)
      setElapsedMs(0)
      setError(null)
      try {
        const value = await fnRef.current(...args)
        if (mountedRef.current) setResult(value)
        return value
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err))
        if (mountedRef.current) setError(wrapped)
        throw wrapped
      } finally {
        registry.stop(token)
        startedAtRef.current = null
        if (mountedRef.current) {
          setBusy(false)
          setElapsedMs(0)
        }
      }
    },
    [busy, ignoreReentrant, label, registry],
  )

  const reset = React.useCallback(() => {
    setError(null)
    setResult(null)
  }, [])

  return { run, busy, elapsedMs, error, result, reset }
}

/**
 * Format ms as a compact "12s" / "1m 04s" string suitable for button labels.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}m ${String(s).padStart(2, "0")}s`
}
