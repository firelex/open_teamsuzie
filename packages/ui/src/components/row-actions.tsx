import * as React from "react"
import { MoreHorizontal } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "./button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { cn } from "../lib/utils"

export interface RowAction {
  id: string
  label: string
  icon?: LucideIcon
  /** Renders the item in destructive (red) styling. */
  destructive?: boolean
  disabled?: boolean
  /** Inserts a separator above this item. Useful before destructive items. */
  separatorBefore?: boolean
  onSelect: () => void | Promise<void>
}

export interface RowActionsProps {
  /** Action set, top-to-bottom order. Conventionally Edit first, Delete last. */
  actions: RowAction[]
  /** sr-only label for the trigger; defaults to "Actions". */
  triggerLabel?: string
  /** Aligns the menu — `end` puts it flush with the right edge of the trigger. */
  align?: "start" | "center" | "end"
  className?: string
}

/**
 * The standard row-level actions menu — a hover-revealed `⋯` icon
 * button that opens a DropdownMenu. Use on every list row that
 * supports per-item edit / delete / etc., so the affordance is the
 * same everywhere (matters list, documents list, chats list, prompts).
 *
 * Convention: Edit-style actions on top, destructive last with
 * `separatorBefore: true` to give the dangerous one room to breathe.
 */
export function RowActions({
  actions,
  triggerLabel = "Actions",
  align = "end",
  className,
}: RowActionsProps) {
  if (actions.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-8", className)}
          aria-label={triggerLabel}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <React.Fragment key={action.id}>
              {action.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={action.disabled}
                onSelect={(e) => {
                  e.preventDefault()
                  void action.onSelect()
                }}
                className={cn(
                  action.destructive &&
                    "text-destructive focus:bg-destructive/10 focus:text-destructive",
                )}
              >
                {Icon && <Icon className="size-4" aria-hidden />}
                <span>{action.label}</span>
              </DropdownMenuItem>
            </React.Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
