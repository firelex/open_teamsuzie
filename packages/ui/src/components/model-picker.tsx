import * as React from "react"

import { cn } from "../lib/utils"

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPer1M: number
  /** USD per 1M output tokens. */
  outputPer1M: number
  /** Free-form note to display under the price (e.g. "approximate; see provider"). */
  note?: string
}

export interface ModelOption {
  /** Model id sent to the chat backend (e.g. "qwen3.6-plus", "anthropic/claude-sonnet-4-6"). */
  id: string
  /** Display name. */
  name: string
  /** Provider label (e.g. "Anthropic", "Alibaba (Dashscope)"). */
  provider: string
  /** One-line description shown under the name. */
  description?: string
  pricing?: ModelPricing
  /** Optional link to provider pricing page. */
  pricingUrl?: string
  /** Marks this as a locally-hosted model — surfaces a "Local" badge and
   *  hides cloud-style pricing in favor of the install link. */
  local?: boolean
  /** Link to install / setup instructions (e.g. an unsloth HF page). Shown
   *  in place of `pricingUrl` for local models. */
  installUrl?: string
  /** For local models: the base URL the server will route this model's chat
   *  calls to. Display-only — set by the consumer from `/api/health` so the
   *  user can verify the configured endpoint matches where their server runs. */
  resolvedBaseUrl?: string
}

/**
 * Starter model list — three commonly-used frontier-grade options spanning a
 * wide cost band. Apps free to override or extend. Pricing values are
 * approximate and meant for orientation, not billing — `pricingUrl` always
 * points at the provider's actual pricing page so users can verify.
 */
