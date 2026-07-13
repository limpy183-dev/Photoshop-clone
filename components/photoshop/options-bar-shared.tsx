"use client"

import * as React from "react"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import {
  Brush,
  Eraser,
  Pipette,
  MousePointer2,
  Square,
  Type,
  Hand,
  ZoomIn,
  Star,
  Heart,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Check,
  X,
  Zap,
  Hexagon,
  Triangle as TriangleIcon,
  Diamond,
  Frame as FrameIcon,
  Scissors,
  Hash,
  Ruler as RulerIcon,
  StickyNote,
  PaintbrushVertical,
  LayoutTemplate,
  PenTool,
  PenLine,
  Crosshair,
  RotateCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CustomShapeId, GradientStop, ToolId } from "./types"

export const Divider = () => <div className="w-px h-5 bg-[var(--ps-divider)] mx-2" />

export const labelClass = "text-[11px] text-[var(--ps-text-dim)]"
export const numInputClass =
  "w-16 h-6 px-1.5 text-[11px] bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[var(--ps-text)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
export const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const SHAPE_LIBRARY: { id: CustomShapeId; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "star5", label: "5-Star", Icon: Star },
  { id: "star6", label: "6-Star", Icon: Star },
  { id: "heart", label: "Heart", Icon: Heart },
  { id: "arrow-right", label: "Arrow Right", Icon: ArrowRight },
  { id: "arrow-left", label: "Arrow Left", Icon: ArrowLeft },
  { id: "arrow-up", label: "Arrow Up", Icon: ArrowUp },
  { id: "arrow-down", label: "Arrow Down", Icon: ArrowDown },
  { id: "speech", label: "Speech", Icon: MessageSquare },
  { id: "check", label: "Check", Icon: Check },
  { id: "cross", label: "Cross", Icon: X },
  { id: "lightning", label: "Lightning", Icon: Zap },
  { id: "polygon-hex", label: "Hexagon", Icon: Hexagon },
  { id: "polygon-tri", label: "Triangle", Icon: TriangleIcon },
  { id: "diamond", label: "Diamond", Icon: Diamond },
]

export function ColorChip({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-5 h-5 rounded-sm border border-[var(--ps-divider)]"
      style={{ background: color }}
    />
  )
}

export function rgbaCss(hex: string, opacity: number) {
  if (!hex.startsWith("#")) return hex
  const v = hex.slice(1)
  const n = v.length === 3 ? v.split("").map((c) => c + c).join("") : v
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${opacity})`
}

export function GradientStopsEditor({
  stops,
  onChange,
}: {
  stops: GradientStop[]
  onChange: (next: GradientStop[]) => void
}) {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  const css = `linear-gradient(to right, ${sorted
    .map((s) => `${rgbaCss(s.color, s.opacity)} ${Math.round(s.offset * 100)}%`)
    .join(", ")})`
  const [activeIdx, setActiveIdx] = React.useState(0)
  const active = sorted[activeIdx] ?? sorted[0]

  const updateActive = (patch: Partial<GradientStop>) => {
    const next = sorted.map((s, i) => (i === activeIdx ? { ...s, ...patch } : s))
    onChange(next)
  }

  const addStop = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const offset = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const color = approximateColor(sorted, offset)
    const next = [...sorted, { offset, color, opacity: 1 }].sort((a, b) => a.offset - b.offset)
    onChange(next)
    setActiveIdx(next.findIndex((s) => s.offset === offset && s.color === color))
  }

  const removeStop = () => {
    if (sorted.length <= 2) return
    const next = sorted.filter((_, i) => i !== activeIdx)
    onChange(next)
    setActiveIdx(Math.max(0, activeIdx - 1))
  }

  return (
    <div className="space-y-3 text-xs">
      <div
        className="relative h-8 border border-[var(--ps-divider)] rounded-sm cursor-crosshair"
        style={{ background: css }}
        onDoubleClick={addStop}
      >
        {sorted.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            className={cn(
              "absolute top-full -translate-x-1/2 w-2.5 h-3 mt-0.5 rounded-b-sm border",
              i === activeIdx ? "border-[var(--ps-accent)]" : "border-[var(--ps-divider)]",
            )}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
            aria-label={`Stop ${i + 1}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-[80px_1fr] gap-2 items-center pt-3">
        <label>Color</label>
        <input
          type="color"
          value={active?.color ?? "#000000"}
          onChange={(e) => updateActive({ color: e.target.value })}
          className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-transparent"
        />
        <label>Opacity</label>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[active?.opacity ?? 1]}
          onValueChange={(v) => updateActive({ opacity: v[0] })}
        />
        <label>Position</label>
        <Slider
          min={0}
          max={1}
          step={0.001}
          value={[active?.offset ?? 0]}
          onValueChange={(v) => updateActive({ offset: v[0] })}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Double-click bar to add a stop</span>
        <button
          onClick={removeStop}
          disabled={sorted.length <= 2}
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function approximateColor(stops: GradientStop[], offset: number) {
  let prev = stops[0]
  let _next = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i].offset <= offset && stops[i + 1].offset >= offset) {
      prev = stops[i]
      _next = stops[i + 1]
      break
    }
  }
  return prev.color
}

