import * as React from "react"

/** How long to keep the section in place while panels above it finish loading. */
const SETTLE_MS = 1500
const USER_INPUT = ["wheel", "touchstart", "keydown", "mousedown"] as const

/**
 * Scrolls to the element whose id is the URL fragment (`#ai-spend`) once the
 * page says its content is on screen. Browsers do this by themselves only on
 * a full page load; a client-side navigation, or a section that appears
 * after data loads, needs this hook. Pass the router's current hash (e.g.
 * `useLocation().hash`) so following another `#section` link scrolls again.
 *
 * Panels often finish loading afterwards: those above push the section
 * down, and until those below load the page may be too short to bring it
 * to the top. So for a moment the hook keeps scrolling it into place. It
 * stops as soon as the person scrolls, clicks or types.
 *
 * A fragment that names no element on the page is ignored, as browsers do.
 */
export function useScrollToHash(hash: string, ready: boolean): void {
  React.useEffect(() => {
    if (!ready || hash.length < 2) return
    const id = decodeURIComponent(hash.slice(1))
    const until = performance.now() + SETTLE_MS
    let frame = 0
    const tick = () => {
      document.getElementById(id)?.scrollIntoView({ block: "start" })
      if (performance.now() < until) frame = requestAnimationFrame(tick)
    }
    const stop = () => cancelAnimationFrame(frame)
    frame = requestAnimationFrame(tick)
    for (const e of USER_INPUT) window.addEventListener(e, stop, { passive: true })
    return () => {
      stop()
      for (const e of USER_INPUT) window.removeEventListener(e, stop)
    }
  }, [hash, ready])
}
