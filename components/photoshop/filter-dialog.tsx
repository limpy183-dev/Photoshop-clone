"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { compositeLayer } from "./blend-modes"
import { useEditor } from "./editor-context"
import {
  applyPlannedFilterFinal,
  applyPlannedFilterPreview,
  buildFilterPreviewQualityModel,
  getFilterPreviewDisplayModes,
  planFilterPreviewExecution,
  type FilterPreviewDisplayMode,
} from "./filter-preview"
import { getFilter, type FilterContext, type FilterDef } from "./filters"
import { applyHighBitFilterToLayer, previewHighBitFilterForLayer } from "./high-bit-document"
import {
  createBlurGalleryMeshResource,
  getBlurGalleryControlState,
  isBlurGalleryFilterId,
  normalizeBlurGalleryParams,
  type BlurGalleryParams,
} from "./blur-gallery-controls"
import {
  normalizeLightingEffectsParams,
  type LightingEffectsParams,
} from "./lighting-effects-controls"
import type { Layer, PsDocument } from "./types"

interface FilterDialogProps {
  filterId: string | null
  onClose: () => void
}

type ParamValue = number | string | boolean
type ParamMap = Record<string, ParamValue>

const ADVANCED_ADJUSTMENTS = new Set([
  "brightness-contrast",
  "hue-saturation",
  "levels",
  "curves",
  "color-balance",
  "black-white",
  "vibrance",
  "threshold",
  "posterize",
  "gradient-map",
  "match-color",
])

