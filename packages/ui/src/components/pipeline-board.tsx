import * as React from "react"

import { cn } from "../lib/utils"

/**
 * Generic stage-board layout. Renders one column per
 * {@link PipelineBoardStage} with the subjects placed in that stage,
 * using a host-provided card renderer. No domain vocabulary or
 * persistence — drag/drop is opt-in via `onMove`, and the move is the
 * host's to apply (call your store, then re-render with new props).
 *
 * The component intentionally does not animate transitions or own
 * placement state, so it remains a thin presentational layer.
 */
export interface PipelineBoardStage<TSubject> {
  id: string
  name: React.ReactNode
  /** Optional sub-label shown under the stage name (count, total value, etc.). */
  meta?: React.ReactNode
  subjects: TSubject[]
}

export interface PipelineBoardProps<TSubject> {
  stages: PipelineBoardStage<TSubject>[]
  /**
   * Renders one subject card. Receives the subject + the stage it
   * belongs to (handy for tinting badges by stage).
   */
  renderSubject: (
    subject: TSubject,
    stage: PipelineBoardStage<TSubject>,
  ) => React.ReactNode
  /** Stable subject id used as the React key and for drag/drop payloads. */
  getSubjectId: (subject: TSubject) => string
  /**
   * Optional move handler. When supplied, cards become draggable and
   * the board accepts drops between columns. Called with the subject
   * id and the destination stage id; the host updates its store and
   * passes a new `stages` prop.
   */
  onMove?: (subjectId: string, toStageId: string) => void
  /** Default `360px`. */
  columnWidth?: string
  className?: string
  emptyStageLabel?: React.ReactNode
}

function PipelineBoard<TSubject>({
  stages,
  renderSubject,
  getSubjectId,
  onMove,
  columnWidth = "20rem",
  emptyStageLabel = "No items",
  className,
}: PipelineBoardProps<TSubject>) {
  const [hoverStage, setHoverStage] = React.useState<string | null>(null)
  const dragDisabled = !onMove
  return (
    <div
      data-slot="pipeline-board"
      className={cn(
        "flex h-full min-h-0 gap-4 overflow-x-auto py-4",
        className,
      )}
    >
      {stages.map((stage) => {
        const isHover = hoverStage === stage.id
        return (
          <div
            key={stage.id}
            data-slot="pipeline-board-column"
            data-stage-id={stage.id}
            style={{ width: columnWidth }}
            className={cn(
              "flex shrink-0 flex-col rounded-lg border border-border bg-muted/30 transition-colors",
              isHover && "border-primary/60 bg-primary/5",
            )}
            onDragOver={(e) => {
              if (dragDisabled) return
              e.preventDefault()
              if (hoverStage !== stage.id) setHoverStage(stage.id)
            }}
            onDragLeave={(e) => {
              if (dragDisabled) return
              // Only clear when leaving the column proper, not when
              // moving onto an inner card.
              if (e.currentTarget === e.target) setHoverStage(null)
            }}
            onDrop={(e) => {
              if (dragDisabled) return
              e.preventDefault()
              const subjectId = e.dataTransfer.getData("text/plain")
              setHoverStage(null)
              if (subjectId) onMove?.(subjectId, stage.id)
            }}
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
              <div className="text-sm font-semibold text-foreground">
                {stage.name}
              </div>
              {stage.meta ? (
                <div className="text-xs text-muted-foreground">
                  {stage.meta}
                </div>
              ) : null}
            </header>
            <div
              data-slot="pipeline-board-column-body"
              className="flex-1 space-y-2 overflow-y-auto p-2"
            >
              {stage.subjects.length === 0 ? (
                <div
                  data-slot="pipeline-board-empty"
                  className="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
                >
                  {emptyStageLabel}
                </div>
              ) : (
                stage.subjects.map((subject) => {
                  const id = getSubjectId(subject)
                  return (
                    <div
                      key={id}
                      data-slot="pipeline-board-card"
                      data-subject-id={id}
                      draggable={!dragDisabled}
                      onDragStart={(e) => {
                        if (dragDisabled) return
                        e.dataTransfer.setData("text/plain", id)
                        e.dataTransfer.effectAllowed = "move"
                      }}
                      className={cn(
                        "rounded border border-border bg-card",
                        !dragDisabled && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      {renderSubject(subject, stage)}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { PipelineBoard }
