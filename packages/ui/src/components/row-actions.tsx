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
import { useUiT } from "../lib/i18n.js"

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
  triggerLabel,
  align = "end",
  className,
}: RowActionsProps) {
  const { t } = useUiT()
  // The chosen action runs only once the menu has closed and handed focus
  // back to the trigger. Actions usually open a confirm dialog; opening it
  // while the menu is still open leaves the menu sitting under the dialog,
  // and the dialog would hand focus back to a menu item that no longer
  // exists when it closes.
  const chosen = React.useRef<RowAction | null>(null)
  if (actions.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-8", className)}
          aria-label={triggerLabel ?? t('rowActions.actions')}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="min-w-44"
        onCloseAutoFocus={() => {
          const action = chosen.current
          chosen.current = null
          if (action) void action.onSelect()
        }}
      >
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <React.Fragment key={action.id}>
              {action.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={action.disabled}
                variant={action.destructive ? "destructive" : "default"}
                onSelect={() => {
                  chosen.current = action
                }}
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