export function FilterDialog({ filterId, onClose }: FilterDialogProps) {
  const { documents, activeDoc, selectedLayers, commit, dispatch, requestRender, setFilterPreview } = useEditor()
  const filter = filterId ? getFilter(filterId) : null
  const previewRef = React.useRef<HTMLCanvasElement>(null)

  const originalsRef = React.useRef<{ id: string; data: ImageData }[]>([])
  const previewCanvasesRef = React.useRef<Record<string, HTMLCanvasElement>>({})
  const previewSequenceRef = React.useRef(0)
  const [params, setParams] = React.useState<ParamMap>({})
  const [previewMode, setPreviewMode] = React.useState<FilterPreviewDisplayMode>("split")
  const [applying, setApplying] = React.useState(false)
  const isAdvancedAdjustment = !!filter && ADVANCED_ADJUSTMENTS.has(filter.id)
  const isBlurGallery = !!filter && isBlurGalleryFilterId(filter.id)
  const isLightingEffects = filter?.id === "lighting-effects"
  const smartTarget =
    selectedLayers.length === 1 &&
    (selectedLayers[0].smartObject || selectedLayers[0].kind === "smart-object")
  const firstPreviewLayer = selectedLayers.find((layer) => typeof layer.canvas?.getContext === "function")
  const previewPlan = filter && firstPreviewLayer
    ? planFilterPreviewExecution(filter.id, firstPreviewLayer.canvas.width, firstPreviewLayer.canvas.height, params, {
        interactive: isBlurGallery && getBlurGalleryControlState(params).previewQuality === "interactive",
      })
    : null
  const previewQualityModel = previewPlan
    ? buildFilterPreviewQualityModel(previewPlan, {
        debounceMs: isBlurGallery || isLightingEffects ? 24 : 80,
        selectedLayerCount: originalsRef.current.length || selectedLayers.length || 1,
        smartTarget: !!smartTarget,
      })
    : null

  React.useEffect(() => {
    if (!filter || !activeDoc || selectedLayers.length === 0) return
    const init = defaultParams(filter, activeDoc, selectedLayers, documents)
    setParams(init)
    originalsRef.current = selectedLayers
      .filter((l) => !l.locked && typeof l.canvas.getContext === "function")
      .map((l) => {
        const ctx = l.canvas.getContext("2d")!
        return { id: l.id, data: ctx.getImageData(0, 0, l.canvas.width, l.canvas.height) }
      })
  }, [filterId, filter, activeDoc, selectedLayers, documents])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ filterId?: string; params?: BlurGalleryParams }>).detail
      if (!filter || !isBlurGalleryFilterId(filter.id) || detail?.filterId !== filter.id || !detail.params) return
      setParams((cur) => ({ ...cur, ...detail.params! }))
    }
    window.addEventListener("ps-blur-gallery-overlay-change", handler)
    return () => window.removeEventListener("ps-blur-gallery-overlay-change", handler)
  }, [filter])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ params?: LightingEffectsParams }>).detail
      if (!filter || filter.id !== "lighting-effects" || !detail?.params) return
      setParams((cur) => ({ ...cur, ...detail.params! }))
    }
    window.addEventListener("ps-lighting-effects-overlay-change", handler)
    return () => window.removeEventListener("ps-lighting-effects-overlay-change", handler)
  }, [filter])

  React.useEffect(() => {
    if (!filter || !activeDoc || !isBlurGalleryFilterId(filter.id)) {
      window.dispatchEvent(new CustomEvent("ps-blur-gallery-overlay-state", { detail: null }))
      return
    }
    const normalized = normalizeBlurGalleryParams(filter.id, params)
    window.dispatchEvent(new CustomEvent("ps-blur-gallery-overlay-state", {
      detail: {
        filterId: filter.id,
        params: normalized,
        docId: activeDoc.id,
      },
    }))
    return () => {
      window.dispatchEvent(new CustomEvent("ps-blur-gallery-overlay-state", { detail: null }))
    }
  }, [filter, params, activeDoc])

  React.useEffect(() => {
    if (!filter || !activeDoc || filter.id !== "lighting-effects") {
      window.dispatchEvent(new CustomEvent("ps-lighting-effects-overlay-state", { detail: null }))
      return
    }
    const normalized = normalizeLightingEffectsParams(params)
    window.dispatchEvent(new CustomEvent("ps-lighting-effects-overlay-state", {
      detail: {
        params: normalized,
        docId: activeDoc.id,
      },
    }))
    return () => {
      window.dispatchEvent(new CustomEvent("ps-lighting-effects-overlay-state", { detail: null }))
    }
  }, [filter, params, activeDoc])

  const context = React.useMemo<FilterContext>(() => {
    if (!filter) return {}
    const ctx: FilterContext = {}
    if (filter.id === "match-color") {
      ctx.matchColorSource = matchSourceData(String(params.matchSource ?? ""), documents)
    }
    if (filter.id === "displace") {
      const ref = String(params.mapSource ?? "")
      if (ref) ctx.displacementMap = matchSourceData(ref, documents)
    }
    if (filter.id === "lens-blur") {
      const ref = String(params.depthSource ?? "")
      if (ref) ctx.lensBlurDepthSource = matchSourceData(ref, documents)
    }
    if (filter.id === "lighting-effects") {
      const ref = String(params.bumpSource ?? "")
      if (ref) ctx.lightingBumpSource = matchSourceData(ref, documents)
    }
    if (filter.id === "apply-image") {
      const ref = String(params.applySource ?? "")
      if (ref) ctx.applyImageSource = matchSourceData(ref, documents)
    }
    if (filter.id === "calculations") {
      const refA = String(params.sourceA ?? "")
      const refB = String(params.sourceB ?? "")
      if (refA) ctx.calcSourceA = matchSourceData(refA, documents)
      if (refB) ctx.calcSourceB = matchSourceData(refB, documents)
    }
    // Equalize honours an explicit selection mask. We rasterize the current
    // selection into a 0/255 Uint8Array sized w*h so the filter can decide
    // between selection-only and whole-image modes without re-querying the DOM.
    if (filter.id === "equalize" && activeDoc?.selection) {
      const sel = activeDoc.selection
      if (sel.mask || sel.bounds) {
        try {
          const maskCanvas = sel.mask
            ?? (() => {
              const c = document.createElement("canvas")
              c.width = activeDoc.width
              c.height = activeDoc.height
              const cctx = c.getContext("2d")
              if (cctx && sel.bounds) {
                cctx.fillStyle = "#fff"
                if (sel.shape === "ellipse") {
                  cctx.beginPath()
                  cctx.ellipse(
                    sel.bounds.x + sel.bounds.w / 2,
                    sel.bounds.y + sel.bounds.h / 2,
                    sel.bounds.w / 2,
                    sel.bounds.h / 2,
                    0,
                    0,
                    Math.PI * 2,
                  )
                  cctx.fill()
                } else {
                  cctx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
                }
              }
              return c
            })()
          const cctx = maskCanvas.getContext("2d")
          if (cctx) {
            const img = cctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
            const out = new Uint8Array(activeDoc.width * activeDoc.height)
            for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + 3] > 8 ? 255 : 0
            ctx.selectionMask = out
            ctx.selectionMode = (String(params.mode ?? "image") as "image" | "selection-only" | "selection-source")
          }
        } catch {
          // Selection canvas may be tainted in cross-origin demos; fall back
          // to image-wide equalization.
        }
      }
    }
    return ctx
  }, [filter, params.matchSource, params.mapSource, params.depthSource, params.bumpSource, params.applySource, params.sourceA, params.sourceB, params.mode, documents, activeDoc])

  const drawPreviewThumbnail = React.useCallback(() => {
    if (!filter || !activeDoc) return
    const cv = previewRef.current
    if (!cv) return
    const max = isAdvancedAdjustment ? 260 : 180
    const ratio = Math.min(max / activeDoc.width, max / activeDoc.height, 1)
    const width = Math.max(1, Math.floor(activeDoc.width * ratio))
    const height = Math.max(1, Math.floor(activeDoc.height * ratio))
    cv.width = width
    cv.height = height
    const ctx = cv.getContext("2d")!
    const drawComposite = (usePreview: boolean) => {
      ctx.fillStyle = activeDoc.background
      ctx.fillRect(0, 0, width, height)
      for (const l of activeDoc.layers) {
        if (!l.visible || typeof l.canvas.getContext !== "function") continue
        const source = usePreview ? previewCanvasesRef.current[l.id] ?? l.canvas : l.canvas
        ctx.save()
        ctx.globalAlpha = l.opacity
        ctx.drawImage(source, 0, 0, width, height)
        ctx.restore()
      }
    }

    ctx.clearRect(0, 0, width, height)
    if (previewMode === "split") {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, width / 2, height)
      ctx.clip()
      drawComposite(false)
      ctx.restore()
      ctx.save()
      ctx.beginPath()
      ctx.rect(width / 2, 0, width / 2, height)
      ctx.clip()
      drawComposite(true)
      ctx.restore()
      ctx.fillStyle = "rgba(255,255,255,0.82)"
      ctx.fillRect(Math.floor(width / 2) - 1, 0, 2, height)
      return
    }
    drawComposite(previewMode === "after")
  }, [activeDoc, filter, isAdvancedAdjustment, previewMode])

  React.useEffect(() => {
    if (!filter || !activeDoc) return
    if (originalsRef.current.length === 0) return
    if (smartTarget) return
    const controller = new AbortController()
    const sequence = ++previewSequenceRef.current
    const interactiveBlurGallery = isBlurGallery && getBlurGalleryControlState(params).previewQuality === "interactive"
    const run = async () => {
      for (const o of originalsRef.current) {
        if (controller.signal.aborted || sequence !== previewSequenceRef.current) return
        const layer = activeDoc.layers.find((l) => l.id === o.id)
        if (!layer || typeof layer.canvas.getContext !== "function") continue
        let result: ImageData
        try {
          const highBitPreview = activeDoc.bitDepth > 8 && Object.keys(context).length === 0
            ? previewHighBitFilterForLayer(layer, activeDoc, filter.id, params, context)
            : null
          result = highBitPreview ?? await applyPlannedFilterPreview(filter, o.data, params, context, controller.signal, {
            interactive: interactiveBlurGallery,
          })
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return
          result = filter.apply(o.data, params, context)
        }
        if (controller.signal.aborted || sequence !== previewSequenceRef.current) return
        const tmp = previewCanvasesRef.current[layer.id] ?? document.createElement("canvas")
        if (tmp.width !== layer.canvas.width) tmp.width = layer.canvas.width
        if (tmp.height !== layer.canvas.height) tmp.height = layer.canvas.height
        previewCanvasesRef.current[layer.id] = tmp
        tmp.getContext("2d")!.putImageData(result, 0, 0)
        setFilterPreview(layer.id, tmp)
        drawPreviewThumbnail()
      }
    }
    const id = window.setTimeout(() => void run(), interactiveBlurGallery || isLightingEffects ? 24 : 80)
    return () => {
      controller.abort()
      window.clearTimeout(id)
    }
  }, [filter, params, context, activeDoc, setFilterPreview, smartTarget, isBlurGallery, isLightingEffects, drawPreviewThumbnail])

  React.useEffect(() => {
    drawPreviewThumbnail()
  }, [drawPreviewThumbnail, params])

  const restoreOriginals = React.useCallback(() => {
    if (!activeDoc) return
    for (const o of originalsRef.current) {
      setFilterPreview(o.id, null)
    }
    previewCanvasesRef.current = {}
    requestRender()
  }, [activeDoc, requestRender, setFilterPreview])

  const handleCancel = () => {
    restoreOriginals()
    originalsRef.current = []
    setApplying(false)
    onClose()
  }

  const handleApply = async () => {
    if (!filter) return onClose()
    setApplying(true)
    for (const o of originalsRef.current) setFilterPreview(o.id, null)

    if (smartTarget) {
      const layer = selectedLayers[0]
      const smartFilter = {
        id: `sf_${Math.random().toString(36).slice(2, 9)}`,
        filterId: filter.id,
        name: filter.name,
        enabled: true,
        opacity: 1,
        blendMode: "normal" as const,
        maskDensity: 1,
        maskFeather: 0,
        params,
        ...(isBlurGalleryFilterId(filter.id) ? { blurGalleryMesh: createBlurGalleryMeshResource(filter.id, params) } : {}),
      }
      const smartFilters = [
        ...(layer.smartFilters ?? []),
        smartFilter,
      ]
      dispatch({ type: "set-layer-smart-filters", id: layer.id, smartFilters })
      requestRender({ layerIds: [layer.id], reason: "smart-filter" })
      setTimeout(() => commit(`Smart Filter: ${filter.name}`, [layer.id]), 0)
      originalsRef.current = []
      setApplying(false)
      onClose()
      return
    }

    try {
      for (const o of originalsRef.current) {
        const layer = activeDoc!.layers.find((l) => l.id === o.id)
        if (!layer || typeof layer.canvas.getContext !== "function") continue
        if (activeDoc!.bitDepth > 8 && Object.keys(context).length === 0 && applyHighBitFilterToLayer(layer, activeDoc!, filter.id, params, context)) {
          continue
        }
        const result = await applyPlannedFilterFinal(filter, o.data, params, context)
        layer.canvas.getContext("2d")!.putImageData(result, 0, 0)
      }

      const layerCount = originalsRef.current.length
      commit(
        `${filter.name}${layerCount > 1 ? ` (${layerCount} layers)` : ""}`,
        originalsRef.current.map((o) => o.id),
      )
      originalsRef.current = []
      previewCanvasesRef.current = {}
      onClose()
    } finally {
      setApplying(false)
    }
  }

  const reset = () => {
    if (!filter || !activeDoc) return
    setParams(defaultParams(filter, activeDoc, selectedLayers, documents))
  }

  const update = (key: string, value: ParamValue) => setParams((cur) => ({ ...cur, [key]: value }))

  if (!filter) return null
  const visibleParams = isBlurGallery
    ? filter.params.filter((param) => param.key !== "pins" && param.key !== "path")
    : filter.params

  return (
    <Dialog
      open={!!filterId}
      modal={!isBlurGallery}
      onOpenChange={(open) => {
        if (!open) handleCancel()
      }}
    >
      <DialogContent
        showOverlay={!isBlurGallery}
        onInteractOutside={isBlurGallery ? (event) => event.preventDefault() : undefined}
        className={
          isBlurGallery
            ? "sm:max-w-[560px] overflow-hidden fixed left-auto right-6 top-20 translate-x-0 translate-y-0"
            : isAdvancedAdjustment
              ? "sm:max-w-[860px] overflow-hidden"
              : "sm:max-w-2xl overflow-hidden"
        }
      >
        <DialogHeader>
          <DialogTitle>{filter.name}</DialogTitle>
        </DialogHeader>
        <div className={isAdvancedAdjustment ? "grid grid-cols-[1fr_300px] gap-4" : "grid grid-cols-[1fr_220px] gap-4"}>
          <div className="flex flex-col gap-3 max-h-[62vh] overflow-y-auto pr-1">
            {isAdvancedAdjustment ? (
              <AdjustmentControls
                filter={filter}
                params={params}
                onChange={update}
                originals={originalsRef.current.map((o) => o.data)}
                documents={documents}
              />
            ) : visibleParams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No parameters. Click Apply.</p>
            ) : (
              visibleParams.map((p) => (
                <FilterParamRow
                  key={p.key}
                  param={p}
                  value={params[p.key]}
                  onChange={(v) => update(p.key, v)}
                />
              ))
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Applying to {originalsRef.current.length} layer
              {originalsRef.current.length === 1 ? "" : "s"}
              {selectedLayers.length > originalsRef.current.length ? " (locked layers skipped)" : ""}
              {smartTarget ? " as a re-editable Smart Filter" : ""}
            </p>
          </div>
          <div className="flex flex-col items-center gap-2 min-w-0">
            <div className="text-[11px] text-muted-foreground">Preview</div>
            <div className="grid w-full grid-cols-3 gap-1" role="group" aria-label="Filter preview mode">
              {getFilterPreviewDisplayModes().map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setPreviewMode(mode.id)}
                  className={`h-7 rounded-sm border px-2 text-[10px] ${
                    previewMode === mode.id
                      ? "border-[var(--ps-accent)] bg-[var(--ps-accent)] text-white"
                      : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)]"
                  }`}
                  title={mode.description}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className="ps-checker rounded-sm border overflow-hidden max-w-[280px] max-h-[280px]">
              <canvas ref={previewRef} className="block max-w-full max-h-[260px] object-contain" />
            </div>
            {previewQualityModel ? (
              <div className="w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] leading-snug text-[var(--ps-text-dim)]">
                <div className="font-medium text-[var(--ps-text)]">{previewQualityModel.executionLabel}</div>
                <div>{previewQualityModel.detailLabel}</div>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={applying}>
            Cancel
          </Button>
          <Button variant="outline" onClick={reset} disabled={applying}>
            Reset
          </Button>
          <Button onClick={() => void handleApply()} disabled={applying}>
            {applying ? "Applying..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function defaultParams(filter: FilterDef, activeDoc: PsDocument, selectedLayers: Layer[], documents: PsDocument[]) {
  const out: ParamMap = {}
  for (const p of filter.params) out[p.key] = p.default
  if (filter.id === "curves") out.points = "0,0;255,255"
  if (filter.id === "gradient-map") out.gradient = "0,#000000;1,#ffffff"
  if (filter.id === "match-color") out.matchSource = defaultMatchSource(activeDoc, selectedLayers, documents)
  if (isBlurGalleryFilterId(filter.id)) return normalizeBlurGalleryParams(filter.id, out)
  if (filter.id === "lighting-effects") return normalizeLightingEffectsParams(out)
  return out
}

function defaultMatchSource(activeDoc: PsDocument, selectedLayers: Layer[], documents: PsDocument[]) {
  const selectedIds = new Set(selectedLayers.map((l) => l.id))
  const layer = activeDoc.layers.find((l) => l.visible && !selectedIds.has(l.id) && l.kind !== "group")
  if (layer) return `layer:${activeDoc.id}:${layer.id}`
  const otherDoc = documents.find((d) => d.id !== activeDoc.id)
  return otherDoc ? `doc:${otherDoc.id}` : `doc:${activeDoc.id}`
}

function AdjustmentControls({
  filter,
  params,
  onChange,
  originals,
  documents,
}: {
  filter: FilterDef
  params: ParamMap
  onChange: (key: string, value: ParamValue) => void
  originals: ImageData[]
  documents: PsDocument[]
}) {
  switch (filter.id) {
    case "brightness-contrast":
      return (
        <>
          <SliderRow label="Brightness" min={-150} max={150} value={num(params.brightness)} onChange={(v) => onChange("brightness", v)} />
          <SliderRow label="Contrast" min={-100} max={100} value={num(params.contrast)} onChange={(v) => onChange("contrast", v)} />
          <CheckboxRow label="Use Legacy" checked={bool(params.useLegacy)} onChange={(v) => onChange("useLegacy", v)} />
        </>
      )
    case "hue-saturation":
      return (
        <>
          <SelectRow
            label="Edit"
            value={String(params.range ?? "master")}
            options={[
              ["master", "Master"],
              ["reds", "Reds"],
              ["yellows", "Yellows"],
              ["greens", "Greens"],
              ["cyans", "Cyans"],
              ["blues", "Blues"],
              ["magentas", "Magentas"],
            ]}
            onChange={(v) => onChange("range", v)}
          />
          <SliderRow label="Hue" min={-180} max={180} value={num(params.hue)} suffix="deg" onChange={(v) => onChange("hue", v)} />
          <SliderRow label="Saturation" min={-100} max={100} value={num(params.saturation)} onChange={(v) => onChange("saturation", v)} />
          <SliderRow label="Lightness" min={-100} max={100} value={num(params.lightness)} onChange={(v) => onChange("lightness", v)} />
          <CheckboxRow label="Colorize" checked={bool(params.colorize)} onChange={(v) => onChange("colorize", v)} />
        </>
      )
    case "levels":
      return (
        <>
          <SelectRow label="Channel" value={String(params.channel ?? "rgb")} options={CHANNEL_OPTIONS} onChange={(v) => onChange("channel", v)} />
          <Histogram images={originals} channel={String(params.channel ?? "rgb")} />
          <SliderRow label="Input Black" min={0} max={254} value={num(params.inputBlack)} onChange={(v) => onChange("inputBlack", Math.min(v, num(params.inputWhite, 255) - 1))} />
          <SliderRow label="Gamma" min={0.1} max={9.99} step={0.01} value={num(params.gamma, 1)} onChange={(v) => onChange("gamma", v)} />
          <SliderRow label="Input White" min={1} max={255} value={num(params.inputWhite, 255)} onChange={(v) => onChange("inputWhite", Math.max(v, num(params.inputBlack) + 1))} />
          <SliderRow label="Output Black" min={0} max={255} value={num(params.outputBlack)} onChange={(v) => onChange("outputBlack", v)} />
          <SliderRow label="Output White" min={0} max={255} value={num(params.outputWhite, 255)} onChange={(v) => onChange("outputWhite", v)} />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const auto = autoLevels(originals, String(params.channel ?? "rgb"))
                onChange("inputBlack", auto.black)
                onChange("inputWhite", auto.white)
              }}
            >
              Auto
            </Button>
          </div>
        </>
      )
    case "curves":
      return (
        <>
          <SelectRow label="Channel" value={String(params.channel ?? "rgb")} options={CHANNEL_OPTIONS} onChange={(v) => onChange("channel", v)} />
          <CurveEditor
            images={originals}
            channel={String(params.channel ?? "rgb")}
            value={String(params.points ?? "0,0;255,255")}
            onChange={(v) => onChange("points", v)}
          />
        </>
      )
    case "color-balance":
      return (
        <>
          <SelectRow
            label="Tone Balance"
            value={String(params.tone ?? "midtones")}
            options={[
              ["shadows", "Shadows"],
              ["midtones", "Midtones"],
              ["highlights", "Highlights"],
            ]}
            onChange={(v) => onChange("tone", v)}
          />
          <SliderRow label="Cyan / Red" min={-100} max={100} value={num(params.cyanRed)} onChange={(v) => onChange("cyanRed", v)} />
          <SliderRow label="Magenta / Green" min={-100} max={100} value={num(params.magentaGreen)} onChange={(v) => onChange("magentaGreen", v)} />
          <SliderRow label="Yellow / Blue" min={-100} max={100} value={num(params.yellowBlue)} onChange={(v) => onChange("yellowBlue", v)} />
          <CheckboxRow label="Preserve Luminosity" checked={bool(params.preserveLuminosity, true)} onChange={(v) => onChange("preserveLuminosity", v)} />
        </>
      )
    case "black-white":
      return (
        <>
          {["reds", "yellows", "greens", "cyans", "blues", "magentas"].map((key) => (
            <SliderRow key={key} label={title(key)} min={-100} max={100} value={num(params[key])} onChange={(v) => onChange(key, v)} />
          ))}
          <CheckboxRow label="Tint" checked={bool(params.tint)} onChange={(v) => onChange("tint", v)} />
          {bool(params.tint) ? (
            <>
              <SliderRow label="Tint Hue" min={0} max={360} value={num(params.tintHue, 38)} suffix="deg" onChange={(v) => onChange("tintHue", v)} />
              <SliderRow label="Tint Saturation" min={0} max={100} value={num(params.tintSaturation, 18)} onChange={(v) => onChange("tintSaturation", v)} />
            </>
          ) : null}
        </>
      )
    case "vibrance":
      return (
        <>
          <SliderRow label="Vibrance" min={-100} max={100} value={num(params.amount)} onChange={(v) => onChange("amount", v)} />
          <SliderRow label="Saturation" min={-100} max={100} value={num(params.saturation)} onChange={(v) => onChange("saturation", v)} />
        </>
      )
    case "threshold":
      return (
        <>
          <Histogram images={originals} channel="rgb" threshold={num(params.level, 128)} />
          <SliderRow label="Threshold Level" min={0} max={255} value={num(params.level, 128)} onChange={(v) => onChange("level", v)} />
        </>
      )
    case "posterize":
      return <SliderRow label="Levels" min={2} max={32} value={num(params.levels, 4)} onChange={(v) => onChange("levels", v)} />
    case "gradient-map":
      return (
        <>
          <GradientStops value={String(params.gradient ?? "0,#000000;1,#ffffff")} onChange={(v) => onChange("gradient", v)} />
          <SelectRow
            label="Interpolation"
            value={String(params.interpolation ?? "rgb")}
            options={[
              ["rgb", "RGB"],
              ["hsl", "HSL"],
            ]}
            onChange={(v) => onChange("interpolation", v)}
          />
          <CheckboxRow label="Reverse" checked={bool(params.reverse)} onChange={(v) => onChange("reverse", v)} />
          <CheckboxRow label="Dither" checked={bool(params.dither, true)} onChange={(v) => onChange("dither", v)} />
        </>
      )
    case "match-color":
      return (
        <>
          <SelectRow
            label="Source"
            value={String(params.matchSource ?? "")}
            options={matchSourceOptions(documents)}
            onChange={(v) => onChange("matchSource", v)}
          />
          <SliderRow label="Luminance" min={0} max={200} value={num(params.luminance, 100)} onChange={(v) => onChange("luminance", v)} />
          <SliderRow label="Color Intensity" min={0} max={200} value={num(params.colorIntensity, 100)} onChange={(v) => onChange("colorIntensity", v)} />
          <SliderRow label="Fade" min={0} max={100} value={num(params.fade)} suffix="%" onChange={(v) => onChange("fade", v)} />
          <CheckboxRow label="Neutralize" checked={bool(params.neutralize)} onChange={(v) => onChange("neutralize", v)} />
        </>
      )
    default:
      return (
        <>
          {filter.params.map((p) => (
            <FilterParamRow key={p.key} param={p} value={params[p.key]} onChange={(v) => onChange(p.key, v)} />
          ))}
        </>
      )
  }
}

const CHANNEL_OPTIONS: [string, string][] = [
  ["rgb", "RGB"],
  ["red", "Red"],
  ["green", "Green"],
  ["blue", "Blue"],
]

function FilterParamRow({
  param,
  value,
  onChange,
}: {
  param: FilterDef["params"][number]
  value: ParamValue | undefined
  onChange: (v: ParamValue) => void
}) {
  if (param.type === "slider") {
    return (
      <SliderRow
        label={param.label}
        min={param.min}
        max={param.max}
        step={param.step ?? 1}
        suffix={param.suffix}
        value={typeof value === "number" ? value : param.default}
        onChange={onChange}
      />
    )
  }
  if (param.type === "select") {
    return (
      <SelectRow
        label={param.label}
        value={typeof value === "string" ? value : param.default}
        options={param.options.map((o) => [o.value, o.label])}
        onChange={onChange}
      />
    )
  }
  if (param.type === "text") {
    return (
      <TextRow
        label={param.label}
        value={typeof value === "string" ? value : param.default}
        multiline={param.multiline}
        placeholder={param.placeholder}
        accept={param.accept}
        onChange={onChange}
      />
    )
  }
  return (
    <CheckboxRow
      label={param.label}
      checked={typeof value === "boolean" ? value : param.default}
      onChange={onChange}
    />
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const display = step < 1 ? Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : Math.round(value)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <label className="text-foreground">{label}</label>
        <span className="tabular-nums text-muted-foreground text-xs">
          {display}
          {suffix ?? ""}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Slider min={min} max={max} step={step} value={[value]} onValueChange={(arr) => onChange(arr[0])} className="flex-1" />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 h-7 rounded-sm border border-border bg-background px-2 text-sm tabular-nums"
        />
      </div>
    </div>
  )
}

function SelectRow({
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
    <div className="flex items-center gap-3 text-sm">
      <label className="w-36 shrink-0">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-sm border border-border bg-background px-2 text-sm flex-1 min-w-0"
      >
        {options.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}

function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--ps-accent)]" />
      {label}
    </label>
  )
}

