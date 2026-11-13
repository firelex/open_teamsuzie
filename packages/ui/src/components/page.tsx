import * as React from "react"

import { cn } from "../lib/utils.js"

export interface PageProps {
  /** A short label above the title (e.g. the section the page belongs to). */
  eyebrow?: React.ReactNode
  title: React.ReactNode
  /** One or two sentences under the title. */
  description?: React.ReactNode
  /** Buttons and controls for the whole page, at the right of the header. */
  actions?: React.ReactNode
  /** Above the label, e.g. a link back to where the page was opened from. */
  back?: React.ReactNode
  /** Under the description, still in the header, e.g. a status badge or tabs. */
  meta?: React.ReactNode
  children?: React.ReactNode
  className?: string
  /** Extra classes for the body (the part under the header). */
  bodyClassName?: string
}

/**
 * A page of an app: a header (back link, label, title, description, actions)
 * over a body, both at one centred width with the same padding, so every
 * page lines up with every other. Apps style the parts through their
 * `data-slot` names (page-eyebrow, page-title, page-description, …).
 */
export function Page({ eyebrow, title, description, actions, back, meta, children, className, bodyClassName }: PageProps) {
  return (
    <div data-slot="page" className={cn("flex min-h-full w-full flex-col", className)}>
      <header data-slot="page-header" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-8 pb-6 pt-8">
          {back && (
            <div data-slot="page-back" className="mb-3 text-sm text-muted-foreground">
              {back}
            </div>
          )}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              {eyebrow && (
                <div data-slot="page-eyebrow" className="text-xs uppercase tracking-wider text-muted-foreground">
                  {eyebrow}
                </div>
              )}
              <h1 data-slot="page-title" className="mt-1 text-2xl font-semibold tracking-tight">
                {title}
              </h1>
              {description && (
                <p data-slot="page-description" className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            {actions && (
              <div data-slot="page-actions" className="flex flex-wrap items-center gap-3">
                {actions}
              </div>
            )}
          </div>
          {meta && (
            <div data-slot="page-meta" className="mt-4">
              {meta}
            </div>
          )}
        </div>
      </header>
      <div data-slot="page-body" className={cn("mx-auto w-full max-w-6xl flex-1 px-8 py-8", bodyClassName)}>
        {children}
      </div>
    </div>
  )
}
