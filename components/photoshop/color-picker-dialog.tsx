"use client"

import * as React from "react"
import { Check, ChevronRight, CopyPlus, Pipette, Plus, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEditor } from "./editor-context"
import {
  buildColorHarmony,
  cmykFieldsToRgb,
  describePickerColor,
  hsbToRgb,
  labFieldsToRgb,
  normalizeWebColor,
  type ColorHarmonyRule,
  type HsbColor,
  type PickerColorDescription,
} from "./color-picker-model"
import { captureSwatch } from "./swatches-store"

export type ColorPickerTarget = "foreground" | "background"

const HARMONY_RULES: Array<{ id: ColorHarmonyRule; label: string }> = [
  { id: "complementary", label: "Complementary" },
  { id: "analogous", label: "Analogous" },
  { id: "triadic", label: "Triadic" },
  { id: "split-complementary", label: "Split complementary" },
  { id: "tetradic", label: "Tetradic" },
  { id: "monochrome", label: "Monochrome" },
]

function targetLabel(target: ColorPickerTarget) {
  return target === "foreground" ? "Foreground" : "Background"
}

function colorForTarget(target: ColorPickerTarget, foreground: string, background: string) {
  return target === "foreground" ? foreground : background
}

function actionForTarget(target: ColorPickerTarget, color: string) {
  return target === "foreground"
    ? ({ type: "set-foreground", color } as const)
    : ({ type: "set-background", color } as const)
}

function usePickerColor(target: ColorPickerTarget, open: boolean, live = false) {
  const { foreground, background, dispatch } = useEditor()
  const current = colorForTarget(target, foreground, background)
  const [hex, setHex] = React.useState(() => normalizeWebColor(current))
  const [webDraft, setWebDraft] = React.useState(() => normalizeWebColor(current))

  React.useEffect(() => {
    if (!open) return
    const next = normalizeWebColor(current)
    setHex(next)
    setWebDraft(next)
  }, [current, open])

  const setColor = React.useCallback(
    (next: string) => {
      const normalized = normalizeWebColor(next, hex)
      setHex(normalized)
      setWebDraft(normalized)
      if (live) dispatch(actionForTarget(target, normalized))
    },
    [dispatch, hex, live, target],
  )

  const setFromRgb = React.useCallback(
    (rgb: { r: number; g: number; b: number }) => {
      setColor(describePickerColor(rgb).web)
    },
    [setColor],
  )

  const description = React.useMemo(() => describePickerColor(hex), [hex])

  return {
    hex,
    webDraft,
    setWebDraft,
    description,
    setColor,
    setFromRgb,
    commit: () => dispatch(actionForTarget(target, hex)),
  }
}

