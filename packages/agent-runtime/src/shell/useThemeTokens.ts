import { useEffect } from 'react';
import type { ThemeTokens } from '../manifest/schema.js';

/**
 * Push the active manifest's `theme.tokens` to documentElement as CSS
 * variable overrides. The build's seeded `client/src/index.css` declares
 * its initial palette via Tailwind's `@theme` directive (`--color-background`,
 * `--color-foreground`, `--color-primary`, etc.); without runtime
 * overrides those are FROZEN at seed time. A theme swap via SuzieCode's
 * `set_theme` tool writes the new tokens to agent.json — this hook
 * forwards them onto the documentElement so the running agent re-skins
 * without a reload.
 *
 * The schema carries both legacy short-name fields (`bg`, `panel`, `fg`,
 * `muted`) and explicit role-named fields (`background`, `card`,
 * `foreground`, `mutedForeground`, …). Explicit names win when present so
 * a fully-specified theme replaces every surface atomically.
 */

const OWNED_PROPERTIES = [
  '--color-background',
  '--color-foreground',
  '--color-card',
  '--color-card-foreground',
  '--color-popover',
  '--color-popover-foreground',
  '--color-primary',
  '--color-primary-foreground',
  '--color-secondary',
  '--color-secondary-foreground',
  '--color-muted',
  '--color-muted-foreground',
  '--color-accent',
  '--color-accent-foreground',
  '--color-destructive',
  '--color-destructive-foreground',
  '--color-border',
  '--color-input',
  '--color-ring',
  '--color-success',
  '--font-sans',
  '--font-mono',
  '--font-display',
  '--sidebar-hover-bg',
  '--sidebar-active-bg',
  'color-scheme',
] as const;

export function useThemeTokens(tokens: ThemeTokens | undefined): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!tokens) {
      for (const v of OWNED_PROPERTIES) root.style.removeProperty(v);
      return;
    }

    // Core background / foreground.
    // Explicit `background`/`foreground` win; legacy `bg`/`fg` fall back.
    const background = tokens.background ?? tokens.bg;
    const foreground = tokens.foreground ?? tokens.fg;
    if (background) root.style.setProperty('--color-background', background);
    if (foreground) root.style.setProperty('--color-foreground', foreground);

    // Card / popover surfaces. `panel` is the legacy alias for `card`.
    const card = tokens.card ?? tokens.panel;
    if (card) root.style.setProperty('--color-card', card);
    if (tokens.cardForeground) root.style.setProperty('--color-card-foreground', tokens.cardForeground);
    else if (foreground) root.style.setProperty('--color-card-foreground', foreground);

    const popover = tokens.popover ?? card;
    if (popover) root.style.setProperty('--color-popover', popover);
    if (tokens.popoverForeground) root.style.setProperty('--color-popover-foreground', tokens.popoverForeground);
    else if (foreground) root.style.setProperty('--color-popover-foreground', foreground);

    // Primary + its on-color foreground.
    if (tokens.primary) root.style.setProperty('--color-primary', tokens.primary);
    if (tokens.primaryForeground) root.style.setProperty('--color-primary-foreground', tokens.primaryForeground);

    // Secondary surface + its foreground.
    if (tokens.secondary) root.style.setProperty('--color-secondary', tokens.secondary);
    if (tokens.secondaryForeground) root.style.setProperty('--color-secondary-foreground', tokens.secondaryForeground);

    // Muted — surface AND text color. The previous schema collapsed these
    // into one field and wrote it to both vars, which renders as text the
    // same color as its background on every light theme. The new schema
    // treats them as distinct roles; legacy `muted` is now interpreted as
    // the SURFACE color only, with `mutedForeground` as the text color.
    if (tokens.muted) root.style.setProperty('--color-muted', tokens.muted);
    if (tokens.mutedForeground) root.style.setProperty('--color-muted-foreground', tokens.mutedForeground);

    // Accent — secondary brand color. Always pairs with ring (focus) and
    // accent-foreground (text on accent surfaces). Pre-rewrite, accent-fg
    // was implicitly = fg, which is wrong for designs where the accent is
    // mid-light (saffron, pink) and needs ink-dark text on top.
    if (tokens.accent) {
      root.style.setProperty('--color-accent', tokens.accent);
      if (!tokens.ring) root.style.setProperty('--color-ring', tokens.accent);
    }
    if (tokens.accentForeground) root.style.setProperty('--color-accent-foreground', tokens.accentForeground);
    else if (tokens.accent && foreground) root.style.setProperty('--color-accent-foreground', foreground);
    if (tokens.ring) root.style.setProperty('--color-ring', tokens.ring);

    // Status colors.
    if (tokens.destructive) root.style.setProperty('--color-destructive', tokens.destructive);
    if (tokens.destructiveForeground) root.style.setProperty('--color-destructive-foreground', tokens.destructiveForeground);
    if (tokens.success) root.style.setProperty('--color-success', tokens.success);

    // Borders + inputs.
    if (tokens.border) root.style.setProperty('--color-border', tokens.border);
    if (tokens.input) root.style.setProperty('--color-input', tokens.input);

    // Fonts. The runtime forwards these immediately so a swap re-skins
    // without waiting for the build's CSS reseed; the matching <link>
    // tags get added by useThemeFontLinks.
    if (tokens.fontSans) root.style.setProperty('--font-sans', tokens.fontSans);
    if (tokens.fontMono) root.style.setProperty('--font-mono', tokens.fontMono);
    // Display font drives big headings ("Good evening" etc.). Without this
    // override the build's @theme default leaks into every theme. Fall
    // back to fontSans so designs without a distinct display family pick
    // up the new font.
    if (tokens.fontDisplay) root.style.setProperty('--font-display', tokens.fontDisplay);
    else if (tokens.fontSans) root.style.setProperty('--font-display', tokens.fontSans);

    // Sidebar hover/active backgrounds — surfaced as CSS custom properties
    // so the @teamsuzie/ui sidebar primitive can consume them without
    // adding more shadcn variants. Consumed by the injected stylesheet
    // in Sidebar.tsx.
    if (tokens.sidebarHoverBg) root.style.setProperty('--sidebar-hover-bg', tokens.sidebarHoverBg);
    if (tokens.sidebarActiveBg) root.style.setProperty('--sidebar-active-bg', tokens.sidebarActiveBg);

    if (tokens.colorScheme) root.style.setProperty('color-scheme', tokens.colorScheme);
  }, [tokens]);
}
