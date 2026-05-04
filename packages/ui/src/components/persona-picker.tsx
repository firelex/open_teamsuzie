import * as React from "react"
import { cn } from "../lib/utils.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog.js"
import type { Persona } from "../hooks/use-personas.js"

export interface PersonaPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  personas: Persona[]
  loading?: boolean
  /** id of the currently-selected persona, or null for "default". */
  selectedId: string | null
  onSelect: (persona: Persona) => void
  /** Optional handler for the "Default" tile (clears any selection). */
  onClearSelection?: () => void
  /** Override the title shown above the list. */
  title?: string
  /** Override the description. */
  description?: string
  /** Label for the "no persona" tile. */
  defaultLabel?: string
  /** Description for the "no persona" tile. */
  defaultDescription?: string
}

export function PersonaPicker(props: PersonaPickerProps) {
  const {
    open,
    onOpenChange,
    personas,
    loading,
    selectedId,
    onSelect,
    onClearSelection,
    title = "Choose a persona",
    description = "Each persona has its own system prompt and tool set. Picking one starts a chat tuned for that persona.",
    defaultLabel = "Default assistant",
    defaultDescription = "The generic assistant — no persona-specific tuning.",
  } = props
  const builtins = personas.filter((p) => p.source === "builtin")
  const userOwned = personas.filter((p) => p.source === "user")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-sm text-muted-foreground">Loading personas…</p>
        ) : (
          <div className="space-y-5">
            <PersonaCard
              persona={null}
              isSelected={selectedId === null}
              defaultLabel={defaultLabel}
              defaultDescription={defaultDescription}
              onClick={() => {
                onClearSelection?.()
                onOpenChange(false)
              }}
            />

            {builtins.length > 0 && (
              <Section title="Built-in">
                {builtins.map((p) => (
                  <PersonaCard
                    key={p.id}
                    persona={p}
                    isSelected={p.id === selectedId}
                    onClick={() => {
                      onSelect(p)
                      onOpenChange(false)
                    }}
                  />
                ))}
              </Section>
            )}

            {userOwned.length > 0 && (
              <Section title="Your personas">
                {userOwned.map((p) => (
                  <PersonaCard
                    key={p.id}
                    persona={p}
                    isSelected={p.id === selectedId}
                    onClick={() => {
                      onSelect(p)
                      onOpenChange(false)
                    }}
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function PersonaCard({
  persona,
  isSelected,
  onClick,
  defaultLabel,
  defaultDescription,
}: {
  persona: Persona | null
  isSelected: boolean
  onClick: () => void
  defaultLabel?: string
  defaultDescription?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all",
        "hover:border-foreground/30 hover:bg-accent",
        isSelected && "border-foreground/50 ring-1 ring-foreground/20",
      )}
    >
      <PersonaAvatar persona={persona} size="md" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {persona ? persona.name : defaultLabel}
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {persona ? persona.description : defaultDescription}
        </div>
      </div>
    </button>
  )
}

export interface PersonaAvatarProps {
  persona: Persona | null
  size?: "xs" | "sm" | "md" | "lg"
  className?: string
}

/** Square, rounded-full avatar that falls back to initials when no image is set. */
export function PersonaAvatar({ persona, size = "sm", className }: PersonaAvatarProps) {
  const dimensions =
    size === "xs"
      ? "size-6"
      : size === "sm"
        ? "size-8"
        : size === "md"
          ? "size-10"
          : "size-12"
  if (persona?.avatar) {
    return (
      <img
        src={persona.avatar}
        alt=""
        aria-hidden="true"
        className={cn(dimensions, "shrink-0 rounded-full object-cover", className)}
      />
    )
  }
  const initials = persona ? initialsFor(persona.name) : "·"
  return (
    <div
      className={cn(
        dimensions,
        "flex shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground",
        className,
      )}
    >
      {initials}
    </div>
  )
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("")
}