export const DEFAULT_MODELS: ModelOption[] = [
  {
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    description: "Strong on tool use, long-form drafting, and structured output.",
    pricing: { inputPer1M: 3, outputPer1M: 15, note: "approx." },
    pricingUrl: "https://www.anthropic.com/pricing",
  },
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    provider: "OpenAI",
    description: "Reliable at structured tool use; broadly available.",
    pricing: { inputPer1M: 2.5, outputPer1M: 10, note: "approx." },
    pricingUrl: "https://openai.com/api/pricing/",
  },
  {
    id: "qwen3.6-plus",
    name: "Qwen 3.6-Plus",
    provider: "Alibaba (Dashscope)",
    description: "Strong reasoning at a fraction of the cost of US frontier models.",
    pricing: { inputPer1M: 0.4, outputPer1M: 1.2, note: "approx." },
    pricingUrl:
      "https://www.alibabacloud.com/help/en/model-studio/billing-of-model-studio",
  },
]

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2).replace(/\.00$/, "")}`
  return `$${value.toFixed(2)}`
}

export interface ModelPickerProps {
  models: ModelOption[]
  selected?: string
  onSelect: (id: string) => void
  className?: string
  /** Compact = single-line rows for unselected, expanded for selected.
   *  Default `true`. Set false for the older roomy three-line tiles. */
  compact?: boolean
  /** Called when the user clicks the "Configure" affordance on a Local row.
   *  Apps wire this to open `<LocalModelConfigDialog>`. When undefined, no
   *  Configure button is rendered (display-only mode). */
  onConfigure?: (model: ModelOption) => void
}

/**
 * Radio-style picker for selecting a chat model. Compact by default — each
 * unselected row is a single line, the selected row expands to show the
 * description and links. Set `compact={false}` for the older roomy layout.
 *
 * Pricing values are display-only. Hard numbers tend to drift; treat them as
 * informational and keep `pricingUrl` set so users can verify on the
 * provider's actual pricing page. Local models use `installUrl` instead.
 */
export function ModelPicker({
  models,
  selected,
  onSelect,
  className,
  compact = true,
  onConfigure,
}: ModelPickerProps) {
  return (
    <div
      className={cn(compact ? "divide-y divide-border rounded-lg border border-border bg-card" : "space-y-2", className)}
      role="radiogroup"
    >
      {models.map((model) => {
        const isSelected = model.id === selected
        if (!compact) {
          return <RoomyRow key={model.id} model={model} isSelected={isSelected} onSelect={onSelect} onConfigure={onConfigure} />
        }
        return <CompactRow key={model.id} model={model} isSelected={isSelected} onSelect={onSelect} onConfigure={onConfigure} />
      })}
    </div>
  )
}

function CompactRow({
  model,
  isSelected,
  onSelect,
  onConfigure,
}: {
  model: ModelOption
  isSelected: boolean
  onSelect: (id: string) => void
  onConfigure?: (model: ModelOption) => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={() => onSelect(model.id)}
      className={cn(
        "group flex w-full flex-col gap-1.5 px-3.5 py-2.5 text-left transition-colors",
        isSelected ? "bg-accent/40" : "hover:bg-accent",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border",
            isSelected ? "border-foreground" : "border-muted-foreground/40",
          )}
          aria-hidden="true"
        >
          {isSelected && <span className="size-1.5 rounded-full bg-foreground" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {model.name}
        </span>
        {model.local && <LocalBadge />}
        <span className="shrink-0 text-[11px] text-muted-foreground">{model.provider}</span>
        {model.pricing && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatUsd(model.pricing.inputPer1M)} / {formatUsd(model.pricing.outputPer1M)}
          </span>
        )}
      </div>
      {isSelected && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-[11px] text-muted-foreground">
          {model.description && <span className="text-foreground/80">{model.description}</span>}
          <span className="font-mono">{model.id}</span>
          {model.local && model.resolvedBaseUrl && (
            <span title="Resolved server URL — set in .env">
              → <span className="font-mono">{model.resolvedBaseUrl}</span>
            </span>
          )}
          {model.local && model.installUrl ? (
            <a
              href={model.installUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="text-primary underline-offset-2 hover:underline"
            >
              Install instructions →
            </a>
          ) : (
            model.pricingUrl && (
              <a
                href={model.pricingUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="text-primary underline-offset-2 hover:underline"
              >
                Verify pricing →
              </a>
            )
          )}
          {model.local && onConfigure && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onConfigure(model)
              }}
              className="text-primary underline-offset-2 hover:underline"
            >
              Configure endpoint →
            </button>
          )}
          {model.pricing?.note && <span>{model.pricing.note}</span>}
        </div>
      )}
    </button>
  )
}

function RoomyRow({
  model,
  isSelected,
  onSelect,
  onConfigure,
}: {
  model: ModelOption
  isSelected: boolean
  onSelect: (id: string) => void
  onConfigure?: (model: ModelOption) => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={() => onSelect(model.id)}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg border bg-card px-3.5 py-3 text-left transition-colors",
        isSelected
          ? "border-foreground/30 ring-1 ring-foreground/10"
          : "border-border hover:border-foreground/20 hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
          isSelected ? "border-foreground" : "border-muted-foreground/40",
        )}
        aria-hidden="true"
      >
        {isSelected && <span className="size-2 rounded-full bg-foreground" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-foreground">{model.name}</div>
              {model.local && <LocalBadge />}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{model.provider}</div>
          </div>
          {model.pricing && (
            <div className="shrink-0 text-right text-[11px]">
              <div className="font-mono text-foreground">
                {formatUsd(model.pricing.inputPer1M)} / {formatUsd(model.pricing.outputPer1M)}
              </div>
              <div className="text-muted-foreground">per 1M tokens</div>
            </div>
          )}
        </div>
        {model.description && <div className="text-xs text-muted-foreground">{model.description}</div>}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-mono">{model.id}</span>
          {model.local && model.resolvedBaseUrl && (
            <span title="Resolved server URL — set in .env">
              → <span className="font-mono">{model.resolvedBaseUrl}</span>
            </span>
          )}
          {model.local && model.installUrl ? (
            <a
              href={model.installUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="text-primary underline-offset-2 hover:underline"
            >
              Install instructions →
            </a>
          ) : (
            model.pricingUrl && (
              <a
                href={model.pricingUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="text-primary underline-offset-2 hover:underline"
              >
                Verify pricing →
              </a>
            )
          )}
          {model.local && onConfigure && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onConfigure(model)
              }}
              className="text-primary underline-offset-2 hover:underline"
            >
              Configure endpoint →
            </button>
          )}
          {model.pricing?.note && <span>{model.pricing.note}</span>}
        </div>
      </div>
    </button>
  )
}

function LocalBadge() {
  return (
    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      Local
    </span>
  )
}
