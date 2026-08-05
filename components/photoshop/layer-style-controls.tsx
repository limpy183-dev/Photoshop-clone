"use client"

/**
 * Form rows shared across the Layer Style dialog's effect sections — colour,
 * slider, select, checkbox, blend mode and contour. Presentation only, so the
 * dialog and the blend-if / gradient sections can all pull from here without
 * importing each other.
 */

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { BlendMode } from "@/editor/types"
import { titleCaseBlend } from "@/editor/document/layer-style-helpers"
/** Blend modes offered on layer effects — deliberately narrower than the layer
 *  blend menu, which is why this is not `BLEND_MODE_OPTIONS`. */
const BLEND_OPTIONS: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

const CONTOURS = ["linear", "soft", "sharp", "ring", "cone"] as const

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3">{children}</div>
}

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px]">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-[11px] h-8" />
      </div>
    </div>
  )
}

export function SliderRow({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const rounded = Math.round(value)
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <span className="text-[11px] tabular-nums text-[var(--ps-text-dim)]">
          {rounded}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={rounded}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

export function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px]">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([id, label]) => (
            <SelectItem key={id} value={id}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="h-3.5 w-3.5" />
      {label}
    </label>
  )
}

export function BlendModeRow({
  label = "Blend Mode",
  value,
  onChange,
}: {
  label?: string
  value: BlendMode
  onChange: (v: BlendMode) => void
}) {
  return (
    <SelectRow
      label={label}
      value={value}
      options={BLEND_OPTIONS.map((b) => [b, titleCaseBlend(b)])}
      onChange={(v) => onChange(v as BlendMode)}
    />
  )
}

export function ContourRow({
  value,
  onChange,
}: {
  value: (typeof CONTOURS)[number]
  onChange: (v: (typeof CONTOURS)[number]) => void
}) {
  return (
    <SelectRow
      label="Contour"
      value={value}
      options={CONTOURS.map((contour) => [contour, titleCaseBlend(contour)])}
      onChange={(v) => onChange(v as (typeof CONTOURS)[number])}
    />
  )
}
