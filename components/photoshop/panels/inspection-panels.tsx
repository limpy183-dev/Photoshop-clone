"use client"

import * as React from "react"
import { useEditor, useRenderSubscription } from "../editor-context"
import { compositeLayer } from "../blend-modes"
import { getFilter } from "../filters"
import { applyLayerStyle } from "../layer-styles"
import { Slider } from "@/components/ui/slider"
import type { BlendMode, Layer, PsDocument } from "../types"
import { requestCanvasZoom } from "../zoom-events"

function makePanelCanvas(w: number, h: number) {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.floor(w))
  c.height = Math.max(1, Math.floor(h))
  return c
}

function drawLayerForPanel(ctx: CanvasRenderingContext2D, layer: Layer) {
  const content = applySmartFiltersForPanel(layer.canvas, layer.smartFilters)
  const renderLayer = content === layer.canvas ? layer : { ...layer, canvas: content }
  const styleRendered = !!layer.style
  let toDraw = styleRendered ? applyLayerStyle(renderLayer, renderLayer.fillOpacity ?? 1) : content
  if (layer.mask) {
    const tmp = makePanelCanvas(toDraw.width, toDraw.height)
    const tctx = tmp.getContext("2d")!
    tctx.drawImage(toDraw, 0, 0)
    tctx.globalCompositeOperation = "destination-in"
    tctx.drawImage(layer.mask, 0, 0)
    toDraw = tmp
  }
  compositeLayer(ctx, toDraw, layer.blendMode, layer.opacity, styleRendered ? 1 : layer.fillOpacity ?? 1)
}

function renderComposite(doc: PsDocument, scale = 1) {
  const c = makePanelCanvas(doc.width * scale, doc.height * scale)
  const ctx = c.getContext("2d")!
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, c.width, c.height)
  if (scale !== 1) ctx.scale(scale, scale)
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group" || typeof layer.canvas.getContext !== "function") continue
    let clipMask: HTMLCanvasElement | null = null
    if (layer.clipped) {
      const idx = doc.layers.indexOf(layer)
      for (let j = idx - 1; j >= 0; j--) {
        if (!doc.layers[j].clipped) {
          clipMask = doc.layers[j].canvas
          break
        }
      }
    }
    if (layer.kind === "adjustment" && layer.adjustment) {
      applyAdjustmentForPanel(ctx, layer, doc.width, doc.height, clipMask)
      continue
    }
    drawLayerForPanel(ctx, layer)
  }
  return c
}

function paramsWithDefaults(filter: NonNullable<ReturnType<typeof getFilter>>, params: Record<string, number | string | boolean>) {
  const out: Record<string, number | string | boolean> = {}
  for (const param of filter.params) {
    const raw = params[param.key] ?? param.default
    if (param.type === "slider") {
      const numeric = typeof raw === "number" ? raw : Number(raw)
      out[param.key] = Math.max(param.min, Math.min(param.max, Number.isFinite(numeric) ? numeric : param.default))
    } else if (param.type === "checkbox") {
      out[param.key] = raw === true
    } else if (param.type === "select") {
      out[param.key] = param.options.some((option) => option.value === raw) ? raw : param.default
    } else {
      out[param.key] = typeof raw === "string" ? raw : param.default
    }
  }
  return out
}

function imageDataToCanvas(data: ImageData) {
  const c = makePanelCanvas(data.width, data.height)
  c.getContext("2d")!.putImageData(data, 0, 0)
  return c
}

function maskAmountAt(mask: ImageData | null, x: number, y: number) {
  if (!mask || x >= mask.width || y >= mask.height) return 1
  const i = (y * mask.width + x) * 4
  const luminance = (mask.data[i] + mask.data[i + 1] + mask.data[i + 2]) / 765
  return luminance * (mask.data[i + 3] / 255)
}

function smartFilterResult(
  before: ImageData,
  after: ImageData,
  smartFilter: NonNullable<Layer["smartFilters"]>[number],
  width: number,
  height: number,
) {
  const opacity = Math.max(0, Math.min(1, smartFilter.opacity ?? 1))
  if (opacity <= 0) return before
  const blendMode = (smartFilter.blendMode ?? "normal") as BlendMode
  const maskCtx = smartFilter.maskEnabled === false ? null : smartFilter.mask?.getContext("2d") ?? null
  const mask = maskCtx
    ? maskCtx.getImageData(0, 0, Math.min(smartFilter.mask!.width, width), Math.min(smartFilter.mask!.height, height))
    : null
  if (!mask && opacity >= 1 && blendMode === "normal") return after
  const overlay = new ImageData(new Uint8ClampedArray(after.data), width, height)
  if (mask) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        overlay.data[i + 3] = Math.round(overlay.data[i + 3] * maskAmountAt(mask, x, y))
      }
    }
  }
  const baseCanvas = imageDataToCanvas(before)
  compositeLayer(baseCanvas.getContext("2d")!, imageDataToCanvas(overlay), blendMode, opacity)
  return baseCanvas.getContext("2d")!.getImageData(0, 0, width, height)
}

