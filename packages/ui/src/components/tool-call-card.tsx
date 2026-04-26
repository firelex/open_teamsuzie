import * as React from "react"

import { cn } from "../lib/utils"
import { prettyToolName, summarizeArgs } from "../lib/tool-display"
import type { ToolEvent } from "./tool-use-status"

function ToolIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
      aria-hidden="true"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "size-3.5 text-muted-foreground transition-transform",
        open && "rotate-180"
      )}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * Expandable card for a single tool call. Currently unused by the default
 * chat UI (which uses the collapsed live indicator), but kept here for
 * "show details" disclosures and tool-debugging surfaces.
 */
export function ToolCallCard({ event }: { event: ToolEvent }) {
  const [open, setOpen] = React.useState(false)
  const statusLabel = {
    running: "Running…",
    done: "Done",
    error: "Failed",
  }[event.status]
  const statusColor = {
    running: "text-muted-foreground",
    done: "text-emerald-600 dark:text-emerald-500",
    error: "text-destructive",
  }[event.status]
  const summary = summarizeArgs(event.args)
  const isError = event.status === "error"
  const isRunning = event.status === "running"

  return (
    <div
      className={cn(
        "my-1.5 rounded-lg border bg-card px-3 py-2 text-[13px] transition-colors",
        isError ? "border-destructive/30" : "border-border"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-md border",
              isError
                ? "border-destructive/40 text-destructive"
                : "border-border text-muted-foreground",
              isRunning && "animate-pulse"
            )}
            aria-hidden="true"
          >
            <ToolIcon />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium text-foreground">
              {prettyToolName(event.name)}
            </span>
            {summary && (
              <span className="truncate text-[11px] text-muted-foreground">{summary}</span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={cn("text-xs font-medium", statusColor)}>{statusLabel}</span>
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border pt-2 text-xs">
          {event.args !== undefined && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Arguments
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(event.args, null, 2)}
              </pre>
            </div>
          )}
          {event.result !== undefined && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Result
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(event.result, null, 2)}
              </pre>
            </div>
          )}
          {event.error && (
            <div className="text-destructive">
              <div className="mb-1 text-[11px] uppercase tracking-wider">Error</div>
              <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px]">
                {event.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
