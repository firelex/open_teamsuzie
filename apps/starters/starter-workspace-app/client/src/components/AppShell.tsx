import { createElement, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { WorkspaceShell, type WorkspaceNavGroup } from '@teamsuzie/ui';

import { useAuth } from './AuthGate';
import { logout } from '../lib/auth';
import { testid } from '../lib/testids';
import { TopBar } from './TopBar';
import { NAV_GROUPS } from '../lib/nav';

/**
 * Fixed top-level shell — the canonical `@teamsuzie/ui` `WorkspaceShell`, which
 * renders chrome identical to the Suzie IT Department parent app (gradient
 * sidebar, teamsuzie.com wordmark, grouped nav, user footer, top-bar frame).
 *
 * The build agent does NOT edit this file. It wires navigation by editing
 * `lib/nav.ts` (`NAV_GROUPS`) and drops app controls into `TopBar`. Only `brand`
 * / `tagline` are app-specific here.
 */
export function AppShell({
  children,
  brand = 'Workspace',
  tagline = 'Team Suzie',
}: {
  children: ReactNode;
  brand?: string;
  tagline?: string;
}) {
  const { user } = useAuth();
  const name = user.name || user.email;

  const navGroups: WorkspaceNavGroup[] = NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({
      id: item.id,
      to: item.to,
      label: item.label,
      end: item.end,
      icon: createElement(item.icon),
    })),
  }));

  return (
    <WorkspaceShell
      appName={brand}
      appTagline={tagline}
      navGroups={navGroups}
      navLinkComponent={NavLink}
      navItemTestId={testid.navItem}
      user={{ name, email: user.email, initial: (name || '?').charAt(0).toUpperCase() }}
      onSignOut={() => { void logout(); }}
      topBar={<TopBar />}
      shellTestId={testid.appShell}
      sidebarTestId={testid.sidebar}
      topBarTestId={testid.topBar}
    >
      {children}
    </WorkspaceShell>
  );
}
