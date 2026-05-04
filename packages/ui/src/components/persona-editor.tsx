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
import type {
  Persona,
  PersonaCreateInput,
  PersonaUpdateInput,
} from "../hooks/use-personas.js"

export interface PersonaEditorProps {
  /** Full persona list (builtins + user). The editor only manages user-owned. */
  personas: Persona[]
  /** Avatar URLs the user can pick from. */
  availableAvatars?: string[]
  /** Tools the agent has wired up — used to render the allowlist UI. */
  availableTools?: { name: string; description?: string }[]
  onCreate: (input: PersonaCreateInput) => Promise<Persona>
  onUpdate: (id: string, patch: PersonaUpdateInput) => Promise<Persona>
  onDelete: (id: string) => Promise<void>
}

export function PersonaEditor(props: PersonaEditorProps) {
  const { personas, availableAvatars = [], availableTools = [], onCreate, onUpdate, onDelete } = props
  const userPersonas = personas.filter((p) => p.source === "user")

  const [editing, setEditing] = React.useState<Persona | "new" | null>(null)

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Personas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your own assistant personas with custom system prompts and tool subsets. Built-in
            personas are read-only.
          </p>
        </div>
        <Button type="button" onClick={() => setEditing("new")}>
          New persona
        </Button>
      </div>

      {userPersonas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            You haven't created any personas yet. Click "New persona" to start.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {userPersonas.map((persona) => (
            <div
              key={persona.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
            >
              <PersonaAvatar persona={persona} size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{persona.name}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {persona.description}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(persona)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (typeof window !== "undefined" && !window.confirm(`Delete "${persona.name}"?`)) return
                    await onDelete(persona.id).catch(() => undefined)
                  }}
                  className="text-destructive hover:text-destructive"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
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
              await onCreate(values)
            } else {
              await onUpdate(editing.id, values)
            }
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

interface PersonaFormProps {
  mode: "create" | "edit"
  initial: Persona | null
  availableAvatars: string[]
  availableTools: { name: string; description?: string }[]
  onCancel: () => void
  onSubmit: (values: PersonaCreateInput) => Promise<void>
}

function PersonaForm(props: PersonaFormProps) {
  const { mode, initial, availableAvatars, availableTools, onCancel, onSubmit } = props
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

  const canSubmit = name.trim() && systemPrompt.trim() && !submitting

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New persona" : "Edit persona"}</DialogTitle>
          <DialogDescription>
            Personas have their own system prompt and (optionally) restricted tool set. They show
            up in the persona picker alongside the built-ins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="persona-name">Name</Label>
            <Input
              id="persona-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Litigation associate"
              maxLength={100}
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
            />
          </div>

          {availableAvatars.length > 0 && (
            <div className="space-y-1.5">
              <Label>Avatar</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAvatar(undefined)}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full border-2 bg-muted text-[11px] text-muted-foreground transition-colors",
                    avatar === undefined ? "border-foreground" : "border-transparent hover:border-foreground/30",
                  )}
                  title="No avatar"
                >
                  none
                </button>
                {availableAvatars.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setAvatar(src)}
                    className={cn(
                      "size-10 overflow-hidden rounded-full border-2 transition-colors",
                      avatar === src ? "border-foreground" : "border-transparent hover:border-foreground/30",
                    )}
                  >
                    <img src={src} alt="" className="size-full object-cover" />
                  </button>
                ))}
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
            />
          </div>

          {availableTools.length > 0 && (
            <div className="space-y-1.5">
              <Label>Tools</Label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowAll}
                  onChange={(e) => setAllowAll(e.target.checked)}
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
                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
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
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
