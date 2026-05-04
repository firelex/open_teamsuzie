# UI guide — `@teamsuzie/ui`

This is the prescriptive style guide for any app built on `@teamsuzie/ui`.
It exists to make the UI feel like *one product*, not the union of every
contributor's preferences. The rules are short and enforced by code review —
when in doubt, follow the rule and bring up the exception in PR.

The conventions below are derived from a Phase 0 audit of the suzielaw app
(Spring 2026). Each section names the upstream component to use and points
at a real example file in the repo. If you find yourself wanting to deviate,
the answer is almost always to extend the upstream component, not to fork
it locally.

---

## Foundations

### Icons

- **Source:** `lucide-react` only. No inline `<svg>` glyphs. No Unicode
  glyphs (`⋯`, `…`, `✓`, `→`, etc.) used in place of icons.
- **Sizes:** use Tailwind's `size-*` utilities, never `h-N w-N` pairs.
  - `size-3` — chip/badge ornaments, helper-text inline icons.
  - `size-4` — default for buttons, list rows, form fields, menu items.
  - `size-5` — large CTAs, page header icons.
  - `size-1.5` — status dots only (paired with `<StatusDot>`).
- **Accessibility:** if the icon sits next to text, add `aria-hidden`. If
  the button is icon-only, the wrapping `<Button>` must carry an
  `aria-label`.
- **Stroke width:** Lucide's default. Don't override unless you're
  drawing a check mark inside a colored fill (see `<Checkbox>`).

### Typography

Lock to Tailwind's text-size scale. Arbitrary `text-[Npx]` values are
banned in app code.

| Class | px | Use |
|---|---|---|
| `text-xs` | 12 | helper text, hints, metadata, tag labels, errors |
| `text-sm` | 14 | body, list rows, descriptions, chat messages |
| `text-base` | 16 | reserved for marketing surfaces |
| `text-lg` | 18 | section titles inside cards |
| `text-xl` | 20 | page-header titles (set by `<PageHeaderTitle>`) |
| `text-2xl` | 24 | empty-state titles, dashboard hero numbers |

### Spacing

| Surface | Class |
|---|---|
| Page wrapper | `<AppShellContent className="px-6 pt-6 pb-12">` |
| Page wrapper (full-bleed chat) | `<AppShellContent className="flex flex-col px-0 pt-0 pb-0">` |
| Card interior, between sections | `space-y-4` |
| Card interior, inside one section | `space-y-2` |
| Form fields | `space-y-1.5` between Label and Input |
| Action rows (right-aligned) | `flex justify-end gap-2` |

---

## Buttons

Always `<Button>`. Native `<button>` is banned.

### Variants

| Variant | When |
|---|---|
| `default` | The single primary CTA on a page or in a dialog ("Save", "Send", "Run pending") |
| `outline` | Secondary actions ("Add documents", "Add column", "Cancel") |
| `ghost` | Tertiary / icon-only menu triggers, tab nav, sheet/dialog close |
| `destructive` | Irreversible actions only — never "Cancel" or "Skip" |
| `secondary` | Reserved — don't use in app code |
| `link` | Reserved for inline-text links that need button semantics |

### Sizes

| Size | Use |
|---|---|
| `default` (h-9) | Header actions, dialog footers |
| `sm` (h-8) | Inline list-row actions, dense toolbars |
| `icon` (size-9 square) | Icon-only triggers; **always include `aria-label`** |

`lg` is reserved for marketing surfaces. Don't set `h-7 w-7` ad-hoc; if
you need a smaller icon button, use `size="icon"` and let the design
breathe — small click targets fail accessibility minimums.

### Patterns

- **"New X" / "Add X" buttons** are *always* icon + text. Plus icon from
  Lucide on the left, label on the right: `<Button><Plus className="size-4"/>New matter</Button>`.
  Never icon-only for primary discoverable CTAs. Pick the icon by
  intent — `Plus` for create, `Upload` for upload, `FolderPlus` for
  new folder, `MessageSquarePlus` for new chat.
- **Icon-only buttons must have a visible outline.** Destructive
  row-level deletes use `variant="outline"` with destructive border +
  text override, not `variant="ghost"` — a bare ghost icon floating in
  a row reads as decoration, not an action target. Pattern:
  ```tsx
  <Button
    variant="outline"
    size="icon"
    className="size-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
    aria-label={`Delete ${name}`}
  >
    <Trash2 className="size-4" />
  </Button>
  ```
  `ghost` is reserved for buttons-inside-other-affordances (Sheet
  close, Dialog close, dropdown triggers nested in already-bordered
  rows).
