"use client"

import { renderDocumentComposite } from "./document-io"
import type {
  BlendMode,
  FrameEasing,
  FrameLayerTransform,
  Layer,
  LayerStyle,
  OnionSkinSettings,
  PsDocument,
  TimelineFrame,
  TimelineSettings,
} from "./types"
import { uid } from "./uid"

export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
  fps: 12,
  loopCount: 0,
  onionSkin: { enabled: false, before: 1, after: 1, opacity: 0.35, tint: "none" },
}

export const IDENTITY_TRANSFORM: FrameLayerTransform = {
  tx: 0,
  ty: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function easingProgress(t: number, easing: FrameEasing = "linear"): number {
  const clamped = clamp(t, 0, 1)
  if (easing === "hold") return 0
  if (easing === "linear") return clamped
  if (easing === "ease-in") return clamped * clamped
  if (easing === "ease-out") return 1 - (1 - clamped) * (1 - clamped)
  if (easing === "ease-in-out") return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2
  return clamped
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function lerpTransform(a: FrameLayerTransform, b: FrameLayerTransform, t: number): FrameLayerTransform {
  return {
    tx: lerp(a.tx, b.tx, t),
    ty: lerp(a.ty, b.ty, t),
    scaleX: lerp(a.scaleX, b.scaleX, t),
    scaleY: lerp(a.scaleY, b.scaleY, t),
    rotation: lerp(a.rotation, b.rotation, t),
  }
}

export function captureFrameFromDocument(doc: PsDocument, name?: string): TimelineFrame {
  const layerVisibility: Record<string, boolean> = {}
  const layerOpacity: Record<string, number> = {}
  const layerFillOpacity: Record<string, number> = {}
  const layerBlend: Record<string, BlendMode> = {}
  const layerStyle: Record<string, LayerStyle | null> = {}
  for (const layer of doc.layers) {
    layerVisibility[layer.id] = layer.visible
    layerOpacity[layer.id] = layer.opacity
    layerFillOpacity[layer.id] = layer.fillOpacity ?? 1
    layerBlend[layer.id] = layer.blendMode
    layerStyle[layer.id] = layer.style ? JSON.parse(JSON.stringify(layer.style)) : null
  }
  return {
    id: uid("frame"),
    name: name ?? `Frame ${(doc.timelineFrames?.length ?? 0) + 1}`,
    durationMs: 500,
    layerVisibility,
    layerOpacity,
    layerFillOpacity,
    layerStyle,
    layerBlend,
    layerTransform: {},
    transition: "hold",
    easing: "linear",
  }
}

/**
 * Produce a virtual document with frame state applied to layer metadata,
 * including pre-baked transforms drawn into temporary canvases when needed.
 *
 * Returns a shallow clone — original layer canvases are not mutated.
 */
export function buildDocumentForFrame(doc: PsDocument, frame: TimelineFrame): PsDocument {
  const layers: Layer[] = doc.layers.map((layer) => {
    const transform = frame.layerTransform?.[layer.id]
    const visible = frame.layerVisibility[layer.id] ?? layer.visible
    const opacity = frame.layerOpacity?.[layer.id] ?? layer.opacity
    const fillOpacity = frame.layerFillOpacity?.[layer.id] ?? layer.fillOpacity ?? 1
    const blendMode = frame.layerBlend?.[layer.id] ?? layer.blendMode
    const styleOverride = frame.layerStyle?.[layer.id]
    const style = styleOverride === null ? undefined : styleOverride ?? layer.style
    let canvas = layer.canvas
    let mask = layer.mask
    if (transform && hasTransform(transform) && canvas && typeof canvas.getContext === "function") {
      canvas = applyTransformToCanvas(canvas, transform, doc.width, doc.height)
      if (mask) mask = applyTransformToCanvas(mask, transform, doc.width, doc.height)
    }
    return {
      ...layer,
      visible,
      opacity,
      fillOpacity,
      blendMode,
      style,
      canvas,
      mask,
    }
  })
  return { ...doc, layers }
}

function hasTransform(t: FrameLayerTransform) {
  return t.tx !== 0 || t.ty !== 0 || t.scaleX !== 1 || t.scaleY !== 1 || t.rotation !== 0
}

function applyTransformToCanvas(
  source: HTMLCanvasElement,
  transform: FrameLayerTransform,
  docWidth: number,
  docHeight: number,
): HTMLCanvasElement {
  const out = document.createElement("canvas")
  out.width = Math.max(1, docWidth)
  out.height = Math.max(1, docHeight)
  const ctx = out.getContext("2d")
  if (!ctx) return source
  const cx = source.width / 2
  const cy = source.height / 2
  ctx.save()
  ctx.translate(transform.tx + cx, transform.ty + cy)
  ctx.rotate((transform.rotation * Math.PI) / 180)
  ctx.scale(transform.scaleX, transform.scaleY)
  ctx.translate(-cx, -cy)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, 0, 0)
  ctx.restore()
  return out
}

export function renderTimelineFrameComposite(
  doc: PsDocument,
  frame: TimelineFrame,
  options: { transparent?: boolean; matte?: string } = {},
): HTMLCanvasElement {
  const projected = buildDocumentForFrame(doc, frame)
  return renderDocumentComposite(projected, options)
}

/**
 * Composite a frame with the per-frame transition applied at the given
 * progress [0,1]. Used by both export sampling and live playback.
 *
 * For `hold` (or when there's no next frame) the current frame is returned
 * unchanged. For `dissolve`/`cross-dissolve` we cross-fade with `next`. For
 * `fade-black`/`fade-white` we fade the current frame toward the named
 * colour. For `wipe-left`/`wipe-right` we wipe `next` over the current frame.
 */
export function renderTimelineFrameWithTransition(
  doc: PsDocument,
  current: TimelineFrame,
  next: TimelineFrame | null,
  progress: number,
  options: { transparent?: boolean; matte?: string } = {},
): HTMLCanvasElement {
  const fromCanvas = renderTimelineFrameComposite(doc, current, options)
  const transition = current.transition
  if (!transition || transition === "hold" || progress <= 0 || !next) {
    return fromCanvas
  }
  const toCanvas = renderTimelineFrameComposite(doc, next, options)
  const out = document.createElement("canvas")
  out.width = fromCanvas.width
  out.height = fromCanvas.height
  const ctx = out.getContext("2d")
  if (!ctx) return fromCanvas
  const t = clamp(progress, 0, 1)
  ctx.clearRect(0, 0, out.width, out.height)

  if (transition === "fade-black" || transition === "fade-white") {
    ctx.drawImage(fromCanvas, 0, 0)
    ctx.save()
    ctx.globalAlpha = t
    ctx.fillStyle = transition === "fade-white" ? "#ffffff" : "#000000"
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.restore()
    return out
  }
  if (transition === "wipe-left" || transition === "wipe-right") {
    ctx.drawImage(fromCanvas, 0, 0)
    const w = out.width * t
    const x = transition === "wipe-right" ? 0 : out.width - w
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, 0, w, out.height)
    ctx.clip()
    ctx.drawImage(toCanvas, 0, 0)
    ctx.restore()
    return out
  }

  ctx.save()
  ctx.globalAlpha = 1 - t
  ctx.drawImage(fromCanvas, 0, 0)
  ctx.restore()
  ctx.save()
  ctx.globalAlpha = t
  ctx.drawImage(toCanvas, 0, 0)
  ctx.restore()
  if (!options.transparent) {
    ctx.save()
    ctx.globalCompositeOperation = "destination-over"
    ctx.fillStyle = options.matte ?? doc.background ?? "#ffffff"
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.restore()
  }
  return out
}

