"use client"

import * as React from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  buildIndexedColorTable,
  convertImageDataToDocumentMode,
  defaultDuotoneCurve,
  DUOTONE_PRESETS,
  sampleDuotoneCurve,
} from "./color-mode-conversion"
import { useActiveDocument, useActiveLayer, useEditorCommands } from "./editor-context"
import { downloadBlob, renderDocumentComposite } from "./document-io"
import type { DocumentModeSettings, Layer } from "./types"

export type ColorModeDialogTarget = DocumentModeSettings["mode"] | "ColorTable"

const defaultSettings: Record<DocumentModeSettings["mode"], DocumentModeSettings> = {
  RGB: { mode: "RGB" },
  CMYK: { mode: "CMYK" },
  Grayscale: { mode: "Grayscale" },
  Multichannel: { mode: "Multichannel", multichannel: { channels: { r: true, g: true, b: true } } },
  Duotone: {
    mode: "Duotone",
    duotone: {
      inkCount: 2,
      ink1: "#111111",
      ink2: "#1f80ff",
      ink1Name: "Black",
      ink2Name: "Second Ink",
      paper: "#ffffff",
      overprint: "normal",
      curve: 1,
      opacity1: 100,
      opacity2: 70,
      balance: 1,
      curves: { ink1: defaultDuotoneCurve(), ink2: defaultDuotoneCurve() },
    },
  },
  Indexed: {
    mode: "Indexed",
    indexed: {
      colors: 64,
      dither: true,
      ditherMethod: "ordered",
      ditherAmount: 75,
      palette: "adaptive",
      transparency: true,
      matte: "#ffffff",
      forced: "none",
      preserveExact: false,
    },
  },
  Bitmap: {
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 10, angle: 45, shape: "round", inputResolution: 300, outputResolution: 300 },
  },
}

function hydratedModeSettings(settings: DocumentModeSettings, docDpi = 300): DocumentModeSettings {
  if (settings.mode === "Bitmap") {
    return {
      ...settings,
      bitmap: {
        ...defaultSettings.Bitmap.bitmap!,
        ...(settings.bitmap ?? {}),
        inputResolution: settings.bitmap?.inputResolution ?? docDpi,
        outputResolution: settings.bitmap?.outputResolution ?? docDpi,
      },
    }
  }
  if (settings.mode === "Duotone") {
    return {
      ...settings,
      duotone: {
        ...defaultSettings.Duotone.duotone!,
        ...(settings.duotone ?? defaultSettings.Duotone.duotone!),
      },
    }
  }
  return settings
}

function bitmapDocumentDpi(settings: DocumentModeSettings) {
  const dpi = settings.mode === "Bitmap" ? settings.bitmap?.outputResolution : undefined
  return typeof dpi === "number" && Number.isFinite(dpi) ? dpi : undefined
}