function TextRow({
  label,
  value,
  multiline,
  placeholder,
  accept,
  onChange,
}: {
  label: string
  value: string
  multiline?: boolean
  placeholder?: string
  accept?: string
  onChange: (v: string) => void
}) {
  const inputClass = "rounded-sm border border-border bg-background px-2 py-1 text-sm font-mono"
  const readFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result ?? ""))
    reader.readAsText(file)
  }
  return (
    <div className="grid gap-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <label>{label}</label>
        {accept ? (
          <input
            type="file"
            accept={accept}
            onChange={(e) => readFile(e.currentTarget.files?.[0])}
            className="max-w-[180px] text-xs text-muted-foreground file:mr-2 file:h-7 file:rounded-sm file:border file:border-border file:bg-background file:px-2 file:text-xs"
          />
        ) : null}
      </div>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          rows={6}
          className={`${inputClass} min-h-[120px] resize-y`}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={`${inputClass} h-8`}
        />
      )}
    </div>
  )
}

function Histogram({ images, channel, threshold }: { images: ImageData[]; channel: string; threshold?: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = 320
    canvas.height = 96
    const ctx = canvas.getContext("2d")!
    const hist = histogram(images, channel)
    const max = Math.max(1, ...hist)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#151515"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "rgba(255,255,255,0.08)"
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * canvas.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    ctx.fillStyle = "#b8c7e0"
    for (let x = 0; x < 256; x++) {
      const h = Math.sqrt(hist[x] / max) * (canvas.height - 8)
      const px = (x / 256) * canvas.width
      const pw = Math.ceil(canvas.width / 256)
      ctx.fillRect(px, canvas.height - h, pw, h)
    }
    if (threshold !== undefined) {
      ctx.strokeStyle = "#ff5f57"
      const x = (threshold / 255) * canvas.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
  }, [images, channel, threshold])
  return <canvas ref={ref} className="w-full h-24 rounded-sm border border-border bg-black" />
}