export function renderOnionSkinOverlay(
  doc: PsDocument,
  frames: TimelineFrame[],
  currentIndex: number,
  settings: OnionSkinSettings,
): HTMLCanvasElement | null {
  if (!settings.enabled || frames.length === 0 || currentIndex < 0) return null
  const canvas = document.createElement("canvas")
  canvas.width = doc.width
  canvas.height = doc.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  const drawGhost = (index: number, distance: number, side: "before" | "after") => {
    if (index < 0 || index >= frames.length) return
    const frame = frames[index]
    const ghost = renderTimelineFrameComposite(doc, frame, { transparent: true })
    const alpha = clamp(settings.opacity * (1 - distance / (side === "before" ? settings.before + 1 : settings.after + 1)), 0, 1)
    if (alpha <= 0.01) return
    if (settings.tint && settings.tint !== "none") {
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.drawImage(ghost, 0, 0)
      ctx.globalCompositeOperation = "source-in"
      ctx.fillStyle = tintColor(settings.tint, side)
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    } else {
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.drawImage(ghost, 0, 0)
      ctx.restore()
    }
  }
  for (let i = 1; i <= settings.before; i++) drawGhost(currentIndex - i, i, "before")
  for (let i = 1; i <= settings.after; i++) drawGhost(currentIndex + i, i, "after")
  return canvas
}