- **Async submits** use `<PendingButton pending={busy} pendingLabel="Saving">Save</PendingButton>` —
  the spinner answers "did my click register?" before the user starts
  doubting themselves. PendingButton renders children directly when
  not pending, so the Button's flex layout still applies to icon +
  text inside (don't wrap children in a `<span>` from the call site —
  that defeats the layout).
- **Destructive submits** combine: `<PendingButton variant="destructive" pending={busy}>Delete</PendingButton>`
  inside a `ConfirmDialog`.

Example: `apps/suzielaw/client/src/pages/settings.tsx` — danger-zone
reset uses `PendingButton` + `useConfirm`.

---

## Loading & pending states

`<p>Loading…</p>` is banned. Always use a spinner alongside a label.

| Surface | Component |
|---|---|
| Inline body, list/card placeholder | `<LoadingState>Loading reviews…</LoadingState>` |
| Centered, fills container | `<LoadingState variant="block">Loading chat…</LoadingState>` |
| Async submit on a button | `<PendingButton pending={busy} pendingLabel="Saving">Save</PendingButton>` |
| Inline progress alongside running operations | `<Loader2 className="size-4 animate-spin"/>` directly |

**Loading-text vocabulary:** the noun comes after "Loading":
"Loading reviews…", "Loading chat…", "Loading session…". Avoid
verb-form alternatives like "Starting…" or "Fetching…" — pick *one*
phrasing per nature of operation.

| Action verb | Pending label |
|---|---|
| Save / submit | "Saving" |
| Send (chat) | "Sending" |
| Create / new | "Creating" |
| Delete | "Deleting" |
| Run / execute | "Running" |

The trailing `…` is added automatically by `<PendingButton>` when
`pendingLabel` is set.

---

## Cards as click targets

Every card that represents a navigable thing — a matter, a chat in a
list, a review, a document, a saved prompt — has the *whole card
surface* as the click target, not just the title. Title-only links
make users hunt for the active region.

Pattern: put `onClick` on the `<Card>` itself, give it `cursor-pointer`,
and stop propagation on any nested interactive children (dropdown
triggers, inline edit inputs):

```tsx
<Card
  role="link"
  tabIndex={0}
  onClick={() => navigate(to)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      navigate(to)
    }
  }}
  className="cursor-pointer hover:border-foreground/30 hover:shadow-sm focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
>
  <CardHeader>
    <CardTitle>{title}</CardTitle>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button onClick={(e) => e.stopPropagation()}>…</Button>
      </DropdownMenuTrigger>
      …
    </DropdownMenu>
  </CardHeader>
  …
</Card>
```

Skip the `role="link"` + keyboard handler when the card has a clear
inline edit mode that swaps in (e.g. a rename input replaces the
title) — disable the surface click while editing so a click on the
input doesn't navigate.

Cards that are *not* navigable (settings cards, info cards, status
cards) stay as-is. The rule only applies to cards whose primary
purpose is "click to enter".

Example: `apps/suzielaw/client/src/pages/matters.tsx` — `MatterCard`
is whole-card-clickable with the dropdown menu trigger
`stopPropagation()`-ing.

---

## Empty states

Always `<EmptyState>` with `<EmptyStateIcon>` + `<EmptyStateTitle>` +
optional `<EmptyStateDescription>`. Never a bare `<CardTitle>` or `<p>`
saying "No items".

```tsx
<EmptyState>
  <EmptyStateIcon icon={Inbox} />
  <EmptyStateTitle>No matters yet</EmptyStateTitle>
  <EmptyStateDescription>
    Create your first matter to start uploading documents.
  </EmptyStateDescription>
</EmptyState>
```

The icon should be domain-relevant: `FileText` for documents,
`MessageSquare` for chats, `LayoutGrid` for reviews, `Inbox` for
generic empty inboxes.

---

## Errors & destructive feedback

| Severity | Component |
|---|---|
| Page-level error (load failed, server error) | `<Alert variant="destructive"><AlertCircle className="size-4"/><AlertDescription>…</AlertDescription></Alert>` |
| Form-level error (the form failed to submit) | `<p className="text-sm text-destructive">…</p>` above the action row |
| Field-level error (one input is invalid) | `<p className="text-xs text-destructive">…</p>` directly under the input |
| Operation succeeded with caveats | not yet — toast system is a future ticket |

`window.confirm()` and `window.alert()` are **banned**. They have no
theme, no async support, no a11y. Replace with:

