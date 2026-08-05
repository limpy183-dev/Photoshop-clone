/**
 * The two dab kinds that read pixels back before they write them: the
 * background eraser and the colour-replacement brush. Both match a sampled
 * colour inside the dab footprint, optionally restrict the match to the region
 * connected to the cursor, and then write per-pixel rather than compositing a
 * prepared dab — which is why they live apart from `brush-stamping.ts`.
 */

import { resolveColorReplacementPixel, type BrushDynamicsInput } from "@/editor/brush-engine"
import { applyCanvasBrushShapeDynamics, applyCanvasBrushTransfer } from "@/editor/canvas/brush-dynamics"
import { colorDistance, connectedEraserMask, localPatchGradient } from "@/editor/canvas/eraser-helpers"
import { dabTouchesSelection } from "@/editor/canvas/selection-helpers"
import { clamp01 } from "@/editor/canvas/view-helpers"
import { hexToRgb } from "@/editor/tool/helpers"
import type { BrushSettings, EraserSettings, PsDocument } from "@/editor/types"

export interface SampledRgba {
  r: number
  g: number
  b: number
  a: number
}

const DEFAULT_COLOR_REPLACEMENT = {
  sampling: "continuous" as const,
  limits: "contiguous" as const,
  mode: "color" as const,
  tolerance: 32,
  antiAlias: true,
}

export function colorReplacementSettings(brush: BrushSettings) {
  return brush.colorReplacement ?? DEFAULT_COLOR_REPLACEMENT
}

/** Dab footprint clamped to the target canvas, or null when fully off-canvas. */
function dabRegion(canvas: HTMLCanvasElement, x: number, y: number, radius: number) {
  const x0 = Math.max(0, Math.floor(x - radius))
  const y0 = Math.max(0, Math.floor(y - radius))
  const x1 = Math.min(canvas.width, Math.ceil(x + radius))
  const y1 = Math.min(canvas.height, Math.ceil(y + radius))
  const w = x1 - x0
  const h = y1 - y0
  return w > 0 && h > 0 ? { x0, y0, w, h } : null
}

/** Hard-centre falloff shared by both stamps: 1 inside `r * hardness`, ramping to 0 at `r`. */
function brushFalloff(dist: number, r: number, hardness: number) {
  if (hardness >= 1 || dist <= r * hardness) return 1
  return Math.max(0, 1 - (dist - r * hardness) / Math.max(1, r * (1 - hardness)))
}

export interface SelectiveEraserStampContext {
  document: PsDocument | null | undefined
  layerCanvas: HTMLCanvasElement | null
  brush: BrushSettings
  eraser: EraserSettings
  foreground: string
  background: string
  /** Layer pixels frozen at stroke start, so a dab never samples its own output. */
  sourceCanvas: HTMLCanvasElement | null
  /** Holds the "sample once" colour for the life of the stroke. */
  sample: { current: SampledRgba | null }
  enforceTransparencyLock: (ctx: CanvasRenderingContext2D) => void
}

/** Background eraser: erase only pixels matching the sampled colour under the cursor. */
export function selectiveEraserStamp(
  context: SelectiveEraserStampContext,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  input: BrushDynamicsInput,
) {
  const { document: doc, brush, eraser, foreground, background } = context
  if (!context.layerCanvas || !doc || doc.quickMask) return
  const sourceCanvas = context.sourceCanvas ?? context.layerCanvas
  const { dabSize } = applyCanvasBrushShapeDynamics(brush, input)
  const { opaMul, flowMul } = applyCanvasBrushTransfer(brush, input)
  const r = Math.max(1, Math.floor(dabSize / 2))
  const region = dabRegion(ctx.canvas, x, y, r)
  if (!region) return
  const { x0, y0, w, h } = region

  const srcCtx = sourceCanvas.getContext("2d")!
  const src = srcCtx.getImageData(x0, y0, w, h)
  // Reuse the region read for the centre sample instead of a separate
  // getImageData(1,1) per dab — same source canvas, same pixel data.
  const centerSx = Math.max(0, Math.min(w - 1, Math.floor(x) - x0))
  const centerSy = Math.max(0, Math.min(h - 1, Math.floor(y) - y0))
  const sIdx = (centerSy * w + centerSx) * 4
  const sample =
    eraser.sampling === "background-swatch"
      ? { ...hexToRgb(background), a: 255 }
      : eraser.sampling === "once" && context.sample.current
        ? context.sample.current
        : { r: src.data[sIdx], g: src.data[sIdx + 1], b: src.data[sIdx + 2], a: src.data[sIdx + 3] }
  if (eraser.sampling === "once" && !context.sample.current) context.sample.current = sample
  const fg = hexToRgb(foreground)

  const dest = ctx.getImageData(x0, y0, w, h)
  const matched = new Uint8Array(w * h)
  const hard = clamp01(brush.hardness / 100)
  const tolerance = Math.max(0, eraser.tolerance)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const docX = x0 + px
      const docY = y0 + py
      const dist = Math.hypot(docX - x, docY - y)
      if (dist > r) continue
      const i = (py * w + px) * 4
      const color = { r: src.data[i], g: src.data[i + 1], b: src.data[i + 2], a: src.data[i + 3] }
      if (color.a <= 0) continue
      if (eraser.protectForeground && colorDistance(color, fg) <= Math.max(12, tolerance * 0.85)) continue
      if (colorDistance(color, sample) <= tolerance) matched[py * w + px] = 1
    }
  }

  const allowed =
    eraser.limits === "discontiguous"
      ? matched
      : connectedEraserMask(matched, w, h, Math.max(0, Math.min(w - 1, Math.floor(x - x0))), Math.max(0, Math.min(h - 1, Math.floor(y - y0))))

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const p = py * w + px
      if (!allowed[p]) continue
      const docX = x0 + px
      const docY = y0 + py
      const brushAlpha = brushFalloff(Math.hypot(docX - x, docY - y), r, hard)
      const i = p * 4
      let edgeFactor = 1
      if (eraser.limits === "find-edges") {
        const edge = localPatchGradient(src, px, py, w, h)
        edgeFactor = edge > tolerance * 1.65 ? 0.25 : 1
      }
      const amount = clamp01((brush.opacity / 100) * (brush.flow / 100) * opaMul * flowMul * brushAlpha * edgeFactor)
      dest.data[i + 3] = Math.round(dest.data[i + 3] * (1 - amount))
    }
  }
  ctx.putImageData(dest, x0, y0)
  context.enforceTransparencyLock(ctx)
}

