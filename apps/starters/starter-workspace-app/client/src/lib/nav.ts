import { LayoutGrid, Boxes, type LucideIcon } from '@teamsuzie/ui';

/**
 * Navigation data — THE ONE PART OF THE SHELL THE BUILD AGENT WIRES from
 * `docs/ux/layout.json`: one group per nav section, one item per nav entry (and
 * object workspace). The shell chrome itself (components/AppShell.tsx → the
 * fixed `@teamsuzie/ui` `WorkspaceShell`) renders this into the canonical Suzie
 * sidebar. Do NOT restyle the shell — only edit this data.
 */

export interface AppNavItem {
  /** Stable id → the nav item's data-testid (derive from the layout nav id). */
  id: string;
  /** Route path, e.g. '/deals'. The '/' entry is the home/index. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Set on the index route so it isn't marked active on every path. */
  end?: boolean;
}

export interface AppNavGroup {
  /** Uppercase section label (a `docs/ux/layout.json` nav group). Omit for an unlabelled group. */
  title?: string;
  items: AppNavItem[];
}

/** The template ships a single group so the shell renders before wiring. */
export const NAV_GROUPS: AppNavGroup[] = [
  {
    title: 'Overview',
    items: [
      { id: 'home', to: '/', label: 'Home', icon: LayoutGrid, end: true },
      // Shared Models page (from @teamsuzie/models-ui) — ships in every app.
      { id: 'models', to: '/models', label: 'Models', icon: Boxes },
    ],
  },
];