```tsx
const confirm = useConfirm()
if (await confirm({
  title: "Delete matter?",
  description: "This removes the matter and all its documents. There is no undo.",
  confirmLabel: "Delete matter",
  variant: "destructive",
})) {
  void doDelete()
}
```

For destructive actions that take a network round-trip, pass `onConfirm`
to keep the dialog open with a spinner until the action settles:

```tsx
await confirm({
  title: "Reset all content?",
  variant: "destructive",
  onConfirm: async () => {
    await fetch("/api/admin/reset", { method: "POST" })
  },
})
```

---

## Surfaces

| Surface | When | Component |
|---|---|---|
| Modal / centered form | Edit / create / confirm flows | `<Dialog>` |
| Persistent docked panel | Pinned tabbed reading surface (citations, side-by-side review) | `<SidePanelSurface>` + `useSidePanel()` |
| One-shot drawer | Single-pane sliding-in transient surfaces | `<Sheet>` |
| Confirm prompt | Destructive or irreversible actions | `<ConfirmDialog>` (via `useConfirm`) |
| Action menu | Hover-revealed row controls, page-action overflow | `<DropdownMenu>` (or `<RowActions>`) |
| Inline contextual help | Not implemented yet | (deferred ticket) |

Don't reach for `Popover` — every popover need in suzielaw is served
better by `DropdownMenu` (which is `@radix-ui/react-dropdown-menu`).

### Escape and outside-click

**Every dismissable surface — Dialog, Sheet, ConfirmDialog, the side
panel, future Popovers — must respond to Escape.** This is muscle
memory for keyboard users; if one surface in the app swallows Escape
silently, every surface in the app starts to feel unreliable. Radix's
`Dialog` / `Sheet` / `Popover` ship Escape handling by default; don't
override `onEscapeKeyDown` to suppress it. The `<SidePanelSurface>`
adds its own `keydown` listener and stands down when a Radix surface
is open above it (so a single Escape closes the topmost surface, a
second Escape closes the next one down).

Outside-click is *separate from* Escape: a non-modal dialog that
shouldn't dismiss on outside clicks (e.g. `ReviewGrid`'s cell modal
when the user is drilling from a chip into the side panel) must still
honor Escape. The pattern is `onPointerDownOutside={e => e.preventDefault()}`
+ `onInteractOutside={e => e.preventDefault()}` while leaving
`onEscapeKeyDown` untouched.

Confirmation modals always honor outside-click as an implicit cancel —
don't `preventDefault` the outside-click on a `ConfirmDialog`.

---

## Lists

Every screen that renders a list of N items follows the same pattern.

### Pagination

Lists with more than ~25 items must paginate. Use `usePagination` for
client-side paging today; server-side paging is the eventual upgrade
(deferred ticket — needs endpoint changes across `@teamsuzie/workspaces`,
`chats`, `grid-review`, `kb`).

```tsx
const { page, pageSize, totalPages, totalItems, pageItems, setPage, pageStart, pageEnd } =
  usePagination(items, { defaultPageSize: 25 })

return (
  <>
    {pageItems.map(item => <Row key={item.id} {...item} />)}
    {totalPages > 1 && (
      <div className="flex items-center justify-between pt-4">
        <PaginationInfo currentPage={page} pageSize={pageSize} totalItems={totalItems} />
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    )}
  </>
)
```

### Bulk actions

Lists where multi-row operations make sense (delete, archive, move)
ship a checkbox column and a sticky `<BulkActionBar>` at the bottom:

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set())

return (
  <>
    <Table>{/* rows include a Checkbox in the first column */}</Table>
    <BulkActionBar
      selectionCount={selected.size}
      itemNoun="matter"
      onClear={() => setSelected(new Set())}
      actions={[
        { id: "delete", label: "Delete", icon: Trash2, variant: "destructive", onClick: bulkDelete },
        { id: "archive", label: "Archive", icon: Archive, onClick: bulkArchive },
      ]}
    />
  </>
)
```

The bar hides when `selectionCount === 0`. Header checkbox should be
indeterminate (`<Checkbox indeterminate>` ) when *some but not all*
rows are selected on the current page.

### Row actions

Every row exposes Edit + Delete (at minimum) via `<RowActions>`:

```tsx
<RowActions
  actions={[
    { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(item) },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      destructive: true,
      separatorBefore: true,
      onSelect: async () => {
        if (await confirm({ title: `Delete ${item.name}?`, variant: "destructive" })) {
          await onDelete(item.id)
        }
      },
    },
  ]}
