import * as React from "react"
import { X } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "./button"
import { cn } from "../lib/utils"

export interface BulkActionBarItem {
  /** Stable id used as React key. */
  id: string
  label: string
  icon?: LucideIcon
  /**
   * Visual treatment. `destructive` for delete-style actions; `default`
   * for primary; `outline` for everything else.
   */
  variant?: "default" | "outline" | "destructive"
  /** Disabled when busy or otherwise unavailable. */
  disabled?: boolean
  onClick: () => void | Promise<void>
}

export interface BulkActionBarItemBarProps {
  /** Number of selected items. The bar hides when this is 0. */
  selectionCount: number
  /** "matter" / "document" / "chat" — used for the count label. */
  itemNoun: string
  /** Plural override; default is `${itemNoun}s`. */
  itemNounPlural?: string
  /** Clear-selection callback. */
  onClear: () => void
  actions: BulkActionBarItem[]
  className?: string
}

/**
 * Sticky bar that appears at the bottom of a list when one or more
 * items are selected. Hosts the bulk actions (delete, archive, move,
 * etc.) plus a clear-selection control.
 *
 * Renders in-flow at the bottom of the page content; if you need it
 * to float above scrolling content, wrap it in a `sticky bottom-0`
 * container at the page level.
 */
export function BulkActionBarItemBar({
  selectionCount,
  itemNoun,
  itemNounPlural,
  onClear,
  actions,
  className,
}: BulkActionBarItemBarProps) {
  if (selectionCount === 0) return null
  const noun =
    selectionCount === 1
      ? itemNoun
      : (itemNounPlural ?? `${itemNoun}s`)

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X className="size-4" aria-hidden />
        </Button>
        <span className="font-medium">
          {selectionCount} {noun} selected
        </span>
      </div>
      <div className="flex items-center gap-2">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <Button
              key={action.id}
              variant={action.variant ?? "outline"}
              size="sm"
              disabled={action.disabled}
              onClick={() => void action.onClick()}
            >
              {Icon && <Icon className="size-4" aria-hidden />}
              <span>{action.label}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