function applySmartFiltersForPanel(source: HTMLCanvasElement, smartFilters: Layer["smartFilters"]) {
  const enabled = smartFilters?.filter((sf) => sf.enabled) ?? []
  if (!enabled.length) return source
  const c = makePanelCanvas(source.width, source.height)
  const ctx = c.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  let current = ctx.getImageData(0, 0, c.width, c.height)
  for (const smartFilter of enabled) {
    const filter = getFilter(smartFilter.filterId)
    if (!filter) continue
    const before = current
    const after = filter.apply(before, paramsWithDefaults(filter, smartFilter.params))
    current = smartFilterResult(before, after, smartFilter, c.width, c.height)
  }
  ctx.putImageData(current, 0, 0)
  return c
}

function applyAdjustmentForPanel(ctx: CanvasRenderingContext2D, layer: Layer, width: number, height: number, clipMask?: HTMLCanvasElement | null) {
  if (!layer.adjustment) return
  const filter = getFilter(layer.adjustment.type)
  if (!filter) return
  const before = ctx.getImageData(0, 0, width, height)
  const after = filter.apply(before, paramsWithDefaults(filter, layer.adjustment.params))
  const opacity = Math.max(0, Math.min(1, layer.opacity))
  const maskCtx = layer.mask?.getContext("2d") ?? null
  const mask = maskCtx ? maskCtx.getImageData(0, 0, Math.min(layer.mask!.width, width), Math.min(layer.mask!.height, height)) : null
  const clipCtx = clipMask?.getContext("2d") ?? null
  const clip = clipCtx ? clipCtx.getImageData(0, 0, Math.min(clipMask!.width, width), Math.min(clipMask!.height, height)) : null
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const amount = opacity * maskAmountAt(mask, x, y) * maskAmountAt(clip, x, y)
      for (let k = 0; k < 4; k++) {
        after.data[i + k] = before.data[i + k] * (1 - amount) + after.data[i + k] * amount
      }
    }
  }
  ctx.putImageData(after, 0, 0)
}

export function NavigatorPanel() {
  const { activeDoc, dispatch: _dispatch } = useEditor()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  const draw = React.useCallback(() => {
    const out = canvasRef.current
    if (!out || !activeDoc) return
    const maxW = 252
    const scale = Math.min(maxW / activeDoc.width, 150 / activeDoc.height, 1)
    out.width = Math.max(1, Math.round(activeDoc.width * scale))
    out.height = Math.max(1, Math.round(activeDoc.height * scale))
    const ctx = out.getContext("2d")!
    ctx.clearRect(0, 0, out.width, out.height)
    ctx.drawImage(renderComposite(activeDoc, scale), 0, 0)
    const viewW = Math.min(activeDoc.width, activeDoc.width / activeDoc.zoom)
    const viewH = Math.min(activeDoc.height, activeDoc.height / activeDoc.zoom)
    ctx.strokeStyle = "#ef4444"
    ctx.lineWidth = 1
    ctx.strokeRect((activeDoc.width - viewW) * scale * 0.5, (activeDoc.height - viewH) * scale * 0.5, viewW * scale, viewH * scale)
  }, [activeDoc])

  React.useEffect(draw, [draw])
  useRenderSubscription(draw)

  if (!activeDoc) return null

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <div className="ps-checker border border-[var(--ps-divider)] rounded-sm overflow-hidden inline-block">
        <canvas
          ref={canvasRef}
          className="block cursor-crosshair"
          onPointerDown={(e) => {
            const c = e.currentTarget
            const rect = c.getBoundingClientRect()
            const x = ((e.clientX - rect.left) / rect.width) * activeDoc.width
            const y = ((e.clientY - rect.top) / rect.height) * activeDoc.height
            window.dispatchEvent(new CustomEvent("ps-navigator-pan", { detail: { x, y } }))
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--ps-text-dim)] w-10">Zoom</span>
        <Slider
          min={5}
          max={3200}
          step={5}
          value={[Math.round(activeDoc.zoom * 100)]}
          onValueChange={(v) => requestCanvasZoom({ zoom: v[0] / 100 })}
          className="flex-1"
        />
        <span className="tabular-nums w-12 text-right">{Math.round(activeDoc.zoom * 100)}%</span>
      </div>
    </div>
  )
}