/>
```

Convention: edit-style actions on top, destructive last with
`separatorBefore: true`.

---

## Page layout

Every data-centric page is built from these primitives, in this order:

```tsx
<>
  <PageHeader>
    <PageHeaderContent>
      <PageHeaderTitle>{title}</PageHeaderTitle>
      <PageHeaderDescription>{subtitle}</PageHeaderDescription>
    </PageHeaderContent>
    <PageHeaderActions>
      <Button variant="outline">Secondary</Button>
      <Button><Plus className="size-4"/>New thing</Button>
    </PageHeaderActions>
  </PageHeader>
  <AppShellContent className="px-6 pt-6 pb-12">
    {error && <Alert variant="destructive">…</Alert>}
    {loading
      ? <LoadingState variant="block">Loading {nounPlural}…</LoadingState>
      : items.length === 0
        ? <EmptyState>…</EmptyState>
        : <List items={items} />}
  </AppShellContent>
</>
```

Settings pages use `<SettingsLayout>` + `<SettingsCard>` from
`@teamsuzie/ui` instead — that's its own composite primitive.

Custom div-based headers (assistant page's 14h custom header, the
personas page's `<div className="px-6 py-8">`) are debt to be paid
down in the Phase 2 sweep.

---

## Forms

```tsx
<div className="space-y-4">
  <div className="space-y-1.5">
    <Label htmlFor="matter-name">Name</Label>
    <Input id="matter-name" value={name} onChange={e => setName(e.target.value)} />
    {nameError && <p className="text-xs text-destructive">{nameError}</p>}
  </div>
  <div className="space-y-1.5">
    <Label htmlFor="matter-desc">Description (optional)</Label>
    <Textarea id="matter-desc" rows={3} value={desc} onChange={e => setDesc(e.target.value)} />
  </div>
  {formError && <p className="text-sm text-destructive">{formError}</p>}
  <div className="flex justify-end gap-2">
    <Button variant="outline" onClick={onCancel}>Cancel</Button>
    <PendingButton pending={busy} pendingLabel="Saving" onClick={save}>Save</PendingButton>
  </div>
</div>
```

Helper text (the "(optional)" bit) lives inline in the `<Label>` —
don't introduce a separate FormDescription unless we need a richer
helper-text component (deferred).

---

## Status indicators

| Use | Component |
|---|---|
| Service health (online/offline/pending) | `<StatusDot status="online" />` |
| Cell / row state in a tabular list | `<Badge variant="…">streaming</Badge>` |
| Persistent in-flight indicator | `<Loader2 className="size-4 animate-spin" />` inline |

Badge color conventions: `default` for neutral, `destructive` for
errors, `secondary` for "in progress", `outline` for muted /
informational.

---

## Deferred tickets

These showed up in Phase 0 but didn't land in Phase 1:

- **Server-side pagination** across `@teamsuzie/workspaces`, `chats`,
  `grid-review`, `kb`. Requires `?cursor` / `?limit` query params on
  list endpoints + `next_cursor` in responses. Hook stays the same
  shape, slice replaces with cursor-based fetch.
- **Toast system.** Success / info notifications without modal weight.
  Likely `sonner`-based.
- **Inline contextual help** (`?` icon next to labels with a popover).
- **Skeleton placeholders** for slow loads instead of LoadingState
  blocks. Adopt when a measured load exceeds 500ms in 90th percentile.
- **`FormField` wrapper** — Label + Input + helper text + error in one
  component. Defer until the form complexity warrants it.

---

## Phase 2 sweep checklist

When auditing a page against this guide, walk these in order:

1. `confirm()` / `alert()` → `useConfirm()`.
2. `<button>` (lowercase, native) → `<Button>` with the right variant.
3. `<p>Loading…</p>` → `<LoadingState>`.
4. `Saving…` / `Sending…` button text → `<PendingButton>` with
   `pendingLabel`.
5. Inline `<svg>` icons → `lucide-react` import.
6. Unicode glyphs used as icons (`⋯`, `…`, `→`) → Lucide equivalent.
7. `text-[11px]`, `text-[15px]` → nearest Tailwind scale step.
8. List screens: ensure `usePagination` + `<Pagination>` wired when
   the source list can grow past ~25.
9. List screens: ensure `<RowActions>` with Edit + Delete on each row.
10. Bare `<CardTitle>"No items"` → `<EmptyState>`.
11. Custom `<header>` markup → `<PageHeader>`.
12. Page-level errors as bare `<p>` → `<Alert variant="destructive">`.
