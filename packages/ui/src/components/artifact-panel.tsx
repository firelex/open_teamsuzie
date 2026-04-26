import * as React from "react"

import { Button } from "./button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { MarkdownMessage } from "./markdown-message"
import { safeFilename } from "../lib/format"

/**
 * Read-only snapshot of a document. The chat client lifts this to state when
 * a doc-aware tool result includes a `_doc_state` field.
 */
export interface ArtifactSnapshot {
  docId: string
  title: string
  /** Full current markdown body. Render via {@link MarkdownMessage}. */
  markdown: string
  /** Set when the agent has called export_to_docx for this doc. */
  docxDownloadUrl?: string
  docxFilename?: string
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function downloadBlob(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Read-only side panel that mirrors the agent's working markdown document in
 * real time. Shown beside the chat thread; populated by the chat client when
 * a tool result carries an `ArtifactSnapshot`.
 *
 * Hidden below `md` breakpoint (`md:flex`) — 44% of a phone screen is
 * unusable, so chat-only on mobile is the right call.
 */
export function ArtifactPanel({
  artifact,
  onClose,
}: {
  artifact: ArtifactSnapshot
  onClose: () => void
}) {
  function downloadMarkdown() {
    downloadBlob(
      artifact.markdown,
      "text/markdown;charset=utf-8",
      safeFilename(artifact.title, ".md")
    )
  }

  return (
    <aside
      aria-label="Document preview"
      className="hidden h-full w-[44%] shrink-0 flex-col border-l border-border bg-card md:flex"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileIcon />
          <span className="truncate font-medium">{artifact.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
                <DownloadIcon />
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={downloadMarkdown}>
                Markdown (.md)
              </DropdownMenuItem>
              {artifact.docxDownloadUrl ? (
                <DropdownMenuItem asChild>
                  <a
                    href={artifact.docxDownloadUrl}
                    download={
                      artifact.docxFilename ?? safeFilename(artifact.title, ".docx")
                    }
                  >
                    Word (.docx)
                  </a>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>
                  Word (.docx) — not yet exported
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close preview"
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {artifact.markdown.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            Empty document — content will appear here as the agent writes.
          </p>
        ) : (
          <MarkdownMessage content={artifact.markdown} />
        )}
      </div>
    </aside>
  )
}
