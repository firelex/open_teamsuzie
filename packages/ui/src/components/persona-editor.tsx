import * as React from "react"
import { cn } from "../lib/utils.js"
import { Button } from "./button.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js"
import { Input } from "./input.js"
import { Label } from "./label.js"
import { Textarea } from "./textarea.js"
import { PersonaAvatar } from "./persona-picker.js"
import {
  usePersonas,
  type Persona,
  type PersonaCreateInput,
  type PersonaUpdateInput,
} from "../hooks/use-personas.js"

export interface PersonaEditorProps {
  /** Avatar URLs the user can pick from. */
  availableAvatars?: string[]
  /** Tools the agent has wired up — used to render the allowlist UI. */
  availableTools?: { name: string; description?: string }[]
  /** Currently-active persona (`null` = Default Counsel). When set, cards are
   *  clickable and the active one gets a highlight + "Active" badge. */
  selectedPersonaId?: string | null
  /** Activation callback. Pass `null` to clear the selection. When omitted,
   *  cards are non-clickable (manage-only mode). */
  onSelect?: (personaId: string | null) => void
  /** Override the personas API endpoint (default `/api/personas`). */
  endpoint?: string
  /** Custom fetch implementation, e.g. for testing. */
  fetchImpl?: typeof fetch
  /** Page size for the user-personas tab. Default 12. */
  userPageSize?: number
}

export function PersonaEditor(props: PersonaEditorProps) {
  const {
    availableAvatars = [],
    availableTools = [],
    selectedPersonaId,
    onSelect,
    endpoint,
    fetchImpl,
    userPageSize = 10,
  } = props
  const selectable = !!onSelect
  const noPersonaActive = selectable && (selectedPersonaId == null)

  const [page, setPage] = React.useState(1)
  // The text the user is typing. We push it into the debounced `q` after a
  // short delay so we don't fire a request per keystroke.
  const [searchInput, setSearchInput] = React.useState("")
  const [q, setQ] = React.useState("")
  React.useEffect(() => {
    const handle = window.setTimeout(() => setQ(searchInput.trim()), 200)
    return () => window.clearTimeout(handle)
  }, [searchInput])

  React.useEffect(() => {
    setPage(1)
  }, [q])

  const {
    personas,
    total,
    loading,
    error,
    createPersona,
    updatePersona,
    deletePersona,
  } = usePersonas({
    source: "all",
    page,
    pageSize: userPageSize,
    q,
    endpoint,
    fetchImpl,
  })

  const totalPages = Math.max(1, Math.ceil(total / userPageSize))

  const [editing, setEditing] = React.useState<Persona | "new" | null>(null)
  // Read-only inspection mode for built-in personas — shows the same form
  // dialog with every field disabled and no Save button. Lets the user see
  // the system prompt + tool allowlist without being able to modify them.
  const [viewing, setViewing] = React.useState<Persona | null>(null)

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Personas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectable
              ? "Click a persona to activate it. Create your own with custom system prompts and tool subsets."
              : "Create your own assistant personas with custom system prompts and tool subsets. Built-in personas are read-only."}
          </p>
        </div>
        <Button type="button" className="shrink-0" onClick={() => setEditing("new")}>
          New persona
        </Button>
      </div>

      <div className="mb-4">
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search personas…"
          className="h-9"
          aria-label="Search personas"
        />
      </div>

      {error && (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      )}

      {selectable && !q && (
        <div className="mb-3">
          <PersonaCard
            active={noPersonaActive}
            onClick={() => onSelect?.(null)}
            avatar={<DefaultPersonaCircle />}
            title="Default Counsel"
            description="No persona — the assistant uses its base system prompt and full tool set."
          />
        </div>
      )}

      {loading ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">Loading…</p>
      ) : personas.length === 0 ? (
        <EmptyState q={q} />
      ) : (
        <div className="space-y-2">
          {personas.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              selectable={selectable}
              isActive={selectable && selectedPersonaId === persona.id}
              onSelect={onSelect}
              onView={setViewing}
              onEdit={setEditing}
              onDelete={deletePersona}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}

      {editing !== null && (
        <PersonaForm
          mode={editing === "new" ? "create" : "edit"}
          initial={editing === "new" ? null : editing}
          availableAvatars={availableAvatars}
          availableTools={availableTools}
          onCancel={() => setEditing(null)}
          onSubmit={async (values) => {
            if (editing === "new") {
              await createPersona(values)
            } else {
              await updatePersona(editing.id, values)
            }
            setEditing(null)
          }}
        />
      )}

      {viewing !== null && (
        <PersonaForm
          mode="view"
          initial={viewing}
          availableAvatars={availableAvatars}
          availableTools={availableTools}
          onCancel={() => setViewing(null)}
          onSubmit={async () => {
            // unreachable in view mode — Save button is hidden
          }}
        />
      )}
    </div>
  )
}

