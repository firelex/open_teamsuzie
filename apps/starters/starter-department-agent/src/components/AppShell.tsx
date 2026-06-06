import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  MessageSquare,
  Activity,
  Inbox,
  FileText,
  Check,
  SettingsIcon,
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

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Sidebar nav for the starter. Each entry maps to a placeholder route in
 * `App.tsx`. Use neutral terms — `Activity`, `Work queue`, `Artifacts`,
 * `Approvals` — so this list can be the seed for any department vertical
 * (executive assistant, customer support, ops, …) without rename churn.
 */
const NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/work-queue', label: 'Work queue', icon: Inbox },
  { to: '/artifacts', label: 'Artifacts', icon: FileText },
  { to: '/approvals', label: 'Approvals', icon: Check },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * Top-level shell. Wraps `@teamsuzie/ui`'s `AppShell` + `Sidebar` with a
 * starter-flavored brand mark and the neutral nav above. The cyan
 * gradient backdrop, electric-violet accents, and JetBrains-Mono tabular
 * numerics come from `@teamsuzie/theme` — change the brand mark and
 * replace the nav to retheme an entire department vertical.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <UiAppShell>
      <Sidebar className="bg-header-gradient-v">
        <SidebarHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-fancy-gradient text-white shadow-violet-glow">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-neutral-900">Department</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ev-700/80">
                Team Suzie
              </div>
            </div>
          </div>
        </SidebarHeader>
        <SidebarNav>
          {NAV.map(({ to, label, icon: Icon }) => (
            <SidebarNavItem key={to} asChild>
              <NavLink to={to} end={to === '/'}>
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
        <AppShellContent>{children}</AppShellContent>
      </AppShellMain>
    </UiAppShell>
  );
}