function CurveEditor({
  images,
  channel,
  value,
  onChange,
}: {
  images: ImageData[]
  channel: string
  value: string
  onChange: (value: string) => void
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const dragRef = React.useRef<number | null>(null)
  const points = React.useMemo(() => parsePoints(value), [value])

  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = 320
    canvas.height = 320
    const ctx = canvas.getContext("2d")!
    const hist = histogram(images, channel)
    const max = Math.max(1, ...hist)
    ctx.fillStyle = "#141414"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "rgba(255,255,255,0.08)"
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * canvas.width
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, canvas.height)
      ctx.moveTo(0, p)
      ctx.lineTo(canvas.width, p)
      ctx.stroke()
    }
    ctx.fillStyle = "rgba(160,180,220,0.26)"
    for (let x = 0; x < 256; x++) {
      const h = Math.sqrt(hist[x] / max) * canvas.height
      ctx.fillRect((x / 256) * canvas.width, canvas.height - h, Math.ceil(canvas.width / 256), h)
    }
    const lut = curveLut(points)
    ctx.strokeStyle = "#e8edf7"
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = 0; x < 256; x++) {
      const px = (x / 255) * canvas.width
      const py = canvas.height - (lut[x] / 255) * canvas.height
      if (x === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    for (const p of points) {
      const x = (p[0] / 255) * canvas.width
      const y = canvas.height - (p[1] / 255) * canvas.height
      ctx.fillStyle = "#ffffff"
      ctx.strokeStyle = "#111111"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }, [points, images, channel])

  const updateFromPointer = (e: React.PointerEvent<HTMLCanvasElement>, existing: number | null) => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 255)
    const y = Math.round((1 - (e.clientY - rect.top) / rect.height) * 255)
    const next = points.slice()
    const idx = existing ?? nearestPoint(points, x, y)
    if (idx === null) {
      next.push([clamp255(x), clamp255(y)])
      dragRef.current = next.length - 1
    } else {
      next[idx] = [idx === 0 ? 0 : idx === points.length - 1 ? 255 : clamp255(x), clamp255(y)]
      dragRef.current = idx
    }
    next.sort((a, b) => a[0] - b[0])
    onChange(formatPoints(next))
  }

  return (
    <div className="grid gap-2">
      <canvas
        ref={ref}
        className="w-full aspect-square rounded-sm border border-border bg-black touch-none"
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
          updateFromPointer(e, null)
        }}
        onPointerMove={(e) => {
          if (dragRef.current !== null) updateFromPointer(e, dragRef.current)
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onDoubleClick={(e) => {
          const canvas = ref.current
          if (!canvas || points.length <= 2) return
          const rect = canvas.getBoundingClientRect()
          const x = Math.round(((e.clientX - rect.left) / rect.width) * 255)
          const y = Math.round((1 - (e.clientY - rect.top) / rect.height) * 255)
          const idx = nearestPoint(points, x, y, 12)
          if (idx !== null && idx > 0 && idx < points.length - 1) onChange(formatPoints(points.filter((_, i) => i !== idx)))
        }}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Click to add points. Drag to shape the curve.</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange("0,0;255,255")}>
          Linear
        </Button>
      </div>
    </div>
  )
}

