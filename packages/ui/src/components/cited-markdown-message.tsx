import * as React from "react"
import type { Citation } from "@teamsuzie/citations"
import {
  parseCiteUrl,
  remarkCitations,
} from "@teamsuzie/citations"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "../lib/utils"
import { CitationChip } from "./citation-chip"
import { MarkdownErrorBoundary } from "./markdown-message"

export type CitedMarkdownMessageProps = {
  content: string
  citations: Citation[]
  onJump?: (citation: Citation) => void
  docLabels?: Record<string, string>
  className?: string
}

const allowCiteUrls = (url: string) => {
  if (typeof url === "string" && url.startsWith("cite:")) return url
  // Allow http(s), mailto, tel, in-page anchors, AND same-origin
  // relative paths (`/api/files/.../content` for tool-generated download
  // links, etc.) — leaving relative URLs out previously made any markdown
  // link to a download endpoint render as `href=""`, so clicking them
  // navigated to `/` instead of the actual file.
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return url
  return ""
}

/**
 * Markdown renderer with first-class inline citations. Pairs with
 * `parseResponse` from @teamsuzie/citations: feed `text` and `citations`
 * directly through. Markers `[N]` become `<CitationChip>` instances.
 */
export function CitedMarkdownMessage({
  content,
  citations,
  onJump,
  docLabels,
  className,
}: CitedMarkdownMessageProps) {
  const byId = React.useMemo(() => {
    const map = new Map<number, Citation>()
    for (const c of citations) map.set(c.id, c)
    return map
  }, [citations])

  return (
    <MarkdownErrorBoundary>
    <div
      className={cn(
        "space-y-3 text-[15px] leading-relaxed text-foreground",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCitations]}
        urlTransform={allowCiteUrls}
        components={{
          a: ({ href, children, ...rest }) => {
            const citeId = parseCiteUrl(href)
            if (citeId !== null) {
              const citation = byId.get(citeId)
              const docLabel =
                citation && docLabels ? docLabels[citation.doc] : undefined
              return (
                <CitationChip
                  id={citeId}
                  citation={citation}
                  onJump={onJump}
                  docLabel={docLabel}
                />
              )
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
                {...rest}
              >
                {children}
              </a>
            )
          },
          p: ({ children }) => (
            <p className="[&:not(:first-child)]:mt-3">{children}</p>
          ),
          h1: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold tracking-tight">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold tracking-tight">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 text-[15px] font-semibold tracking-tight">
              {children}
            </h4>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 text-sm font-semibold tracking-tight">
              {children}
            </h4>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ className: cls, children, ...rest }) => {
            const isBlock = (cls ?? "").includes("language-")
            if (isBlock) {
              return (
                <code className={cn("font-mono text-[13px]", cls)} {...rest}>
                  {children}
                </code>
              )
            }
            return (
              <code
                className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground"
                {...rest}
              >
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-[13px] leading-relaxed">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-1.5 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-3 py-1.5 align-top">
              {children}
            </td>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
    </MarkdownErrorBoundary>
  )
}