export function ColorPickerDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ColorPickerTarget
}) {
  const { activeDoc } = useEditor()
  const picker = usePickerColor(target, open)
  const [harmonyRule, setHarmonyRule] = React.useState<ColorHarmonyRule>("complementary")
  const [captureOpen, setCaptureOpen] = React.useState(false)
  const [swatchName, setSwatchName] = React.useState("")
  const [swatchGroup, setSwatchGroup] = React.useState("Captured")
  const [captureStatus, setCaptureStatus] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setCaptureOpen(false)
    setSwatchName("")
    setSwatchGroup("Captured")
    setCaptureStatus("")
  }, [open, target])

  const saveSwatch = () => {
    const name = swatchName.trim()
    const group = swatchGroup.trim()
    captureSwatch(
      {
        color: picker.description.web,
        name: name || undefined,
        group: group || "Captured",
      },
      activeDoc?.id,
    )
    setCaptureStatus(`Captured ${name || picker.description.web}`)
    setCaptureOpen(false)
  }

  const applyAndClose = () => {
    picker.commit()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-32px))] max-w-[880px] overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)] shadow-2xl">
        <DialogHeader className="border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold">
            <Pipette className="h-4 w-4 text-[var(--ps-accent)]" />
            Color Picker
          </DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            {targetLabel(target)} color
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[minmax(260px,1fr)_340px] gap-4 overflow-y-auto p-4 max-md:grid-cols-1">
          <div className="min-w-0 space-y-3">
            <ColorSpectrum
              description={picker.description}
              onChange={picker.setFromRgb}
              squareLabel="Saturation and brightness"
            />
            <PreviewStrip
              target={target}
              description={picker.description}
            />
            <HarmonyPicker
              value={harmonyRule}
              onChange={setHarmonyRule}
              color={picker.description.web}
              onPick={picker.setColor}
            />
          </div>

          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <FieldGroup title="HSB">
                <NumberField label="HSB hue" shortLabel="H" value={picker.description.hsb.h} min={0} max={360} onChange={(value) => picker.setFromRgb(hsbToRgb({ ...picker.description.hsb, h: value }))} />
                <NumberField label="HSB saturation" shortLabel="S" suffix="%" value={picker.description.hsb.s} min={0} max={100} onChange={(value) => picker.setFromRgb(hsbToRgb({ ...picker.description.hsb, s: value }))} />
                <NumberField label="HSB brightness" shortLabel="B" suffix="%" value={picker.description.hsb.b} min={0} max={100} onChange={(value) => picker.setFromRgb(hsbToRgb({ ...picker.description.hsb, b: value }))} />
              </FieldGroup>

              <FieldGroup title="RGB">
                <NumberField label="RGB red" shortLabel="R" value={picker.description.rgb.r} min={0} max={255} onChange={(value) => picker.setFromRgb({ ...picker.description.rgb, r: value })} />
                <NumberField label="RGB green" shortLabel="G" value={picker.description.rgb.g} min={0} max={255} onChange={(value) => picker.setFromRgb({ ...picker.description.rgb, g: value })} />
                <NumberField label="RGB blue" shortLabel="B" value={picker.description.rgb.b} min={0} max={255} onChange={(value) => picker.setFromRgb({ ...picker.description.rgb, b: value })} />
              </FieldGroup>

              <FieldGroup title="Lab">
                <NumberField label="Lab lightness" shortLabel="L" value={picker.description.lab.l} min={0} max={100} onChange={(value) => picker.setFromRgb(labFieldsToRgb({ ...picker.description.lab, l: value }))} />
                <NumberField label="Lab a" shortLabel="a" value={picker.description.lab.a} min={-128} max={127} onChange={(value) => picker.setFromRgb(labFieldsToRgb({ ...picker.description.lab, a: value }))} />
                <NumberField label="Lab b" shortLabel="b" value={picker.description.lab.b} min={-128} max={127} onChange={(value) => picker.setFromRgb(labFieldsToRgb({ ...picker.description.lab, b: value }))} />
              </FieldGroup>

              <FieldGroup title="CMYK">
                <NumberField label="CMYK cyan" shortLabel="C" suffix="%" value={picker.description.cmyk.c} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, c: value }))} />
                <NumberField label="CMYK magenta" shortLabel="M" suffix="%" value={picker.description.cmyk.m} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, m: value }))} />
                <NumberField label="CMYK yellow" shortLabel="Y" suffix="%" value={picker.description.cmyk.y} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, y: value }))} />
                <NumberField label="CMYK black" shortLabel="K" suffix="%" value={picker.description.cmyk.k} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, k: value }))} />
              </FieldGroup>
            </div>

            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
              <label className="mb-1 block text-[10px] font-medium uppercase text-[var(--ps-text-dim)]" htmlFor="web-color-field">
                Web
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="web-color-field"
                  aria-label="Web color"
                  value={picker.webDraft}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    picker.setWebDraft(value)
                    if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim())) {
                      picker.setColor(value)
                    }
                  }}
                  onBlur={() => picker.setColor(picker.webDraft)}
                  className="h-8 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 font-mono text-[12px] uppercase outline-none focus:border-[var(--ps-accent)]"
                />
                <div
                  aria-hidden="true"
                  className="h-8 w-12 rounded-sm border border-[var(--ps-divider)]"
                  style={{ background: picker.description.web }}
                />
              </div>
            </div>

            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium">Swatch capture</div>
                  <div className="text-[10px] text-[var(--ps-text-dim)]">Save the active color into the Swatches panel.</div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[11px] hover:bg-[var(--ps-tool-hover)]"
                  onClick={() => setCaptureOpen((value) => !value)}
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  Capture swatch
                </button>
              </div>
              {captureOpen ? (
                <div className="grid gap-2">
                  <input
                    aria-label="Swatch name"
                    value={swatchName}
                    onChange={(event) => setSwatchName(event.currentTarget.value)}
                    placeholder={picker.description.web.toUpperCase()}
                    className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px] outline-none focus:border-[var(--ps-accent)]"
                  />
                  <div className="flex gap-2">
                    <input
                      aria-label="Swatch group"
                      value={swatchGroup}
                      onChange={(event) => setSwatchGroup(event.currentTarget.value)}
                      className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px] outline-none focus:border-[var(--ps-accent)]"
                    />
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-sm bg-[var(--ps-accent)] px-2 text-[11px] text-white hover:brightness-110"
                      onClick={saveSwatch}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save swatch
                    </button>
                  </div>
                </div>
              ) : null}
              {captureStatus ? <div className="mt-2 text-[10px] text-[var(--ps-accent-2)]">{captureStatus}</div> : null}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={applyAndClose}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ColorPickerHud({
  open,
  onOpenChange,
  onOpenFull,
  target,
  position,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenFull: () => void
  target: ColorPickerTarget
  position: { x: number; y: number }
}) {
  const { activeDoc } = useEditor()
  const picker = usePickerColor(target, open, true)
  const [harmonyRule, setHarmonyRule] = React.useState<ColorHarmonyRule>("analogous")

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onOpenChange, open])

  if (!open) return null

  const left = Math.max(8, Math.min(position.x, typeof window === "undefined" ? position.x : window.innerWidth - 336))
  const top = Math.max(44, Math.min(position.y, typeof window === "undefined" ? position.y : window.innerHeight - 482))

  return (
    <div
      role="dialog"
      aria-label="HUD Color Picker"
      aria-modal="false"
      className="fixed z-[1100] w-[328px] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)] shadow-2xl"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="flex h-9 items-center gap-2 border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-2">
        <Pipette className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
        <div className="min-w-0 flex-1 text-[11px] font-medium">
          HUD Color Picker
          <span className="ml-1 text-[10px] font-normal text-[var(--ps-text-dim)]">{targetLabel(target)}</span>
        </div>
        <button
          type="button"
          aria-label="Close HUD color picker"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-3 p-3">
        <ColorSpectrum
          compact
          description={picker.description}
          onChange={picker.setFromRgb}
          squareLabel="HUD saturation and brightness"
        />
        <div className="flex items-center gap-2">
          <input
            aria-label="HUD Web color"
            value={picker.webDraft}
            onChange={(event) => {
              const value = event.currentTarget.value
              picker.setWebDraft(value)
              if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim())) picker.setColor(value)
            }}
            onBlur={() => picker.setColor(picker.webDraft)}
            className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 font-mono text-[11px] uppercase outline-none focus:border-[var(--ps-accent)]"
          />
          <button
            type="button"
            aria-label="Capture HUD swatch"
            title="Capture current HUD color"
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]"
            onClick={() => captureSwatch({ color: picker.description.web, group: "HUD" }, activeDoc?.id)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <HarmonyPicker
          compact
          value={harmonyRule}
          onChange={setHarmonyRule}
          color={picker.description.web}
          onPick={picker.setColor}
        />
        <div className="flex items-center justify-between border-t border-[var(--ps-divider)] pt-2">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[11px] hover:bg-[var(--ps-tool-hover)]"
            onClick={onOpenFull}
          >
            Open full color picker
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="h-7 rounded-sm bg-[var(--ps-accent)] px-3 text-[11px] text-white hover:brightness-110"
            onClick={() => onOpenChange(false)}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function ColorSpectrum({
  description,
  onChange,
  squareLabel,
  compact = false,
}: {
  description: PickerColorDescription
  onChange: (rgb: { r: number; g: number; b: number }) => void
  squareLabel: string
  compact?: boolean
}) {
  const squareRef = React.useRef<HTMLDivElement>(null)
  const hueRef = React.useRef<HTMLDivElement>(null)
  const hueColor = `hsl(${description.hsb.h}, 100%, 50%)`

  const updateHsb = React.useCallback(
    (patch: Partial<HsbColor>) => {
      onChange(hsbToRgb({ ...description.hsb, ...patch }))
    },
    [description.hsb, onChange],
  )

  const startSquareDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = squareRef.current
    if (!element) return
    element.setPointerCapture(event.pointerId)
    event.preventDefault()
    const update = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      updateHsb({ s: Math.round(x * 100), b: Math.round((1 - y) * 100) })
    }
    update(event.clientX, event.clientY)
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX, moveEvent.clientY)
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  const startHueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = hueRef.current
    if (!element) return
    element.setPointerCapture(event.pointerId)
    event.preventDefault()
    const update = (clientX: number) => {
      const rect = element.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      updateHsb({ h: Math.round(x * 360) })
    }
    update(event.clientX)
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  return (
    <div className="space-y-2">
      <div
        ref={squareRef}
        aria-label={squareLabel}
        onPointerDown={startSquareDrag}
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-sm border border-[var(--ps-divider)]"
        style={{
          height: compact ? 174 : 280,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
      >
        <div
          className="absolute h-4 w-4 rounded-full border-2 border-white pointer-events-none"
          style={{
            left: `calc(${description.hsb.s}% - 8px)`,
            top: `calc(${100 - description.hsb.b}% - 8px)`,
            background: description.web,
            boxShadow: "0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 1px rgba(0,0,0,.55)",
          }}
        />
      </div>
      <div
        ref={hueRef}
        aria-label="Hue"
        onPointerDown={startHueDrag}
        className="relative h-4 w-full cursor-pointer touch-none rounded-sm border border-[var(--ps-divider)]"
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 16.6%, #0f0 33.3%, #0ff 50%, #00f 66.6%, #f0f 83.3%, #f00 100%)",
        }}
      >
        <div
          className="absolute -top-0.5 -bottom-0.5 w-2 rounded-sm border border-black bg-white pointer-events-none"
          style={{ left: `calc(${(description.hsb.h / 360) * 100}% - 4px)` }}
        />
      </div>
    </div>
  )
}

