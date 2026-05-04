import * as React from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

import { findHighlightRange } from "@teamsuzie/citations"

import { cn } from "../lib/utils"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

const HIGHLIGHT_BG = "rgba(252, 211, 77, 0.45)"

export type PdfJumpTarget = {
  /** Quote text to find and highlight. Optional — without it, only scroll. */
  quote?: string
  /** Optional page hint. If absent or out of range, search the whole rendered doc. */
  page?: number
}

export type PdfPreviewHandle = {
  jumpTo: (target: PdfJumpTarget) => void
}

export type PdfPreviewProps = {
  src: string | ArrayBuffer | { url: string } | { data: Uint8Array }
  width?: number
  initialPage?: number
  onLoad?: (info: { numPages: number }) => void
  onError?: (err: Error) => void
  className?: string
}

export const PdfPreview = React.forwardRef<PdfPreviewHandle, PdfPreviewProps>(
  function PdfPreview(
    { src, width, initialPage = 1, onLoad, onError, className },
    ref,
  ) {
    const [numPages, setNumPages] = React.useState<number | null>(null)
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const pageElsRef = React.useRef<Map<number, HTMLDivElement>>(new Map())
    const renderedPagesRef = React.useRef<Set<number>>(new Set())
    const pendingJumpRef = React.useRef<PdfJumpTarget | null>(null)
    const highlightedRef = React.useRef<HTMLElement[]>([])

    const setPageEl = React.useCallback(
      (pageNumber: number) => (el: HTMLDivElement | null) => {
        if (el) pageElsRef.current.set(pageNumber, el)
        else pageElsRef.current.delete(pageNumber)
      },
      [],
    )

    const clearHighlights = React.useCallback(() => {
      for (const el of highlightedRef.current) {
        el.style.backgroundColor = ""
        delete el.dataset.citationHighlight
      }
      highlightedRef.current = []
    }, [])

    const tryHighlightInPage = React.useCallback(
      (pageEl: HTMLElement, quote: string): boolean => {
        const textLayer = pageEl.querySelector<HTMLElement>(
          ".react-pdf__Page__textContent, .textLayer",
        )
        if (!textLayer) return false

        const spans = Array.from(
          textLayer.querySelectorAll<HTMLElement>("span"),
        ).filter((s) => s.parentElement === textLayer)

        const ranges: { start: number; end: number; el: HTMLElement }[] = []
        let cursor = 0
        let fullText = ""
        for (const span of spans) {
          const t = span.textContent ?? ""
          ranges.push({ start: cursor, end: cursor + t.length, el: span })
          fullText += t
          cursor += t.length
        }

        const match = findHighlightRange(fullText, quote)
        if (!match) return false

        const highlighted: HTMLElement[] = []
        for (const r of ranges) {
          if (r.end <= match.start) continue
          if (r.start >= match.end) break
          r.el.dataset.citationHighlight = ""
          r.el.style.backgroundColor = HIGHLIGHT_BG
          highlighted.push(r.el)
        }
        highlightedRef.current.push(...highlighted)
        const first = highlighted[0]
        if (first) {
          first.scrollIntoView({ block: "center", behavior: "smooth" })
        }
        return highlighted.length > 0
      },
      [],
    )

    const applyJump = React.useCallback(
      (target: PdfJumpTarget) => {
        clearHighlights()

        const hintedPageEl =
          target.page !== undefined
            ? pageElsRef.current.get(target.page)
            : undefined
        if (hintedPageEl) {
          hintedPageEl.scrollIntoView({ block: "start", behavior: "smooth" })
          if (target.quote && tryHighlightInPage(hintedPageEl, target.quote)) {
            return
          }
        }

        if (!target.quote) return

        // Whole-doc fallback: search every rendered page in order.
        const sorted = Array.from(pageElsRef.current.entries()).sort(
          ([a], [b]) => a - b,
        )
        for (const [, pageEl] of sorted) {
          if (tryHighlightInPage(pageEl, target.quote)) {
            return
          }
        }
      },
      [clearHighlights, tryHighlightInPage],
    )

    const tryApplyPending = React.useCallback(() => {
      const target = pendingJumpRef.current
      if (!target) return
      // If a specific page is hinted, wait until it has rendered. Otherwise
      // any rendered page is enough to attempt a whole-doc search.
      if (target.page !== undefined) {
        if (!renderedPagesRef.current.has(target.page)) return
      } else if (renderedPagesRef.current.size === 0) {
        return
      }
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

    const handleDocumentLoad = React.useCallback(
      ({ numPages: n }: { numPages: number }) => {
        setNumPages(n)
        renderedPagesRef.current = new Set()
        onLoad?.({ numPages: n })
        if (initialPage > 1) {
          pendingJumpRef.current = { page: initialPage }
        }
      },
      [initialPage, onLoad],
    )

    const handlePageRendered = React.useCallback(
      (pageNumber: number) => () => {
        renderedPagesRef.current.add(pageNumber)
        tryApplyPending()
      },
      [tryApplyPending],
    )

    return (
      <div
        ref={containerRef}
        className={cn(
          "h-full w-full overflow-y-auto bg-muted/40",
          className,
        )}
      >
        <Document file={src} onLoadSuccess={handleDocumentLoad} onLoadError={onError}>
          {numPages !== null &&
            Array.from({ length: numPages }, (_, i) => i + 1).map(
              (pageNumber) => (
                <div
                  key={pageNumber}
                  ref={setPageEl(pageNumber)}
                  data-pdf-page={pageNumber}
                  className="mx-auto my-3 w-fit shadow-sm bg-background"
                >
                  <Page
                    pageNumber={pageNumber}
                    width={width}
                    renderTextLayer
                    renderAnnotationLayer={false}
                    onRenderSuccess={handlePageRendered(pageNumber)}
                  />
                </div>
              ),
            )}
        </Document>
      </div>
    )
  },
)