type HistogramChannel = "composite" | "rgb" | "red" | "green" | "blue" | "luminosity"

export function HistogramPanel() {
  const { activeDoc } = useEditor()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [channel, setChannel] = React.useState<HistogramChannel>("composite")
  const [stats, setStats] = React.useState({ mean: 0, std: 0, median: 0, pixels: 0 })

  const draw = React.useCallback(() => {
    const out = canvasRef.current
    if (!out || !activeDoc) return
    out.width = 252
    out.height = 112
    const ctx = out.getContext("2d")!
    ctx.clearRect(0, 0, out.width, out.height)
    ctx.fillStyle = "#181818"
    ctx.fillRect(0, 0, out.width, out.height)
    const sampleScale = Math.min(1, 256 / Math.max(activeDoc.width, activeDoc.height))
    const source = renderComposite(activeDoc, sampleScale)
    const img = source.getContext("2d")!.getImageData(0, 0, source.width, source.height)
    const channels = {
      red: new Array<number>(256).fill(0),
      green: new Array<number>(256).fill(0),
      blue: new Array<number>(256).fill(0),
      luminosity: new Array<number>(256).fill(0),
    }
    let count = 0
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue
      const r = img.data[i]
      const g = img.data[i + 1]
      const b = img.data[i + 2]
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      channels.red[r]++
      channels.green[g]++
      channels.blue[b]++
      channels.luminosity[lum]++
      count++
      sum += lum
      sumSq += lum * lum
    }
    const statHist = channels.luminosity
    let running = 0
    let median = 0
    for (let i = 0; i < 256; i++) {
      running += statHist[i]
      if (running >= count / 2) {
        median = i
        break
      }
    }
    const mean = count ? sum / count : 0
    const std = count ? Math.sqrt(sumSq / count - mean * mean) : 0
    setStats({ mean, std, median, pixels: count })

    const drawHist = (hist: number[], color: string, alpha = 0.85) => {
      const max = Math.max(1, ...hist)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = color
      ctx.beginPath()
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * out.width
        const y = out.height - (hist[i] / max) * (out.height - 8)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()
    }

    if (channel === "rgb" || channel === "composite") {
      drawHist(channels.red, "#ef4444", channel === "composite" ? 0.55 : 0.85)
      drawHist(channels.green, "#22c55e", channel === "composite" ? 0.55 : 0.85)
      drawHist(channels.blue, "#3b82f6", channel === "composite" ? 0.55 : 0.85)
      if (channel === "composite") drawHist(channels.luminosity, "#e5e7eb", 0.9)
    } else {
      const map = {
        red: ["#ef4444", channels.red],
        green: ["#22c55e", channels.green],
        blue: ["#3b82f6", channels.blue],
        luminosity: ["#e5e7eb", channels.luminosity],
      } as const
      const [color, hist] = map[channel]
      drawHist(hist, color, 0.95)
    }
  }, [activeDoc, channel])

  React.useEffect(draw, [draw])
  useRenderSubscription(draw)

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[var(--ps-text-dim)]">Channel</span>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as HistogramChannel)}
          className="h-6 flex-1 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1"
        >
          <option value="composite">Composite</option>
          <option value="rgb">RGB</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
          <option value="luminosity">Luminosity</option>
        </select>
      </div>
      <canvas ref={canvasRef} className="block w-full border border-[var(--ps-divider)] rounded-sm" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[var(--ps-text-dim)]">
        <span>Mean: {stats.mean.toFixed(1)}</span>
        <span>Std Dev: {stats.std.toFixed(1)}</span>
        <span>Median: {stats.median}</span>
        <span>Pixels: {stats.pixels.toLocaleString()}</span>
      </div>
    </div>
  )
}

