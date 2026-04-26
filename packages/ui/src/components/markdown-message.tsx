import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "../lib/utils"

/**
 * Render markdown with the chat-flavored typography defaults used throughout
 * Team Suzie's chat starters and apps. Drop-in replacement for an inline
 * ReactMarkdown call — handles headings, lists, code blocks, tables, etc.
 */
export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="[&:not(:first-child)]:mt-3">{children}</p>,
          h1: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold tracking-tight">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold tracking-tight">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 text-[15px] font-semibold tracking-tight">{children}</h4>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 text-sm font-semibold tracking-tight">{children}</h4>
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
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = (className ?? "").includes("language-")
            if (isBlock) {
              return (
                <code className={cn("font-mono text-[13px]", className)} {...rest}>
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
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-1.5 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-3 py-1.5 align-top">{children}</td>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
