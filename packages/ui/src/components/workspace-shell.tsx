import * as React from "react"
import { Boxes } from "lucide-react"

import { cn } from "../lib/utils"
import { AppShell, AppShellMain, AppShellContent } from "./app-shell.js"
import {
  Sidebar,
  SidebarHeader,
  SidebarNav,
  SidebarSection,
  SidebarDivider,
  SidebarNavItem,
  SidebarFooter,
  SidebarUserProfile,
} from "./sidebar.js"
import { TeamSuzieLogo } from "./team-suzie-logo.js"

export interface WorkspaceNavItem {
  /** Stable id (used for the nav item's data-testid). */
  id: string
  /** Route path, e.g. "/deals". */
  to: string
  label: React.ReactNode
  /** Leading icon; sized to the canonical 18px inside the shell. */
  icon?: React.ReactNode
  badge?: React.ReactNode
  /** Exact-match routing (the index route usually sets this). */
  end?: boolean
}

export interface WorkspaceNavGroup {
  /** Uppercase section label. Omit for an unlabelled group. */
  title?: React.ReactNode
  items: WorkspaceNavItem[]
}

export interface WorkspaceUser {
  name?: React.ReactNode
  email?: React.ReactNode
  avatar?: React.ReactNode
  /** Single char for the default gradient avatar when `avatar` is omitted. */
  initial?: string
}

export interface WorkspaceShellProps {
  /** App name shown under the fixed teamsuzie.com wordmark (e.g. "IT Department"). */
  appName: React.ReactNode
  /** Small label above the app name (e.g. "Workspace"). */
  appTagline?: React.ReactNode
  /** Brand mark beside the app name; defaults to the standard gradient box. */
  appMark?: React.ReactNode
  navGroups: WorkspaceNavGroup[]
  /** Router link component (e.g. react-router's NavLink). Receives {to,end,children,...}. */
  navLinkComponent: React.ElementType
  navItemTestId?: (id: string) => string
  user?: WorkspaceUser
  onSignOut?: () => void | Promise<void>
  signOutPending?: boolean
  /** App-specific controls dropped into the fixed top-bar frame (right-aligned). */
  topBar?: React.ReactNode
  shellTestId?: string
  sidebarTestId?: string
  topBarTestId?: string
  className?: string
  children: React.ReactNode
}

const DEFAULT_MARK = (
  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-fancy-gradient text-white shadow-sm">
    <Boxes className="h-3.5 w-3.5" />
  </div>
)

/**
 * The canonical Suzie workspace app frame — a gradient sidebar with the
 * teamsuzie.com wordmark, an app-name header, grouped navigation (sections +
 * dividers), a user footer, and a top-bar frame — matching the Suzie IT
 * Department parent app.
 *
 * ALL chrome (layout, wordmark, fonts, colours, spacing, icon sizing, top-bar
 * frame) is fixed here, so every app that renders this looks identical.
 * Consumers supply only DATA: `navGroups`, the signed-in `user`, and the
 * app-specific `topBar` controls. Do not fork the chrome per app — feed it data.
 */
export function WorkspaceShell({
  appName,
  appTagline,
  appMark,
  navGroups,
  navLinkComponent: NavLink,
  navItemTestId,
  user,
  onSignOut,
  signOutPending,
  topBar,
  shellTestId,
  sidebarTestId,
  topBarTestId,
  className,
  children,
}: WorkspaceShellProps) {
  return (
    <AppShell data-testid={shellTestId} className={cn("bg-white font-inter text-neutral-900", className)}>
      <Sidebar gradient data-testid={sidebarTestId}>
        <div className="relative px-5 pt-5">
          <TeamSuzieLogo className="h-6 w-auto" />
        </div>
        <SidebarHeader
          className="px-5 pt-3 pb-4"
          brand={appMark ?? DEFAULT_MARK}
          title={appName}
          subtitle={appTagline}
        />
        <SidebarDivider />
        <SidebarNav className="relative flex-1 overflow-y-auto px-4 py-5">
          {navGroups.map((group, gi) => (
            <SidebarSection key={gi} title={group.title} divider={gi > 0}>
              {group.items.map((item) => (
                <SidebarNavItem key={item.id} asChild icon={sizeIcon(item.icon)} badge={item.badge}>
                  <NavLink to={item.to} end={item.end} data-testid={navItemTestId?.(item.id)}>
                    {item.label}
                  </NavLink>
                </SidebarNavItem>
              ))}
            </SidebarSection>
          ))}
        </SidebarNav>
        {user && (
          <SidebarFooter>
            <SidebarUserProfile
              name={user.name}
              email={user.email}
              avatar={user.avatar}
              initial={user.initial}
              statusDot="bg-emerald-500"
              onSignOut={onSignOut}
              signOutPending={signOutPending}
            />
          </SidebarFooter>
        )}
      </Sidebar>
      <AppShellMain>
        <div
          data-testid={topBarTestId}
          className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-5 font-inter text-sm text-neutral-600"
        >
          {topBar}
        </div>
        <AppShellContent>{children}</AppShellContent>
      </AppShellMain>
    </AppShell>
  )
}

/** Normalise a nav icon to the canonical 18px so every app's nav matches. */
function sizeIcon(icon: React.ReactNode): React.ReactNode {
  if (!React.isValidElement(icon)) return icon
  const el = icon as React.ReactElement<{ className?: string }>
  return React.cloneElement(el, { className: cn("h-[18px] w-[18px]", el.props.className) })
}
