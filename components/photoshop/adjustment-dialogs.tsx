"use client"

/**
 * Adjustment workflow dialogs — Photoshop-style modal panels for the six
 * adjustments whose UI exceeds what the generic FilterDialog/AdjustmentsPanel
 * param-driven renderer can express:
 *
 *   1. Shadows/Highlights — grouped controls + "Save As Defaults" persistence
 *   2. HDR Toning         — method dropdown + Local Adaptation knobs + presets
 *   3. Match Color        — Destination/Statistics groups + source picker
 *   4. Replace Color      — eyedropper add/subtract sampling on a preview
 *   5. Equalize prompt    — selection-only vs whole-image radio
 *   6. Auto Options       — algorithm + Snap Neutral Midtones + clip percents
 *
 * Each dialog dispatches its result through the existing reducer/commit path
 * so a destructive call lands in history exactly like a manual filter run.
 * They are wired into menu-bar.tsx via the lazyDialog helper.
 */

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { useEditor, makeCanvas } from "./editor-context"
import { compositeLayer } from "./blend-modes"
import { FILTERS, HDR_TONING_PRESETS, AUTO_DEFAULTS, applyAutoAdjustment, type AutoAlgorithm, type AutoOptions } from "./filters"
import { toast } from "sonner"
import { Minus, Plus, RotateCcw, Save, XIcon } from "lucide-react"
import type { Layer, PsDocument } from "./types"

/* ------------------------------------------------------------------ */
/* shared helpers                                                     */
/* ------------------------------------------------------------------ */

function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * Composite the active document into a temporary canvas (matches how the
 * Color Range dialog samples colors). We need this for eyedropper-style
 * sampling because layers are stored separately.
 */
function compositeDocument(doc: PsDocument): HTMLCanvasElement {
  const c = makeCanvas(doc.width, doc.height)
  const ctx = c.getContext("2d")!
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, doc.width, doc.height)
  for (const l of doc.layers) {
    if (!l.visible) continue
    compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
  }
  return c
}

function activeRasterLayer(doc: PsDocument): Layer | null {
  for (const l of doc.layers) {
    if (!l.visible || l.locked) continue
    if (l.kind === "adjustment") continue
    return l
  }
  return null
}

function commitFilterResult(
  doc: PsDocument,
  layer: Layer,
  result: ImageData,
  label: string,
  commit: (label: string, ids: string[]) => void,
) {
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) return
  ctx.putImageData(result, 0, 0)
  commit(label, [layer.id])
  void doc
}

/* ------------------------------------------------------------------ */
/* 1. Shadows / Highlights                                            */
/* ------------------------------------------------------------------ */

interface ShadowsHighlightsState {
  shadowsAmount: number
  shadowsTonalWidth: number
  shadowsRadius: number
  highlightsAmount: number
  highlightsTonalWidth: number
  highlightsRadius: number
  colorCorrection: number
  midtoneContrast: number
  blackClip: number
  whiteClip: number
}

const SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS: ShadowsHighlightsState = {
  shadowsAmount: 35,
  shadowsTonalWidth: 50,
  shadowsRadius: 30,
  highlightsAmount: 0,
  highlightsTonalWidth: 50,
  highlightsRadius: 30,
  colorCorrection: 20,
  midtoneContrast: 0,
  blackClip: 0.01,
  whiteClip: 0.01,
}

const SHADOWS_HIGHLIGHTS_PREFS_KEY = "ps.shadowsHighlights.defaults"

function loadShadowsHighlightsDefaults(): ShadowsHighlightsState {
  if (typeof window === "undefined") return SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS
  try {
    const raw = window.localStorage.getItem(SHADOWS_HIGHLIGHTS_PREFS_KEY)
    if (!raw) return SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<ShadowsHighlightsState>
    return { ...SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS, ...parsed }
  } catch {
    return SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS
  }
}

function saveShadowsHighlightsDefaults(state: ShadowsHighlightsState) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SHADOWS_HIGHLIGHTS_PREFS_KEY, JSON.stringify(state))
  } catch {
    /* ignore quota errors */
  }
}

