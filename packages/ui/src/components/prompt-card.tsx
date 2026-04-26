import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "../lib/utils"

/**
 * A clickable card for browseable items in a library grid: title, optional
 * subtitle, optional tag chips, and an optional leading icon. Driven by
 * `aria-current` for selection state if you want it.
 *
 * Use `asChild` to render as a different element (e.g. a router link).
 *
 * Layout note: the card stretches to fill its grid cell (`h-full`). Pair
 * with `auto-rows-fr` on the parent grid for visually consistent rows even
 * when descriptions vary in length.
 *
 * Pass `disabled` to render a visibly faded, non-interactive card — useful
 * for "coming soon" entries in a catalog.
 */
function PromptCard({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="prompt-card"
      type={asChild ? undefined : "button"}
      className={cn(
        // w-full: <button> defaults to inline-block — without this, cards
        // shrink to their content width inside a CSS grid cell, breaking
        // the otherwise-equal-width grid columns.
        "group flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-card px-4 py-4 text-left transition-colors",
        "hover:border-foreground/20 hover:bg-accent",
        "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card",
        className
      )}
      {...props}
    />
  )
}

function PromptCardIcon({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-card-icon"
      className={cn(
        "flex size-6 items-center justify-center text-muted-foreground",
        className
      )}
      aria-hidden="true"
      {...props}
    />
  )
}

function PromptCardTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-card-title"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

function PromptCardDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-card-description"
      // Clamp to three lines so cards don't bloat on long descriptions —
      // pair with auto-rows-fr on the grid for consistent card heights.
      className={cn("line-clamp-3 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function PromptCardTags({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-card-tags"
      className={cn(
        "mt-auto flex flex-wrap gap-1.5 pt-2 text-[11px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function PromptCardTag({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="prompt-card-tag"
      className={cn(
        "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-medium",
        className
      )}
      {...props}
    />
  )
}

export {
  PromptCard,
  PromptCardIcon,
  PromptCardTitle,
  PromptCardDescription,
  PromptCardTags,
  PromptCardTag,
}
