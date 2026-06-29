import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  Sparkles,
  AppShell as UiAppShell,
  AppShellMain,
  AppShellContent,
  Sidebar,
  SidebarHeader,
  SidebarNav,
  SidebarNavItem,
  SidebarFooter,
  type LucideIcon,
} from '@teamsuzie/ui';
import { testid } from '../lib/testids';
import { TopBar } from './TopBar';

export interface NavEntry {
  /** Route path, e.g. '/deals'. The '/' entry is treated as the home/index. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Stable id for the nav item's data-testid (derive from the layout nav id). */
  id: string;
}

/**
 * Navigation map. THIS IS THE ONE THING THE BUILD AGENT WIRES from
 * docs/ux/layout.json: one entry per nav-group item (and object workspace).
 * The template ships a single placeholder so the shell renders before wiring.
 * Everything else in this file is fixed.
 */
export const NAV: NavEntry[] = [
  { to: '/', label: 'Home', icon: LayoutGrid, id: 'home' },
];

/**
 * Fixed top-level shell: @teamsuzie/ui AppShell + Sidebar + the governance
 * TopBar. Brand mark and theme come from @teamsuzie/theme. The agent replaces
 * NAV and the brand label; it does not restructure the shell.
 */
export function AppShell({ children, brand = 'Workspace' }: { children: ReactNode; brand?: string }) {
  return (
    <UiAppShell>
      <Sidebar className="bg-header-gradient-v">
        <SidebarHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-fancy-gradient text-white shadow-violet-glow">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-neutral-900">{brand}</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ev-700/80">
                Team Suzie
              </div>
            </div>
          </div>
        </SidebarHeader>
        <SidebarNav>
          {NAV.map(({ to, label, icon: Icon, id }) => (
            <SidebarNavItem key={to} asChild>
              <NavLink to={to} end={to === '/'} data-testid={testid.navItem(id)}>
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </span>
              </NavLink>
            </SidebarNavItem>
          ))}
        </SidebarNav>
        <SidebarFooter>
          <span className="font-mono-data text-[10px]">v0.1 · starter</span>
        </SidebarFooter>
      </Sidebar>
      <AppShellMain>
        <TopBar />
        <AppShellContent>{children}</AppShellContent>
      </AppShellMain>
    </UiAppShell>
  );
}
