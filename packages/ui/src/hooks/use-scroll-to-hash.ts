import * as React from "react"

/**
 * Scrolls to the element whose id is the URL fragment (`#ai-spend`) once the
 * page says its content is on screen. Browsers do this by themselves only on
 * a full page load; a client-side navigation, or a section that appears
 * after data loads, needs this hook. Pass the router's current hash (e.g.
 * `useLocation().hash`) so following another `#section` link scrolls again.
 *
 * A fragment that names no element on the page is ignored, as browsers do.
 */
export function useScrollToHash(hash: string, ready: boolean): void {
  React.useEffect(() => {
    if (!ready || hash.length < 2) return
    const id = decodeURIComponent(hash.slice(1))
    // Wait a frame so the section's own content has been laid out.
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })
    })
    return () => cancelAnimationFrame(frame)
  }, [hash, ready])
}
