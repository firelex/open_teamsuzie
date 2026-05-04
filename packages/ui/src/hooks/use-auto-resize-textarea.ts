import { useCallback, useEffect, type RefObject } from "react"

export interface UseAutoResizeTextareaOptions {
  /** Minimum height in pixels. Falls back to the textarea's CSS min-height. */
  minHeight?: number
  /** Maximum height in pixels. Above this the textarea shows a scrollbar.
   *  Use to prevent the composer from eating the whole screen on long pastes. */
  maxHeight?: number
}

/**
 * Auto-resize a `<textarea>` to fit its content, clamped to optional min/max.
 *
 * Pass a ref to the textarea and the textarea's current `value` (so the hook
 * can recompute on every change). Bind once — works with raw `<textarea>` or
 * any styled wrapper that forwards a ref.
 *
 * Returns a `recalc()` function for cases where the value changes externally
 * without re-rendering (e.g. programmatic reset).
 *
 * @example
 *   const ref = useRef<HTMLTextAreaElement>(null)
 *   const [text, setText] = useState("")
 *   useAutoResizeTextarea(ref, text, { maxHeight: 320 })
 *   return <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} />
 */
export function useAutoResizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  options: UseAutoResizeTextareaOptions = {},
): { recalc: () => void } {
  const { minHeight, maxHeight } = options

  const recalc = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Reset first so scrollHeight reflects only the content, not the previous height.
    el.style.height = "auto"
    const min = minHeight ?? 0
    const max = maxHeight ?? Infinity
    const next = Math.min(Math.max(el.scrollHeight, min), max)
    el.style.height = `${next}px`
    // Show a scrollbar only after we've hit the max — otherwise hide it so
    // the textarea looks flush at small sizes.
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden"
  }, [ref, minHeight, maxHeight])

  useEffect(() => {
    recalc()
  }, [recalc, value])

  return { recalc }
}
