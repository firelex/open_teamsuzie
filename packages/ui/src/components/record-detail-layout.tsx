import * as React from "react"

import { cn } from "../lib/utils"

/**
 * Two-column layout used by record-detail screens: a tall primary
 * column for the headline + tabs/content, and a fixed-width sidebar
 * for property panels, related records, or activity. Purely
 * presentational — no data hooks. Hosts compose any children they
 * like into the slots.
 *
 * Mobile: stacks main above sidebar. From `md:` up, the sidebar pins
 * to the right at a default width of ~22rem (override with
 * `sidebarClassName` to widen, e.g. `md:w-[28rem]`).
 */
export interface RecordDetailLayoutProps extends React.ComponentProps<"div"> {
  header?: React.ReactNode
  sidebar?: React.ReactNode
  sidebarClassName?: string
  mainClassName?: string
}

function RecordDetailLayout({
  className,
  header,
  sidebar,
  sidebarClassName,
  mainClassName,
  children,
  ...props
}: RecordDetailLayoutProps) {
  return (
    <div
      data-slot="record-detail-layout"
      className={cn("flex h-full min-h-0 flex-col", className)}
      {...props}
    >
      {header ? (
        <div data-slot="record-detail-header" className="border-b border-border bg-card">
          {header}
        </div>
      ) : null}
      <div
        data-slot="record-detail-body"
        className="flex min-h-0 flex-1 flex-col md:flex-row"
      >
        <div
          data-slot="record-detail-main"
          className={cn(
            "min-w-0 flex-1 overflow-y-auto px-6 py-5",
            mainClassName,
          )}
        >
          {children}
        </div>
        {sidebar ? (
          <aside
            data-slot="record-detail-sidebar"
            className={cn(
              "shrink-0 border-t border-border bg-card md:w-[22rem] md:border-l md:border-t-0",
              "overflow-y-auto",
              sidebarClassName,
            )}
          >
            {sidebar}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

function RecordDetailTitle({
  className,
  ...props
}: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="record-detail-title"
      className={cn(
        "text-xl font-semibold tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function RecordDetailSubtitle({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="record-detail-subtitle"
      className={cn("mt-1 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function RecordDetailHeaderContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="record-detail-header-content"
      className={cn(
        "flex items-start justify-between gap-4 px-6 py-5",
        className,
      )}
      {...props}
    />
  )
}

function RecordDetailActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="record-detail-actions"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

export {
  RecordDetailLayout,
  RecordDetailTitle,
  RecordDetailSubtitle,
  RecordDetailHeaderContent,
  RecordDetailActions,
}
