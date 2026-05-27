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
  /**
   * Optional pre-rendered HTML body. When present, the panel renders this
   * directly (via `dangerouslySetInnerHTML`) instead of the markdown — used
   * by hosts that produce HTML locally (e.g. drafter's mammoth-from-DOCX
   * preview) and don't want a markdown round-trip. The HTML is assumed
   * trusted (host-generated); never set this from untrusted user input.
   */
  html?: string
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
  onExport,
}: {
  artifact: ArtifactSnapshot
  onClose: () => void
  /**
   * Optional host-supplied DOCX exporter. When provided, the "Word (.docx)"
   * dropdown entry becomes clickable even before the model has called
   * export_to_docx — clicking it runs the host's export, caches the URL
   * locally, and triggers the browser download. When omitted, the entry
   * stays disabled with the legacy "not yet exported" hint.
   */
  onExport?: (docId: string, title: string) => Promise<{
    downloadUrl: string
    filename?: string
  }>
}) {
  const [exporting, setExporting] = React.useState(false)
  const [exportError, setExportError] = React.useState<string | null>(null)
  // Cache the URL we got back from on-demand export so re-clicks reuse it
  // instead of re-exporting. Keyed on docId so switching docs clears it.
  const [exported, setExported] = React.useState<{
    docId: string
    downloadUrl: string
    filename?: string
  } | null>(null)

  React.useEffect(() => {
    setExportError(null)
    if (exported && exported.docId !== artifact.docId) setExported(null)
  }, [artifact.docId, exported])

  function downloadMarkdown() {
    downloadBlob(
      artifact.markdown,
      "text/markdown;charset=utf-8",
      safeFilename(artifact.title, ".md")
    )
  }

  // Resolution order for the DOCX link: (1) model already called
  // export_to_docx → docxDownloadUrl on the snapshot; (2) the user
  // previously triggered on-demand export this session → cached `exported`.
  const docxUrl = artifact.docxDownloadUrl ?? exported?.downloadUrl
  const docxName =
    artifact.docxFilename
    ?? exported?.filename
    ?? safeFilename(artifact.title, ".docx")
  const canTriggerExport = !docxUrl && Boolean(onExport) && !exporting

  async function triggerExport(event: Event) {
    // Prevent the dropdown from closing on click so the user sees the
    // loading state. Radix passes the underlying KeyboardEvent/MouseEvent
    // via the `onSelect` callback.
    event.preventDefault()
    if (!onExport) return
    setExporting(true)
    setExportError(null)
    try {
      const result = await onExport(artifact.docId, artifact.title)
      setExported({
        docId: artifact.docId,
        downloadUrl: result.downloadUrl,
        filename: result.filename,
      })
      // Trigger the browser download by clicking a transient <a>.
      const a = document.createElement("a")
      a.href = result.downloadUrl
      a.download =
        result.filename ?? safeFilename(artifact.title, ".docx")
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(false)
    }
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
              {docxUrl ? (
                <DropdownMenuItem asChild>
                  <a href={docxUrl} download={docxName}>
                    Word (.docx)
                  </a>
                </DropdownMenuItem>
              ) : canTriggerExport ? (
                <DropdownMenuItem onSelect={triggerExport}>
                  Word (.docx)
                </DropdownMenuItem>
              ) : exporting ? (
                <DropdownMenuItem disabled>
                  Word (.docx) — exporting…
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>
                  Word (.docx) — not yet exported
                </DropdownMenuItem>
              )}
              {exportError && (
                <DropdownMenuItem disabled className="text-destructive">
                  {exportError}
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
        {artifact.markdown.length === 0 && artifact.html === undefined ? (
          <p className="text-sm italic text-muted-foreground">
            Empty document — content will appear here as the agent writes.
          </p>
        ) : artifact.html !== undefined ? (
          <div
            className="prose prose-sm max-w-none"
            // eslint-disable-next-line react/no-danger -- host-generated HTML (mammoth output); never accept from user input.
            dangerouslySetInnerHTML={{ __html: artifact.html }}
          />
        ) : (
          <MarkdownMessage content={artifact.markdown} />
        )}
      </div>
    </aside>
  )
}