function PreviewStrip({
  target,
  description,
}: {
  target: ColorPickerTarget
  description: PickerColorDescription
}) {
  const { foreground, background } = useEditor()
  const previous = target === "foreground" ? foreground : background
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-[var(--ps-divider)] text-[10px]">
      <div className="flex items-center gap-2 bg-[var(--ps-panel-2)] p-2">
        <div className="h-8 w-12 rounded-sm border border-[var(--ps-divider)]" style={{ background: previous }} />
        <div>
          <div className="text-[var(--ps-text-dim)]">Current</div>
          <div className="font-mono uppercase">{previous}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-[var(--ps-panel-2)] p-2">
        <div className="h-8 w-12 rounded-sm border border-[var(--ps-divider)]" style={{ background: description.web }} />
        <div>
          <div className="text-[var(--ps-text-dim)]">New</div>
          <div className="font-mono uppercase">{description.web}</div>
        </div>
      </div>
    </div>
  )
}

function HarmonyPicker({
  value,
  onChange,
  color,
  onPick,
  compact = false,
}: {
  value: ColorHarmonyRule
  onChange: (rule: ColorHarmonyRule) => void
  color: string
  onPick: (color: string) => void
  compact?: boolean
}) {
  const harmony = React.useMemo(() => buildColorHarmony(color, value), [color, value])
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <div className="mb-2 flex items-center gap-2">
        <label className="text-[10px] font-medium uppercase text-[var(--ps-text-dim)]" htmlFor={compact ? "hud-harmony-rule" : "dialog-harmony-rule"}>
          Harmony
        </label>
        <select
          id={compact ? "hud-harmony-rule" : "dialog-harmony-rule"}
          aria-label="Harmony rule"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value as ColorHarmonyRule)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[11px]"
        >
          {HARMONY_RULES.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.label}
            </option>
          ))}
        </select>
      </div>
      <div className={compact ? "grid grid-cols-4 gap-1" : "grid grid-cols-3 gap-1.5"}>
        {harmony.map((swatch) => (
          <button
            type="button"
            key={`${swatch.role}-${swatch.color}`}
            aria-label={`Use harmony ${swatch.role} ${swatch.color}`}
            title={`${swatch.role} ${swatch.color}`}
            onClick={() => onPick(swatch.color)}
            className="group min-w-0 overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-left hover:border-[var(--ps-accent)]"
          >
            <span className="block h-7" style={{ background: swatch.color }} />
            {!compact ? (
              <span className="block truncate px-1.5 py-1 text-[10px] text-[var(--ps-text-dim)] group-hover:text-[var(--ps-text)]">
                {swatch.role}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}

function FieldGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <legend className="px-1 text-[10px] font-medium uppercase text-[var(--ps-text-dim)]">{title}</legend>
      <div className="grid gap-1.5">{children}</div>
    </fieldset>
  )
}

function NumberField({
  label,
  shortLabel,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  shortLabel: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const commit = (input: string) => {
    const next = Number(input)
    if (!Number.isFinite(next)) return
    onChange(Math.max(min, Math.min(max, Math.round(next))))
  }

  return (
    <label className="grid grid-cols-[18px_1fr_auto] items-center gap-1 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{shortLabel}</span>
      <input
        aria-label={label}
        value={value}
        onChange={(event) => commit(event.currentTarget.value)}
        className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 text-right font-mono text-[11px] outline-none focus:border-[var(--ps-accent)]"
        inputMode="numeric"
      />
      <span className="w-4 text-[10px] text-[var(--ps-text-dim)]">{suffix}</span>
    </label>
  )
}
