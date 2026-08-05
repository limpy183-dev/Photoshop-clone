"use client"

/**
 * The gradient controls used by the gradient-overlay and stroke effects —
 * type/angle/scale plus the draggable gradient stop editor.
 */

import * as React from "react"
import { Label } from "@/components/ui/label"
import type { GradientStop, MultiGradient } from "@/editor/types"
import { SelectRow, SliderRow } from "@/components/photoshop/layer-style-controls"
import { titleCaseBlend } from "@/editor/document/layer-style-helpers"
const GRADIENT_TYPES: MultiGradient["type"][] = ["linear", "radial", "angular", "reflected", "diamond"]

export function GradientControls({
  gradient,
  onChange,
}: {
  gradient: MultiGradient
  onChange: (gradient: MultiGradient) => void
}) {
  return (
    <>
      <SelectRow
        label="Gradient Type"
        value={gradient.type}
        options={GRADIENT_TYPES.map((t) => [t, titleCaseBlend(t)])}
        onChange={(v) => onChange({ ...gradient, type: v as MultiGradient["type"] })}
      />
      <SliderRow label="Angle" suffix=" deg" min={-180} max={180} value={gradient.angle} onChange={(v) => onChange({ ...gradient, angle: v })} />
      <GradientStopsRow stops={gradient.stops} onChange={(stops) => onChange({ ...gradient, stops })} />
    </>
  )
}

export function GradientStopsRow({
  stops,
  onChange,
}: {
  stops: GradientStop[]
  onChange: (stops: GradientStop[]) => void
}) {
  const safeStops = stops.length >= 2 ? stops : [
    { offset: 0, color: "#000000", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 1 },
  ]
  const addStop = () => {
    const last = safeStops[safeStops.length - 1]
    const second = safeStops[safeStops.length - 2] ?? safeStops[0]
    const offset = (last.offset + second.offset) / 2
    const next = [...safeStops, { offset, color: last.color, opacity: 1 }].sort((a, b) => a.offset - b.offset)
    onChange(next)
  }
  const removeStop = (idx: number) => {
    if (safeStops.length <= 2) return
    onChange(safeStops.filter((_, i) => i !== idx))
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">Color Stops</Label>
        <button
          type="button"
          onClick={addStop}
          className="text-[10px] px-2 py-0.5 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
        >
          Add Stop
        </button>
      </div>
      <div className="relative h-6 rounded-sm border border-[var(--ps-divider)] overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, ${safeStops
              .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
              .join(", ")})`,
          }}
        />
      </div>
      <div className="grid gap-1">
        {safeStops.map((s, i) => (
          <div key={i} className="grid grid-cols-[32px_1fr_42px_18px] items-center gap-2 text-[11px]">
            <input
              type="color"
              value={s.color}
              onChange={(e) => {
                const next = safeStops.slice()
                next[i] = { ...s, color: e.target.value }
                onChange(next)
              }}
              className="h-6 w-8 rounded-sm border border-[var(--ps-divider)] bg-transparent"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.offset * 100)}
              onChange={(e) => {
                const next = safeStops.slice()
                next[i] = { ...s, offset: Number(e.target.value) / 100 }
                onChange(next.sort((a, b) => a.offset - b.offset))
              }}
              className="w-full"
            />
            <span className="tabular-nums text-right">{Math.round(s.offset * 100)}%</span>
            <button
              type="button"
              onClick={() => removeStop(i)}
              className="text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] disabled:opacity-30"
              disabled={safeStops.length <= 2}
              aria-label="Remove stop"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