function GradientStops({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const stops = parseStops(value)
  const update = (idx: number, patch: Partial<{ offset: number; color: string }>) => {
    const next = stops.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(formatStops(next))
  }
  return (
    <div className="grid gap-2">
      <div
        className="h-8 rounded-sm border border-border"
        style={{
          background: `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ")})`,
        }}
      />
      {stops.map((s, idx) => (
        <div key={idx} className="grid grid-cols-[36px_1fr_44px_24px] gap-2 items-center text-sm">
          <input type="color" value={s.color} onChange={(e) => update(idx, { color: e.target.value })} className="h-7 w-9" />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.offset * 100)}
            onChange={(e) => update(idx, { offset: Number(e.target.value) / 100 })}
            disabled={idx === 0 || idx === stops.length - 1}
          />
          <span className="tabular-nums text-xs text-right">{Math.round(s.offset * 100)}%</span>
          <button
            type="button"
            disabled={stops.length <= 2 || idx === 0 || idx === stops.length - 1}
            onClick={() => onChange(formatStops(stops.filter((_, i) => i !== idx)))}
            className="text-muted-foreground disabled:opacity-30"
          >
            x
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const mid = stops.length > 1 ? (stops[stops.length - 2].offset + stops[stops.length - 1].offset) / 2 : 0.5
          onChange(formatStops([...stops, { offset: mid, color: "#808080" }]))
        }}
      >
        Add Stop
      </Button>
    </div>
  )
}

