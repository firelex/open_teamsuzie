# @teamsuzie/theme

CSS-only package containing the canonical **Team Suzie department-app**
design tokens, brand utility classes, and reveal animation primitives.

Pair with `@teamsuzie/ui` (components) and Tailwind 4.

## Usage

In your app's entry CSS:

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
@import "tailwindcss";
@import "tw-animate-css";

@plugin "@tailwindcss/typography";

@import "@teamsuzie/theme/team-suzie.css";
```

Order matters: `@import "tailwindcss"` first so Tailwind's `@theme` directive
is registered before the token file uses it.

## What you get

- **Surface tokens** (HSL): `--color-background`, `--color-foreground`,
  `--color-card`, `--color-popover`, `--color-primary` (electric violet
  `ev-500`), `--color-secondary/muted/accent/destructive`, `--color-border`,
  `--color-input`, `--color-ring`.
- **Electric-violet brand scale**: `--color-ev-50` … `--color-ev-950`.
- **Radius scale**: `--radius-lg/md/sm`.
- **Typography**: Inter (sans) + JetBrains Mono.
- **Brand shadows**: `--shadow-violet-glow`, `--shadow-ring-violet-soft`.
- **Animation**: `--animate-fade-in-up` token + `@keyframes fade-in-up`.
- **Utility classes**: `.bg-header-gradient` (horizontal cyan brand band),
  `.bg-header-gradient-v` (vertical), `.bg-fancy-gradient` (violet→pink),
  `.text-fancy` (gradient text), `.border-fancy-gradient`,
  `.ring-violet-soft`, `.font-mono-data`.
- **Landing primitives**: `.suzie-reveal`, `.suzie-pulse` with
  `prefers-reduced-motion` fallbacks.

## What the app still owns

- The `@import "tailwindcss"` directive.
- Any `@plugin` / `@source` directives (e.g. `@plugin "@tailwindcss/typography"`).
- Font `@import` from Google Fonts (or self-hosted equivalents).
- App-specific overrides / additional utilities.
