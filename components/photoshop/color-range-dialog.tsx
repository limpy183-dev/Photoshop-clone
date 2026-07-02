"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useEditorSelector } from "./editor-context"
import { compositeLayer } from "./blend-modes"
import { colorRangeMask, hexToRgb, makeCanvas, selectionFromMask } from "./tool-helpers"
import { Minus, Pipette, Plus } from "lucide-react"

type ColorRangePreset =
  | "sampled"
  | "reds"
  | "yellows"
  | "greens"
  | "cyans"
  | "blues"
  | "magentas"
  | "highlights"
  | "midtones"
  | "shadows"

type PreviewMode = "mask" | "image" | "overlay"
type SampledColor = { r: number; g: number; b: number; hex: string; x?: number; y?: number }

const RANGE_PRESETS: Array<{ value: ColorRangePreset; label: string }> = [
  { value: "sampled", label: "Sampled Colors" },
  { value: "reds", label: "Reds" },
  { value: "yellows", label: "Yellows" },
  { value: "greens", label: "Greens" },
  { value: "cyans", label: "Cyans" },
  { value: "blues", label: "Blues" },
  { value: "magentas", label: "Magentas" },
  { value: "highlights", label: "Highlights" },
  { value: "midtones", label: "Midtones" },
  { value: "shadows", label: "Shadows" },
]

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function luminance(r: number, g: number, b: number) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

