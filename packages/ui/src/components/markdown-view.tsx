import * as React from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Code2, Eye } from "lucide-react"

import { markdownComponents } from "./markdown-components"

type Mode = "rendered" | "raw"

export interface MarkdownViewProps {
  body: string
  emptyState?: React.ReactNode
  initial?: Mode
  /** Slot rendered next to the Rendered/Raw toggle (Export PDF, custom actions). */
  headerExtras?: React.ReactNode
  /** Override the react-markdown components map (e.g. for image-URL rewriting). */
  components?: Components
  className?: string
}

/**
 * Shared markdown viewer with a Rendered ↔ Raw toggle in the header.
 * Used by artifact views (specs, plans, tickets, docs) so every viewer
 * exposes the same "see the markdown source" affordance.
 *
 * No PDF dependency: apps that want an Export PDF button pass it via
 * `headerExtras`. Mermaid fenced blocks are rendered by the default
 * components map (see `./markdown-components`).
 */
export function MarkdownView({
  body,
  emptyState,
  initial = "rendered",
  headerExtras,
  components,
  className = "",
}: MarkdownViewProps) {
  const [mode, setMode] = React.useState<Mode>(initial)

  const hasBody = body.trim().length > 0
  const activeComponents = components ?? markdownComponents

  return (
    <div data-slot="markdown-view" className={`flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center gap-1 mb-2 shrink-0">
        <div className="inline-flex rounded-full border border-neutral-200 bg-white text-xs overflow-hidden">
          <button
            type="button"
            onClick={() => setMode("rendered")}
            className={`px-2.5 py-1 flex items-center gap-1 ${
              mode === "rendered" ? "bg-ev-50 text-ev-700" : "text-neutral-500 hover:text-ev-700"
            }`}
            title="Rendered markdown"
          >
            <Eye className="w-3 h-3" />
            Rendered
          </button>
          <button
            type="button"
            onClick={() => setMode("raw")}
            className={`px-2.5 py-1 flex items-center gap-1 border-l border-neutral-200 ${
              mode === "raw" ? "bg-ev-50 text-ev-700" : "text-neutral-500 hover:text-ev-700"
            }`}
            title="Raw markdown source"
          >
            <Code2 className="w-3 h-3" />
            Raw
          </button>
        </div>
        {headerExtras}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {!hasBody && (emptyState ?? <div className="text-sm text-neutral-400 italic">(empty)</div>)}
        {hasBody && mode === "rendered" && (
          <article
            className="prose prose-slate prose-sm max-w-none
            prose-headings:font-semibold
            prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base
            prose-code:before:content-none prose-code:after:content-none
            prose-code:bg-neutral-100 prose-code:px-1 prose-code:rounded
            prose-pre:bg-neutral-900 prose-pre:text-neutral-100
            prose-pre:rounded-md prose-pre:p-3 prose-pre:overflow-x-auto
            prose-pre:text-[12px] prose-pre:leading-5
            [&_pre_code]:bg-transparent [&_pre_code]:text-neutral-100
            [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-[12px]
            [&_pre_code]:font-mono [&_pre_code]:whitespace-pre
            prose-table:border prose-table:border-neutral-200
            prose-th:bg-neutral-50 prose-th:border-neutral-200
            prose-td:border-neutral-200 prose-td:align-top
            prose-a:text-ev-700"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={activeComponents}>
              {body}
            </ReactMarkdown>
          </article>
        )}
        {hasBody && mode === "raw" && (
          <pre className="text-xs font-mono whitespace-pre-wrap bg-neutral-50 p-3 rounded-md border border-neutral-200">
            {body}
          </pre>
        )}
      </div>
    </div>
  )
}