function PersonaRow({
  persona,
  selectable,
  isActive,
  onSelect,
  onView,
  onEdit,
  onDelete,
}: {
  persona: Persona
  selectable: boolean
  isActive: boolean
  onSelect: ((id: string | null) => void) | undefined
  onView: (persona: Persona) => void
  onEdit: (persona: Persona) => void
  onDelete: (id: string) => Promise<void>
}) {
  const isUser = persona.source === "user"
  return (
    <PersonaCard
      active={isActive}
      onClick={selectable ? () => onSelect?.(persona.id) : undefined}
      avatar={<PersonaAvatar persona={persona} size="md" />}
      title={persona.name}
      description={persona.description}
      actions={
        isUser ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(persona)
              }}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async (e) => {
                e.stopPropagation()
                if (typeof window !== "undefined" && !window.confirm(`Delete "${persona.name}"?`)) return
                await onDelete(persona.id).catch(() => undefined)
              }}
              className="text-destructive hover:text-destructive"
            >
              Delete
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onView(persona)
            }}
          >
            View
          </Button>
        )
      }
    />
  )
}

function EmptyState({ q }: { q: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {q ? `No personas match "${q}".` : "No personas to show."}
      </p>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (next: number) => void
}) {
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  )
}

function PersonaCard(props: {
  active: boolean
  onClick?: () => void
  avatar: React.ReactNode
  title: string
  description: string
  actions?: React.ReactNode
  /** Optional source badge — "Built-in" or "Custom". Rendered next to the
   *  title in a quieter outline style than the "Active" pill. */
  kindLabel?: "Built-in" | "Custom"
}) {
  const { active, onClick, avatar, title, description, actions, kindLabel } = props
  const clickable = !!onClick
  // Render as a div with role="button" when clickable — using a real <button>
  // would nest inside the action <button>s (Edit / Delete), which is invalid
  // HTML and triggers React's hydration warning.
  const interactive = clickable
    ? {
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick!()
          }
        },
        "aria-pressed": active,
      }
    : {}
  return (
    <div
      {...interactive}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors",
        active
          ? "border-foreground/40 bg-accent/40"
          : "border-border",
        clickable &&
          "cursor-pointer hover:bg-accent/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {kindLabel && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                kindLabel === "Built-in"
                  ? "border-border text-muted-foreground"
                  : "border-primary/30 bg-primary/5 text-primary",
              )}
            >
              {kindLabel}
            </span>
          )}
          {active && (
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-background">
              Active
            </span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {description}
        </div>
      </div>
      {actions && (
        <div
          className="flex shrink-0 gap-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  )
}

/**
 * Avatar picker — collapses cleanly even with hundreds of items. Default state
 * shows just the current selection (or "none") plus a "Choose…" button. Open
 * state is a scrollable, dense grid; if the avatar URLs sort into category
 * subfolders (e.g. `/avatars/female/12.webp`) we group by category.
 *
 * Optimised for the case where `available` has 10 items *and* the case where
 * it has 400+. No virtualisation — the per-tile cost is one `<img>`, modern
 * browsers handle a few hundred fine inside a 80vh-capped scroll container.
 */
function AvatarPicker({
  available,
  selected,
  onChange,
}: {
  available: string[]
  selected: string | undefined
  onChange: (next: string | undefined) => void
}) {
  const [open, setOpen] = React.useState(false)
  // Stage Escape: while the picker is expanded inside the persona dialog,
  // pressing Escape should collapse the picker first; only when it's
  // already collapsed should Escape bubble to Radix's DialogContent and
  // close the whole form. Capture-phase so we run before Radix's listener.
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [open])
  // Group by the parent folder name in the URL (e.g. `female`, `male`).
  // When the avatars don't sort that way, the picker falls back to a single
  // "All" group with no tab strip.
  const groups = React.useMemo(() => {
    const out = new Map<string, string[]>()
    for (const src of available) {
      const m = src.match(/\/([^/]+)\/[^/]+$/)
      const key = m ? m[1] : "All"
      if (!out.has(key)) out.set(key, [])
      out.get(key)!.push(src)
    }
    return out
  }, [available])
  const groupNames = React.useMemo(() => Array.from(groups.keys()), [groups])
  const [activeGroup, setActiveGroup] = React.useState<string>("__all__")

  // If the active group disappears (e.g. `available` changes), fall back.
  React.useEffect(() => {
    if (activeGroup === "__all__") return
    if (!groupNames.includes(activeGroup)) setActiveGroup("__all__")
  }, [activeGroup, groupNames])

  const visibleGroups: [string, string[]][] =
    activeGroup === "__all__"
      ? Array.from(groups.entries())
      : [[activeGroup, groups.get(activeGroup) ?? []]]

  return (
    <div className="space-y-1.5">
      <Label>Avatar</Label>
      {/* Trigger is the avatar itself — click it to open the picker. The
          "no avatar" state shows a placeholder circle with a + glyph; same
          click target. Removing the avatar entirely happens via the "None"
          tile inside the picker, so we don't need a separate clear button
          out here. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-3 rounded-md border border-border bg-card p-2 text-left transition-colors hover:bg-accent/30",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-expanded={open}
      >
        {selected ? (
          <div className="size-10 shrink-0 overflow-hidden rounded-full border-2 border-foreground">
            <img src={selected} alt="" className="size-full object-cover" />
          </div>
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border bg-muted text-base text-muted-foreground">
            +
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {selected ? "Avatar" : "No avatar"}
          </div>
          <div className="text-xs text-muted-foreground">
            {open ? "Picker open — pick one or click to close" : "Click to change"}
          </div>
        </div>
      </button>
      {open && (
        <div className="rounded-md border border-border bg-card">
          {groupNames.length > 1 && (
            <div className="flex items-center gap-1 border-b border-border p-1.5">
              <GroupTab
                label="All"
                active={activeGroup === "__all__"}
                onClick={() => setActiveGroup("__all__")}
                count={available.length}
              />
              {groupNames.map((name) => (
                <GroupTab
                  key={name}
                  label={capitalize(name)}
                  active={activeGroup === name}
                  onClick={() => setActiveGroup(name)}
                  count={groups.get(name)?.length ?? 0}
                />
              ))}
            </div>
          )}
          <div className="p-2">
            {/* "None" tile is always visible at the top — the only way to
                clear the avatar now that the trigger is the avatar itself. */}
            {(activeGroup === "__all__" || visibleGroups.length === 0) && (
              <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange(undefined)}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full border-2 bg-muted text-[10px] text-muted-foreground transition-colors",
                    selected === undefined
                      ? "border-foreground"
                      : "border-transparent hover:border-foreground/30",
                  )}
                  title="No avatar"
                >
                  None
                </button>
              </div>
            )}
            {visibleGroups.map(([groupName, items]) => (
              <div key={groupName} className="mb-3 last:mb-0">
                {visibleGroups.length > 1 && (
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {capitalize(groupName)}
                  </div>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
                  {items.map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => onChange(src)}
                      className={cn(
                        "size-10 overflow-hidden rounded-full border-2 transition-colors",
                        selected === src
                          ? "border-foreground"
                          : "border-transparent hover:border-foreground/30",
                      )}
                    >
                      <img src={src} alt="" loading="lazy" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GroupTab({
  label,
  active,
  onClick,
  count,
}: {
  label: string
  active: boolean
  onClick: () => void
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("ml-1.5", active ? "opacity-70" : "opacity-60")}>{count}</span>
    </button>
  )
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function DefaultPersonaCircle() {
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      aria-hidden="true"
    >
      C
    </div>
  )
}

interface PersonaFormProps {
  mode: "create" | "edit" | "view"
  initial: Persona | null
  availableAvatars: string[]
  availableTools: { name: string; description?: string }[]
  onCancel: () => void
  onSubmit: (values: PersonaCreateInput) => Promise<void>
}

function PersonaForm(props: PersonaFormProps) {
  const { mode, initial, availableAvatars, availableTools, onCancel, onSubmit } = props
  const readOnly = mode === "view"
  const [name, setName] = React.useState(initial?.name ?? "")
  const [description, setDescription] = React.useState(initial?.description ?? "")
  const [avatar, setAvatar] = React.useState<string | undefined>(initial?.avatar)
  const [systemPrompt, setSystemPrompt] = React.useState(initial?.systemPrompt ?? "")
  const initialAllowedAll =
    !initial?.allowedTools || initial.allowedTools.includes("*") || initial.allowedTools.length === 0
  const [allowAll, setAllowAll] = React.useState(initialAllowedAll)
  const [allowedTools, setAllowedTools] = React.useState<Set<string>>(
    () => new Set(initial?.allowedTools?.filter((n) => n !== "*") ?? []),
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState("")

  const canSubmit = !readOnly && name.trim() && systemPrompt.trim() && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError("")
    try {
      const input: PersonaCreateInput = {
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
      }
      if (avatar) input.avatar = avatar
      if (!allowAll) input.allowedTools = Array.from(allowedTools)
      await onSubmit(input)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      {/* Cap the dialog at viewport height and lay it out as a 3-row grid so
          header + footer stay visible while the body scrolls. The middle row's
          `minmax(0,1fr)` is what lets the body actually shrink — without it,
          flex/grid items refuse to size below their content and the dialog
          spills off-screen on small viewports. */}
      <DialogContent
        className={cn(
          "sm:max-w-3xl",
          "max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]",
        )}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "New persona"
              : mode === "view"
                ? `${initial?.name ?? "Persona"} — built-in`
                : "Edit persona"}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "Read-only view of a built-in persona's system prompt and tool allowlist."
              : "Personas have their own system prompt and (optionally) restricted tool set. They show up in the persona picker alongside the built-ins."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 space-y-4 overflow-y-auto pr-2">
          <div className="space-y-1.5">
            <Label htmlFor="persona-name">Name</Label>
            <Input
              id="persona-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Litigation associate"
              maxLength={100}
              readOnly={readOnly}
              disabled={readOnly}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="persona-description">Description</Label>
            <Input
              id="persona-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One sentence — shown in the picker"
              maxLength={200}
              readOnly={readOnly}
              disabled={readOnly}
            />
          </div>

          {availableAvatars.length > 0 && !readOnly && (
            <AvatarPicker
              available={availableAvatars}
              selected={avatar}
              onChange={setAvatar}
            />
          )}
          {readOnly && avatar && (
            <div className="space-y-1.5">
              <Label>Avatar</Label>
              <div className="size-12 overflow-hidden rounded-full border-2 border-foreground">
                <img src={avatar} alt="" className="size-full object-cover" />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="persona-prompt">System prompt</Label>
            <Textarea
              id="persona-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are Counsel, an AI legal assistant focused on…"
              className="min-h-[180px] font-mono text-xs"
              readOnly={readOnly}
              disabled={readOnly}
            />
          </div>

          {availableTools.length > 0 && (
            <div className="space-y-1.5">
              <Label>Tools</Label>
              <label className={cn("flex items-center gap-2 text-sm", readOnly ? "cursor-default" : "cursor-pointer")}>
                <input
                  type="checkbox"
                  checked={allowAll}
                  onChange={(e) => setAllowAll(e.target.checked)}
                  disabled={readOnly}
                />
                <span>Use all available tools</span>
              </label>
              {!allowAll && (
                <div className="max-h-44 overflow-y-auto rounded-md border border-border p-2">
                  {availableTools.map((tool) => {
                    const checked = allowedTools.has(tool.name)
                    return (
                      <label
                        key={tool.name}
                        className={cn(
                          "flex items-start gap-2 rounded px-2 py-1 text-xs",
                          readOnly ? "cursor-default" : "cursor-pointer hover:bg-accent",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(allowedTools)
                            if (e.target.checked) next.add(tool.name)
                            else next.delete(tool.name)
                            setAllowedTools(next)
                          }}
                          className="mt-0.5"
                          disabled={readOnly}
                        />
                        <span>
                          <span className="font-mono text-foreground">{tool.name}</span>
                          {tool.description && (
                            <span className="ml-2 text-muted-foreground">{tool.description}</span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