export function ToolBadge({ tool }: { tool: ToolId }) {
  const map: Partial<Record<ToolId, { Icon: React.ComponentType<{ className?: string }>; name: string }>> =
  {
    brush: { Icon: Brush, name: "Brush" },
    pencil: { Icon: Brush, name: "Pencil" },
    "mixer-brush": { Icon: Brush, name: "Mixer Brush" },
    "pattern-stamp": { Icon: Brush, name: "Pattern Stamp" },
    eraser: { Icon: Eraser, name: "Eraser" },
    "background-eraser": { Icon: Eraser, name: "Background Eraser" },
    "magic-eraser": { Icon: Eraser, name: "Magic Eraser" },
    "clone-stamp": { Icon: Brush, name: "Clone Stamp" },
    "healing-brush": { Icon: Brush, name: "Healing Brush" },
    "art-history-brush": { Icon: Brush, name: "Art History Brush" },
    "red-eye": { Icon: Brush, name: "Red Eye" },
    move: { Icon: MousePointer2, name: "Move" },
    "content-aware-move": { Icon: MousePointer2, name: "Content-Aware Move" },
    "marquee-rect": { Icon: Square, name: "Marquee" },
    "marquee-ellipse": { Icon: Square, name: "Marquee" },
    "magic-wand": { Icon: Square, name: "Magic Wand" },
    "quick-selection": { Icon: Square, name: "Quick Selection" },
    "object-select": { Icon: Square, name: "Object Selection" },
    "refine-edge-brush": { Icon: Brush, name: "Refine Edge Brush" },
    "select-subject": { Icon: Square, name: "Select Subject" },
    "select-sky": { Icon: Square, name: "Select Sky" },
    "select-background": { Icon: Square, name: "Select Background" },
    "patch-tool": { Icon: Scissors, name: "Patch Tool" },
    type: { Icon: Type, name: "Type" },
    "type-vertical": { Icon: Type, name: "Vertical Type" },
    "type-mask-horizontal": { Icon: Type, name: "Horizontal Type Mask" },
    "type-mask-vertical": { Icon: Type, name: "Vertical Type Mask" },
    eyedropper: { Icon: Pipette, name: "Eyedropper" },
    "color-sampler": { Icon: Crosshair, name: "Color Sampler" },
    "material-eyedropper": { Icon: Pipette, name: "3D Material Eyedropper" },
    "material-drop": { Icon: Pipette, name: "3D Material Drop" },
    zoom: { Icon: ZoomIn, name: "Zoom" },
    hand: { Icon: Hand, name: "Hand" },
    "rotate-view": { Icon: RotateCw, name: "Rotate View" },
    "shape-rect": { Icon: Square, name: "Rectangle" },
    "shape-rounded-rect": { Icon: Square, name: "Rounded Rectangle" },
    "shape-ellipse": { Icon: Square, name: "Ellipse" },
    "shape-polygon": { Icon: TriangleIcon, name: "Polygon" },
    "shape-star": { Icon: Star, name: "Star" },
    "shape-triangle": { Icon: TriangleIcon, name: "Triangle" },
    "shape-line": { Icon: Square, name: "Line" },
    "custom-shape": { Icon: Star, name: "Custom Shape" },
    gradient: { Icon: PaintbrushVertical, name: "Gradient" },
    frame: { Icon: FrameIcon, name: "Frame" },
    slice: { Icon: Scissors, name: "Slice" },
    "slice-select": { Icon: MousePointer2, name: "Slice Select" },
    ruler: { Icon: RulerIcon, name: "Ruler" },
    note: { Icon: StickyNote, name: "Note" },
    count: { Icon: Hash, name: "Count" },
    "perspective-crop": { Icon: Square, name: "Perspective Crop" },
    artboard: { Icon: LayoutTemplate, name: "Artboard" },
    "direct-select": { Icon: MousePointer2, name: "Direct Select" },
    pen: { Icon: PenTool, name: "Pen" },
    "freeform-pen": { Icon: PenLine, name: "Freeform Pen" },
    "curvature-pen": { Icon: PenLine, name: "Curvature Pen" },
    "add-anchor-point": { Icon: PenLine, name: "Add Anchor Point" },
    "delete-anchor-point": { Icon: PenLine, name: "Delete Anchor Point" },
    "convert-point": { Icon: PenLine, name: "Convert Point" },
  }
  const cur = map[tool] ?? { Icon: MousePointer2, name: tool }
  return (
    <div className="flex items-center gap-1.5 pr-1">
      <div className="w-6 h-6 rounded-sm bg-[var(--ps-panel-2)] flex items-center justify-center">
        <cur.Icon className="w-3.5 h-3.5" />
      </div>
      <span className="text-[11px] font-medium">{cur.name}</span>
    </div>
  )
}

