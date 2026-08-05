/**
 * Everything that turns one brush sample into pixels on a canvas.
 *
 * The entry point is `stampSymmetric` (or `stampWithScatter`, which fans out to
 * it): resolve the dab's shape from the brush dynamics, pick the cheapest way
 * to draw it, then mirror it for whatever symmetry axis is active. Stroke
 * walking and stroke lifecycle live elsewhere — this file only knows about a
 * single point in document space.
 */

import {
  resolveBristleTipSimulation,
  resolveErodibleTipSimulation,
  type BrushDynamicsInput,
  type BrushTipSimulation,
} from "@/editor/brush-engine"
import {
  applyCanvasBrushColorDynamics,
  applyCanvasBrushShapeDynamics,
  applyCanvasBrushTransfer,
} from "@/editor/canvas/brush-dynamics"
import { colorReplacementStamp, type SampledRgba } from "@/editor/canvas/replacement-stamps"
import { dabTouchesSelection } from "@/editor/canvas/selection-helpers"
import { makeCanvas } from "@/editor/canvas/utils"
import { clamp01, hashNoise } from "@/editor/canvas/view-helpers"
import { hexToRgba } from "@/editor/color/utils"
import { hexToRgb } from "@/editor/tool/helpers"
import type { BrushSettings, PsDocument, SymmetrySettings, ToolId } from "@/editor/types"

export interface StampOptions {
  includeBrushOpacity?: boolean
  enforceTransparencyLock?: boolean
  drawEraserMask?: boolean
  opacityMultiplier?: number
}

/** Base dab shape kept between dabs; only round/square tips are position-independent. */
export interface DabShapeCache {
  key: string
  canvas: HTMLCanvasElement
  side: number
}

export interface BrushStampContext {
  tool: ToolId
  brush: BrushSettings
  foreground: string
  background: string
  symmetry: SymmetrySettings
  document: PsDocument | null | undefined
  hasActiveLayer: boolean
  dabShapeCache: { current: DabShapeCache | null }
  /** Colour-replacement stroke state, threaded through to that stamp. */
  colorReplacementSource: HTMLCanvasElement | null
  colorReplacementSample: { current: SampledRgba | null }
  enforceTransparencyLock: (ctx: CanvasRenderingContext2D) => void
}

export function isEraserPaintTool(tool: ToolId) {
  return tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser"
}

/** In quick-mask mode, whether a dab removes from the mask instead of adding to it. */
export function quickMaskPaintsSubtract(document: PsDocument | null | undefined, tool: ToolId) {
  if (!document?.quickMask) return false
  const mode = document.quickMaskPaintMode ?? "auto"
  if (mode === "subtract") return true
  if (mode === "add") return false
  return isEraserPaintTool(tool)
}

function canUseFastBrushDab(brush: BrushSettings) {
  const tip = brush.tipShape ?? "round"
  return (
    (tip === "round" || tip === "square") &&
    !brush.texture?.enabled &&
    !brush.dualBrush?.enabled &&
    !brush.wetEdges &&
    !brush.noise
  )
}

/**
 * A stroke with no per-dab variation at all: every dab is the same shape, so
 * spacing can be tightened below the configured value to hide the seams
 * without the cost of re-deriving a dab each step.
 */
export function isPlainContinuousPaintStroke(tool: ToolId, brush: BrushSettings) {
  const tip = brush.tipShape ?? "round"
  const paintTool =
    tool === "brush" ||
    tool === "mixer-brush" ||
    tool === "pattern-stamp" ||
    tool === "eraser" ||
    tool === "color-replace" ||
    tool === "background-eraser" ||
    tool === "magic-eraser"
  return (
    paintTool &&
    (tip === "round" || tip === "square") &&
    (brush.scatter ?? 0) <= 0 &&
    (brush.scatterCount ?? 1) <= 1 &&
    (brush.scatterCountJitter ?? 0) <= 0 &&
    !brush.texture?.enabled &&
    !brush.dualBrush?.enabled &&
    !brush.wetEdges &&
    !brush.noise &&
    (brush.sizeControl ?? "off") === "off" &&
    (brush.angleControl ?? "off") === "off" &&
    (brush.roundnessControl ?? "off") === "off" &&
    (brush.sizeJitter ?? 0) <= 0 &&
    (brush.angleJitter ?? 0) <= 0 &&
    (brush.roundnessJitter ?? 0) <= 0
  )
}

