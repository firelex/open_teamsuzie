import * as React from "react"

import { cn } from "../lib/utils"
import { useUiT } from "../lib/i18n.js"

export type StatusState = "online" | "offline" | "pending"

const DOT_COLOR: Record<StatusState, string> = {
  online: "bg-emerald-500",
  offline: "bg-destructive",
  pending: "bg-muted-foreground/50",
}

/**
 * Inline status indicator: a colored dot + label, with a hover title that
 * explains what the state means. Designed for chat-app sidebar footers and
 * admin headers — anywhere the user wants a quick at-a-glance read on
 * upstream service health.
 */
export function StatusDot({
  name,
  state,
  title,
  className,
}: {
  name: string
  state: StatusState
  /** Override the default hover title. */
  title?: string
  className?: string
}) {
  const { t } = useUiT()
  const defaultTitles: Record<StatusState, string> = {
    online: t('statusDot.runtimeReachable'),
    offline: t('statusDot.runtimeOffline'),
    pending: t('statusDot.checkingRuntime'),
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
      title={title ?? defaultTitles[state]}
    >
      <span className={cn("size-1.5 rounded-full", DOT_COLOR[state])} aria-hidden="true" />
      <span className="font-medium text-foreground/80">{name}</span>
    </span>
  )
}
