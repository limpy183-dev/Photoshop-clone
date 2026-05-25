"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { buildIndexedColorTable, convertImageDataToDocumentMode } from "./color-mode-conversion"
import { useEditor } from "./editor-context"
import { renderDocumentComposite } from "./document-io"
import type { DocumentModeSettings, Layer } from "./types"

export type ColorModeDialogTarget = DocumentModeSettings["mode"] | "ColorTable"

const defaultSettings: Record<DocumentModeSettings["mode"], DocumentModeSettings> = {
  RGB: { mode: "RGB" },
  CMYK: { mode: "CMYK" },
  Grayscale: { mode: "Grayscale" },
  Multichannel: { mode: "Multichannel", multichannel: { channels: { r: true, g: true, b: true } } },
  Duotone: {
    mode: "Duotone",
    duotone: { ink1: "#111111", ink2: "#1f80ff", ink1Name: "Black", ink2Name: "Second Ink", curve: 1, opacity1: 100, opacity2: 70, balance: 1 },
  },
  Indexed: {
    mode: "Indexed",
    indexed: { colors: 64, dither: true, ditherMethod: "ordered", palette: "adaptive", transparency: true, matte: "#ffffff", forced: "none" },
  },
  Bitmap: {
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 10, angle: 45, shape: "round", outputResolution: 300 },
  },
}