function tintColor(tint: NonNullable<OnionSkinSettings["tint"]>, side: "before" | "after"): string {
  if (tint === "red-cyan") return side === "before" ? "#ff4f64" : "#3ad6ff"
  if (tint === "red-blue") return side === "before" ? "#ff5959" : "#5d8bff"
  if (tint === "green-red") return side === "before" ? "#5fd17a" : "#ff5959"
  return "#888"
}

export interface TweenGenerationOptions {
  steps: number
  easing: FrameEasing
  durationMs?: number
  properties: {
    opacity?: boolean
    transform?: boolean
    style?: boolean
    visibility?: boolean
  }
}

export function generateTweenFrames(
  from: TimelineFrame,
  to: TimelineFrame,
  options: TweenGenerationOptions,
): TimelineFrame[] {
  const steps = Math.max(0, Math.floor(options.steps))
  if (steps === 0) return []
  const out: TimelineFrame[] = []
  for (let i = 1; i <= steps; i++) {
    const linearT = i / (steps + 1)
    const t = easingProgress(linearT, options.easing)
    const layerVisibility: Record<string, boolean> = {}
    const layerOpacity: Record<string, number> = {}
    const layerFillOpacity: Record<string, number> = {}
    const layerTransform: Record<string, FrameLayerTransform> = {}
    const layerStyle: Record<string, LayerStyle | null> = {}
    const layerBlend: Record<string, BlendMode> = {}
    const layerIds = new Set([
      ...Object.keys(from.layerVisibility),
      ...Object.keys(to.layerVisibility),
    ])
    for (const id of layerIds) {
      const fromVisible = from.layerVisibility[id] ?? false
      const toVisible = to.layerVisibility[id] ?? false
      const fromOpacity = from.layerOpacity?.[id] ?? (fromVisible ? 1 : 0)
      const toOpacity = to.layerOpacity?.[id] ?? (toVisible ? 1 : 0)
      const interpolatedOpacity = options.properties.opacity !== false ? lerp(fromOpacity, toOpacity, t) : fromOpacity
      layerOpacity[id] = interpolatedOpacity
      if (options.properties.visibility !== false) {
        layerVisibility[id] = interpolatedOpacity > 0.01
      } else {
        layerVisibility[id] = fromVisible
      }
      const fromFill = from.layerFillOpacity?.[id] ?? 1
      const toFill = to.layerFillOpacity?.[id] ?? 1
      layerFillOpacity[id] = lerp(fromFill, toFill, t)
      if (options.properties.transform !== false) {
        const fromTransform = from.layerTransform?.[id] ?? IDENTITY_TRANSFORM
        const toTransform = to.layerTransform?.[id] ?? IDENTITY_TRANSFORM
        layerTransform[id] = lerpTransform(fromTransform, toTransform, t)
      }
      if (options.properties.style !== false) {
        const fromStyle = from.layerStyle?.[id]
        const toStyle = to.layerStyle?.[id]
        layerStyle[id] = interpolateStyle(fromStyle, toStyle, t)
      }
      const fromBlend = from.layerBlend?.[id]
      const toBlend = to.layerBlend?.[id]
      if (fromBlend || toBlend) layerBlend[id] = t < 0.5 ? fromBlend ?? toBlend! : toBlend ?? fromBlend!
    }
    out.push({
      id: uid("tween"),
      name: `${from.name} → ${to.name} ${i}`,
      durationMs: options.durationMs ?? Math.round((from.durationMs + to.durationMs) / 2),
      layerVisibility,
      layerOpacity,
      layerFillOpacity,
      layerTransform,
      layerStyle,
      layerBlend,
      transition: "dissolve",
      easing: options.easing,
    })
  }
  return out
}