function histogram(images: ImageData[], channel: string) {
  const hist = new Array(256).fill(0)
  for (const img of images) {
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue
      const value =
        channel === "red" ? img.data[i] :
        channel === "green" ? img.data[i + 1] :
        channel === "blue" ? img.data[i + 2] :
        // Math.round can produce 256 from a value of 255.5 (or float
        // accumulation), which would write past `hist[255]` and corrupt
        // the next typed-array slot. Clamp to a valid bin index.
        Math.min(255, Math.max(0, Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])))
      hist[value]++
    }
  }
  return hist
}

function autoLevels(images: ImageData[], channel: string) {
  const hist = histogram(images, channel)
  const total = hist.reduce((sum, v) => sum + v, 0)
  const lowClip = total * 0.005
  const highClip = total * 0.995
  let sum = 0
  let black = 0
  let white = 255
  for (let i = 0; i < 256; i++) {
    sum += hist[i]
    if (sum >= lowClip) {
      black = i
      break
    }
  }
  sum = 0
  for (let i = 0; i < 256; i++) {
    sum += hist[i]
    if (sum >= highClip) {
      white = i
      break
    }
  }
  return { black, white: Math.max(black + 1, white) }
}

function matchSourceOptions(documents: PsDocument[]): [string, string][] {
  const out: [string, string][] = []
  for (const doc of documents) {
    out.push([`doc:${doc.id}`, `${doc.name} (Merged)`])
    for (const layer of doc.layers) {
      if (layer.kind === "group") continue
      out.push([`layer:${doc.id}:${layer.id}`, `${doc.name} / ${layer.name}`])
    }
  }
  return out
}