export function effectiveBrushSpacing(tool: ToolId, brush: BrushSettings) {
  const configured = Math.max(1, brush.size * (brush.spacing ?? 25) / 100)
  if (!isPlainContinuousPaintStroke(tool, brush)) return configured
  return Math.max(1, Math.min(configured, brush.size * 0.035))
}

/** Padding a stroke's dirty rect needs to cover scatter and the dual brush. */
export function strokeDirtyPadding(brush: BrushSettings) {
  const scatter = ((brush.scatter ?? 0) / 100) * brush.size
  const dualBrush = brush.dualBrush?.enabled
    ? brush.dualBrush.size + ((brush.dualBrush.scatter ?? 0) / 100) * brush.size
    : 0
  return Math.ceil(Math.max(brush.size, dualBrush) + scatter + 24)
}

function sampleBrushTexture(
  pattern: NonNullable<BrushSettings["texture"]>["pattern"],
  x: number,
  y: number,
  scale = 100,
  protect = false,
) {
  const s = Math.max(8, scale)
  const tx = protect ? Math.floor(x / s) * s : x
  const ty = protect ? Math.floor(y / s) * s : y
  if (pattern === "noise") return hashNoise(tx, ty, 3)
  if (pattern === "linen") {
    const warp = 0.5 + 0.5 * Math.sin(tx / s * Math.PI * 18)
    const weft = 0.5 + 0.5 * Math.sin(ty / s * Math.PI * 18)
    return 0.25 + (warp * 0.35 + weft * 0.4)
  }
  if (pattern === "paper") {
    const n1 = hashNoise(Math.floor(tx / (s * 0.05)), Math.floor(ty / (s * 0.05)), 5)
    const n2 = hashNoise(Math.floor(tx / (s * 0.17)), Math.floor(ty / (s * 0.17)), 9)
    return 0.2 + n1 * 0.45 + n2 * 0.35
  }
  const weave = Math.abs(Math.sin(tx / s * Math.PI * 10) * Math.cos(ty / s * Math.PI * 10))
  return 0.3 + weave * 0.7
}

function sampleDualBrushMask(
  brush: BrushSettings,
  px: number,
  py: number,
  side: number,
  docX: number,
  docY: number,
) {
  const dual = brush.dualBrush
  if (!dual?.enabled) return 1
  const count = Math.max(1, Math.round(dual.count))
  const r = Math.max(1, dual.size / 2)
  let mask = 0
  for (let i = 0; i < count; i++) {
    const seed = i * 29
    const scatter = (dual.scatter / 100) * brush.size
    const ox = (hashNoise(docX, docY, seed) - 0.5) * scatter
    const oy = (hashNoise(docY, docX, seed + 11) - 0.5) * scatter
    const spacingShift = (i - (count - 1) / 2) * (dual.spacing / 100) * r
    const dx = px - side / 2 - ox - spacingShift
    const dy = py - side / 2 - oy
    mask = Math.max(mask, clamp01(1 - Math.hypot(dx, dy) / r))
  }
  return mask
}

function dabShapeCacheKey(context: BrushStampContext, dabSize: number, roundness: number, color: string) {
  const { tool, brush } = context
  const hardness = tool === "pencil" ? 1 : clamp01(brush.hardness / 100)
  const shape = brush.tipShape ?? "round"
  return `${Math.round(dabSize * 10)}:${Math.round(roundness * 100)}:${Math.round(hardness * 100)}:${shape}:${color}`
}

/**
 * Render one dab into its own canvas, then post-process the alpha for wet
 * edges, noise, texture and the dual brush. The base shape is cached for
 * round/square tips, which are the only ones whose appearance does not depend
 * on where in the document they land.
 */
