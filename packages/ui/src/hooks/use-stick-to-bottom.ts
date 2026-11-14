import { useCallback, useEffect, useRef } from "react"

/** How close to the bottom (in pixels) still counts as "at the bottom". */
const AT_BOTTOM_PX = 80

/** The element that scrolls `el`: its nearest ancestor with a scrolling overflow, or the page. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return p
  }
  return null
}

/**
 * Keep a growing list (a chat, a streaming reply) scrolled to its end, but only while the reader is
 * there: scrolling up stops the following, and coming back to the bottom starts it again.
 *
 * Put `endRef` on an empty element after the last item. The view follows when `deps` change and the
 * reader is at the bottom. Call `stick()` when the reader does something that should bring them to
 * the end whatever they were reading (sending a message), which also starts the following again.
 *
 * Any scroll *up* by the reader stops the following at once, even a few pixels (a trackpad moves in
 * small steps, and a streaming reply would otherwise pull the reader back down between them); so does a
 * wheel or trackpad gesture upward. It starts again only when the reader scrolls back down to the end.
 * Content growing under a pinned reader, and our own (downward) scrolling, never stop it.
 */
export function useStickToBottom(deps: readonly unknown[], behavior: ScrollBehavior = "auto") {
  const endRef = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)
  const container = useRef<HTMLElement | Window | null>(null)
  const lastTop = useRef(0)

  const metrics = (c: HTMLElement | Window) => {
    if (c instanceof Window) {
      const doc = document.scrollingElement ?? document.documentElement
      return { top: doc.scrollTop, distance: doc.scrollHeight - doc.scrollTop - window.innerHeight }
    }
    return { top: c.scrollTop, distance: c.scrollHeight - c.scrollTop - c.clientHeight }
  }

  const onScroll = useCallback(() => {
    const c = container.current
    if (!c) return
    const { top, distance } = metrics(c)
    if (top < lastTop.current - 1) pinned.current = false
    else if (distance <= AT_BOTTOM_PX) pinned.current = true
    lastTop.current = top
  }, [])

  // A wheel or trackpad gesture upward means the reader wants to read back, before the view has moved.
  const onWheel = useCallback((e: Event) => {
    if ((e as WheelEvent).deltaY < 0) pinned.current = false
  }, [])

  // Find what scrolls the list (it can change when the list first renders) and listen to it.
  const attach = useCallback(() => {
    const el = endRef.current
    if (!el) return
    const next: HTMLElement | Window = scrollParent(el) ?? window
    if (next === container.current) return
    container.current?.removeEventListener("scroll", onScroll)
    container.current?.removeEventListener("wheel", onWheel)
    next.addEventListener("scroll", onScroll, { passive: true })
    next.addEventListener("wheel", onWheel, { passive: true })
    container.current = next
    lastTop.current = metrics(next).top
  }, [onScroll, onWheel])

  useEffect(
    () => () => {
      container.current?.removeEventListener("scroll", onScroll)
      container.current?.removeEventListener("wheel", onWheel)
    },
    [onScroll, onWheel],
  )

  /** Scroll to the end, and note where that left the view, so the reader's next scroll up is seen as one. */
  const toEnd = () => {
    // Braces: newer browsers return a promise from scrollIntoView, which React would take for a clean-up.
    void endRef.current?.scrollIntoView({ block: "end", behavior })
    if (container.current) lastTop.current = metrics(container.current).top
  }

  useEffect(() => {
    attach()
    if (pinned.current) toEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const stick = useCallback(() => {
    attach()
    pinned.current = true
    toEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach, behavior])

  return { endRef, stick }
}
