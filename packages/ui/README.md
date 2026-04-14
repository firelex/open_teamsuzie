# @teamsuzie/ui

Shared React component library used by the admin app and example apps.

Built on [shadcn/ui](https://ui.shadcn.com), [Tailwind CSS](https://tailwindcss.com), and [Radix primitives](https://www.radix-ui.com). If you've worked with shadcn you'll recognize everything here.

## Contents

- Base components (Button, Dialog, Table, Form, Toast, Tabs, etc.)
- `DataTable` — paginated, filterable table built on @tanstack/table
- `ActionsMenu` — dropdown menu pattern used across admin surfaces
- Form helpers wrapping react-hook-form + zod

## Usage

```tsx
import { Button, DataTable } from '@teamsuzie/ui';
```

See `docs/DESIGN_SYSTEM.md` and `docs/UI_COMPONENTS.md` *(coming in v0.2)* for the style conventions.

## Status

v0.1 — being extracted.