export function ColorModeDialog({
  target,
  onOpenChange,
}: {
  target: ColorModeDialogTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const activeDoc = useActiveDocument()
  const activeLayer = useActiveLayer()
  const { dispatch, commit, requestRender } = useEditorCommands()
  const open = target !== null
  const mode = target === "ColorTable" ? "Indexed" : target
  const isColorTable = target === "ColorTable"
  const [settings, setSettings] = React.useState<DocumentModeSettings>(defaultSettings.Indexed)
  const importInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!mode) return
    const base = activeDoc?.modeSettings?.mode === mode ? activeDoc.modeSettings : defaultSettings[mode]
    setSettings(hydratedModeSettings(base, activeDoc?.dpi ?? 300))
  }, [activeDoc?.dpi, activeDoc?.id, activeDoc?.modeSettings, mode])

  if (!mode || !activeDoc) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    )
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
    dispatch({ type: "set-document-mode-settings", colorMode: settings.mode, settings, dpi: bitmapDocumentDpi(settings) })
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
    dispatch({ type: "set-document-mode-settings", colorMode: settings.mode, settings, dpi: bitmapDocumentDpi(settings) })
    requestRender()
    window.setTimeout(() => commit(`Apply ${settings.mode} Conversion`, changed.length ? changed : "all"), 0)
    onOpenChange(false)
  }

  const colorTable = settings.indexed?.colorTable ?? []
  const bitmapSettings = settings.bitmap ?? defaultSettings.Bitmap.bitmap!

  // ----- Color Table (.act) load/save -------------------------------------------------------
  const exportActTable = () => {
    const table = colorTable.length ? colorTable : buildIndexedColorTable(
      renderDocumentComposite(activeDoc, { transparent: true }).getContext("2d")!.getImageData(0, 0, activeDoc.width, activeDoc.height),
      settings.indexed,
    )
    // .act is 768 bytes (256 RGB triplets) optionally followed by 4-byte trailer (count BE, transparent index BE).
    const buf = new Uint8Array(772)
    for (let i = 0; i < 256; i++) {
      const hex = table[i] ?? "#000000"
      const r = parseInt(hex.slice(1, 3), 16) || 0
      const g = parseInt(hex.slice(3, 5), 16) || 0
      const b = parseInt(hex.slice(5, 7), 16) || 0
      buf[i * 3] = r
      buf[i * 3 + 1] = g
      buf[i * 3 + 2] = b
    }
    const count = Math.min(256, table.length || 256)
    buf[768] = (count >> 8) & 0xff
    buf[769] = count & 0xff
    buf[770] = 0xff
    buf[771] = 0xff
    downloadBlob(new Blob([buf], { type: "application/octet-stream" }), `${activeDoc.name || "color-table"}.act`)
  }

  const importActTable = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length < 768) {
        toast.error("Not a valid .act color table (must be at least 768 bytes)")
        return
      }
      let count = 256
      if (bytes.length >= 770) {
        const declared = (bytes[768] << 8) | bytes[769]
        if (declared > 0 && declared <= 256) count = declared
      }
      const out: string[] = []
      for (let i = 0; i < count; i++) {
        const r = bytes[i * 3]
        const g = bytes[i * 3 + 1]
        const b = bytes[i * 3 + 2]
        out.push(`#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`)
      }
      updateIndexed({ colorTable: out, palette: "custom" })
      toast.success(`Loaded ${out.length} colors from ${file.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to read .act file")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>{isColorTable ? "Color Table" : `${mode} Options`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 text-[11px]">
          {/* ------------- DUOTONE ------------- */}
          {mode === "Duotone" && !isColorTable ? (
            <DuotonePanel
              duotone={settings.duotone ?? defaultSettings.Duotone.duotone!}
              update={updateDuotone}
              applyPreset={(key) => {
                const preset = DUOTONE_PRESETS[key]
                if (preset) updateDuotone({ ...preset, preset: key })
              }}
            />
          ) : null}

          {/* ------------- INDEXED (full options) ------------- */}
          {mode === "Indexed" && !isColorTable ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Palette">
                  <select value={settings.indexed?.palette ?? "adaptive"} onChange={(event) => updateIndexed({ palette: event.target.value as NonNullable<DocumentModeSettings["indexed"]>["palette"] })} className={selectClass}>
                    <option value="exact">Exact</option>
                    <option value="system">System (Win 16)</option>
                    <option value="web">Web</option>
                    <option value="uniform">Uniform</option>
                    <option value="perceptual">Perceptual</option>
                    <option value="selective">Selective</option>
                    <option value="adaptive">Adaptive</option>
                    <option value="grayscale">Grayscale</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <NumberField label="Colors" value={settings.indexed?.colors ?? 64} min={2} max={256} onChange={(value) => updateIndexed({ colors: value })} />
                <Field label="Dither">
                  <select
                    value={settings.indexed?.ditherMethod ?? (settings.indexed?.dither ? "ordered" : "none")}
                    onChange={(event) => updateIndexed({ ditherMethod: event.target.value as NonNullable<DocumentModeSettings["indexed"]>["ditherMethod"], dither: event.target.value !== "none" })}
                    className={selectClass}
                  >
                    <option value="none">None</option>
                    <option value="ordered">Pattern</option>
                    <option value="diffusion">Diffusion</option>
                    <option value="noise">Noise</option>
                  </select>
                </Field>
                <NumberField
                  label="Dither %"
                  value={settings.indexed?.ditherAmount ?? 75}
                  min={0}
                  max={100}
                  onChange={(value) => updateIndexed({ ditherAmount: value })}
                />
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
                <label className="flex items-end gap-2 pb-2 text-[var(--ps-text-dim)]">
                  <input type="checkbox" checked={settings.indexed?.preserveExact ?? false} onChange={(event) => updateIndexed({ preserveExact: event.target.checked })} />
                  Preserve exact colors
                </label>
              </div>
              <ColorTableEditor
                table={colorTable}
                onChange={(next) => updateIndexed({ colorTable: next, palette: "custom" })}
                onBuild={buildTable}
                onReset={() => updateIndexed({ colorTable: [], palette: "adaptive" })}
                onImport={() => importInputRef.current?.click()}
                onExport={exportActTable}
              />
              <input
                ref={importInputRef}
                type="file"
                accept=".act,application/octet-stream"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importActTable(file)
                  event.target.value = ""
                }}
              />
            </div>
          ) : null}

          {/* ------------- COLOR TABLE (dedicated) ------------- */}
          {isColorTable ? (
            <div className="grid gap-3">
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[var(--ps-text-dim)]">
                Edit the indexed color table. Click any swatch to change its color. .act files store 256 sRGB triplets and may
                include a count + transparent-index trailer.
              </div>
              <ColorTableEditor
                table={colorTable}
                onChange={(next) => updateIndexed({ colorTable: next, palette: "custom" })}
                onBuild={buildTable}
                onReset={() => updateIndexed({ colorTable: [], palette: "adaptive" })}
                onImport={() => importInputRef.current?.click()}
                onExport={exportActTable}
              />
              <input
                ref={importInputRef}
                type="file"
                accept=".act,application/octet-stream"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importActTable(file)
                  event.target.value = ""
                }}
              />
            </div>
          ) : null}

          {/* ------------- BITMAP ------------- */}
          {mode === "Bitmap" && !isColorTable ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Method">
                <select value={bitmapSettings.method} onChange={(event) => updateBitmap({ method: event.target.value as NonNullable<DocumentModeSettings["bitmap"]>["method"] })} className={selectClass}>
                  <option value="threshold">50% Threshold</option>
                  <option value="halftone">Halftone Screen</option>
                  <option value="pattern-dither">Pattern Dither</option>
                  <option value="diffusion-dither">Diffusion Dither</option>
                </select>
              </Field>
              <NumberField label="Input PPI" value={bitmapSettings.inputResolution ?? activeDoc.dpi ?? 300} min={1} max={2400} onChange={(value) => updateBitmap({ inputResolution: value })} />
              <NumberField label="Output PPI" value={bitmapSettings.outputResolution ?? activeDoc.dpi ?? 300} min={1} max={2400} onChange={(value) => updateBitmap({ outputResolution: value })} />
              <NumberField label="Threshold" value={bitmapSettings.threshold} min={0} max={255} onChange={(value) => updateBitmap({ threshold: value })} />
              {bitmapSettings.method === "halftone" ? (
                <>
                  <NumberField label="Frequency" value={bitmapSettings.frequency} min={1} max={200} onChange={(value) => updateBitmap({ frequency: value })} />
                  <NumberField label="Angle" value={bitmapSettings.angle} min={-180} max={180} onChange={(value) => updateBitmap({ angle: value })} />
                  <Field label="Shape">
                    <select value={bitmapSettings.shape ?? "round"} onChange={(event) => updateBitmap({ shape: event.target.value as NonNullable<DocumentModeSettings["bitmap"]>["shape"] })} className={selectClass}>
                      <option value="round">Round</option>
                      <option value="line">Line</option>
                      <option value="diamond">Diamond</option>
                      <option value="ellipse">Ellipse</option>
                      <option value="square">Square</option>
                      <option value="cross">Cross</option>
                    </select>
                  </Field>
                </>
              ) : null}
            </div>
          ) : null}

          {/* ------------- Live preview thumbs (Duotone / Indexed / Bitmap) ------------- */}
          {!isColorTable && (mode === "Duotone" || mode === "Indexed" || mode === "Bitmap") ? (
            <ModePreview settings={settings} />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {isColorTable ? (
            <Button onClick={() => { dispatch({ type: "set-document-mode-settings", colorMode: "Indexed", settings }); requestRender(); window.setTimeout(() => commit("Update Color Table", []), 0); onOpenChange(false) }}>OK</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={previewMode}>Preview Mode</Button>
              <Button variant="secondary" disabled={!activeLayer} onClick={() => applyScope("active")}>Apply Layer</Button>
              <Button onClick={() => applyScope("all")}>Apply Document</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Reusable subcomponents                                              */
/* ------------------------------------------------------------------ */

function ColorTableEditor({
  table,
  onChange,
  onBuild,
  onReset,
  onImport,
  onExport,
}: {
  table: string[]
  onChange: (next: string[]) => void
  onBuild: () => void
  onReset: () => void
  onImport: () => void
  onExport: () => void
}) {
  const swatches = table.length ? table : Array.from({ length: 64 }, (_, i) => {
    const v = Math.round((i / 63) * 255)
    return `#${[v, v, v].map((value) => value.toString(16).padStart(2, "0")).join("")}`
  })
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onBuild}>Build Table</Button>
        <Button size="sm" variant="secondary" onClick={onReset}>Reset</Button>
        <Button size="sm" variant="outline" onClick={onImport}>Load .act</Button>
        <Button size="sm" variant="outline" onClick={onExport}>Save .act</Button>
        <span className="ml-auto self-center text-[var(--ps-text-dim)]">{swatches.length} colors</span>
      </div>
      <div className="grid max-h-48 grid-cols-16 gap-1 overflow-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
        {swatches.slice(0, 256).map((color, index) => (
          <input
            key={`${index}-${color}`}
            aria-label={`Color ${index + 1}`}
            type="color"
            value={color}
            onChange={(event) => {
              const next = [...swatches]
              next[index] = event.target.value
              onChange(next)
            }}
            className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-transparent p-0"
            title={`#${color.slice(1)}`}
          />
        ))}
      </div>
    </div>
  )
}

