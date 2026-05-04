import * as React from "react"
import { renderAsync } from "docx-preview"

import { findHighlightRange } from "@teamsuzie/citations"

import { cn } from "../lib/utils"

const HIGHLIGHT_BG = "rgba(252, 211, 77, 0.45)"
const HIGHLIGHT_DATA_ATTR = "data-citation-highlight"
const PAGE_SELECTOR = "section.docx"

export type DocxJumpTarget = {
  /** Quote text to find and highlight. Optional — without it, only scroll. */
  quote?: string
  /** Optional page hint (1-based). If absent or out of range, search the whole rendered doc. */
  page?: number
}

export type DocxPreviewHandle = {
  jumpTo: (target: DocxJumpTarget) => void
}

export type DocxPreviewProps = {
  src: Blob | ArrayBuffer | string
  initialPage?: number
  onLoad?: (info: { numPages: number }) => void
  onError?: (err: Error) => void
  className?: string
}

async function resolveSource(
  src: Blob | ArrayBuffer | string,
): Promise<Blob | ArrayBuffer> {
  if (typeof src === "string") {
    const res = await fetch(src)
    if (!res.ok) {
      throw new Error(`Failed to fetch DOCX (${res.status} ${res.statusText})`)
    }
    return await res.blob()
  }
  return src
}

export const DocxPreview = React.forwardRef<DocxPreviewHandle, DocxPreviewProps>(
  function DocxPreview(
    { src, initialPage = 1, onLoad, onError, className },
    ref,
  ) {
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const renderedRef = React.useRef(false)
    const numPagesRef = React.useRef(0)
    const pendingJumpRef = React.useRef<DocxJumpTarget | null>(null)
    const highlightedRef = React.useRef<HTMLElement[]>([])
    const [error, setError] = React.useState<Error | null>(null)

    const clearHighlights = React.useCallback(() => {
      for (const mark of highlightedRef.current) {
        const parent = mark.parentNode
        if (!parent) continue
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
        parent.removeChild(mark)
      }
      highlightedRef.current = []
    }, [])

    const tryHighlightInRoot = React.useCallback(
      (root: HTMLElement, quote: string): boolean => {
        const textNodes = collectTextNodes(root)
        const ranges: { start: number; end: number; node: Text }[] = []
        let cursor = 0
        let fullText = ""
        for (const node of textNodes) {
          const t = node.data
          ranges.push({ start: cursor, end: cursor + t.length, node })
          fullText += t
          cursor += t.length
        }

        const match = findHighlightRange(fullText, quote)
        if (!match) return false

        const created: HTMLElement[] = []
        for (const r of ranges) {
          if (r.end <= match.start) continue
          if (r.start >= match.end) break
          const localStart = Math.max(0, match.start - r.start)
          const localEnd = Math.min(r.node.data.length, match.end - r.start)
          if (localStart >= localEnd) continue
          const wrapped = wrapTextNodeRange(r.node, localStart, localEnd)
          if (wrapped) created.push(wrapped)
        }
        highlightedRef.current.push(...created)

        const first = created[0]
        if (first) {
          first.scrollIntoView({ block: "center", behavior: "smooth" })
        }
        return created.length > 0
      },
      [],
    )

    const applyJump = React.useCallback(
      (target: DocxJumpTarget) => {
        clearHighlights()
        const container = containerRef.current
        if (!container) return
        const sections = container.querySelectorAll<HTMLElement>(PAGE_SELECTOR)

        const hintedPageEl =
          target.page !== undefined ? sections[target.page - 1] : undefined
        if (hintedPageEl) {
          hintedPageEl.scrollIntoView({ block: "start", behavior: "smooth" })
          if (target.quote && tryHighlightInRoot(hintedPageEl, target.quote)) {
            return
          }
        }

        if (!target.quote) return

        // Whole-doc fallback: search across all sections, then bare container.
        for (const section of sections) {
          if (tryHighlightInRoot(section, target.quote)) return
        }
        tryHighlightInRoot(container, target.quote)
      },
      [clearHighlights, tryHighlightInRoot],
    )

    const tryApplyPending = React.useCallback(() => {
      if (!renderedRef.current) return
      const target = pendingJumpRef.current
      if (!target) return
      applyJump(target)
      pendingJumpRef.current = null
    }, [applyJump])

    React.useImperativeHandle(
      ref,
      () => ({
        jumpTo: (target) => {
          pendingJumpRef.current = target
          tryApplyPending()
        },
      }),
      [tryApplyPending],
    )

    React.useEffect(() => {
      let cancelled = false
      const container = containerRef.current
      if (!container) return

      renderedRef.current = false
      numPagesRef.current = 0
      highlightedRef.current = []
      container.replaceChildren()

      ;(async () => {
        try {
          const data = await resolveSource(src)
          if (cancelled) return
          await renderAsync(data, container, undefined, {
            inWrapper: true,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
          })
          if (cancelled) return
          const sections = container.querySelectorAll(PAGE_SELECTOR)
          numPagesRef.current = sections.length
          renderedRef.current = true
          onLoad?.({ numPages: sections.length })
          if (initialPage > 1) {
            pendingJumpRef.current = { page: initialPage }
          }
          tryApplyPending()
        } catch (err) {
          if (cancelled) return
          const e = err instanceof Error ? err : new Error(String(err))
          setError(e)
          onError?.(e)
        }
      })()

      return () => {
        cancelled = true
      }
    }, [src, initialPage, onLoad, onError, tryApplyPending])

    return (
      <div
        ref={containerRef}
        className={cn("h-full w-full overflow-y-auto bg-muted/40", className)}
        data-error={error ? "true" : undefined}
      />
    )
  },
)

function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === "STYLE" || tag === "SCRIPT") return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const out: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    out.push(node as Text)
  }
  return out
}

function wrapTextNodeRange(
  node: Text,
  localStart: number,
  localEnd: number,
): HTMLElement | null {
  const parent = node.parentNode
  if (!parent) return null

  let target = node
  if (localStart > 0) {
    target = node.splitText(localStart)
  }
  if (localEnd - localStart < target.data.length) {
    target.splitText(localEnd - localStart)
  }

  const mark = document.createElement("mark")
  mark.setAttribute(HIGHLIGHT_DATA_ATTR, "")
  mark.style.backgroundColor = HIGHLIGHT_BG
  mark.style.padding = "0"
  mark.style.borderRadius = "1px"

  parent.insertBefore(mark, target)
  mark.appendChild(target)
  return mark
}