function interpolateStyle(
  from: LayerStyle | null | undefined,
  to: LayerStyle | null | undefined,
  t: number,
): LayerStyle | null {
  if (!from && !to) return null
  const base = from ?? to ?? null
  const target = to ?? from ?? null
  if (!base) return target ?? null
  if (!target) return base ?? null
  const out: LayerStyle = JSON.parse(JSON.stringify(base))
  for (const key of Object.keys(target) as (keyof LayerStyle)[]) {
    const a = base[key]
    const b = target[key]
    if (!a || !b) {
      ;(out as Record<string, unknown>)[key as string] = b ?? a
      continue
    }
    if (typeof a === "object" && typeof b === "object") {
      const merged: Record<string, unknown> = { ...(a as Record<string, unknown>) }
      for (const propKey of Object.keys(b as Record<string, unknown>)) {
        const av = (a as Record<string, unknown>)[propKey]
        const bv = (b as Record<string, unknown>)[propKey]
        if (typeof av === "number" && typeof bv === "number") {
          merged[propKey] = lerp(av, bv, t)
        } else {
          merged[propKey] = t < 0.5 ? av ?? bv : bv ?? av
        }
      }
      ;(out as Record<string, unknown>)[key as string] = merged
    } else {
      ;(out as Record<string, unknown>)[key as string] = t < 0.5 ? a : b
    }
  }
  return out
}

export function reverseFrames(frames: TimelineFrame[]): TimelineFrame[] {
  return [...frames].reverse().map((frame) => ({ ...frame, id: uid("frame") }))
}

export function distributeDurations(frames: TimelineFrame[], totalMs: number): TimelineFrame[] {
  if (!frames.length) return frames
  const perFrame = Math.max(20, Math.round(totalMs / frames.length))
  return frames.map((frame) => ({ ...frame, durationMs: perFrame }))
}

export function setDurationsFromFps(frames: TimelineFrame[], fps: number): TimelineFrame[] {
  const duration = Math.max(20, Math.round(1000 / Math.max(1, fps)))
  return frames.map((frame) => ({ ...frame, durationMs: duration }))
}

export function moveFrame(frames: TimelineFrame[], from: number, to: number): TimelineFrame[] {
  if (from < 0 || from >= frames.length) return frames
  const clampedTo = clamp(to, 0, frames.length - 1)
  if (from === clampedTo) return frames
  const next = frames.slice()
  const [removed] = next.splice(from, 1)
  next.splice(clampedTo, 0, removed)
  return next
}

export function timelineDurationMs(frames: TimelineFrame[]): number {
  return frames.reduce((sum, frame) => sum + Math.max(0, Math.round(frame.durationMs)), 0)
}

export function timelineFrameIndexAtTime(frames: TimelineFrame[], playheadMs: number): number {
  if (!frames.length) return -1
  const total = timelineDurationMs(frames)
  const time = clamp(Math.round(playheadMs), 0, Math.max(0, total))
  let cursor = 0
  for (let i = 0; i < frames.length; i++) {
    const duration = Math.max(0, Math.round(frames[i].durationMs))
    if (time < cursor + duration) return i
    cursor += duration
  }
  return frames.length - 1
}

