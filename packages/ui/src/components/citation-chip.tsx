import * as React from "react"
import type { Citation } from "@teamsuzie/citations"

import { cn } from "../lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip"

export type CitationChipProps = {
  id: number
  citation?: Citation
  onJump?: (citation: Citation) => void
  className?: string
  docLabel?: string
}

const baseClass =
  "inline-flex items-center justify-center align-super rounded-full px-1.5 mx-0.5 min-w-[1.25rem] h-[1.1rem] text-[10px] font-medium leading-none transition-colors"

export function CitationChip({
  id,
  citation,
  onJump,
  className,
  docLabel,
}: CitationChipProps) {
  const orphan = !citation

  if (orphan) {
    return (
      <span
        aria-label={`Unresolved citation [${id}]`}
        className={cn(
          baseClass,
          "bg-muted text-muted-foreground line-through cursor-help",
          className,
        )}
      >
        {id}
      </span>
    )
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    onJump?.(citation)
  }

  const docName = docLabel ?? citation.doc
  const ariaLocator = citation.locator ? ` — ${citation.locator}` : ""

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Citation [${id}] — ${docName}${ariaLocator}`}
            onClick={handleClick}
            className={cn(
              baseClass,
              "bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40",
              className,
            )}
          >
            {id}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm bg-popover text-popover-foreground border border-border shadow-md">
          <div className="space-y-1 text-left">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {docName}
              {citation.locator ? ` · ${citation.locator}` : ""}
            </div>
            <div className="text-xs italic leading-snug">
              &ldquo;{citation.quote}&rdquo;
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