function createBrushDab(
  context: BrushStampContext,
  dabSize: number,
  roundness: number,
  color: string,
  opacity: number,
  docX: number,
  docY: number,
  tipState?: BrushTipSimulation,
) {
  const { tool, brush } = context
  const pad = 6
  const side = Math.max(4, Math.ceil(dabSize + pad * 2))
  const c = makeCanvas(side, side)
  const dctx = c.getContext("2d")!
  const cx = side / 2
  const cy = side / 2
  const r = dabSize / 2
  const hardness = tool === "pencil" ? 1 : clamp01(brush.hardness / 100)
  const shape = brush.tipShape ?? "round"

  // For round/square shapes (position-independent), use cached base shape
  const isCacheable = shape === "round" || shape === "square"
  const shapeKey = isCacheable ? dabShapeCacheKey(context, dabSize, roundness, color) : ""
  const cachedShape = isCacheable ? context.dabShapeCache.current : null

  if (isCacheable && cachedShape && cachedShape.key === shapeKey && cachedShape.side === side) {
    // Clone from cache — much faster than redrawing gradients/arcs
    dctx.drawImage(cachedShape.canvas, 0, 0)
  } else {
    dctx.save()
    dctx.translate(cx, cy)
    dctx.scale(1, roundness)
    if (shape === "square") {
      if (hardness < 1 && tool !== "pencil") {
        dctx.shadowColor = color
        dctx.shadowBlur = Math.max(1, r * (1 - hardness))
      }
      dctx.fillStyle = color
      dctx.fillRect(-r, -r, r * 2, r * 2)
    } else if (shape === "bristle") {
      dctx.strokeStyle = color
      dctx.lineCap = "round"
      const resolved = tipState?.kind === "bristle"
        ? tipState
        : resolveBristleTipSimulation(
          brush,
          { pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 0, strokeAngle: 0 },
          { seed: Math.max(1, Math.round(docX * 17 + docY * 29)) },
        )
      for (let i = 0; i < resolved.bristles.length; i++) {
        const bristle = resolved.bristles[i]
        const y = bristle.offset * r
        const wobble = bristle.bend * r
        dctx.globalAlpha = bristle.alpha
        dctx.lineWidth = Math.max(0.45, bristle.thickness * Math.max(0.7, r / 11))
        dctx.beginPath()
        dctx.moveTo(-r * 0.92, y)
        dctx.quadraticCurveTo(wobble, y * 0.35, r * bristle.length, y + wobble * 0.18)
        dctx.stroke()
      }
      dctx.globalAlpha = 1
    } else if (shape === "erodible") {
      dctx.fillStyle = color
      dctx.beginPath()
      const resolved = tipState?.kind === "erodible"
        ? tipState
        : resolveErodibleTipSimulation(
          brush,
          { pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 0, strokeAngle: 0 },
          { seed: Math.max(1, Math.round(docX * 19 + docY * 31)) },
        )
      for (let i = 0; i < resolved.edge.length; i++) {
        const point = resolved.edge[i]
        const px = Math.cos(point.angle) * r * point.radiusScale
        const py = Math.sin(point.angle) * r * point.radiusScale
        if (i === 0) dctx.moveTo(px, py)
        else dctx.lineTo(px, py)
      }
      dctx.closePath()
      if (resolved.softness > 0.01) {
        dctx.shadowColor = color
        dctx.shadowBlur = Math.max(1, r * resolved.softness * 0.55)
      }
      dctx.fill()
    } else {
      if (hardness >= 0.99) {
        // Solid circle at full hardness
        dctx.fillStyle = color
        dctx.beginPath()
        dctx.arc(0, 0, r, 0, Math.PI * 2)
        dctx.fill()
      } else {
        const grad = dctx.createRadialGradient(0, 0, r * hardness, 0, 0, r)
        grad.addColorStop(0, color)
        grad.addColorStop(1, hexToRgba(color, 0))
        dctx.fillStyle = grad
        dctx.beginPath()
        dctx.arc(0, 0, r, 0, Math.PI * 2)
        dctx.fill()
      }
    }
    dctx.restore()

    // Cache the base shape for round/square tips
    if (isCacheable) {
      const cacheCanvas = makeCanvas(side, side)
      cacheCanvas.getContext("2d")!.drawImage(c, 0, 0)
      context.dabShapeCache.current = { key: shapeKey, canvas: cacheCanvas, side }
    }
  }

  const img = dctx.getImageData(0, 0, side, side)
  const data = img.data
  const texture = brush.texture
  const dual = brush.dualBrush
  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const idx = (py * side + px) * 4
      if (data[idx + 3] === 0) continue
      const lx = px - cx
      const ly = (py - cy) / Math.max(0.08, roundness)
      const dist = Math.hypot(lx, ly)
      const edge = clamp01((dist - r * hardness) / Math.max(1, r * (1 - hardness)))
      let alpha = (data[idx + 3] / 255) * opacity

      if (brush.wetEdges) alpha *= 0.48 + edge * 0.74
      if (shape === "erodible") alpha *= hashNoise(docX + px, docY + py, 47) > 0.18 ? 1 : 0.22
      if (brush.noise) alpha *= 0.78 + hashNoise(docX + px, docY + py, 13) * 0.44

      if (texture?.enabled) {
        const depthJitter = texture.depthJitter ? hashNoise(docX + px, docY + py, 31) * texture.depthJitter : 0
        const depth = Math.max(texture.minDepth, texture.depth - depthJitter) / 100
        const tex = sampleBrushTexture(texture.pattern, docX + px - cx, docY + py - cy, texture.scale, brush.protectTexture)
        const amount =
          texture.mode === "subtract"
            ? 1 - depth * (1 - tex)
            : texture.mode === "burn"
              ? Math.max(0, 1 - depth * Math.pow(1 - tex, 0.55) * 1.35)
              : 1 - depth + tex * depth
        alpha *= amount
      }

      if (dual?.enabled) {
        const dualMask = sampleDualBrushMask(brush, px, py, side, docX, docY)
        if (dual.mode === "screen") alpha *= 0.35 + dualMask * 0.65
        else if (dual.mode === "subtract") alpha *= 1 - dualMask * 0.75
        else alpha *= dualMask
      }

      data[idx + 3] = Math.max(0, Math.min(255, alpha * 255))
    }
  }
  dctx.putImageData(img, 0, 0)
  return c
}