function matchSourceData(value: string, documents: PsDocument[]) {
  const [type, docId, layerId] = value.split(":")
  const doc = documents.find((d) => d.id === docId)
  if (!doc) return null
  if (type === "layer" && layerId) {
    const layer = doc.layers.find((l) => l.id === layerId)
    if (!layer || typeof layer.canvas.getContext !== "function") return null
    return layer.canvas.getContext("2d")!.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  }
  const canvas = document.createElement("canvas")
  canvas.width = doc.width
  canvas.height = doc.height
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, doc.width, doc.height)
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group" || typeof layer.canvas.getContext !== "function") continue
    compositeLayer(ctx, layer.canvas, layer.blendMode, layer.opacity, layer.fillOpacity ?? 1)
  }
  return ctx.getImageData(0, 0, doc.width, doc.height)
}

function parsePoints(value: string) {
  const points = value
    .split(";")
    .map((entry) => entry.split(",").map((n) => Number(n)))
    .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([x, y]) => [clamp255(x), clamp255(y)] as [number, number])
    .sort((a, b) => a[0] - b[0])
  if (!points.some((p) => p[0] === 0)) points.unshift([0, 0])
  if (!points.some((p) => p[0] === 255)) points.push([255, 255])
  return points
}

function formatPoints(points: [number, number][]) {
  return points
    .map(([x, y]) => [clamp255(x), clamp255(y)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .map(([x, y]) => `${x},${y}`)
    .join(";")
}

function curveLut(points: [number, number][]) {
  const lut = new Uint8ClampedArray(256)
  for (let x = 0; x < 256; x++) {
    let j = 0
    while (j < points.length - 2 && x > points[j + 1][0]) j++
    const a = points[j]
    const b = points[j + 1]
    const t = (x - a[0]) / Math.max(1, b[0] - a[0])
    lut[x] = clamp255(a[1] + (b[1] - a[1]) * t)
  }
  return lut
}

function nearestPoint(points: [number, number][], x: number, y: number, radius = 18) {
  let best: number | null = null
  let bestDist = radius
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - x, points[i][1] - y)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

function parseStops(value: string) {
  const stops = value
    .split(";")
    .map((entry) => {
      const [offset, color] = entry.split(",")
      return { offset: clamp01(Number(offset)), color: /^#[0-9a-f]{6}$/i.test(color ?? "") ? color : "#000000" }
    })
    .filter((s) => Number.isFinite(s.offset))
    .sort((a, b) => a.offset - b.offset)
  if (!stops.length) return [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }]
  if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 })
  if (stops[stops.length - 1].offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 })
  return stops
}

function formatStops(stops: { offset: number; color: string }[]) {
  return stops
    .map((s) => ({ offset: clamp01(s.offset), color: s.color }))
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${round3(s.offset)},${s.color}`)
    .join(";")
}

function clamp255(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function round3(v: number) {
  return Math.round(v * 1000) / 1000
}

function num(value: ParamValue | undefined, fallback = 0) {
  return typeof value === "number" ? value : fallback
}

function bool(value: ParamValue | undefined, fallback = false) {
  return typeof value === "boolean" ? value : fallback
}

function title(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}