export function ShadowsHighlightsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const [state, setState] = React.useState<ShadowsHighlightsState>(SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS)
  const [showMore, setShowMore] = React.useState(true)

  React.useEffect(() => {
    if (open) setState(loadShadowsHighlightsDefaults())
  }, [open])

  const setK = <K extends keyof ShadowsHighlightsState>(key: K, value: ShadowsHighlightsState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  const apply = () => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("Select a pixel layer first.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const filter = FILTERS["shadows-highlights"]
    const result = filter.apply(src, state as unknown as Record<string, number | string | boolean>)
    commitFilterResult(activeDoc, layer, result, "Shadows/Highlights", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Shadows/Highlights</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Group title="Shadows">
            <SliderRow label="Amount" suffix="%" min={0} max={100} step={1} value={state.shadowsAmount} onChange={(v) => setK("shadowsAmount", v)} />
            {showMore ? (
              <>
                <SliderRow label="Tonal Width" suffix="%" min={1} max={100} step={1} value={state.shadowsTonalWidth} onChange={(v) => setK("shadowsTonalWidth", v)} />
                <SliderRow label="Radius" suffix="px" min={0} max={250} step={1} value={state.shadowsRadius} onChange={(v) => setK("shadowsRadius", v)} />
              </>
            ) : null}
          </Group>
          <Group title="Highlights">
            <SliderRow label="Amount" suffix="%" min={0} max={100} step={1} value={state.highlightsAmount} onChange={(v) => setK("highlightsAmount", v)} />
            {showMore ? (
              <>
                <SliderRow label="Tonal Width" suffix="%" min={1} max={100} step={1} value={state.highlightsTonalWidth} onChange={(v) => setK("highlightsTonalWidth", v)} />
                <SliderRow label="Radius" suffix="px" min={0} max={250} step={1} value={state.highlightsRadius} onChange={(v) => setK("highlightsRadius", v)} />
              </>
            ) : null}
          </Group>
          {showMore ? (
            <Group title="Adjustments">
              <SliderRow label="Color Correction" min={-100} max={100} step={1} value={state.colorCorrection} onChange={(v) => setK("colorCorrection", v)} />
              <SliderRow label="Midtone Contrast" min={-100} max={100} step={1} value={state.midtoneContrast} onChange={(v) => setK("midtoneContrast", v)} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SliderRow label="Black Clip" suffix="%" min={0} max={50} step={0.01} value={state.blackClip} onChange={(v) => setK("blackClip", v)} />
                <SliderRow label="White Clip" suffix="%" min={0} max={50} step={0.01} value={state.whiteClip} onChange={(v) => setK("whiteClip", v)} />
              </div>
            </Group>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2 text-[11px]">
            <Button variant="outline" size="sm" onClick={() => setShowMore((v) => !v)}>
              {showMore ? "Hide Options" : "Show More Options"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setState(SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS)}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reset
              </Button>
              <Button variant="outline" size="sm" onClick={() => { saveShadowsHighlightsDefaults(state); toast.success("Defaults saved.") }}>
                <Save className="size-3.5" aria-hidden="true" />
                Save As Defaults
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 2. HDR Toning                                                      */
/* ------------------------------------------------------------------ */

const HDR_PRESET_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "monochromatic", label: "Monochromatic" },
  { value: "more-saturated", label: "More Saturated" },
  { value: "photorealistic", label: "Photorealistic" },
  { value: "surrealistic", label: "Surrealistic" },
  { value: "highlight-compression", label: "Highlight Compression" },
  { value: "equalize-histogram", label: "Equalize Histogram" },
]

interface HdrToningState {
  method: string
  radius: number
  strength: number
  edgeGlow: number
  gamma: number
  exposureEv: number
  detail: number
  shadow: number
  highlight: number
  vibrance: number
  saturation: number
  toningCurve: string
}

const HDR_DEFAULT_STATE: HdrToningState = {
  method: "local-adaptation",
  radius: 60,
  strength: 100,
  edgeGlow: 30,
  gamma: 1,
  exposureEv: 0,
  detail: 0,
  shadow: 0,
  highlight: 0,
  vibrance: 0,
  saturation: 0,
  toningCurve: "0,0;255,255",
}

export function HdrToningDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const [state, setState] = React.useState<HdrToningState>(HDR_DEFAULT_STATE)
  const [preset, setPreset] = React.useState<string>("default")

  React.useEffect(() => {
    if (open) {
      setPreset("default")
      setState(HDR_DEFAULT_STATE)
    }
  }, [open])

  const applyPreset = (id: string) => {
    setPreset(id)
    const def = HDR_TONING_PRESETS[id]
    if (def) setState({ ...HDR_DEFAULT_STATE, ...def })
  }

  const set = <K extends keyof HdrToningState>(key: K, value: HdrToningState[K]) => {
    setPreset("(custom)")
    setState((s) => ({ ...s, [key]: value }))
  }

  const isLocalAdaptation = state.method === "local-adaptation"

  const apply = () => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("No editable layer.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const filter = FILTERS["hdr-toning"]
    const result = filter.apply(src, state as unknown as Record<string, number | string | boolean>)
    commitFilterResult(activeDoc, layer, result, "HDR Toning", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>HDR Toning</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectRow label="Preset" value={preset} onChange={applyPreset} options={[...HDR_PRESET_OPTIONS, { value: "(custom)", label: "Custom" }]} />
            <SelectRow
              label="Method"
              value={state.method}
              onChange={(v) => set("method", v)}
              options={[
                { value: "local-adaptation", label: "Local Adaptation" },
                { value: "exposure-gamma", label: "Exposure and Gamma" },
                { value: "highlight-compression", label: "Highlight Compression" },
                { value: "equalize-histogram", label: "Equalize Histogram" },
              ]}
            />
          </div>
          {isLocalAdaptation ? (
            <Group title="Edge Glow">
              <SliderRow label="Radius" suffix="px" min={1} max={250} step={1} value={state.radius} onChange={(v) => set("radius", v)} />
              <SliderRow label="Strength" suffix="%" min={0} max={200} step={1} value={state.strength} onChange={(v) => set("strength", v)} />
              <SliderRow label="Edge Glow" min={0} max={100} step={1} value={state.edgeGlow} onChange={(v) => set("edgeGlow", v)} />
            </Group>
          ) : null}
          <Group title="Tone and Detail">
            <SliderRow label="Gamma" min={0.3} max={3} step={0.01} value={state.gamma} onChange={(v) => set("gamma", v)} />
            <SliderRow label="Exposure" suffix="EV" min={-4} max={4} step={0.01} value={state.exposureEv} onChange={(v) => set("exposureEv", v)} />
            {isLocalAdaptation ? <SliderRow label="Detail" min={-100} max={100} step={1} value={state.detail} onChange={(v) => set("detail", v)} /> : null}
          </Group>
          {isLocalAdaptation ? (
            <Group title="Advanced">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SliderRow label="Shadow" min={-100} max={100} step={1} value={state.shadow} onChange={(v) => set("shadow", v)} />
                <SliderRow label="Highlight" min={-100} max={100} step={1} value={state.highlight} onChange={(v) => set("highlight", v)} />
                <SliderRow label="Vibrance" min={-100} max={100} step={1} value={state.vibrance} onChange={(v) => set("vibrance", v)} />
                <SliderRow label="Saturation" min={-100} max={100} step={1} value={state.saturation} onChange={(v) => set("saturation", v)} />
              </div>
            </Group>
          ) : null}
          {isLocalAdaptation ? (
            <Group title="Toning Curve">
              <label className="grid gap-1 text-[11px]">
                <span className="text-[var(--ps-text-dim)]">Curve points (x,y;x,y;...)</span>
                <input
                  className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 font-mono text-[11px]"
                  value={state.toningCurve}
                  onChange={(e) => set("toningCurve", e.target.value)}
                />
              </label>
            </Group>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Match Color                                                     */
/* ------------------------------------------------------------------ */

export function MatchColorDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, documents, commit } = useEditor()
  const [sourceDocId, setSourceDocId] = React.useState<string>("")
  const [sourceLayerId, setSourceLayerId] = React.useState<string>("")
  const [luminance, setLuminance] = React.useState(100)
  const [colorIntensity, setColorIntensity] = React.useState(100)
  const [fade, setFade] = React.useState(0)
  const [neutralize, setNeutralize] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setSourceDocId(activeDoc?.id ?? "")
      setSourceLayerId("")
      setLuminance(100)
      setColorIntensity(100)
      setFade(0)
      setNeutralize(false)
    }
  }, [open, activeDoc?.id])

  const sourceDoc = documents.find((d) => d.id === sourceDocId) ?? activeDoc

  const getSourceImageData = (): ImageData | null => {
    if (!sourceDoc) return null
    if (sourceLayerId) {
      const layer = sourceDoc.layers.find((l) => l.id === sourceLayerId)
      if (layer?.canvas) {
        const ctx = layer.canvas.getContext("2d")
        if (ctx) return ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
      }
      return null
    }
    const c = compositeDocument(sourceDoc)
    return c.getContext("2d")!.getImageData(0, 0, sourceDoc.width, sourceDoc.height)
  }

  const apply = () => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("No editable layer.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const matchSource = getSourceImageData()
    const filter = FILTERS["match-color"]
    const result = filter.apply(
      src,
      { luminance, colorIntensity, fade, neutralize },
      { matchColorSource: matchSource },
    )
    commitFilterResult(activeDoc, layer, result, "Match Color", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Match Color</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Group title="Destination Image">
            <div className="text-[11px] text-[var(--ps-text-dim)]">
              {activeDoc ? `Target: ${activeDoc.name} (${activeDoc.width}×${activeDoc.height})` : "No active document"}
            </div>
          </Group>
          <Group title="Image Statistics">
            <SelectRow
              label="Source"
              value={sourceDocId}
              onChange={setSourceDocId}
              options={documents.map((d) => ({ value: d.id, label: d.name }))}
            />
            <SelectRow
              label="Layer"
              value={sourceLayerId}
              onChange={setSourceLayerId}
              options={[
                { value: "", label: "Merged composite" },
                ...((sourceDoc?.layers ?? []).map((l) => ({ value: l.id, label: l.name }))),
              ]}
            />
            <label className="flex items-center gap-2 text-[11px]">
              <Checkbox checked={neutralize} onCheckedChange={(v) => setNeutralize(v === true)} />
              Neutralize (remove a color cast)
            </label>
          </Group>
          <Group title="Image Options">
            <SliderRow label="Luminance" min={0} max={200} step={1} value={luminance} onChange={setLuminance} />
            <SliderRow label="Color Intensity" min={0} max={200} step={1} value={colorIntensity} onChange={setColorIntensity} />
            <SliderRow label="Fade" min={0} max={100} step={1} value={fade} onChange={setFade} />
          </Group>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Replace Color                                                   */
/* ------------------------------------------------------------------ */

type Sample = { r: number; g: number; b: number }

export function ReplaceColorDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const previewRef = React.useRef<HTMLCanvasElement>(null)

  const [includeSamples, setIncludeSamples] = React.useState<Sample[]>([])
  const [excludeSamples, setExcludeSamples] = React.useState<Sample[]>([])
  const [pickMode, setPickMode] = React.useState<"add" | "subtract">("add")
  const [fuzziness, setFuzziness] = React.useState(40)
  const [localizedClusters, setLocalizedClusters] = React.useState(false)
  const [replacementHue, setReplacementHue] = React.useState(0)
  const [replacementSaturation, setReplacementSaturation] = React.useState(0)
  const [replacementLightness, setReplacementLightness] = React.useState(0)
  const [resultHex, setResultHex] = React.useState<string>("")

  // Rendered composite canvas (full-doc resolution) cached so we can both
  // draw the preview thumbnail and sample exact pixels.
  const composite = React.useMemo(() => (activeDoc ? compositeDocument(activeDoc) : null), [activeDoc])

  React.useEffect(() => {
    if (!open || !activeDoc) return
    setIncludeSamples([])
    setExcludeSamples([])
    setFuzziness(40)
    setLocalizedClusters(false)
    setReplacementHue(0)
    setReplacementSaturation(0)
    setReplacementLightness(0)
    setResultHex("")
    setPickMode("add")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeDoc?.id])

  // Render preview with a colored overlay indicating the matched zone.
  React.useEffect(() => {
    if (!open || !activeDoc || !composite) return
    const cv = previewRef.current
    if (!cv) return
    const max = 280
    const ratio = Math.min(max / activeDoc.width, max / activeDoc.height, 1)
    cv.width = Math.max(1, Math.floor(activeDoc.width * ratio))
    cv.height = Math.max(1, Math.floor(activeDoc.height * ratio))
    const ctx = cv.getContext("2d")!
    ctx.drawImage(composite, 0, 0, cv.width, cv.height)
    // Sketch include samples as a halo on the preview so the user can see
    // what got picked.
    for (const s of includeSamples) {
      ctx.strokeStyle = rgbToHex(s.r, s.g, s.b)
      ctx.lineWidth = 1
      ctx.strokeRect(2, 2, cv.width - 4, cv.height - 4)
    }
  }, [open, activeDoc, composite, includeSamples, excludeSamples])

  const samplePreview = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeDoc || !composite) return
    const cv = previewRef.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * activeDoc.width
    const y = ((e.clientY - rect.top) / rect.height) * activeDoc.height
    const ctx = composite.getContext("2d")!
    const px = ctx.getImageData(
      Math.max(0, Math.min(activeDoc.width - 1, Math.floor(x))),
      Math.max(0, Math.min(activeDoc.height - 1, Math.floor(y))),
      1,
      1,
    ).data
    const sample: Sample = { r: px[0], g: px[1], b: px[2] }
    if (pickMode === "add") setIncludeSamples((arr) => [...arr, sample])
    else setExcludeSamples((arr) => [...arr, sample])
  }

  const apply = () => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("No editable layer.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const filter = FILTERS["replace-color"]
    const includeStr = includeSamples.map((s) => `${s.r},${s.g},${s.b}`).join(";")
    const excludeStr = excludeSamples.map((s) => `${s.r},${s.g},${s.b}`).join(";")
    const result = filter.apply(src, {
      includeSamples: includeStr,
      excludeSamples: excludeStr,
      fuzziness,
      localizedClusters,
      replacementHue,
      replacementSaturation,
      replacementLightness,
      resultColor: resultHex ? (() => { const c = hexToRgb(resultHex); return `${c.r},${c.g},${c.b}` })() : "",
    })
    commitFilterResult(activeDoc, layer, result, "Replace Color", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Replace Color</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3">
            <Group title="Selection">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={pickMode === "add" ? "default" : "outline"} onClick={() => setPickMode("add")}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add Sample
                </Button>
                <Button size="sm" variant={pickMode === "subtract" ? "default" : "outline"} onClick={() => setPickMode("subtract")}>
                  <Minus className="size-3.5" aria-hidden="true" />
                  Subtract
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setIncludeSamples([]); setExcludeSamples([]) }}>
                  <XIcon className="size-3.5" aria-hidden="true" />
                  Clear
                </Button>
              </div>
              <div className="text-[11px] text-[var(--ps-text-dim)]">
                Includes: {includeSamples.length}, Excludes: {excludeSamples.length}
              </div>
              <SliderRow label="Fuzziness" min={0} max={200} step={1} value={fuzziness} onChange={setFuzziness} />
              <label className="flex items-center gap-2 text-[11px]">
                <Checkbox checked={localizedClusters} onCheckedChange={(v) => setLocalizedClusters(v === true)} />
                Localized Color Clusters
              </label>
            </Group>
            <Group title="Replacement">
              <SliderRow label="Hue" suffix="deg" min={0} max={360} step={1} value={replacementHue} onChange={setReplacementHue} />
              <SliderRow label="Saturation" min={-100} max={100} step={1} value={replacementSaturation} onChange={setReplacementSaturation} />
              <SliderRow label="Lightness" min={-100} max={100} step={1} value={replacementLightness} onChange={setReplacementLightness} />
              <label className="grid gap-1 text-[11px]">
                <span className="text-[var(--ps-text-dim)]">Result color (overrides HSL shift)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={resultHex || "#808080"}
                    onChange={(e) => setResultHex(e.target.value)}
                    className="h-7 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
                  />
                  <Button size="sm" variant="ghost" onClick={() => setResultHex("")}>Clear</Button>
                  <span className="text-[10px] font-mono text-[var(--ps-text-dim)]">{resultHex || "(none)"}</span>
                </div>
              </label>
            </Group>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="text-[11px] text-[var(--ps-text-dim)]">Selection preview — click to sample</div>
            <div className="inline-block max-w-full overflow-hidden border border-[var(--ps-divider)] bg-black p-1">
              <canvas ref={previewRef} onClick={samplePreview} className="block max-w-full cursor-crosshair" />
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px] text-[var(--ps-text-dim)]">
              <div>+ {includeSamples.length} include</div>
              <div>− {excludeSamples.length} exclude</div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 5. Equalize prompt                                                 */
/* ------------------------------------------------------------------ */

export function EqualizePromptDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const [mode, setMode] = React.useState<"image" | "selection-only" | "selection-source">("selection-only")

  const apply = () => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("No editable layer.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    // Build the selection mask in layer-pixel coordinates (matches filter
    // expectations: 0 / 255 byte array of length width*height).
    let selectionMask: Uint8Array | null = null
    const sel = activeDoc.selection
    if ((mode === "selection-only" || mode === "selection-source") && (sel.mask || sel.bounds)) {
      try {
        const c = makeCanvas(layer.canvas.width, layer.canvas.height)
        const cctx = c.getContext("2d")!
        if (sel.mask) cctx.drawImage(sel.mask, 0, 0)
        else if (sel.bounds) {
          cctx.fillStyle = "#fff"
          if (sel.shape === "ellipse") {
            cctx.beginPath()
            cctx.ellipse(sel.bounds.x + sel.bounds.w / 2, sel.bounds.y + sel.bounds.h / 2, sel.bounds.w / 2, sel.bounds.h / 2, 0, 0, Math.PI * 2)
            cctx.fill()
          } else {
            cctx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
          }
        }
        const data = cctx.getImageData(0, 0, c.width, c.height)
        selectionMask = new Uint8Array(c.width * c.height)
        for (let i = 0; i < selectionMask.length; i++) selectionMask[i] = data.data[i * 4 + 3] > 8 ? 255 : 0
      } catch {
        selectionMask = null
      }
    }
    const filter = FILTERS["equalize"]
    const result = filter.apply(src, { mode }, { selectionMask, selectionMode: mode })
    commitFilterResult(activeDoc, layer, result, "Equalize", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Equalize</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[12px]">
          <p className="text-[var(--ps-text-dim)]">An active selection was detected. How should equalize behave?</p>
          <fieldset className="space-y-1.5">
            <label className="flex items-start gap-2">
              <input type="radio" name="equalize-mode" checked={mode === "selection-only"} onChange={() => setMode("selection-only")} />
              <span>
                <span className="font-medium">Equalize selected area only</span>
                <span className="block text-[11px] text-[var(--ps-text-dim)]">Apply CDF to selection pixels in isolation.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="equalize-mode" checked={mode === "selection-source"} onChange={() => setMode("selection-source")} />
              <span>
                <span className="font-medium">Equalize entire image based on selected area</span>
                <span className="block text-[11px] text-[var(--ps-text-dim)]">Build the CDF from selected pixels, apply to everything.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="equalize-mode" checked={mode === "image"} onChange={() => setMode("image")} />
              <span>
                <span className="font-medium">Equalize entire image</span>
                <span className="block text-[11px] text-[var(--ps-text-dim)]">Ignore the selection.</span>
              </span>
            </label>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 6. Auto Options                                                    */
/* ------------------------------------------------------------------ */

const AUTO_OPTIONS_PREFS_KEY = "ps.auto.options"

function loadAutoDefaults(): AutoOptions {
  if (typeof window === "undefined") return AUTO_DEFAULTS
  try {
    const raw = window.localStorage.getItem(AUTO_OPTIONS_PREFS_KEY)
    if (!raw) return AUTO_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<AutoOptions>
    return { ...AUTO_DEFAULTS, ...parsed }
  } catch {
    return AUTO_DEFAULTS
  }
}

function saveAutoDefaults(opts: AutoOptions) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(AUTO_OPTIONS_PREFS_KEY, JSON.stringify(opts))
  } catch {
    /* ignore */
  }
}

export function AutoOptionsDialog({
  open,
  onOpenChange,
  initialAlgorithm,
  label,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Pre-select an algorithm to match the menu item used (Auto Tone / Auto Contrast / Auto Color). */
  initialAlgorithm?: AutoAlgorithm
  label?: string
}) {
  const { activeDoc, commit } = useEditor()
  const [opts, setOpts] = React.useState<AutoOptions>(AUTO_DEFAULTS)

  React.useEffect(() => {
    if (open) {
      const loaded = loadAutoDefaults()
      if (initialAlgorithm) loaded.algorithm = initialAlgorithm
      setOpts(loaded)
    }
  }, [open, initialAlgorithm])

  const set = <K extends keyof AutoOptions>(key: K, value: AutoOptions[K]) => setOpts((o) => ({ ...o, [key]: value }))

  const apply = (saveAsDefault = false) => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("No editable layer.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const result = applyAutoAdjustment(src, opts)
    commitFilterResult(activeDoc, layer, result, label ?? "Auto Adjust", commit)
    if (saveAsDefault) saveAutoDefaults(opts)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{label ?? "Auto"} Options</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Group title="Algorithms">
            <fieldset className="space-y-1.5 text-[12px]">
              {[
                { value: "monochromatic-contrast", label: "Enhance Monochromatic Contrast" },
                { value: "per-channel-contrast", label: "Enhance Per Channel Contrast" },
                { value: "dark-light-colors", label: "Find Dark & Light Colors" },
                { value: "brightness-contrast", label: "Enhance Brightness and Contrast" },
              ].map((alg) => (
                <label key={alg.value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="auto-alg"
                    checked={opts.algorithm === alg.value}
                    onChange={() => set("algorithm", alg.value as AutoAlgorithm)}
                  />
                  {alg.label}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox checked={opts.snapNeutralMidtones} onCheckedChange={(v) => set("snapNeutralMidtones", v === true)} />
              Snap Neutral Midtones
            </label>
          </Group>
          <Group title="Target Colors and Clipping">
            <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
              <ColorTargetRow label="Shadows" value={opts.shadowsTargetRgb} onChange={(v) => set("shadowsTargetRgb", v)} />
              <ColorTargetRow label="Midtones" value={opts.midtoneTargetRgb} onChange={(v) => set("midtoneTargetRgb", v)} />
              <ColorTargetRow label="Highlights" value={opts.highlightsTargetRgb} onChange={(v) => set("highlightsTargetRgb", v)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SliderRow label="Clip Shadows" suffix="%" min={0} max={50} step={0.01} value={opts.shadowsClipPct} onChange={(v) => set("shadowsClipPct", v)} />
              <SliderRow label="Clip Highlights" suffix="%" min={0} max={50} step={0.01} value={opts.highlightsClipPct} onChange={(v) => set("highlightsClipPct", v)} />
            </div>
          </Group>
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => apply(true)}>Save Defaults &amp; Apply</Button>
          <Button onClick={() => apply(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Reusable group + row primitives                                    */
/* ------------------------------------------------------------------ */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/30 p-2">
      <div className="text-[10px] uppercase text-[var(--ps-text-dim)]">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function SliderRow({
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

function formatSliderValue(value: number, step: number) {
  const digits = decimalsForStep(step)
  const rounded = digits > 0 ? value.toFixed(digits) : Math.round(value).toString()
  const trimmed = rounded.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
  return trimmed === "-0" ? "0" : trimmed
}

function decimalsForStep(step: number) {
  if (!Number.isFinite(step) || step >= 1) return 0
  const text = step.toString()
  if (text.includes("e-")) return Number(text.split("e-")[1]) || 0
  return text.split(".")[1]?.length ?? 0
}

function snapToStep(value: number, min: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return value
  const digits = decimalsForStep(step)
  const snapped = min + Math.round((value - min) / step) * step
  return Number(snapped.toFixed(digits))
}

function SelectRow({
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

function ColorTargetRow({
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
export type { AutoAlgorithm } from "./filters"