export function ColorRangeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const [tolerance, setTolerance] = React.useState(40)
  const [target, setTarget] = React.useState<SampledColor>({
    r: 128,
    g: 128,
    b: 128,
    hex: "#808080",
  })
  const [rangePreset, setRangePreset] = React.useState<ColorRangePreset>("sampled")
  const [previewMode, setPreviewMode] = React.useState<PreviewMode>("mask")
  const [localized, setLocalized] = React.useState(false)
  const [clusterRadius, setClusterRadius] = React.useState(160)
  const [invert, setInvert] = React.useState(false)
  const [addedSamples, setAddedSamples] = React.useState<SampledColor[]>([])
  const [subtractedSamples, setSubtractedSamples] = React.useState<SampledColor[]>([])
  const previewRef = React.useRef<HTMLCanvasElement>(null)

  const buildComposite = React.useCallback(() => {
    if (!activeDoc) return null
    const c = makeCanvas(activeDoc.width, activeDoc.height)
    const ctx = c.getContext("2d")!
    ctx.fillStyle = activeDoc.background
    ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
    for (const l of activeDoc.layers) {
      if (!l.visible) continue
      compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
    }
    return c
  }, [activeDoc])

  const buildRangeMask = React.useCallback((img: ImageData) => {
    if (rangePreset === "sampled" && addedSamples.length === 0 && subtractedSamples.length === 0 && !localized && !invert) {
      return colorRangeMask(img, target, tolerance)
    }
    const includeSamples = [target, ...addedSamples]
    const out = new ImageData(img.width, img.height)
    const fuzziness = Math.max(0, tolerance)
    const falloff = Math.max(8, fuzziness * 0.35)
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue
      const x = (i / 4) % img.width
      const y = Math.floor(i / 4 / img.width)
      const r = img.data[i]
      const g = img.data[i + 1]
      const b = img.data[i + 2]
      let alpha = 0
      if (rangePreset === "sampled") {
        const nearest = includeSamples.reduce((best, sample) => Math.min(best, colorDistance({ r, g, b }, sample)), Number.POSITIVE_INFINITY)
        if (nearest <= fuzziness) alpha = 255
        else if (nearest <= fuzziness + falloff) alpha = Math.round(255 * (1 - (nearest - fuzziness) / falloff))
        if (localized && alpha > 0 && includeSamples.some((sample) => sample.x !== undefined && sample.y !== undefined)) {
          const nearestPoint = includeSamples.reduce((best, sample) => {
            if (sample.x === undefined || sample.y === undefined) return best
            return Math.min(best, Math.hypot(x - sample.x, y - sample.y))
          }, Number.POSITIVE_INFINITY)
          if (nearestPoint > clusterRadius) alpha = 0
        }
      } else {
        const lum = luminance(r, g, b)
        const presetMatch =
          (rangePreset === "reds" && r > g + 20 && r > b + 20) ||
          (rangePreset === "yellows" && r > 130 && g > 120 && b < Math.min(r, g) - 20) ||
          (rangePreset === "greens" && g > r + 18 && g > b + 18) ||
          (rangePreset === "cyans" && g > 115 && b > 115 && r < Math.min(g, b) - 15) ||
          (rangePreset === "blues" && b > r + 18 && b > g + 18) ||
          (rangePreset === "magentas" && r > 115 && b > 115 && g < Math.min(r, b) - 15) ||
          (rangePreset === "highlights" && lum >= 190) ||
          (rangePreset === "midtones" && lum >= 70 && lum <= 190) ||
          (rangePreset === "shadows" && lum <= 90)
        alpha = presetMatch ? 255 : 0
      }
      if (alpha > 0 && subtractedSamples.some((sample) => colorDistance({ r, g, b }, sample) <= fuzziness)) alpha = 0
      if (invert) alpha = 255 - alpha
      out.data[i] = 255
      out.data[i + 1] = 255
      out.data[i + 2] = 255
      out.data[i + 3] = alpha
    }
    return out
  }, [addedSamples, clusterRadius, invert, localized, rangePreset, subtractedSamples, target, tolerance])

  // Render preview thumb
  React.useEffect(() => {
    if (!open || !activeDoc) return
    const composite = buildComposite()
    if (!composite) return
    const cv = previewRef.current
    if (!cv) return
    const max = 280
    const ratio = Math.min(max / activeDoc.width, max / activeDoc.height, 1)
    cv.width = Math.max(1, Math.floor(activeDoc.width * ratio))
    cv.height = Math.max(1, Math.floor(activeDoc.height * ratio))
    const ctx = cv.getContext("2d")!
    // Build mask at full size, scale down
    const fullCtx = composite.getContext("2d")!
    const img = fullCtx.getImageData(0, 0, composite.width, composite.height)
    const mask = buildRangeMask(img)
    // Render: white on black where selected
    const scratch = makeCanvas(composite.width, composite.height)
    scratch.getContext("2d")!.putImageData(mask, 0, 0)
    if (previewMode === "image") {
      ctx.drawImage(composite, 0, 0, cv.width, cv.height)
    } else if (previewMode === "overlay") {
      ctx.drawImage(composite, 0, 0, cv.width, cv.height)
      const tinted = makeCanvas(composite.width, composite.height)
      const tctx = tinted.getContext("2d")!
      tctx.fillStyle = "rgba(34, 211, 238, 0.72)"
      tctx.fillRect(0, 0, composite.width, composite.height)
      tctx.globalCompositeOperation = "destination-in"
      tctx.drawImage(scratch, 0, 0)
      ctx.globalCompositeOperation = "screen"
      ctx.drawImage(tinted, 0, 0, cv.width, cv.height)
      ctx.globalCompositeOperation = "source-over"
    } else {
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, cv.width, cv.height)
      const tinted = makeCanvas(composite.width, composite.height)
      const tctx = tinted.getContext("2d")!
      tctx.fillStyle = "#fff"
      tctx.fillRect(0, 0, composite.width, composite.height)
      tctx.globalCompositeOperation = "destination-in"
      tctx.drawImage(scratch, 0, 0)
      ctx.drawImage(tinted, 0, 0, cv.width, cv.height)
    }
  }, [open, activeDoc, buildRangeMask, previewMode, buildComposite])

  const setSampleFromComposite = (x: number, y: number) => {
    if (!activeDoc) return
    const composite = buildComposite()
    if (!composite) return
    const ctx = composite.getContext("2d")!
    const px = ctx.getImageData(
      Math.max(0, Math.min(activeDoc.width - 1, Math.floor(x))),
      Math.max(0, Math.min(activeDoc.height - 1, Math.floor(y))),
      1,
      1,
    ).data
    setTarget({
      r: px[0],
      g: px[1],
      b: px[2],
      hex: "#" + [px[0], px[1], px[2]].map((c) => c.toString(16).padStart(2, "0")).join(""),
      x,
      y,
    })
  }

  const sample = () => {
    if (!activeDoc) return
    setSampleFromComposite(activeDoc.width / 2, activeDoc.height / 2)
  }

  const samplePreview = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeDoc) return
    const cv = previewRef.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * activeDoc.width
    const y = ((e.clientY - rect.top) / rect.height) * activeDoc.height
    setSampleFromComposite(x, y)
  }

  const apply = () => {
    if (!activeDoc) return
    const composite = buildComposite()
    if (!composite) return
    const ctx = composite.getContext("2d")!
    const img = ctx.getImageData(0, 0, composite.width, composite.height)
    const mask = buildRangeMask(img)
    const m = makeCanvas(composite.width, composite.height)
    m.getContext("2d")!.putImageData(mask, 0, 0)
    dispatch({ type: "set-selection", selection: selectionFromMask(m, "color") })
    commit("Color Range", [])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Color Range</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_300px] gap-4">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5">
                <span className="text-[11px] text-[var(--ps-text-dim)]">Range</span>
                <select
                  aria-label="Range preset"
                  value={rangePreset}
                  onChange={(event) => setRangePreset(event.target.value as ColorRangePreset)}
                  className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                >
                  {RANGE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-[11px] text-[var(--ps-text-dim)]">Preview</span>
                <select
                  aria-label="Selection preview mode"
                  value={previewMode}
                  onChange={(event) => setPreviewMode(event.target.value as PreviewMode)}
                  className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                >
                  <option value="mask">Mask</option>
                  <option value="overlay">Overlay</option>
                  <option value="image">Image</option>
                </select>
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Sampled color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={target.hex}
                  onChange={(e) => {
                    const c = hexToRgb(e.target.value)
                    setTarget({ ...c, hex: e.target.value })
                  }}
                  className="h-8 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
                />
                <span className="text-[11px] tabular-nums font-mono">{target.hex}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={sample}
                  className="ml-auto h-7 text-[11px]"
                >
                  <Pipette className="w-3 h-3 mr-1" /> Sample center
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddedSamples((samples) => [...samples, target])}
                  className="h-7 text-[11px]"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add sample
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSubtractedSamples((samples) => [...samples, target])}
                  className="h-7 text-[11px]"
                >
                  <Minus className="w-3 h-3 mr-1" /> Subtract sample
                </Button>
              </div>
              {(addedSamples.length || subtractedSamples.length) ? (
                <div className="text-[10px] text-[var(--ps-text-dim)]">
                  {addedSamples.length} added, {subtractedSamples.length} subtracted samples
                </div>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Fuzziness ({tolerance})</Label>
              <input
                type="range"
                min={0}
                max={200}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  aria-label="Localized Color Clusters"
                  type="checkbox"
                  checked={localized}
                  onChange={(event) => setLocalized(event.target.checked)}
                  className="accent-[var(--ps-accent)]"
                />
                Localized Color Clusters
              </label>
              {localized ? (
                <label className="grid gap-1.5">
                  <span className="text-[11px] text-[var(--ps-text-dim)]">Range ({clusterRadius}px)</span>
                  <input
                    aria-label="Localized color cluster range"
                    type="range"
                    min={16}
                    max={800}
                    value={clusterRadius}
                    onChange={(event) => setClusterRadius(Number(event.target.value))}
                  />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  aria-label="Invert selection"
                  type="checkbox"
                  checked={invert}
                  onChange={(event) => setInvert(event.target.checked)}
                  className="accent-[var(--ps-accent)]"
                />
                Invert selection
              </label>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[11px] text-[var(--ps-text-dim)]">Selection preview</div>
            <div className="border border-[var(--ps-divider)] bg-black p-1 inline-block">
              <canvas ref={previewRef} onClick={samplePreview} className="block cursor-crosshair" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