export interface ColorReplacementStampContext {
  document: PsDocument | null | undefined
  hasActiveLayer: boolean
  brush: BrushSettings
  foreground: string
  background: string
  /** Layer pixels frozen at stroke start; falls back to the live target canvas. */
  sourceCanvas: HTMLCanvasElement | null
  sample: { current: SampledRgba | null }
}

/** Colour-replacement brush: recolour matching pixels, preserving the chosen channel set. */
export function colorReplacementStamp(
  context: ColorReplacementStampContext,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dabSize: number,
  input: BrushDynamicsInput,
  opacity: number,
) {
  const { document: doc, brush, foreground, background } = context
  if (!context.hasActiveLayer || !dabTouchesSelection(doc, x, y, dabSize)) return
  const settings = colorReplacementSettings(brush)
  const r = Math.max(1, Math.floor(dabSize / 2))
  const region = dabRegion(ctx.canvas, x, y, r)
  if (!region) return
  const { x0, y0, w, h } = region

  const sourceCanvas = context.sourceCanvas ?? ctx.canvas
  const source = sourceCanvas.getContext("2d")!.getImageData(x0, y0, w, h)
  const dest = ctx.getImageData(x0, y0, w, h)
  const centerSx = Math.max(0, Math.min(w - 1, Math.floor(x) - x0))
  const centerSy = Math.max(0, Math.min(h - 1, Math.floor(y) - y0))
  const centerIdx = (centerSy * w + centerSx) * 4
  const sample =
    settings.sampling === "background-swatch"
      ? { ...hexToRgb(background), a: 255 }
      : settings.sampling === "once" && context.sample.current
        ? context.sample.current
        : {
          r: source.data[centerIdx],
          g: source.data[centerIdx + 1],
          b: source.data[centerIdx + 2],
          a: source.data[centerIdx + 3],
        }
  if (settings.sampling === "once" && !context.sample.current) {
    context.sample.current = sample
  }
  const replacement = { ...hexToRgb(foreground), a: 255 }
  const matched = new Uint8Array(w * h)
  const hard = clamp01(brush.hardness / 100)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const p = py * w + px
      const docX = x0 + px
      const docY = y0 + py
      if (Math.hypot(docX - x, docY - y) > r) continue
      const i = p * 4
      const candidate = { r: source.data[i], g: source.data[i + 1], b: source.data[i + 2], a: source.data[i + 3] }
      if (candidate.a <= 0) continue
      if (colorDistance(candidate, sample) <= settings.tolerance) matched[p] = 1
    }
  }
  const allowed =
    settings.limits === "discontiguous"
      ? matched
      : connectedEraserMask(matched, w, h, centerSx, centerSy)
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const p = py * w + px
      if (!allowed[p]) continue
      const docX = x0 + px
      const docY = y0 + py
      const brushAlpha = brushFalloff(Math.hypot(docX - x, docY - y), r, hard)
      if (!settings.antiAlias && brushAlpha < 0.5) continue
      let edgeFactor = 1
      if (settings.limits === "find-edges") {
        const edge = localPatchGradient(source, px, py, w, h)
        edgeFactor = edge > settings.tolerance * 1.65 ? 0.28 : 1
      }
      const i = p * 4
      const replaced = resolveColorReplacementPixel({
        source: { r: dest.data[i], g: dest.data[i + 1], b: dest.data[i + 2], a: dest.data[i + 3] },
        sample,
        replacement,
        tolerance: settings.tolerance,
        mode: settings.mode,
        opacity: opacity * brushAlpha * edgeFactor * (input.pressure || 1),
      })
      if (!replaced.changed) continue
      dest.data[i] = replaced.pixel.r
      dest.data[i + 1] = replaced.pixel.g
      dest.data[i + 2] = replaced.pixel.b
      dest.data[i + 3] = replaced.pixel.a
    }
  }
  ctx.putImageData(dest, x0, y0)
}
