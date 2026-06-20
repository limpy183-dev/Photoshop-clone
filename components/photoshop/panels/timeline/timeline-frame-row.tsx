import * as React from "react"
import { ArrowDown, ArrowUp, Copy, Eye, Trash2 } from "lucide-react"

import { renderDocumentComposite } from "../../document-io"
import { buildDocumentForFrame, renderTimelineFrameWithTransition } from "../../timeline-engine"
import type { FrameEasing, PsDocument, TimelineFrame } from "../../types"
import { EASINGS, ToolButton } from "./timeline-shared"

export function FrameRow({
  doc,
  frame,
  nextFrame,
  index,
  total,
  isSelected,
  isMultiSelected,
  onSelect,
  onApply,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  doc: PsDocument
  frame: TimelineFrame
  nextFrame: TimelineFrame | null
  index: number
  total: number
  isSelected: boolean
  isMultiSelected: boolean
  onSelect: (multi: boolean) => void
  onApply: () => void
  onChange: (patch: Partial<TimelineFrame>) => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const thumbRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const canvas = thumbRef.current
    if (!canvas) return
    const projected = buildDocumentForFrame(doc, frame)
    const rendered = renderDocumentComposite(projected, { transparent: true })
    const target = canvas
    const maxDim = 48
    const scale = Math.min(maxDim / rendered.width, maxDim / rendered.height, 1)
    target.width = Math.max(1, Math.round(rendered.width * scale))
    target.height = Math.max(1, Math.round(rendered.height * scale))
    const ctx = target.getContext("2d")
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.clearRect(0, 0, target.width, target.height)
    ctx.drawImage(rendered, 0, 0, target.width, target.height)
  }, [doc, frame])

  const highlight = isSelected
    ? "bg-[var(--ps-tool-active)]"
    : isMultiSelected
    ? "bg-[var(--ps-tool-hover)]"
    : ""
  const transitionKind = frame.transition ?? "hold"
  const hasTransitionPreview = transitionKind !== "hold" && Boolean(nextFrame)
  const transitionDurationMs = Math.max(0, Math.round(frame.transitionDurationMs ?? frame.durationMs))

  return (
    <div
      className={`grid grid-cols-[18px_56px_1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 ${highlight}`}
      onClick={(e) => onSelect(e.metaKey || e.ctrlKey || e.shiftKey)}
    >
      <div className="flex flex-col items-center justify-center gap-0.5 text-[var(--ps-text-dim)]">
        <button
          type="button"
          title="Move up"
          aria-label={`Move ${frame.name} up`}
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation()
            onMoveUp()
          }}
          className="opacity-60 hover:opacity-100 disabled:opacity-20"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Move down"
          aria-label={`Move ${frame.name} down`}
          disabled={index === total - 1}
          onClick={(e) => {
            e.stopPropagation()
            onMoveDown()
          }}
          className="opacity-60 hover:opacity-100 disabled:opacity-20"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>

      <button
        type="button"
        className="relative flex h-12 w-14 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[#0a0a0a] hover:bg-[var(--ps-tool-hover)]"
        onClick={(e) => {
          e.stopPropagation()
          onApply()
        }}
        title={`Apply ${frame.name} to canvas`}
      >
        <canvas ref={thumbRef} className="max-h-12 max-w-14 object-contain" />
        <Eye className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-white/60" />
      </button>

      <div className="min-w-0 space-y-1">
        <input
          value={frame.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-full bg-transparent text-[11px] outline-none focus:bg-[var(--ps-panel-2)]"
          aria-label={`Name for frame ${index + 1}`}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[var(--ps-text-dim)]">#{index + 1}</span>
          <input
            type="number"
            min={20}
            max={10000}
            step={50}
            value={frame.durationMs}
            onChange={(e) => onChange({ durationMs: Math.max(20, Number(e.target.value) || 500) })}
            onClick={(e) => e.stopPropagation()}
            className="h-5 w-16 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
            aria-label={`Duration ms for ${frame.name}`}
          />
          <span className="text-[10px] text-[var(--ps-text-dim)]">ms</span>
          <select
            aria-label={`Transition for ${frame.name}`}
            value={transitionKind}
            onChange={(e) => {
              const transition = e.target.value as TimelineFrame["transition"]
              onChange({
                transition,
                ...(transition && transition !== "hold" && !frame.transitionDurationMs
                  ? { transitionDurationMs: Math.min(250, Math.max(20, frame.durationMs)) }
                  : {}),
              })
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="hold">Hold</option>
            <option value="dissolve">Dissolve</option>
            <option value="cross-dissolve">Cross-dissolve</option>
            <option value="fade-black">Fade-black</option>
            <option value="fade-white">Fade-white</option>
            <option value="wipe-left">Wipe-left</option>
            <option value="wipe-right">Wipe-right</option>
          </select>
          <select
            aria-label={`Easing for ${frame.name}`}
            value={frame.easing ?? "linear"}
            onChange={(e) => onChange({ easing: e.target.value as FrameEasing })}
            onClick={(e) => e.stopPropagation()}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            {EASINGS.map((easing) => (
              <option key={easing} value={easing}>
                {easing}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-[var(--ps-text-dim)]">Trans</span>
          <input
            type="number"
            min={0}
            max={Math.max(20, frame.durationMs)}
            step={20}
            disabled={!hasTransitionPreview}
            value={hasTransitionPreview ? transitionDurationMs : 0}
            onChange={(e) =>
              onChange({
                transitionDurationMs: Math.max(0, Math.min(frame.durationMs, Number(e.target.value) || 0)),
              })
            }
            onClick={(e) => e.stopPropagation()}
            className="h-5 w-16 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] disabled:opacity-40"
            aria-label={`Transition duration ms for ${frame.name}`}
          />
          <span className="text-[10px] text-[var(--ps-text-dim)]">ms</span>
        </div>
        {hasTransitionPreview && nextFrame ? (
          <div className="flex items-center gap-2">
            <TransitionPreviewCanvas doc={doc} frame={frame} nextFrame={nextFrame} />
            <span className="text-[9px] text-[var(--ps-text-dim)]">
              Preview {transitionKind} over {transitionDurationMs}ms
            </span>
          </div>
        ) : null}
        <input
          aria-label={`Audio cue for ${frame.name}`}
          value={frame.audioLabel ?? ""}
          onChange={(e) => onChange({ audioLabel: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          placeholder="Audio cue / note"
          className="h-5 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] outline-none"
        />
      </div>
      <div className="flex items-center gap-1">
        <ToolButton
          title="Duplicate frame"
          onClick={(e) => {
            e?.stopPropagation()
            onDuplicate()
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Delete frame"
          onClick={(e) => {
            e?.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </ToolButton>
      </div>
    </div>
  )
}

function TransitionPreviewCanvas({
  doc,
  frame,
  nextFrame,
}: {
  doc: PsDocument
  frame: TimelineFrame
  nextFrame: TimelineFrame
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const preview = renderTimelineFrameWithTransition(doc, frame, nextFrame, 0.5, { transparent: true })
    const aspect = Math.max(1, preview.width) / Math.max(1, preview.height)
    const targetW = 64
    const targetH = Math.max(24, Math.round(targetW / aspect))
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, targetW, targetH)
    ctx.drawImage(preview, 0, 0, targetW, targetH)
  }, [doc, frame, nextFrame])

  return (
    <canvas
      ref={canvasRef}
      className="h-8 w-16 rounded-sm border border-[var(--ps-divider)] bg-black"
      aria-label={`Transition preview for ${frame.name}`}
    />
  )
}