/* ---------- ScrubLabel: drag-to-adjust label for number inputs ---------- */

export function PercentInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = React.useState(String(value))
  const focusedRef = React.useRef(false)

  React.useEffect(() => {
    if (!focusedRef.current) setDraft(String(value))
  }, [value])

  const updateDraft = (raw: string) => {
    setDraft(raw)
    if (raw.trim() === "") return
    const numeric = Number(raw)
    if (!Number.isFinite(numeric)) return
    onChange(clampNumber(Math.round(numeric), 0, 100))
  }

  const normalize = () => {
    focusedRef.current = false
    const numeric = Number(draft)
    const next = clampNumber(Number.isFinite(numeric) ? Math.round(numeric) : value, 0, 100)
    setDraft(String(next))
    onChange(next)
  }

  return (
    <Input
      aria-label={label}
      type="number"
      min={0}
      max={100}
      step={1}
      value={draft}
      onFocus={(event) => {
        focusedRef.current = true
        setDraft(String(value))
        event.currentTarget.select()
      }}
      onClick={(event) => event.currentTarget.select()}
      onMouseUp={(event) => event.preventDefault()}
      onChange={(event) => updateDraft(event.target.value)}
      onBlur={normalize}
      onWheel={(event) => {
        event.preventDefault()
        const delta = event.deltaY < 0 ? 1 : -1
        const next = clampNumber(value + delta, 0, 100)
        setDraft(String(next))
        onChange(next)
      }}
      className={numInputClass}
    />
  )
}

export function ScrubLabel({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const dragRef = React.useRef<{ startX: number; startValue: number } | null>(null)
  const elRef = React.useRef<HTMLSpanElement>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = elRef.current
    if (el) el.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startValue: value }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const sensitivity = e.shiftKey ? 0.5 : 2
    const delta = Math.round(dx / sensitivity)
    const next = Math.max(min, Math.min(max, drag.startValue + delta))
    if (next !== value) onChange(next)
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  return (
    <span
      ref={elRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={labelClass}
      style={{ cursor: "ew-resize", userSelect: "none" }}
    >
      {label}
    </span>
  )
}