/** Round/square tips with no per-pixel post-processing: draw the shape directly. */
function drawFastBrushDab(
  context: BrushStampContext,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dabSize: number,
  dabAngle: number,
  dabRoundness: number,
  color: string,
  opacity: number,
  isErase: boolean,
) {
  const { tool, brush } = context
  const r = dabSize / 2
  const tip = brush.tipShape ?? "round"
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(dabAngle)
  ctx.scale(1, dabRoundness)
  ctx.globalCompositeOperation = isErase ? "destination-out" : "source-over"
  ctx.globalAlpha = tool === "pencil" ? 1 : opacity
  if (tip === "square") {
    ctx.fillStyle = color
    ctx.fillRect(-r, -r, r * 2, r * 2)
  } else if (tool === "pencil") {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const hardness = clamp01(brush.hardness / 100)
    if (hardness >= 0.99) {
      // Solid circle at full hardness — no gradient needed
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const hardR = r * hardness
      const grad = ctx.createRadialGradient(0, 0, hardR, 0, 0, r)
      grad.addColorStop(0, color)
      grad.addColorStop(1, hexToRgba(color, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Pattern stamp: clip to the dab footprint and fill it with a generated tile. */
function drawPatternStampDab(
  context: BrushStampContext,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dabSize: number,
  dabAngle: number,
  dabRoundness: number,
  opacity: number,
) {
  const { brush, foreground, background } = context
  const r = dabSize / 2
  const pattern = context.document?.patternLibrary?.[0]?.type ?? brush.texture?.pattern ?? "checker"
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(dabAngle)
  ctx.scale(1, dabRoundness)
  ctx.beginPath()
  if ((brush.tipShape ?? "round") === "square") ctx.rect(-r, -r, r * 2, r * 2)
  else ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalAlpha = opacity
  const tile = makeCanvas(32, 32)
  const tctx = tile.getContext("2d")!
  tctx.fillStyle = foreground
  tctx.fillRect(0, 0, 32, 32)
  tctx.fillStyle = background
  if (pattern === "dots" || pattern === "paper") {
    for (let py = 4; py < 32; py += 8) {
      for (let px = 4; px < 32; px += 8) {
        tctx.beginPath()
        tctx.arc(px, py, 2.2, 0, Math.PI * 2)
        tctx.fill()
      }
    }
  } else if (pattern === "lines" || pattern === "linen") {
    tctx.lineWidth = 3
    tctx.strokeStyle = background
    for (let offset = -32; offset < 64; offset += 10) {
      tctx.beginPath()
      tctx.moveTo(offset, 32)
      tctx.lineTo(offset + 32, 0)
      tctx.stroke()
    }
  } else if (pattern === "noise") {
    const img = tctx.getImageData(0, 0, 32, 32)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = hashNoise(i, x + y, 17) > 0.5
      const c = n ? hexToRgb(foreground) : hexToRgb(background)
      img.data[i] = c.r
      img.data[i + 1] = c.g
      img.data[i + 2] = c.b
    }
    tctx.putImageData(img, 0, 0)
  } else {
    tctx.fillRect(0, 0, 16, 16)
    tctx.fillRect(16, 16, 16, 16)
  }
  const fill = ctx.createPattern(tile, "repeat")
  if (fill) {
    ctx.fillStyle = fill
    ctx.translate(-x, -y)
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.restore()
}

/** One dab at one point: shape from the dynamics, route to the matching painter. */
export function stamp(
  context: BrushStampContext,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  input: BrushDynamicsInput,
  options: StampOptions = {},
) {
  const { tool, brush, background, document: doc } = context
  if (!dabTouchesSelection(doc, x, y, brush.size)) return
  const { dabSize, dabAngle, dabRoundness, tipState } = applyCanvasBrushShapeDynamics(brush, input)
  const { opaMul, flowMul } = applyCanvasBrushTransfer(brush, input)
  const isBuffered = options.includeBrushOpacity === false
  // When painting to the stroke buffer, stamp at full alpha so overlapping
  // dabs don't accumulate and show individual circles.  The combined
  // opacity × flow is applied once in renderBufferedStroke() instead.
  const opacity = isBuffered ? 1 : clamp01((brush.opacity / 100) * (brush.flow / 100) * opaMul * flowMul * (options.opacityMultiplier ?? 1))
  const isErase = isEraserPaintTool(tool)
  const compositeAsErase = doc?.quickMask ? quickMaskPaintsSubtract(doc, tool) : isErase && !options.drawEraserMask
  const dabColor = isErase && options.drawEraserMask ? "#000000" : doc?.quickMask ? "#ffffff" : applyCanvasBrushColorDynamics(brush, color, background)
  if (tool === "pattern-stamp") {
    drawPatternStampDab(context, ctx, x, y, dabSize, dabAngle, dabRoundness, opacity)
    if (options.enforceTransparencyLock !== false) context.enforceTransparencyLock(ctx)
    return
  }
  if (tool === "color-replace") {
    colorReplacementStamp(
      {
        document: doc,
        hasActiveLayer: context.hasActiveLayer,
        brush,
        foreground: context.foreground,
        background,
        sourceCanvas: context.colorReplacementSource,
        sample: context.colorReplacementSample,
      },
      ctx,
      x,
      y,
      dabSize,
      input,
      opacity,
    )
    if (options.enforceTransparencyLock !== false) context.enforceTransparencyLock(ctx)
    return
  }
  if (canUseFastBrushDab(brush)) {
    drawFastBrushDab(context, ctx, x, y, dabSize, dabAngle, dabRoundness, dabColor, opacity, compositeAsErase)
    if (options.enforceTransparencyLock !== false) context.enforceTransparencyLock(ctx)
    return
  }
  const dab = createBrushDab(context, dabSize, dabRoundness, dabColor, opacity, x, y, tipState)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(dabAngle)
  ctx.globalCompositeOperation = compositeAsErase ? "destination-out" : "source-over"
  if (tool === "pencil") ctx.imageSmoothingEnabled = false
  ctx.drawImage(dab, -dab.width / 2, -dab.height / 2)
  ctx.restore()
  if (options.enforceTransparencyLock !== false) context.enforceTransparencyLock(ctx)
}

/** The dab plus every mirror/rotation the active symmetry axis implies. */
export function stampSymmetric(
  context: BrushStampContext,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  w: number,
  h: number,
  input: BrushDynamicsInput,
  options?: StampOptions,
) {
  const { symmetry, brush } = context
  const at = (px: number, py: number) => stamp(context, ctx, px, py, color, input, options)
  at(x, y)
  if (!symmetry.enabled) return
  const cx = w / 2, cy = h / 2
  if (symmetry.axis === "vertical" || symmetry.axis === "both") {
    at(w - x, y)
  }
  if (symmetry.axis === "horizontal" || symmetry.axis === "both") {
    at(x, h - y)
  }
  if (symmetry.axis === "both") {
    at(w - x, h - y)
  }
  if (symmetry.axis === "diagonal") {
    // Reflect across both diagonals
    const dx = x - cx, dy = y - cy
    at(cx + dy, cy + dx)
    at(cx - dy, cy - dx)
    at(cx - dx, cy - dy)
  }
  if (symmetry.axis === "radial" || symmetry.axis === "mandala") {
    const n = symmetry.segments ?? 6
    const dx = x - cx, dy = y - cy
    for (let i = 1; i < n; i++) {
      const angle = (2 * Math.PI * i) / n
      const cos = Math.cos(angle), sin = Math.sin(angle)
      at(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
    }
    if (symmetry.axis === "mandala") {
      // Mirror each rotated point across the vertical axis
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n
        const cos = Math.cos(angle), sin = Math.sin(angle)
        const rx = cx + dx * cos - dy * sin
        at(w - rx, cy + dx * sin + dy * cos)
      }
    }
  }
  if (symmetry.axis === "spiral") {
    const n = symmetry.segments ?? 4
    const dx = x - cx, dy = y - cy
    for (let i = 1; i < n; i++) {
      const angle = (2 * Math.PI * i) / n
      const scale = 1 - (i * 0.15) // shrink each subsequent copy slightly
      const cos = Math.cos(angle), sin = Math.sin(angle)
      at(cx + (dx * cos - dy * sin) * scale, cy + (dx * sin + dy * cos) * scale)
    }
  }
  if (symmetry.axis === "parallel") {
    const n = symmetry.segments ?? 5
    const spacing = symmetry.parallelSpacing ?? Math.max(12, brush.size * 2)
    const normal = input.strokeAngle + Math.PI / 2
    const half = Math.floor(n / 2)
    for (let i = -half; i <= half; i++) {
      if (i === 0) continue
      at(x + Math.cos(normal) * spacing * i, y + Math.sin(normal) * spacing * i)
    }
  }
  if (symmetry.axis === "wavy") {
    const n = symmetry.segments ?? 5
    const amp = symmetry.waveAmplitude ?? Math.max(10, brush.size)
    const freq = symmetry.waveFrequency ?? 3
    const phase = (x / Math.max(1, w)) * Math.PI * 2 * freq
    for (let i = 1; i < n; i++) {
      const offset = Math.sin(phase + (i * Math.PI * 2) / n) * amp
      const spread = (i - (n - 1) / 2) * amp * 0.45
      at(x + spread, y + offset)
    }
  }
  if (symmetry.axis === "circle") {
    const n = symmetry.segments ?? 8
    const dx = x - cx, dy = y - cy
    const radius = Math.hypot(dx, dy)
    const base = Math.atan2(dy, dx)
    for (let i = 1; i < n; i++) {
      const a = base + (Math.PI * 2 * i) / n
      at(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius)
    }
  }
}

/** Scatter the configured number of dabs perpendicular to the stroke direction. */
export function stampWithScatter(
  context: BrushStampContext,
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  color: string,
  w: number,
  h: number,
  input: BrushDynamicsInput,
  scatterAmt: number,
  scatterCnt: number,
  scatterCntJ: number,
  strokeAngle: number,
  options?: StampOptions,
) {
  let dabCount = scatterCnt
  if (scatterCntJ > 0) {
    dabCount = Math.max(1, Math.round(scatterCnt * (1 - Math.random() * scatterCntJ / 100)))
  }
  for (let d = 0; d < dabCount; d++) {
    let sx = baseX, sy = baseY
    if (scatterAmt > 0) {
      const offset = (Math.random() - 0.5) * 2 * (scatterAmt / 100) * context.brush.size
      const perpX = -Math.sin(strokeAngle) * offset
      const perpY = Math.cos(strokeAngle) * offset
      sx += perpX
      sy += perpY
    }
    stampSymmetric(context, ctx, sx, sy, color, w, h, input, options)
  }
}
