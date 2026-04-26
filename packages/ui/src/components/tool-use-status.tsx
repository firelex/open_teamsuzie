import * as React from "react"

import { cn } from "../lib/utils"
import { WHIMSICAL_VERBS, prettyToolName, summarizeArgs } from "../lib/tool-display"

export interface ToolEvent {
  id: string
  name: string
  args?: unknown
  result?: unknown
  error?: string
  status: "running" | "done" | "error"
}

/**
 * Compact live indicator shown under an assistant message while the agent is
 * mid-tool-use: a stable whimsical verb on top, a pulsing chip showing the
 * current tool below. Replaces the Old World "stack a card per tool call"
 * UX with something that doesn't drown the actual reply.
 *
 * Pass an optional `verb` to lock the verb (handy for tests); otherwise one
 * is picked at random on first render and held via a ref.
 */
export function ToolUseStatus({
  events,
  verb,
  className,
}: {
  events: ToolEvent[]
  verb?: string
  className?: string
}) {
  const verbRef = React.useRef<string | null>(null)
  if (verbRef.current === null) {
    verbRef.current = verb ?? WHIMSICAL_VERBS[Math.floor(Math.random() * WHIMSICAL_VERBS.length)]
  }
  const running = events.find((e) => e.status === "running")
  const current = running ?? events[events.length - 1]
  if (!current) return null
  const summary = summarizeArgs(current.args)

  return (
    <div className={cn("my-2 flex flex-col gap-1.5", className)}>
      <span className="text-sm italic text-muted-foreground">{verbRef.current}…</span>
      <div className="inline-flex max-w-fit animate-pulse items-center gap-2 rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
        <span className="font-medium text-foreground">{prettyToolName(current.name)}</span>
        {summary && (
          <span className="truncate text-muted-foreground" title={summary}>
            · {summary}
          </span>
        )}
      </div>
    </div>
  )
}