function DuotonePanel({
  duotone,
  update,
  applyPreset,
}: {
  duotone: NonNullable<DocumentModeSettings["duotone"]>
  update: (patch: Partial<NonNullable<DocumentModeSettings["duotone"]>>) => void
  applyPreset: (key: string) => void
}) {
  const inkCount: 1 | 2 | 3 | 4 = (duotone.inkCount ?? 2)
  const inks = [
    { color: duotone.ink1 ?? "#111111", name: duotone.ink1Name ?? "Black", opacity: duotone.opacity1 ?? 100, curve: duotone.curves?.ink1 ?? defaultDuotoneCurve(), setColor: (v: string) => update({ ink1: v }), setName: (v: string) => update({ ink1Name: v }), setOpacity: (v: number) => update({ opacity1: v }), setCurve: (curve: number[]) => update({ curves: { ...(duotone.curves ?? {}), ink1: curve } }) },
    { color: duotone.ink2 ?? "#1f80ff", name: duotone.ink2Name ?? "Second", opacity: duotone.opacity2 ?? 70, curve: duotone.curves?.ink2 ?? defaultDuotoneCurve(), setColor: (v: string) => update({ ink2: v }), setName: (v: string) => update({ ink2Name: v }), setOpacity: (v: number) => update({ opacity2: v }), setCurve: (curve: number[]) => update({ curves: { ...(duotone.curves ?? {}), ink2: curve } }) },
    { color: duotone.ink3 ?? "#d9534f", name: duotone.ink3Name ?? "Third", opacity: duotone.opacity3 ?? 50, curve: duotone.curves?.ink3 ?? defaultDuotoneCurve(), setColor: (v: string) => update({ ink3: v }), setName: (v: string) => update({ ink3Name: v }), setOpacity: (v: number) => update({ opacity3: v }), setCurve: (curve: number[]) => update({ curves: { ...(duotone.curves ?? {}), ink3: curve } }) },
    { color: duotone.ink4 ?? "#f0ad4e", name: duotone.ink4Name ?? "Fourth", opacity: duotone.opacity4 ?? 35, curve: duotone.curves?.ink4 ?? defaultDuotoneCurve(), setColor: (v: string) => update({ ink4: v }), setName: (v: string) => update({ ink4Name: v }), setOpacity: (v: number) => update({ opacity4: v }), setCurve: (curve: number[]) => update({ curves: { ...(duotone.curves ?? {}), ink4: curve } }) },
  ]
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-5 gap-3">
        <Field label="Type">
          <select value={String(inkCount)} onChange={(event) => update({ inkCount: Number(event.target.value) as 1 | 2 | 3 | 4 })} className={selectClass}>
            <option value="1">Monotone</option>
            <option value="2">Duotone</option>
            <option value="3">Tritone</option>
            <option value="4">Quadtone</option>
          </select>
        </Field>
        <Field label="Preset">
          <select
            value={duotone.preset ?? ""}
            onChange={(event) => { if (event.target.value) applyPreset(event.target.value) }}
            className={selectClass}
          >
            <option value="">(Choose preset...)</option>
            {Object.keys(DUOTONE_PRESETS).map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
        </Field>
        <Field label="Paper">
          <Input type="color" value={duotone.paper ?? "#ffffff"} onChange={(event) => update({ paper: event.target.value })} className={inputClass} />
        </Field>
        <Field label="Overprint">
          <select value={duotone.overprint ?? "normal"} onChange={(event) => update({ overprint: event.target.value as NonNullable<DocumentModeSettings["duotone"]>["overprint"] })} className={selectClass}>
            <option value="normal">Normal</option>
            <option value="multiply">Multiply</option>
          </select>
        </Field>
        <NumberField label="Balance" value={duotone.balance ?? 1} min={0} max={1} step={0.05} onChange={(value) => update({ balance: value })} />
      </div>
      <div className="grid gap-2">
        {inks.slice(0, inkCount).map((ink, index) => (
          <InkRow key={index} index={index} ink={ink} />
        ))}
      </div>
    </div>
  )
}