export function InfoPanel() {
  const { activeDoc } = useEditor()
  const compositeRef = React.useRef<HTMLCanvasElement | null>(null)
  const lastRebuildRef = React.useRef(0)
  const rebuildTimerRef = React.useRef<number | null>(null)
  const [mouse, setMouse] = React.useState<{ x: number; y: number; inside: boolean }>({ x: 0, y: 0, inside: false })
  const [rgba, setRgba] = React.useState([0, 0, 0, 0])

  const rebuildNow = React.useCallback(() => {
    if (!activeDoc) return
    compositeRef.current = renderComposite(activeDoc, 1)
    lastRebuildRef.current = performance.now()
  }, [activeDoc])

  const scheduleRebuild = React.useCallback(() => {
    const elapsed = performance.now() - lastRebuildRef.current
    if (elapsed > 180) {
      rebuildNow()
      return
    }
    if (rebuildTimerRef.current !== null) return
    rebuildTimerRef.current = window.setTimeout(() => {
      rebuildTimerRef.current = null
      rebuildNow()
    }, 180 - elapsed)
  }, [rebuildNow])

  React.useEffect(() => {
    rebuildNow()
    return () => {
      if (rebuildTimerRef.current !== null) window.clearTimeout(rebuildTimerRef.current)
    }
  }, [rebuildNow])
  useRenderSubscription(scheduleRebuild)

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number; inside: boolean }>).detail
      if (!detail) return
      setMouse(detail)
      const c = compositeRef.current
      if (!c || !detail.inside) return
      const px = c.getContext("2d")!.getImageData(Math.floor(detail.x), Math.floor(detail.y), 1, 1).data
      setRgba([px[0], px[1], px[2], px[3]])
    }
    window.addEventListener("ps-mousemove", handler)
    return () => window.removeEventListener("ps-mousemove", handler)
  }, [])

  const hsb = rgbToHsb(rgba[0], rgba[1], rgba[2])
  const lab = rgbToLab(rgba[0], rgba[1], rgba[2])
  const measurement = activeDoc?.measurement
  const length = measurement ? Math.hypot(measurement.x2 - measurement.x1, measurement.y2 - measurement.y1) : 0
  const angle = measurement ? (Math.atan2(measurement.y2 - measurement.y1, measurement.x2 - measurement.x1) * 180) / Math.PI : 0

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <InfoSection title="Cursor">
        <InfoRow label="X/Y" value={mouse.inside ? `${Math.round(mouse.x)}, ${Math.round(mouse.y)} px` : "Outside canvas"} />
        <InfoRow label="RGBA" value={`${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${Math.round((rgba[3] / 255) * 100)}%`} />
        <InfoRow label="HSB" value={`${hsb.h.toFixed(0)} / ${hsb.s.toFixed(0)} / ${hsb.b.toFixed(0)}`} />
        <InfoRow label="Lab" value={`${lab.l.toFixed(0)} / ${lab.a.toFixed(0)} / ${lab.b.toFixed(0)}`} />
      </InfoSection>
      <InfoSection title="Document">
        <InfoRow label="Size" value={activeDoc ? `${activeDoc.width} x ${activeDoc.height}px` : "-"} />
        <InfoRow label="Mode" value={activeDoc ? `${activeDoc.colorMode}, ${activeDoc.bitDepth}-bit` : "-"} />
        <InfoRow label="Selection" value={activeDoc?.selection.bounds ? `${Math.round(activeDoc.selection.bounds.w)} x ${Math.round(activeDoc.selection.bounds.h)}px` : "None"} />
      </InfoSection>
      <InfoSection title="Measurement">
        <InfoRow label="Length" value={measurement ? `${length.toFixed(1)} px` : "None"} />
        <InfoRow label="Angle" value={measurement ? `${angle.toFixed(1)} deg` : "-"} />
      </InfoSection>
      <InfoSection title="Samplers">
        {activeDoc?.colorSamplers?.length ? (
          activeDoc.colorSamplers.map((sampler) => (
            <InfoRow
              key={sampler.id}
              label={sampler.label}
              value={`${Math.round(sampler.x)}, ${Math.round(sampler.y)}  RGB ${sampler.rgba[0]}, ${sampler.rgba[1]}, ${sampler.rgba[2]}`}
            />
          ))
        ) : (
          <InfoRow label="1-4" value="No persistent samples" />
        )}
      </InfoSection>
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--ps-divider)] rounded-sm">
      <div className="px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)] bg-[var(--ps-panel-2)] border-b border-[var(--ps-divider)]">
        {title}
      </div>
      <div className="p-2 space-y-1">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[var(--ps-text-dim)]">{label}</span>
      <span className="flex-1 tabular-nums truncate">{value}</span>
    </div>
  )
}

function rgbToHsb(r: number, g: number, b: number) {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60
    else if (max === gg) h = ((bb - rr) / d + 2) * 60
    else h = ((rr - gg) / d + 4) * 60
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, b: max * 100 }
}

function rgbToLab(r: number, g: number, b: number) {
  const pivotRgb = (v: number) => {
    const n = v / 255
    return n > 0.04045 ? Math.pow((n + 0.055) / 1.055, 2.4) : n / 12.92
  }
  const rr = pivotRgb(r)
  const gg = pivotRgb(g)
  const bb = pivotRgb(b)
  const x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047
  const y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1
  const z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883
  const pivot = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const fx = pivot(x)
  const fy = pivot(y)
  const fz = pivot(z)
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}
