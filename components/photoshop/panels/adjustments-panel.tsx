"use client"

import * as React from "react"
import { useEditor, makeCanvas } from "../editor-context"
import { FILTERS, type FilterParam } from "../filters"
import { renderDocumentComposite } from "../document-io"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { CircleDot, Link, PaintBucket, SlidersHorizontal } from "lucide-react"
import type { AdjustmentType, Layer } from "../types"

const ADJUSTMENTS: AdjustmentType[] = [
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hue-saturation",
  "color-balance",
  "black-white",
  "photo-filter",
  "channel-mixer",
  "color-lookup",
  "invert",
  "posterize",
  "threshold",
  "gradient-map",
  "selective-color",
  "shadows-highlights",
]

export function AdjustmentsPanel() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [clipToBelow, setClipToBelow] = React.useState(false)
  const [withMask, setWithMask] = React.useState(true)

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const adjustmentLayer = activeLayer?.kind === "adjustment" && activeLayer.adjustment ? activeLayer : null

  const createAdjustmentLayer = (filterId: AdjustmentType) => {
    const filter = FILTERS[filterId]
    if (!filter) return
    const params: Record<string, number | string | boolean> = {}
    for (const param of filter.params) params[param.key] = param.default
    const layer: Layer = {
      id: `adj_${Math.random().toString(36).slice(2, 9)}`,
      name: filter.name,
      kind: "adjustment",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      clipped: clipToBelow,
      canvas: makeCanvas(activeDoc.width, activeDoc.height),
      mask: withMask ? makeCanvas(activeDoc.width, activeDoc.height, "#ffffff") : null,
      adjustment: { type: filterId, params },
    }
    dispatch({ type: "add-layer", layer })
    requestRender()
    window.setTimeout(() => commit(`New ${filter.name} Adjustment`, [layer.id]), 0)
  }

  const updateAdjustmentParam = (param: string, value: number | string | boolean) => {
    if (!adjustmentLayer?.adjustment) return
    dispatch({
      type: "set-layer-adjustment",
      id: adjustmentLayer.id,
      adjustment: {
        ...adjustmentLayer.adjustment,
        params: { ...adjustmentLayer.adjustment.params, [param]: value },
      },
    })
    requestRender()
  }

  const setMaskFill = (fill: "#ffffff" | "#000000") => {
    if (!adjustmentLayer) return
    dispatch({ type: "set-layer-mask", id: adjustmentLayer.id, mask: makeCanvas(activeDoc.width, activeDoc.height, fill) })
    requestRender()
    window.setTimeout(() => commit(fill === "#ffffff" ? "Reveal Adjustment Mask" : "Hide Adjustment Mask", [adjustmentLayer.id]), 0)
  }

  const invertMask = () => {
    if (!adjustmentLayer?.mask) return
    const mask = makeCanvas(adjustmentLayer.mask.width, adjustmentLayer.mask.height)
    const ctx = mask.getContext("2d")!
    ctx.drawImage(adjustmentLayer.mask, 0, 0)
    const img = ctx.getImageData(0, 0, mask.width, mask.height)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 255 - img.data[i]
      img.data[i + 1] = 255 - img.data[i + 1]
      img.data[i + 2] = 255 - img.data[i + 2]
    }
    ctx.putImageData(img, 0, 0)
    dispatch({ type: "set-layer-mask", id: adjustmentLayer.id, mask })
    requestRender()
    window.setTimeout(() => commit("Invert Adjustment Mask", [adjustmentLayer.id]), 0)
  }

  const filterDef = adjustmentLayer ? FILTERS[adjustmentLayer.adjustment!.type] : null

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="border-b border-[var(--ps-divider)] p-2">
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase text-[var(--ps-text-dim)]">
          <CircleDot className="h-3 w-3" />
          Add Adjustment
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1">
          {ADJUSTMENTS.map((id) => (
            <button
              key={id}
              type="button"
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-left text-[10px] hover:bg-[var(--ps-tool-hover)]"
              onClick={() => createAdjustmentLayer(id)}
            >
              {FILTERS[id]?.name ?? id}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-[var(--ps-text-dim)]">
          <label className="flex items-center gap-2">
            <Checkbox checked={clipToBelow} onCheckedChange={(v) => setClipToBelow(v === true)} />
            Clip below
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={withMask} onCheckedChange={(v) => setWithMask(v === true)} />
            White mask
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!adjustmentLayer || !filterDef ? (
          <PanelEmpty text="Select an adjustment layer to edit its properties." />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{filterDef.name}</div>
                <div className="text-[10px] text-[var(--ps-text-dim)]">{adjustmentLayer.clipped ? "Clipped to layer below" : "Affects visible stack"}</div>
              </div>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
                onClick={() => {
                  dispatch({ type: "toggle-layer-clipped", id: adjustmentLayer.id })
                  requestRender()
                  window.setTimeout(() => commit("Toggle Adjustment Clipping", [adjustmentLayer.id]), 0)
                }}
              >
                <Link className="h-3 w-3" />
                Clip
              </button>
            </div>

            <div className="rounded-sm border border-[var(--ps-divider)]">
              <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
                <SlidersHorizontal className="h-3 w-3" />
                Controls
              </div>
              <div className="space-y-2 p-2">
                <AdjustmentVisual doc={activeDoc} layer={adjustmentLayer} />
                {filterDef.params.map((param) => (
                  <AdjustmentParamControl
                    key={param.key}
                    param={param}
                    value={adjustmentLayer.adjustment!.params[param.key] ?? param.default}
                    onChange={(value) => updateAdjustmentParam(param.key, value)}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-sm border border-[var(--ps-divider)]">
              <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
                <PaintBucket className="h-3 w-3" />
                Mask
              </div>
              <div className="space-y-2 p-2">
                <div className="flex items-center gap-2">
                  <MaskPreview mask={adjustmentLayer.mask} />
                  <div className="min-w-0 flex-1 text-[10px] text-[var(--ps-text-dim)]">
                    {adjustmentLayer.mask ? "Editable grayscale adjustment mask." : "No mask on this adjustment."}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <MiniButton onClick={() => setMaskFill("#ffffff")}>Reveal</MiniButton>
                  <MiniButton onClick={() => setMaskFill("#000000")}>Hide</MiniButton>
                  <MiniButton disabled={!adjustmentLayer.mask} onClick={invertMask}>Invert</MiniButton>
                  <MiniButton
                    disabled={!adjustmentLayer.mask}
                    onClick={() => {
                      dispatch({ type: "set-layer-mask", id: adjustmentLayer.id, mask: null })
                      requestRender()
                      window.setTimeout(() => commit("Remove Adjustment Mask", [adjustmentLayer.id]), 0)
                    }}
                  >
                    Remove
                  </MiniButton>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AdjustmentVisual({ doc, layer }: { doc: NonNullable<ReturnType<typeof useEditor>["activeDoc"]>; layer: Layer }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas || !layer.adjustment) return
    canvas.width = 252
    canvas.height = 92
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#141414"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#2f2f2f"
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * canvas.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    if (layer.adjustment.type === "curves") {
      const shadow = Number(layer.adjustment.params.shadow ?? 0)
      const midtone = Number(layer.adjustment.params.midtone ?? 128)
      const highlight = Number(layer.adjustment.params.highlight ?? 255)
      ctx.strokeStyle = "#38bdf8"
      ctx.beginPath()
      ctx.moveTo(0, canvas.height - (shadow / 255) * canvas.height)
      ctx.quadraticCurveTo(canvas.width / 2, canvas.height - (midtone / 255) * canvas.height, canvas.width, canvas.height - (highlight / 255) * canvas.height)
      ctx.stroke()
      return
    }
    if (layer.adjustment.type === "hue-saturation") {
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0)
      ;["#f00", "#ff0", "#0f0", "#0ff", "#00f", "#f0f", "#f00"].forEach((color, i) => grad.addColorStop(i / 6, color))
      ctx.fillStyle = grad
      ctx.fillRect(0, 20, canvas.width, 52)
      return
    }
    const source = renderDocumentComposite(doc, { transparent: false, matte: "#000000" })
    const sampleScale = Math.min(1, 192 / Math.max(source.width, source.height))
    const tmp = makeCanvas(Math.max(1, Math.round(source.width * sampleScale)), Math.max(1, Math.round(source.height * sampleScale)))
    tmp.getContext("2d")!.drawImage(source, 0, 0, tmp.width, tmp.height)
    const img = tmp.getContext("2d")!.getImageData(0, 0, tmp.width, tmp.height)
    const hist = new Array<number>(256).fill(0)
    for (let i = 0; i < img.data.length; i += 4) {
      const lum = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
      hist[lum]++
    }
    const max = Math.max(1, ...hist)
    ctx.strokeStyle = "#d1d5db"
    ctx.beginPath()
    hist.forEach((count, i) => {
      const x = (i / 255) * canvas.width
      const y = canvas.height - (count / max) * (canvas.height - 8)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [doc, layer])
  return <canvas ref={ref} className="block w-full rounded-sm border border-[var(--ps-divider)]" />
}

function AdjustmentParamControl({
  param,
  value,
  onChange,
}: {
  param: FilterParam
  value: number | string | boolean
  onChange: (value: number | string | boolean) => void
}) {
  if (param.type === "slider") {
    const n = typeof value === "number" ? value : Number(param.default) || 0
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[var(--ps-text-dim)]">{param.label}</span>
          <span className="tabular-nums">{n.toFixed(param.step && param.step < 1 ? 1 : 0)}{param.suffix ?? ""}</span>
        </div>
        <Slider min={param.min} max={param.max} step={param.step ?? 1} value={[n]} onValueChange={(v) => onChange(v[0])} />
      </div>
    )
  }
  if (param.type === "select") {
    return (
      <label className="grid gap-1 text-[10px]">
        <span className="text-[var(--ps-text-dim)]">{param.label}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[11px]"
        >
          {param.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    )
  }
  if (param.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-[10px]">
        <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        {param.label}
      </label>
    )
  }
  return null
}

function MaskPreview({ mask }: { mask?: HTMLCanvasElement | null }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const dst = ref.current
    if (!dst) return
    const ctx = dst.getContext("2d")!
    ctx.clearRect(0, 0, dst.width, dst.height)
    ctx.fillStyle = "#222"
    ctx.fillRect(0, 0, dst.width, dst.height)
    if (mask) ctx.drawImage(mask, 0, 0, dst.width, dst.height)
    else {
      ctx.strokeStyle = "#777"
      ctx.strokeRect(4, 4, dst.width - 8, dst.height - 8)
      ctx.beginPath()
      ctx.moveTo(5, 5)
      ctx.lineTo(dst.width - 5, dst.height - 5)
      ctx.stroke()
    }
  }, [mask])
  return <canvas ref={ref} width={36} height={24} className="rounded-sm border border-[var(--ps-divider)]" />
}

function MiniButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-7 rounded-sm border border-[var(--ps-divider)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
