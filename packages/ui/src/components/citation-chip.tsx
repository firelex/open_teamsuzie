import * as React from "react"
import type { Citation } from "@teamsuzie/citations"

import { cn } from "../lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip"
import { useUiT } from "../lib/i18n.js"

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
  const { t } = useUiT()
  const orphan = !citation

  if (orphan) {
    return (
      <span
        aria-label={t('citationChip.unresolvedCitation', { id })}
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
  // Set by verifyCitations once the answer is complete. A quote that could
  // not be found in its source is flagged rather than shown as authoritative.
  const notFound = citation.verification === "not_found"

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={
              notFound
                ? t('citationChip.citationAriaLabelNotFound', { id, docName, locator: ariaLocator })
                : t('citationChip.citationAriaLabel', { id, docName, locator: ariaLocator })
            }
            onClick={handleClick}
            className={cn(
              baseClass,
              notFound
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/50 hover:bg-amber-500/25 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/60"
                : "bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40",
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
            {notFound ? (
              <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                {t('citationChip.quoteNotFoundWarning')}
              </div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
