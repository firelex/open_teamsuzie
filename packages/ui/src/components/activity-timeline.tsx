import * as React from "react"
import { Activity } from "lucide-react"

import { cn } from "../lib/utils"

/**
 * Generic activity timeline. Renders a vertical sequence of events
 * with an icon rail. Data-only — host adapters convert their domain
 * events (DB rows from `@teamsuzie/activity`, file-backed entries
 * from `@teamsuzie/artifacts`, etc.) into {@link TimelineEntry} props.
 *
 * Icons and labels are wholly host-driven through `kindRenderer` so
 * the component carries no domain vocabulary.
 */
export interface TimelineEntry {
  id: string
  kind: string
  summary: React.ReactNode
  /** Optional longer content. Renders below the summary in a smaller font. */
  body?: React.ReactNode
  actorLabel?: React.ReactNode
  /** ISO string or a pre-formatted timestamp. */
  timeLabel?: React.ReactNode
}

export interface ActivityTimelineProps {
  entries: TimelineEntry[]
  /**
   * Optional per-kind icon + accent classname pair. Host should return
   * `null` to fall back to the default `Activity` icon in the neutral
   * tone. The renderer is called once per entry.
   */
  kindRenderer?: (kind: string) => {
    icon: React.ReactNode
    /** Tailwind class applied to the icon disc. */
    accentClass?: string
  } | null
  emptyLabel?: React.ReactNode
  className?: string
}

function ActivityTimeline({
  entries,
  kindRenderer,
  emptyLabel = "No activity yet.",
  className,
}: ActivityTimelineProps) {
  if (entries.length === 0) {
    return (
      <div
        data-slot="activity-timeline-empty"
        className={cn(
          "rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        {emptyLabel}
      </div>
    )
  }
  return (
    <ol
      data-slot="activity-timeline"
      className={cn("relative space-y-4", className)}
    >
      {entries.map((entry, index) => {
        const variant = kindRenderer?.(entry.kind) ?? null
        const icon = variant?.icon ?? (
          <Activity className="h-3.5 w-3.5" aria-hidden />
        )
        const isLast = index === entries.length - 1
        return (
          <li
            key={entry.id}
            data-slot="activity-timeline-entry"
            data-kind={entry.kind}
            className="relative flex gap-3"
          >
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground",
                  variant?.accentClass,
                )}
              >
                {icon}
              </span>
              {!isLast ? (
                <span
                  aria-hidden
                  className="mt-1 w-px flex-1 bg-border"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-foreground">
                  {entry.summary}
                </span>
                {entry.actorLabel ? (
                  <span className="text-xs text-muted-foreground">
                    {entry.actorLabel}
                  </span>
                ) : null}
                {entry.timeLabel ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {entry.timeLabel}
                  </span>
                ) : null}
              </div>
              {entry.body ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  {entry.body}
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export { ActivityTimeline }