function InkRow({ index, ink }: {
  index: number
  ink: {
    color: string
    name: string
    opacity: number
    curve: number[]
    setColor: (v: string) => void
    setName: (v: string) => void
    setOpacity: (v: number) => void
    setCurve: (v: number[]) => void
  }
}) {
  return (
    <div className="grid grid-cols-[110px_60px_1fr_72px_120px] items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <Input value={ink.name} onChange={(event) => ink.setName(event.target.value)} placeholder={`Ink ${index + 1}`} className={inputClass} />
      <Input type="color" value={ink.color} onChange={(event) => ink.setColor(event.target.value)} className={inputClass} />
      <DuotoneCurveEditor curve={ink.curve} onChange={ink.setCurve} />
      <Input
        type="number"
        min={0}
        max={100}
        value={ink.opacity}
        onChange={(event) => ink.setOpacity(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
        className={inputClass}
      />
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => ink.setCurve(defaultDuotoneCurve())} title="Linear curve">Lin</Button>
        <Button size="sm" variant="ghost" onClick={() => ink.setCurve(defaultDuotoneCurve().map((_, i, arr) => Math.round(Math.pow(i / (arr.length - 1), 1.6) * 255)))} title="High-contrast curve">S</Button>
        <Button size="sm" variant="ghost" onClick={() => ink.setCurve(defaultDuotoneCurve().reverse())} title="Inverted">Inv</Button>
      </div>
    </div>
  )
}

function DuotoneCurveEditor({ curve, onChange }: { curve: number[]; onChange: (next: number[]) => void }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const drawing = React.useRef(false)
  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const w = canvas.width
    const h = canvas.height
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#0d0d12"
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = "#2a2a36"
    ctx.beginPath()
    for (let i = 1; i < 4; i++) {
      ctx.moveTo((w * i) / 4, 0)
      ctx.lineTo((w * i) / 4, h)
      ctx.moveTo(0, (h * i) / 4)
      ctx.lineTo(w, (h * i) / 4)
    }
    ctx.stroke()
    ctx.strokeStyle = "#6ea8fe"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 0; x <= w; x++) {
      const t = x / w
      const y = h - sampleDuotoneCurve(curve, t) * h
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    // control points
    ctx.fillStyle = "#fff"
    const last = curve.length - 1
    for (let i = 0; i <= last; i++) {
      const cx = (i / last) * w
      const cy = h - (curve[i] / 255) * h
      ctx.beginPath()
      ctx.arc(cx, cy, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [curve])
  const handleAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    const idx = Math.round((x / rect.width) * (curve.length - 1))
    const value = Math.round((1 - y / rect.height) * 255)
    const next = curve.slice()
    next[idx] = Math.max(0, Math.min(255, value))
    onChange(next)
  }
  return (
    <canvas
      ref={ref}
      width={180}
      height={64}
      className="h-16 w-full cursor-crosshair rounded-sm border border-[var(--ps-divider)]"
      onPointerDown={(event) => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); handleAt(event) }}
      onPointerMove={(event) => { if (drawing.current) handleAt(event) }}
      onPointerUp={(event) => { drawing.current = false; event.currentTarget.releasePointerCapture(event.pointerId) }}
    />
  )
}

