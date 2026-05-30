import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "../lib/utils"

function Sidebar({
  className,
  ...props
}: React.ComponentProps<"aside">) {
  return (
    <aside
      data-slot="sidebar"
      aria-label="Sidebar"
      className={cn(
        "hidden w-60 shrink-0 flex-col border-r border-border bg-muted md:flex",
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex min-h-14 items-center px-4 py-3", className)}
      {...props}
    />
  )
}

function SidebarNav({
  className,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="sidebar-nav"
      className={cn("flex-1 px-2 py-2", className)}
      {...props}
    />
  )
}

/**
 * A single sidebar nav row. Active state is driven by `aria-current="page"`,
 * which is set automatically by routers like react-router's NavLink.
 *
 * Use `asChild` to wrap a router link: `<SidebarNavItem asChild><NavLink .../></SidebarNavItem>`.
 */
function SidebarNavItem({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "a"
  return (
    <Comp
      data-slot="sidebar-nav-item"
      className={cn(
        "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
        "text-muted-foreground hover:bg-background/60 hover:text-foreground",
        "aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function SidebarFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        "border-t border-border px-4 py-3 text-xs text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Sidebar, SidebarHeader, SidebarNav, SidebarNavItem, SidebarFooter }
