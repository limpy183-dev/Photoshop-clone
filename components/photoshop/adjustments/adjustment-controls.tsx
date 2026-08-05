"use client"

/**
 * Form primitives shared by the adjustment dialogs — the grouped section, the
 * labelled slider with its step snapping, the select row and the colour target
 * row. Presentation only; each dialog owns its own state.
 */

import * as React from "react"
import { Slider } from "@/components/ui/slider"
import { hexToRgb, rgbToHex } from "@/editor/document/adjustment-helpers"

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/30 p-2">
      <div className="text-[10px] uppercase text-[var(--ps-text-dim)]">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix,
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  suffix?: string
}) {
  const actualStep = step ?? 1
  const [draft, setDraft] = React.useState(() => formatSliderValue(value, actualStep))
  const display = formatSliderValue(value, actualStep)

  React.useEffect(() => {
    setDraft(formatSliderValue(value, actualStep))
  }, [value, actualStep])

  const commitDraft = React.useCallback(() => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(display)
      return
    }
    const next = snapToStep(Math.max(min, Math.min(max, parsed)), min, actualStep)
    onChange(next)
    setDraft(formatSliderValue(next, actualStep))
  }, [actualStep, display, draft, max, min, onChange])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="text-[var(--ps-text-dim)]">{label}</span>
        <span className="tabular-nums">{display}{suffix ? suffix : ""}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2">
        <Slider min={min} max={max} step={actualStep} value={[value]} onValueChange={(v) => onChange(v[0])} className="min-w-0" />
        <input
          aria-label={`${label} value`}
          type="number"
          min={min}
          max={max}
          step={actualStep}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          className="h-7 w-[4.75rem] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 text-right text-[11px] tabular-nums text-[var(--ps-text)]"
        />
      </div>
    </div>
  )
}

export function formatSliderValue(value: number, step: number) {
  const digits = decimalsForStep(step)
  const rounded = digits > 0 ? value.toFixed(digits) : Math.round(value).toString()
  const trimmed = rounded.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
  return trimmed === "-0" ? "0" : trimmed
}

export function decimalsForStep(step: number) {
  if (!Number.isFinite(step) || step >= 1) return 0
  const text = step.toString()
  if (text.includes("e-")) return Number(text.split("e-")[1]) || 0
  return text.split(".")[1]?.length ?? 0
}

export function snapToStep(value: number, min: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return value
  const digits = decimalsForStep(step)
  const snapped = min + Math.round((value - min) / step) * step
  return Number(snapped.toFixed(digits))
}

export function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 text-[11px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  )
}

export function ColorTargetRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: { r: number; g: number; b: number }
  onChange: (rgb: { r: number; g: number; b: number }) => void
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input
        type="color"
        value={rgbToHex(value.r, value.g, value.b)}
        onChange={(e) => onChange(hexToRgb(e.target.value))}
        className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-transparent"
      />
    </label>
  )
}

/* Re-exports of context types used by the dialogs (kept here to avoid a
 * second public surface — these are only imported by menu-bar.tsx). */
export type { AutoAlgorithm } from "@/editor/filters"
