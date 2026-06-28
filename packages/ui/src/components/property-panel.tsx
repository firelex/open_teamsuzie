import * as React from "react"

import { cn } from "../lib/utils"

/**
 * Property panel — generic key/value sidebar block used on record
 * detail screens. Two surfaces:
 *
 * - {@link PropertyPanel} + {@link PropertyRow}: read-only layout
 *   primitives the host composes manually for full control.
 * - {@link EditablePropertyList}: opinionated list that drives inline
 *   edits via host-provided `onChange`. Purely presentational state
 *   for the active editor — persistence is the host's job.
 *
 * The list deliberately renders only string-shaped inputs. Hosts with
 * pickers, date pickers, or rich editors can pass a custom
 * `renderEditor` per property.
 */

export interface PropertyPanelProps
  extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode
}

function PropertyPanel({
  className,
  title,
  children,
  ...props
}: PropertyPanelProps) {
  return (
    <section
      data-slot="property-panel"
      className={cn("border-b border-border px-4 py-4 last:border-b-0", className)}
      {...props}
    >
      {title ? (
        <h3
          data-slot="property-panel-title"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {title}
        </h3>
      ) : null}
      <dl className="space-y-2.5">{children}</dl>
    </section>
  )
}

export interface PropertyRowProps extends React.ComponentProps<"div"> {
  label: React.ReactNode
}

/** One label/value pair inside a {@link PropertyPanel}. */
function PropertyRow({ className, label, children, ...props }: PropertyRowProps) {
  return (
    <div
      data-slot="property-row"
      className={cn("grid grid-cols-[7.5rem_1fr] items-start gap-2", className)}
      {...props}
    >
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

export interface EditablePropertyDescriptor<TValue = unknown> {
  /** Stable identifier — used as React key and passed to `onChange`. */
  key: string
  label: React.ReactNode
  value: TValue
  /** Default `text`. */
  type?: "text" | "number" | "email" | "url"
  placeholder?: string
  /** Default false. Display-only rows are still rendered, just non-editable. */
  readOnly?: boolean
  /**
   * Optional renderer for the read-only display. Defaults to
   * `String(value ?? "—")`. Useful for badges, links, formatted dates.
   */
  renderValue?: (value: TValue) => React.ReactNode
  /**
   * Optional renderer for the editor. Receives the current draft value
   * and an `onCommit(next)` callback. When supplied, this replaces the
   * default `<input>`. Use for custom pickers, switches, etc.
   */
  renderEditor?: (
    draft: TValue,
    onCommit: (next: TValue) => void,
    onCancel: () => void,
  ) => React.ReactNode
}

export interface EditablePropertyListProps {
  properties: EditablePropertyDescriptor[]
  onChange?: (key: string, value: unknown) => void
  /** Default false. When true, all rows render in their read-only display. */
  disabled?: boolean
  className?: string
}

/**
 * Stage 1 of editing is local: the user clicks a value, edits inline,
 * and presses Enter / blurs to commit. The committed value is forwarded
 * through `onChange`; cancellation reverts to the original value.
 *
 * This component does not persist anything itself — hosts wire
 * `onChange` to their own store.
 */
function EditablePropertyList({
  properties,
  onChange,
  disabled,
  className,
}: EditablePropertyListProps) {
  const [editingKey, setEditingKey] = React.useState<string | null>(null)
  return (
    <dl
      data-slot="editable-property-list"
      className={cn("space-y-2.5", className)}
    >
      {properties.map((prop) => {
        const isEditing = !disabled && !prop.readOnly && editingKey === prop.key
        return (
          <PropertyRow key={prop.key} label={prop.label}>
            {isEditing ? (
              <EditableValueEditor
                descriptor={prop}
                onCommit={(next) => {
                  setEditingKey(null)
                  if (next !== prop.value) onChange?.(prop.key, next)
                }}
                onCancel={() => setEditingKey(null)}
              />
            ) : (
              <button
                type="button"
                data-slot="editable-property-display"
                disabled={disabled || prop.readOnly}
                onClick={() => {
                  if (!disabled && !prop.readOnly) setEditingKey(prop.key)
                }}
                className={cn(
                  "block w-full text-left",
                  !disabled && !prop.readOnly
                    ? "rounded px-1 -mx-1 hover:bg-accent/40 focus:bg-accent/40 focus:outline-none"
                    : "cursor-default",
                )}
              >
                {prop.renderValue
                  ? prop.renderValue(prop.value)
                  : renderDefaultValue(prop.value)}
              </button>
            )}
          </PropertyRow>
        )
      })}
    </dl>
  )
}

function renderDefaultValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return <code className="text-xs">{JSON.stringify(value)}</code>
  return String(value)
}

interface EditableValueEditorProps {
  descriptor: EditablePropertyDescriptor
  onCommit: (next: unknown) => void
  onCancel: () => void
}

function EditableValueEditor({
  descriptor,
  onCommit,
  onCancel,
}: EditableValueEditorProps) {
  const initialString =
    descriptor.value === null || descriptor.value === undefined
      ? ""
      : String(descriptor.value)
  const [draft, setDraft] = React.useState(initialString)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  if (descriptor.renderEditor) {
    return (
      <>
        {descriptor.renderEditor(
          descriptor.value,
          (next) => onCommit(next),
          () => onCancel(),
        )}
      </>
    )
  }

  const inputType = descriptor.type ?? "text"

  return (
    <input
      ref={inputRef}
      type={inputType}
      value={draft}
      placeholder={descriptor.placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(coerce(draft, inputType))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          onCommit(coerce(draft, inputType))
        } else if (e.key === "Escape") {
          e.preventDefault()
          onCancel()
        }
      }}
      className={cn(
        "w-full rounded border border-input bg-background px-2 py-1 text-sm",
        "focus:outline-none focus:ring-1 focus:ring-ring",
      )}
    />
  )
}

function coerce(
  raw: string,
  type: NonNullable<EditablePropertyDescriptor["type"]>,
): string | number {
  if (type === "number") {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  return raw
}

export { PropertyPanel, PropertyRow, EditablePropertyList }