export interface SplitTimelineFrameResult {
  frames: TimelineFrame[]
  didSplit: boolean
  frameIndex: number
  playheadMs: number
  splitFrameIds: string[]
}

export function splitTimelineFrameAtPlayhead(
  frames: TimelineFrame[],
  playheadMs: number,
  options: { minDurationMs?: number; idFactory?: (prefix: string) => string } = {},
): SplitTimelineFrameResult {
  const total = timelineDurationMs(frames)
  const clampedPlayhead = clamp(Math.round(playheadMs), 0, Math.max(0, total))
  const frameIndex = timelineFrameIndexAtTime(frames, clampedPlayhead)
  if (frameIndex < 0) {
    return { frames, didSplit: false, frameIndex, playheadMs: clampedPlayhead, splitFrameIds: [] }
  }

  const minDurationMs = Math.max(1, Math.round(options.minDurationMs ?? 20))
  const frameStart = frames.slice(0, frameIndex).reduce((sum, frame) => sum + Math.max(0, Math.round(frame.durationMs)), 0)
  const frame = frames[frameIndex]
  const offset = clampedPlayhead - frameStart
  const leftDuration = Math.round(offset)
  const rightDuration = Math.round(frame.durationMs - offset)
  if (leftDuration < minDurationMs || rightDuration < minDurationMs) {
    return { frames, didSplit: false, frameIndex, playheadMs: clampedPlayhead, splitFrameIds: [] }
  }

  const makeId = options.idFactory ?? ((prefix: string) => uid(prefix))
  const left: TimelineFrame = {
    ...frame,
    id: makeId("frame"),
    name: `${frame.name} A`,
    durationMs: leftDuration,
  }
  const right: TimelineFrame = {
    ...frame,
    id: makeId("frame"),
    name: `${frame.name} B`,
    durationMs: rightDuration,
  }
  return {
    frames: [...frames.slice(0, frameIndex), left, right, ...frames.slice(frameIndex + 1)],
    didSplit: true,
    frameIndex,
    playheadMs: clampedPlayhead,
    splitFrameIds: [left.id, right.id],
  }
}

export interface VideoFrameCanvasSample {
  index: number
  timeMs: number
  label?: string
  canvas: HTMLCanvasElement
  dataUrl?: string
}

export interface VideoFrameCanvasExtraction {
  layers: Layer[]
  frames: TimelineFrame[]
}