export function ColorModeDialog({
  target,
  onOpenChange,
}: {
  target: ColorModeDialogTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const open = target !== null
  const mode = target === "ColorTable" ? "Indexed" : target
  const [settings, setSettings] = React.useState<DocumentModeSettings>(defaultSettings.Indexed)

  React.useEffect(() => {
    if (!mode) return
    const base = activeDoc?.modeSettings?.mode === mode ? activeDoc.modeSettings : defaultSettings[mode]
    setSettings(base)
  }, [activeDoc?.id, activeDoc?.modeSettings, mode])

  if (!mode || !activeDoc) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    )
  }

  const update = (patch: Partial<DocumentModeSettings>) => {
    setSettings((current) => ({ ...current, ...patch, mode }))
  }
  const updateDuotone = (patch: Partial<NonNullable<DocumentModeSettings["duotone"]>>) => {
    setSettings((current) => ({ ...current, mode, duotone: { ...(current.duotone ?? defaultSettings.Duotone.duotone!), ...patch } }))
  }
  const updateIndexed = (patch: Partial<NonNullable<DocumentModeSettings["indexed"]>>) => {
    setSettings((current) => ({ ...current, mode: "Indexed", indexed: { ...(current.indexed ?? defaultSettings.Indexed.indexed!), ...patch } }))
  }
  const updateBitmap = (patch: Partial<NonNullable<DocumentModeSettings["bitmap"]>>) => {
    setSettings((current) => ({ ...current, mode, bitmap: { ...(current.bitmap ?? defaultSettings.Bitmap.bitmap!), ...patch } }))
  }

  const buildTable = () => {
    const composite = renderDocumentComposite(activeDoc, { transparent: true })
    const image = composite.getContext("2d")!.getImageData(0, 0, composite.width, composite.height)
    updateIndexed({
      colorTable: buildIndexedColorTable(image, settings.indexed),
      palette: "custom",
    })
  }

  const previewMode = () => {
    dispatch({ type: "set-document-mode-settings", colorMode: settings.mode, settings })
    requestRender()
    window.setTimeout(() => commit(`Mode Preview: ${settings.mode}`, []), 0)
  }

  const convertLayer = (layer: Layer) => {
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return false
    const image = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    ctx.putImageData(convertImageDataToDocumentMode(image, settings), 0, 0)
    return true
  }

  const applyScope = (scope: "active" | "all") => {
    const layers = scope === "active" && activeLayer ? [activeLayer] : activeDoc.layers.filter((layer) => layer.kind !== "group")
    const changed: string[] = []
    for (const layer of layers) {
      if (layer.locked || layer.lockAll || !layer.canvas) continue
      if (convertLayer(layer)) changed.push(layer.id)
    }
    dispatch({ type: "set-document-mode-settings", colorMode: settings.mode, settings })
    requestRender()
    window.setTimeout(() => commit(`Apply ${settings.mode} Conversion`, changed.length ? changed : "all"), 0)
    onOpenChange(false)
  }

  const colorTable = settings.indexed?.colorTable ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>{target === "ColorTable" ? "Color Table" : `${mode} Options`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 text-[11px]">
          {mode === "Duotone" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ink 1 Name">
                <Input value={settings.duotone?.ink1Name ?? "Black"} onChange={(event) => updateDuotone({ ink1Name: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Ink 1">
                <Input type="color" value={settings.duotone?.ink1 ?? "#111111"} onChange={(event) => updateDuotone({ ink1: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Ink 2 Name">
                <Input value={settings.duotone?.ink2Name ?? "Second Ink"} onChange={(event) => updateDuotone({ ink2Name: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Ink 2">
                <Input type="color" value={settings.duotone?.ink2 ?? "#1f80ff"} onChange={(event) => updateDuotone({ ink2: event.target.value })} className={inputClass} />
              </Field>
              <NumberField label="Curve" value={settings.duotone?.curve ?? 1} min={0.1} max={5} step={0.1} onChange={(value) => updateDuotone({ curve: value })} />
              <NumberField label="Ink 1 %" value={settings.duotone?.opacity1 ?? 100} min={0} max={100} onChange={(value) => updateDuotone({ opacity1: value })} />
              <NumberField label="Ink 2 %" value={settings.duotone?.opacity2 ?? 70} min={0} max={100} onChange={(value) => updateDuotone({ opacity2: value })} />
              <NumberField label="Balance" value={settings.duotone?.balance ?? 1} min={0} max={1} step={0.05} onChange={(value) => updateDuotone({ balance: value })} />
            </div>
          ) : null}

          {mode === "Indexed" ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Palette">
                  <select value={settings.indexed?.palette ?? "adaptive"} onChange={(event) => updateIndexed({ palette: event.target.value as NonNullable<DocumentModeSettings["indexed"]>["palette"] })} className={selectClass}>
                    <option value="adaptive">Adaptive</option>
                    <option value="perceptual">Perceptual</option>
                    <option value="uniform">Uniform</option>
                    <option value="web">Web</option>
                    <option value="grayscale">Grayscale</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <NumberField label="Colors" value={settings.indexed?.colors ?? 64} min={2} max={256} onChange={(value) => updateIndexed({ colors: value })} />
                <Field label="Dither">
                  <select value={settings.indexed?.ditherMethod ?? (settings.indexed?.dither ? "ordered" : "none")} onChange={(event) => updateIndexed({ ditherMethod: event.target.value as NonNullable<DocumentModeSettings["indexed"]>["ditherMethod"], dither: event.target.value !== "none" })} className={selectClass}>
                    <option value="none">None</option>
                    <option value="ordered">Pattern</option>
                    <option value="diffusion">Diffusion</option>
                    <option value="noise">Noise</option>
                  </select>
                </Field>
                <Field label="Forced">
                  <select value={settings.indexed?.forced ?? "none"} onChange={(event) => updateIndexed({ forced: event.target.value as NonNullable<DocumentModeSettings["indexed"]>["forced"] })} className={selectClass}>
                    <option value="none">None</option>
                    <option value="black-white">Black and white</option>
                    <option value="primaries">Primaries</option>
                    <option value="web">Web colors</option>
                  </select>
                </Field>
                <Field label="Matte">
                  <Input type="color" value={settings.indexed?.matte ?? "#ffffff"} onChange={(event) => updateIndexed({ matte: event.target.value })} className={inputClass} />
                </Field>
                <label className="flex items-end gap-2 pb-2 text-[var(--ps-text-dim)]">
                  <input type="checkbox" checked={settings.indexed?.transparency ?? true} onChange={(event) => updateIndexed({ transparency: event.target.checked })} />
                  Transparency
                </label>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={buildTable}>Build Table</Button>
                <Button size="sm" variant="secondary" onClick={() => updateIndexed({ colorTable: grayscaleRamp(settings.indexed?.colors ?? 64), palette: "custom" })}>Gray Ramp</Button>
                <Button size="sm" variant="secondary" onClick={() => updateIndexed({ colorTable: [], palette: "adaptive" })}>Reset</Button>
              </div>
              <div className="grid grid-cols-8 gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                {(colorTable.length ? colorTable : grayscaleRamp(Math.min(32, settings.indexed?.colors ?? 32))).slice(0, 64).map((color, index) => (
                  <input
                    key={`${index}-${color}`}
                    aria-label={`Color ${index + 1}`}
                    type="color"
                    value={color}
                    onChange={(event) => {
                      const next = [...(colorTable.length ? colorTable : grayscaleRamp(settings.indexed?.colors ?? 64))]
                      next[index] = event.target.value
                      updateIndexed({ colorTable: next, palette: "custom" })
                    }}
                    className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-transparent p-0"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {mode === "Bitmap" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select value={settings.bitmap?.method ?? "halftone"} onChange={(event) => updateBitmap({ method: event.target.value as NonNullable<DocumentModeSettings["bitmap"]>["method"] })} className={selectClass}>
                  <option value="threshold">50% Threshold</option>
                  <option value="halftone">Halftone Screen</option>
                  <option value="pattern-dither">Pattern Dither</option>
                  <option value="diffusion-dither">Diffusion Dither</option>
                </select>
              </Field>
              <Field label="Shape">
                <select value={settings.bitmap?.shape ?? "round"} onChange={(event) => updateBitmap({ shape: event.target.value as NonNullable<DocumentModeSettings["bitmap"]>["shape"] })} className={selectClass}>
                  <option value="round">Round</option>
                  <option value="line">Line</option>
                  <option value="diamond">Diamond</option>
                  <option value="ellipse">Ellipse</option>
                </select>
              </Field>
              <NumberField label="Threshold" value={settings.bitmap?.threshold ?? 128} min={0} max={255} onChange={(value) => updateBitmap({ threshold: value })} />
              <NumberField label="Frequency" value={settings.bitmap?.frequency ?? 10} min={1} max={120} onChange={(value) => updateBitmap({ frequency: value })} />
              <NumberField label="Angle" value={settings.bitmap?.angle ?? 45} min={-180} max={180} onChange={(value) => updateBitmap({ angle: value })} />
              <NumberField label="Output PPI" value={settings.bitmap?.outputResolution ?? 300} min={1} max={2400} onChange={(value) => updateBitmap({ outputResolution: value })} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" onClick={previewMode}>Preview Mode</Button>
          <Button variant="secondary" disabled={!activeLayer} onClick={() => applyScope("active")}>Apply Layer</Button>
          <Button onClick={() => applyScope("all")}>Apply Document</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function grayscaleRamp(colors: number) {
  const count = Math.max(2, Math.min(256, Math.round(colors)))
  return Array.from({ length: count }, (_, index) => {
    const v = Math.round((index / Math.max(1, count - 1)) * 255)
    return `#${[v, v, v].map((value) => value.toString(16).padStart(2, "0")).join("")}`
  })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-[var(--ps-text-dim)]">{label}</Label>
      {children}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))}
        className={inputClass}
      />
    </Field>
  )
}

const inputClass = "h-8 rounded-sm border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[11px]"
const selectClass = "h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none"
