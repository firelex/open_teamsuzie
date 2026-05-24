import type { CSSProperties, ReactNode } from 'react';
import {
  Sidebar as UiSidebar,
  SidebarHeader,
  SidebarNav,
  SidebarFooter,
} from '@teamsuzie/ui';
import type { ManifestTheme } from '../manifest/schema.js';
import { DEFAULT_THEME_TOKENS } from '../manifest/defaults.js';

export interface NavItem { to: string; label: string; testId: string }

interface Props {
  theme: ManifestTheme;
  header: ReactNode;
  items: NavItem[];
  footer?: ReactNode;
  renderItem: (item: NavItem) => ReactNode;
}

/**
 * Inject scoped CSS for the saffron-style accent bar once at import time.
 *
 * Tailwind 4 JIT can't easily target attribute-with-dashed-values + CSS var
 * arithmetic (we want a left-border whose width and color come from
 * `theme.tokens.accentBar`). A single id-gated <style> tag is the pragmatic
 * fix — it consumes the CSS custom properties set on the sidebar root below.
 */
if (typeof document !== 'undefined' && !document.getElementById('agent-runtime-sidebar-styles')) {
  const el = document.createElement('style');
  el.id = 'agent-runtime-sidebar-styles';
  el.textContent = `
    [data-slot="sidebar"] [aria-current="page"] {
      border-left: var(--sidebar-accent-width, 0) solid var(--sidebar-accent-color, transparent);
      padding-left: calc(0.75rem - var(--sidebar-accent-width, 0));
    }
    /* Inactive nav rows: muted color from theme token (or fallback).
       Active rows fall through to the sidebar root color (sidebarFg). */
    [data-slot="sidebar"] [data-slot="sidebar-nav-item"]:not([aria-current="page"]) {
      color: var(--sidebar-fg-muted, inherit);
    }
  `;
  document.head.appendChild(el);
}

export function Sidebar({ theme, header, items, footer, renderItem }: Props) {
  const tokens = theme.tokens ?? {};
  const accent = tokens.accentBar ?? {};
  // Inactive-row color falls back through user override -> default token -> active fg.
  // The default lives in DEFAULT_THEME_TOKENS (defaults-only principle: user value wins).
  const fgMuted =
    tokens.sidebarFgMuted ?? DEFAULT_THEME_TOKENS.sidebarFgMuted ?? tokens.sidebarFg;
  const sidebarStyle: CSSProperties = {
    background: tokens.sidebarBg ?? undefined,
    color: tokens.sidebarFg ?? undefined,
  };
  // CSS custom properties consumed by the injected stylesheet to draw the
  // accent bar as a left-border on `aria-current="page"` items, and to color
  // inactive nav rows with sidebarFgMuted.
  const themeVars: CSSProperties = {
    ['--sidebar-accent-color' as never]: accent.color ?? undefined,
    ['--sidebar-accent-width' as never]: accent.width ?? undefined,
    ['--sidebar-fg-muted' as never]: fgMuted ?? undefined,
  };
  return (
    <UiSidebar style={{ ...sidebarStyle, ...themeVars }}>
      <SidebarHeader>{header}</SidebarHeader>
      <SidebarNav data-testid="sidebar-nav">
        {items.map((item) => (
          <div key={item.to} data-testid="nav-item" data-nav={item.to}>
            {renderItem(item)}
          </div>
        ))}
      </SidebarNav>
      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
    </UiSidebar>
  );
}
