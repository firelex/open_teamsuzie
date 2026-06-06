import type { ComponentType } from "react"
import {
  Activity,
  AlertTriangle,
  Circle,
  Cpu,
  MessageCircle,
  Pause,
  Sparkles,
  UserRound,
} from "lucide-react"

/**
 * Live agent activity surface used across a department app to show, at a
 * glance, who is currently working: the work run itself, a code-review
 * agent, an editing agent, a chat agent, or a state requiring user input.
 *
 * Purely presentational. State is derived in app-side hooks and threaded
 * in via the `variant` prop. Pulses only on the dot (and only for non-idle,
 * non-error variants); the pill chrome itself stays static so the rest of
 * the layout doesn't shimmer. `motion-safe:` lets reduced-motion users
 * see a steady dot.
 */
export type ActivityVariant =
  | "work-run-active"
  | "work-run-paused"
  | "work-run-blocked"
  | "codex-active"
  | "claude-active"
  | "qwen-active"
  | "awaiting-user"
  | "error"
  | "idle"

export interface ActivityPillProps {
  variant: ActivityVariant
  label?: string
  detail?: string
  title?: string
  size?: "xs" | "sm"
  className?: string
}

interface VariantStyle {
  icon: ComponentType<{ className?: string }>
  defaultLabel: string
  pillClass: string
  dotClass: string
  iconClass: string
  pulse: boolean
}

const VARIANTS: Record<ActivityVariant, VariantStyle> = {
  "work-run-active": {
    icon: Activity,
    defaultLabel: "Work run active",
    pillClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dotClass: "bg-emerald-500",
    iconClass: "text-emerald-600",
    pulse: true,
  },
  "work-run-paused": {
    icon: Pause,
    defaultLabel: "Paused",
    pillClass: "border-amber-200 bg-amber-50 text-amber-800",
    dotClass: "bg-amber-500",
    iconClass: "text-amber-600",
    pulse: false,
  },
  "work-run-blocked": {
    icon: AlertTriangle,
    defaultLabel: "Blocked",
    pillClass: "border-rose-200 bg-rose-50 text-rose-800",
    dotClass: "bg-rose-500",
    iconClass: "text-rose-600",
    pulse: false,
  },
  "codex-active": {
    icon: Cpu,
    defaultLabel: "Codex reviewing",
    pillClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dotClass: "bg-emerald-500",
    iconClass: "text-emerald-600",
    pulse: true,
  },
  "claude-active": {
    icon: Sparkles,
    defaultLabel: "Claude working",
    pillClass: "border-orange-200 bg-orange-50 text-orange-800",
    dotClass: "bg-orange-500",
    iconClass: "text-orange-500",
    pulse: true,
  },
  "qwen-active": {
    icon: MessageCircle,
    defaultLabel: "Waiting for Qwen",
    pillClass: "border-ev-200 bg-ev-50 text-ev-800",
    dotClass: "bg-ev-500",
    iconClass: "text-ev-500",
    pulse: true,
  },
  "awaiting-user": {
    icon: UserRound,
    defaultLabel: "Needs user",
    pillClass: "border-amber-200 bg-amber-50 text-amber-800",
    dotClass: "bg-amber-500",
    iconClass: "text-amber-600",
    pulse: true,
  },
  "error": {
    icon: AlertTriangle,
    defaultLabel: "Error",
    pillClass: "border-rose-200 bg-rose-50 text-rose-800",
    dotClass: "bg-rose-500",
    iconClass: "text-rose-600",
    pulse: false,
  },
  "idle": {
    icon: Circle,
    defaultLabel: "Idle",
    pillClass: "border-neutral-200 bg-neutral-50 text-neutral-600",
    dotClass: "bg-neutral-400",
    iconClass: "text-neutral-400",
    pulse: false,
  },
}

export function ActivityPill({
  variant,
  label,
  detail,
  title,
  size = "sm",
  className,
}: ActivityPillProps) {
  const v = VARIANTS[variant]
  const Icon = v.icon
  const textSize = size === "xs" ? "text-[10px]" : "text-[11px]"
  const iconSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"
  const dotPulse = v.pulse ? "motion-safe:animate-pulse" : ""
  return (
    <span
      role="status"
      aria-live="polite"
      data-slot="activity-pill"
      title={
        title ??
        (detail ? `${label ?? v.defaultLabel} · ${detail}` : (label ?? v.defaultLabel))
      }
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold uppercase tracking-wider",
        textSize,
        v.pillClass,
        className ?? "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${v.dotClass} ${dotPulse}`}
      />
      <Icon className={`${iconSize} ${v.iconClass} shrink-0`} aria-hidden />
      <span className="truncate max-w-[22ch]">{label ?? v.defaultLabel}</span>
      {detail && (
        <span className="truncate max-w-[20ch] font-mono normal-case tracking-normal text-[10px] opacity-80">
          {detail}
        </span>
      )}
    </span>
  )
}

export const ACTIVITY_DEFAULT_LABEL: Record<ActivityVariant, string> = Object.fromEntries(
  (Object.keys(VARIANTS) as ActivityVariant[]).map((k) => [k, VARIANTS[k].defaultLabel]),
) as Record<ActivityVariant, string>
