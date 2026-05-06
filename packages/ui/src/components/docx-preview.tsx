import * as React from "react"
import { renderAsync } from "docx-preview"

import { findHighlightRange } from "@teamsuzie/citations"

import { cn } from "../lib/utils"

const HIGHLIGHT_BG = "rgba(252, 211, 77, 0.45)"
const HIGHLIGHT_DATA_ATTR = "data-citation-highlight"
const FIND_HIGHLIGHT_BG = "rgba(125, 211, 252, 0.45)" // sky-300/45
const FIND_CURRENT_BG = "rgba(56, 189, 248, 0.7)" // sky-400/70
const FIND_HIGHLIGHT_DATA_ATTR = "data-find-highlight"
const FIND_CURRENT_DATA_ATTR = "data-find-current"
const PAGE_SELECTOR = "section.docx"

export type DocxJumpTarget = {
  /** Quote text to find and highlight. Optional — without it, only scroll. */
  quote?: string
  /** Optional page hint (1-based). If absent or out of range, search the whole rendered doc. */
  page?: number
}

export type DocxPreviewHandle = {
  jumpTo: (target: DocxJumpTarget) => void
  /**
   * Highlight every occurrence of `query` (case-insensitive substring),
   * scroll the first match into view, and return the count. Pass an empty
   * query to clear all find-highlights without affecting jumpTo highlights.
   */
  findAll: (query: string) => { count: number }
  /** Scroll to and "current"-mark the next find-highlight. */
  findNext: () => void
  /** Scroll to and "current"-mark the previous find-highlight. */
  findPrev: () => void
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
    const findMatchesRef = React.useRef<HTMLElement[]>([])
    const findCurrentRef = React.useRef(0)
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
      (
        root: HTMLElement,
        quote: string,
        options?: Parameters<typeof findHighlightRange>[2],
      ): boolean => {
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

        const match = findHighlightRange(fullText, quote, options)
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

        // Search the full rendered document before individual pages. Many
        // legal citations start with repeated boilerplate, and page-local
        // prefix fallback can otherwise "succeed" on the first similar clause.
        if (tryHighlightInRoot(container, target.quote)) return

        // Exact-only page fallback for unusual render trees where a match is
        // easier to find inside one page than in the combined container text.
        for (const section of sections) {
          if (tryHighlightInRoot(section, target.quote, { allowPrefixMatch: false })) return
        }
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

    const clearFindHighlights = React.useCallback(() => {
      for (const mark of findMatchesRef.current) {
        const parent = mark.parentNode
        if (!parent) continue
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
        parent.removeChild(mark)
      }
      findMatchesRef.current = []
      findCurrentRef.current = 0
    }, [])

    const focusFindMatch = React.useCallback((index: number) => {
      const matches = findMatchesRef.current
      if (matches.length === 0) return
      const wrapped = ((index % matches.length) + matches.length) % matches.length
      for (const m of matches) {
        m.removeAttribute(FIND_CURRENT_DATA_ATTR)
        m.style.backgroundColor = FIND_HIGHLIGHT_BG
      }
      const target = matches[wrapped]
      target.setAttribute(FIND_CURRENT_DATA_ATTR, "")
      target.style.backgroundColor = FIND_CURRENT_BG
      target.scrollIntoView({ block: "center", behavior: "smooth" })
      findCurrentRef.current = wrapped
    }, [])

    const findAll = React.useCallback(
      (rawQuery: string): { count: number } => {
        clearFindHighlights()
        const query = rawQuery.trim()
        if (!query) return { count: 0 }
        const container = containerRef.current
        if (!container || !renderedRef.current) return { count: 0 }
        const lowerQuery = query.toLowerCase()
        const textNodes = collectTextNodes(container)
        const created: HTMLElement[] = []
        for (const node of textNodes) {
          const haystack = node.data
          const lower = haystack.toLowerCase()
          // Walk all matches in this text node, splitting + wrapping each.
          let cursor = 0
          let cursorNode: Text = node
          while (true) {
            const idx = lower.indexOf(lowerQuery, cursor)
            if (idx === -1) break
            const localStart = idx - cursor
            const localEnd = localStart + lowerQuery.length
            // Re-fetch length from cursorNode since we splitText on prior iter.
            if (localEnd > cursorNode.data.length) break
            const wrapped = wrapTextNodeRange(
              cursorNode,
              localStart,
              localEnd,
              FIND_HIGHLIGHT_DATA_ATTR,
              FIND_HIGHLIGHT_BG,
            )
            if (wrapped) {
              created.push(wrapped)
              // Advance cursorNode to the trailing remainder so the next
              // search continues after the highlighted span.
              const next = wrapped.nextSibling
              if (next && next.nodeType === Node.TEXT_NODE) {
                cursorNode = next as Text
                cursor = 0
              } else {
                break
              }
            } else {
              break
            }
          }
        }
        findMatchesRef.current = created
        if (created.length > 0) focusFindMatch(0)
        return { count: created.length }
      },
      [clearFindHighlights, focusFindMatch],
    )

    React.useImperativeHandle(
      ref,
      () => ({
        jumpTo: (target) => {
          pendingJumpRef.current = target
          tryApplyPending()
        },
        findAll,
        findNext: () => focusFindMatch(findCurrentRef.current + 1),
        findPrev: () => focusFindMatch(findCurrentRef.current - 1),
      }),
      [tryApplyPending, findAll, focusFindMatch],
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
  dataAttr: string = HIGHLIGHT_DATA_ATTR,
  bgColor: string = HIGHLIGHT_BG,
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
  mark.setAttribute(dataAttr, "")
  mark.style.backgroundColor = bgColor
  mark.style.padding = "0"
  mark.style.borderRadius = "1px"

  parent.insertBefore(mark, target)
  mark.appendChild(target)
  return mark
}
