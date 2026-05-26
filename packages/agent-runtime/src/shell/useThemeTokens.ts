import { useEffect } from 'react';
import type { ThemeTokens } from '../manifest/schema.js';

/**
 * Push the active manifest's `theme.tokens` to documentElement as CSS
 * variable overrides. The build's seeded `client/src/index.css` declares
 * its initial palette via Tailwind's `@theme` directive (`--color-background`,
 * `--color-foreground`, `--color-primary`, etc.); without runtime
 * overrides those are FROZEN at seed time. A theme swap via SuzieCode's
 * `set_theme` tool writes the new tokens to agent.json — but the running
 * agent kept rendering the seed-time palette because nothing was forwarding
 * the new tokens into the cascade.
 *
 * This hook closes that gap. The vars we override are the core palette
 * + fonts; the build's saffron ramp / accent utilities stay at their seed
 * values (they're outside the schema). Setting `color-scheme` on
 * documentElement lets native form controls re-skin too.
 */

const OWNED_PROPERTIES = [
  '--color-background',
  '--color-foreground',
  '--color-primary',
  '--color-accent',
  '--color-accent-foreground',
  '--color-ring',
  '--color-card',
  '--color-border',
  '--color-muted-foreground',
  '--color-muted',
  '--font-sans',
  '--font-mono',
  '--font-display',
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
    if (tokens.bg)          root.style.setProperty('--color-background', tokens.bg);
    if (tokens.fg)          root.style.setProperty('--color-foreground', tokens.fg);
    if (tokens.primary)     root.style.setProperty('--color-primary', tokens.primary);
    if (tokens.panel)       root.style.setProperty('--color-card', tokens.panel);
    if (tokens.border)      root.style.setProperty('--color-border', tokens.border);
    if (tokens.muted) {
      root.style.setProperty('--color-muted-foreground', tokens.muted);
      root.style.setProperty('--color-muted', tokens.muted);
    }
    if (tokens.fontSans)    root.style.setProperty('--font-sans', tokens.fontSans);
    if (tokens.fontMono)    root.style.setProperty('--font-mono', tokens.fontMono);
    // Display font drives big headings ("Good evening" etc.). Without this
    // override the build's @theme default (Archivo, baked at seed time)
    // leaks into every theme — the user sees Inter colors but Archivo
    // headings. Fall back to fontSans so designs without a distinct
    // display family (TeamSuzie, Console) still pick up the new font.
    if (tokens.fontDisplay) root.style.setProperty('--font-display', tokens.fontDisplay);
    else if (tokens.fontSans) root.style.setProperty('--font-display', tokens.fontSans);
    // Accent: secondary brand color (TeamSuzie's pink, paired with violet
    // primary). Drives --color-accent + focus rings; the matching
    // --color-accent-foreground gets foreground for readable text on top.
    if (tokens.accent) {
      root.style.setProperty('--color-accent', tokens.accent);
      root.style.setProperty('--color-ring', tokens.accent);
      if (tokens.fg) root.style.setProperty('--color-accent-foreground', tokens.fg);
    }
    if (tokens.colorScheme) root.style.setProperty('color-scheme', tokens.colorScheme);
  }, [tokens]);
}
