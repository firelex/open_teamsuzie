import * as React from "react"

import { cn } from "../lib/utils.js"

export type Theme = "system" | "light" | "dark"

const STORAGE_KEY = "teamsuzie.theme"

function readStored(): Theme {
  if (typeof window === "undefined") return "system"
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === "light" || raw === "dark" ? raw : "system"
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (theme === "system") {
    root.removeAttribute("data-theme")
  } else {
    root.setAttribute("data-theme", theme)
  }
}

/**
 * Manages the active theme without rendering UI. Mount this once at the app
 * root if you want the saved theme applied on first paint without depending
 * on the toggle component rendering. (Optional — ThemeToggle does the same
 * inside its own effect.)
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = React.useState<Theme>(() => readStored())

  React.useEffect(() => {
    apply(theme)
  }, [theme])

  const setTheme = React.useCallback((next: Theme) => {
    if (typeof window !== "undefined") {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next)
    }
    setThemeState(next)
  }, [])

  return [theme, setTheme]
}

const OPTIONS: { value: Theme; label: string; glyph: string }[] = [
  { value: "light",  label: "Light",  glyph: "☀" },
  { value: "system", label: "System", glyph: "⌂" },
  { value: "dark",   label: "Dark",   glyph: "☾" },
]

/**
 * A compact segmented theme toggle. Renders three options (Light / System /
 * Dark) with the current selection highlighted. Persists to localStorage and
 * sets `data-theme` on `<html>`.
 *
 * Generic — any consuming app uses it the same way. Style overrides via
 * `className` propagate to the container; the individual buttons inherit
 * from the active theme tokens.
 */
export function ThemeToggle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [theme, setTheme] = useTheme()

  return (
    <div
      data-slot="theme-toggle"
      role="radiogroup"
      aria-label="Color theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5",
        className,
      )}
      {...props}
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(opt.value)}
            title={`${opt.label} theme`}
            className={cn(
              "inline-flex h-6 min-w-6 items-center justify-center rounded-sm px-1.5 text-xs transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <span aria-hidden className="text-[11px] leading-none">{opt.glyph}</span>
            <span className="sr-only">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