export function makeFramesFromVideoCanvases(
  doc: PsDocument,
  sourceLayerId: string,
  samples: VideoFrameCanvasSample[],
  options: {
    durationMs?: number
    namePrefix?: string
    idFactory?: (prefix: string, index: number) => string
  } = {},
): VideoFrameCanvasExtraction {
  const durationMs = Math.max(20, Math.round(options.durationMs ?? (1000 / Math.max(1, doc.timelineSettings?.fps ?? DEFAULT_TIMELINE_SETTINGS.fps))))
  const makeId = options.idFactory ?? ((prefix: string) => uid(prefix))
  const sourceLayer = doc.layers.find((layer) => layer.id === sourceLayerId)
  const namePrefix = options.namePrefix ?? sourceLayer?.name ?? "Video frame"

  const layers: Layer[] = samples.map((sample, index) => {
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, doc.width)
    canvas.height = Math.max(1, doc.height)
    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(sample.canvas, 0, 0, canvas.width, canvas.height)
    }
    const label = sample.label ?? `${(sample.timeMs / 1000).toFixed(2)}s`
    return {
      id: makeId("video_frame", index),
      name: `${namePrefix} ${String(index + 1).padStart(3, "0")} @ ${label}`,
      kind: "raster",
      visible: false,
      locked: false,
      opacity: 1,
      fillOpacity: 1,
      blendMode: "normal",
      canvas,
      metadata: {
        title: `${namePrefix} ${String(index + 1).padStart(3, "0")}`,
        custom: {
          sourceLayerId,
          sourceName: sourceLayer?.video?.sourceName ?? sourceLayer?.name ?? namePrefix,
          sourceTimeMs: Math.round(sample.timeMs),
        },
      },
    }
  })

  const existingVisibility = Object.fromEntries(
    doc.layers.map((layer) => [layer.id, layer.id === sourceLayerId ? false : layer.visible]),
  )
  const existingOpacity = Object.fromEntries(doc.layers.map((layer) => [layer.id, layer.opacity]))
  const existingFillOpacity = Object.fromEntries(doc.layers.map((layer) => [layer.id, layer.fillOpacity ?? 1]))
  const existingBlend = Object.fromEntries(doc.layers.map((layer) => [layer.id, layer.blendMode]))
  const extractedVisibilityOff = Object.fromEntries(layers.map((layer) => [layer.id, false]))
  const extractedOpacity = Object.fromEntries(layers.map((layer) => [layer.id, 1]))
  const extractedFillOpacity = Object.fromEntries(layers.map((layer) => [layer.id, 1]))
  const extractedBlend = Object.fromEntries(layers.map((layer) => [layer.id, "normal" as BlendMode]))

  const frames: TimelineFrame[] = samples.map((sample, index) => {
    const layer = layers[index]
    const label = sample.label ?? `${(sample.timeMs / 1000).toFixed(2)}s`
    return {
      id: makeId("frame", index),
      name: `${namePrefix} ${String(index + 1).padStart(3, "0")} @ ${label}`,
      durationMs,
      layerVisibility: {
        ...existingVisibility,
        ...extractedVisibilityOff,
        [layer.id]: true,
      },
      layerOpacity: { ...existingOpacity, ...extractedOpacity },
      layerFillOpacity: { ...existingFillOpacity, ...extractedFillOpacity },
      layerBlend: { ...existingBlend, ...extractedBlend },
      layerTransform: {},
      transition: "hold",
      easing: "linear",
      thumbnail: sample.dataUrl ?? sample.canvas.toDataURL("image/png"),
      keyframes: [{
        id: makeId("key", index),
        timeMs: Math.round(sample.timeMs),
        layerId: sourceLayerId,
        property: "opacity",
        value: 1,
        easing: "hold",
      }],
    }
  })

  return { layers, frames }
}

export function makeFramesFromLayers(doc: PsDocument): TimelineFrame[] {
  const baseVisibility: Record<string, boolean> = Object.fromEntries(
    doc.layers.map((layer) => [layer.id, false]),
  )
  return doc.layers
    .filter((layer) => layer.kind !== "group")
    .map((layer, index) => ({
      id: uid("frame"),
      name: layer.name ?? `Layer ${index + 1}`,
      durationMs: 200,
      layerVisibility: { ...baseVisibility, [layer.id]: true },
      layerOpacity: Object.fromEntries(doc.layers.map((l) => [l.id, l.opacity])),
      layerFillOpacity: Object.fromEntries(doc.layers.map((l) => [l.id, l.fillOpacity ?? 1])),
      layerBlend: Object.fromEntries(doc.layers.map((l) => [l.id, l.blendMode])),
      layerTransform: {},
      transition: "hold",
      easing: "linear",
    }))
}

export function applyFrameToLayers(layers: Layer[], frame: TimelineFrame): Layer[] {
  return layers.map((layer) => ({
    ...layer,
    visible: frame.layerVisibility[layer.id] ?? layer.visible,
    opacity: frame.layerOpacity?.[layer.id] ?? layer.opacity,
    fillOpacity: frame.layerFillOpacity?.[layer.id] ?? layer.fillOpacity,
    blendMode: frame.layerBlend?.[layer.id] ?? layer.blendMode,
    style: frame.layerStyle?.[layer.id] === null
      ? undefined
      : frame.layerStyle?.[layer.id] ?? layer.style,
  }))
}