function ModePreview({ settings }: { settings: DocumentModeSettings }) {
  const activeDoc = useActiveDocument()
  const beforeRef = React.useRef<HTMLCanvasElement>(null)
  const afterRef = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    if (!activeDoc || !beforeRef.current || !afterRef.current) return
    const composite = renderDocumentComposite(activeDoc, { transparent: true })
    const w = beforeRef.current.width
    const h = beforeRef.current.height
    const bctx = beforeRef.current.getContext("2d")!
    bctx.clearRect(0, 0, w, h)
    const scale = Math.min(w / composite.width, h / composite.height)
    const dw = composite.width * scale
    const dh = composite.height * scale
    bctx.drawImage(composite, (w - dw) / 2, (h - dh) / 2, dw, dh)
    const actx = afterRef.current.getContext("2d")!
    actx.clearRect(0, 0, w, h)
    try {
      const img = bctx.getImageData(0, 0, w, h)
      const converted = convertImageDataToDocumentMode(img, settings)
      actx.putImageData(converted, 0, 0)
    } catch {
      // Fall back to before image on error
      actx.drawImage(beforeRef.current, 0, 0)
    }
  }, [activeDoc, settings])
  return (
    <div className="grid grid-cols-2 gap-2 text-[var(--ps-text-dim)]">
      <div className="grid gap-1">
        <Label className="text-[11px]">Before</Label>
        <canvas ref={beforeRef} width={220} height={140} className="h-32 w-full rounded-sm border border-[var(--ps-divider)] bg-black" />
      </div>
      <div className="grid gap-1">
        <Label className="text-[11px]">Preview</Label>
        <canvas ref={afterRef} width={220} height={140} className="h-32 w-full rounded-sm border border-[var(--ps-divider)] bg-black" />
      </div>
    </div>
  )
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
