import { isAdjustmentNoop } from "./adjustment-layers"
import { makeCanvas } from "./canvas-utils"
import { cloneCanvas, alphaBounds } from "./editor-document-cloning"
import { loadPreferencesFromStorage } from "./preferences-engine"
import type { RenderChange } from "./render-bus"
import {
  selectionToMaskCanvas,
  selectionFromMask,
} from "./tool-helpers"
import type { AlphaChannel, CanvasPatch, Layer, LayerSnapshot, PsDocument } from "./types"

export interface DirtyRect {
  x: number
  y: number
  w: number
  h: number
}

export type SelectionChannelLoadMode = "replace" | "add" | "subtract" | "intersect"

export type LayerChangeHints = {
  ids?: readonly string[]
  bounds?: Record<string, DirtyRect>
}

export type ChangedLayerIds = readonly string[] | "all" | LayerChangeHints
export type LayerAlignMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom"
export type LayerDistributeAxis = "horizontal" | "vertical"

const MAX_HISTORY_PATCHES = 24
const MAX_HISTORY_PATCH_AREA_RATIO = 0.42
const MAX_HISTORY_PATCH_CHAIN_AREA_RATIO = 0.9

export function getUndoLimit(): number {
  try {
    return loadPreferencesFromStorage().undoLimit
  } catch {}
  return 50
}

export function combineSelectionWithChannel(
  doc: PsDocument,
  channel: AlphaChannel,
  mode: SelectionChannelLoadMode = "replace",
  invert = false,
) {
  const channelMask = cloneCanvas(channel.canvas) ?? makeCanvas(doc.width, doc.height)
  if (invert) {
    const ctx = channelMask.getContext("2d")!
    const img = ctx.getImageData(0, 0, channelMask.width, channelMask.height)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 255
      img.data[i + 1] = 255
      img.data[i + 2] = 255
      img.data[i + 3] = 255 - img.data[i + 3]
    }
    ctx.putImageData(img, 0, 0)
  }
  if (mode === "replace") return channelMask

  const base = selectionToMaskCanvas(doc.width, doc.height, doc.selection) ?? makeCanvas(doc.width, doc.height)
  const out = makeCanvas(doc.width, doc.height)
  const ctx = out.getContext("2d")!
  ctx.drawImage(base, 0, 0)
  if (mode === "add") {
    ctx.globalCompositeOperation = "source-over"
    ctx.drawImage(channelMask, 0, 0)
  } else if (mode === "subtract") {
    ctx.globalCompositeOperation = "destination-out"
    ctx.drawImage(channelMask, 0, 0)
  } else {
    ctx.globalCompositeOperation = "destination-in"
    ctx.drawImage(channelMask, 0, 0)
  }
  ctx.globalCompositeOperation = "source-over"
  return out
}

export function selectionFromChannel(
  doc: PsDocument,
  channel: AlphaChannel,
  mode?: SelectionChannelLoadMode,
  invert?: boolean,
) {
  return selectionFromMask(combineSelectionWithChannel(doc, channel, mode, invert), "freehand")
}

export function isLayerChangeHints(value: ChangedLayerIds | undefined): value is LayerChangeHints {
  return !!value && value !== "all" && !Array.isArray(value)
}

function changedLayerIdsList(changedLayerIds: ChangedLayerIds | undefined): string[] | null {
  if (!changedLayerIds || changedLayerIds === "all") return null
  if (!isLayerChangeHints(changedLayerIds)) return [...changedLayerIds]
  return changedLayerIds.ids ? [...changedLayerIds.ids] : Object.keys(changedLayerIds.bounds ?? {})
}

export function commitAffectsComposite(doc: PsDocument, changedLayerIds: ChangedLayerIds | undefined) {
  const ids = changedLayerIdsList(changedLayerIds)
  if (!ids) return true
  if (!ids.length) return true
  return ids.some((id) => {
    const layer = doc.layers.find((candidate) => candidate.id === id)
    if (!layer) return true
    return !(layer.kind === "adjustment" && isAdjustmentNoop(layer.adjustment))
  })
}

export function renderChangeForChangedLayerIds(changedLayerIds: ChangedLayerIds | undefined): RenderChange {
  const ids = changedLayerIdsList(changedLayerIds)
  const hints = isLayerChangeHints(changedLayerIds) ? changedLayerIds : undefined
  const dirtyByLayer: Record<string, DirtyRect[]> = {}
  if (hints?.bounds) {
    for (const [id, rect] of Object.entries(hints.bounds)) {
      if (rect && rect.w > 0 && rect.h > 0) dirtyByLayer[id] = [rect]
    }
  }
  const base = ids && ids.length
    ? { layerIds: ids, reason: "history" }
    : { layerIds: "all" as const, reason: "history" }
  return Object.keys(dirtyByLayer).length ? { ...base, dirtyByLayer } : base
}

export function normalizeDirtyRect(rect: DirtyRect | undefined, width: number, height: number): DirtyRect | null {
  if (!rect) return null
  const x1 = Math.max(0, Math.floor(rect.x))
  const y1 = Math.max(0, Math.floor(rect.y))
  const x2 = Math.min(width, Math.ceil(rect.x + rect.w))
  const y2 = Math.min(height, Math.ceil(rect.y + rect.h))
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function cloneCanvasPatch(src: HTMLCanvasElement, rect: DirtyRect): CanvasPatch | null {
  if (typeof src.getContext !== "function") return null
  const patchCanvas = makeCanvas(rect.w, rect.h)
  patchCanvas.getContext("2d")!.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  return { ...rect, canvas: patchCanvas }
}

export function canReuseCanvasSnapshot(
  snapshot: HTMLCanvasElement | null | undefined,
  live: HTMLCanvasElement | null | undefined,
) {
  return !!snapshot && !!live && snapshot.width === live.width && snapshot.height === live.height
}

export function canPatchSnapshot(
  previous: LayerSnapshot | undefined,
  live: HTMLCanvasElement,
  rect: DirtyRect | null,
) {
  if (!previous || !rect || !canReuseCanvasSnapshot(previous.canvas, live)) return false
  const patchCount = previous.canvasPatches?.length ?? 0
  if (patchCount >= MAX_HISTORY_PATCHES) return false
  const patchArea = rect.w * rect.h
  const canvasArea = Math.max(1, live.width * live.height)
  const chainArea = (previous.canvasPatches ?? []).reduce((sum, patch) => sum + patch.w * patch.h, 0)
  if ((chainArea + patchArea) / canvasArea > MAX_HISTORY_PATCH_CHAIN_AREA_RATIO) return false
  return patchArea / canvasArea <= MAX_HISTORY_PATCH_AREA_RATIO
}

function intersectDirtyRects(a: DirtyRect, b: DirtyRect): DirtyRect | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function patchToDirtyRect(patch: CanvasPatch): DirtyRect {
  return { x: patch.x, y: patch.y, w: patch.w, h: patch.h }
}

export function snapshotPixelsEqual(a: LayerSnapshot | undefined, b: LayerSnapshot | undefined) {
  if (!a || !b) return false
  return a.canvas === b.canvas && (a.canvasPatches ?? null) === (b.canvasPatches ?? null)
}

function patchPrefixMatches(shorter: CanvasPatch[], longer: CanvasPatch[]) {
  if (shorter.length >= longer.length) return false
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) return false
  }
  return true
}

export function adjacentRestoreRect(
  target: LayerSnapshot,
  current: LayerSnapshot | undefined,
  direction: "undo" | "redo" | null,
): DirtyRect | null {
  if (!current || !direction || target.canvas !== current.canvas) return null
  const targetPatches = target.canvasPatches ?? []
  const currentPatches = current.canvasPatches ?? []
  if (direction === "redo") {
    if (targetPatches.length !== currentPatches.length + 1) return null
    if (!patchPrefixMatches(currentPatches, targetPatches)) return null
    return patchToDirtyRect(targetPatches[targetPatches.length - 1])
  }
  if (currentPatches.length !== targetPatches.length + 1) return null
  if (!patchPrefixMatches(targetPatches, currentPatches)) return null
  return patchToDirtyRect(currentPatches[currentPatches.length - 1])
}

export function drawSnapshotRegion(ctx: CanvasRenderingContext2D, snap: LayerSnapshot, rect: DirtyRect) {
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
  if (snap.canvas) {
    ctx.drawImage(snap.canvas, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h)
  }
  for (const patch of snap.canvasPatches ?? []) {
    const hit = intersectDirtyRects(rect, patchToDirtyRect(patch))
    if (!hit) continue
    ctx.clearRect(hit.x, hit.y, hit.w, hit.h)
    ctx.drawImage(
      patch.canvas,
      hit.x - patch.x,
      hit.y - patch.y,
      hit.w,
      hit.h,
      hit.x,
      hit.y,
      hit.w,
      hit.h,
    )
  }
}

export function drawSnapshotFull(ctx: CanvasRenderingContext2D, snap: LayerSnapshot, width: number, height: number) {
  ctx.clearRect(0, 0, width, height)
  if (snap.canvas) ctx.drawImage(snap.canvas, 0, 0)
  for (const patch of snap.canvasPatches ?? []) {
    ctx.clearRect(patch.x, patch.y, patch.w, patch.h)
    ctx.drawImage(patch.canvas, patch.x, patch.y)
  }
}

function translateCanvasPixels(canvas: HTMLCanvasElement | null | undefined, dx: number, dy: number) {
  if (!canvas || typeof canvas.getContext !== "function") return
  if (dx === 0 && dy === 0) return
  const tmp = makeCanvas(canvas.width, canvas.height)
  tmp.getContext("2d")!.drawImage(canvas, 0, 0)
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(tmp, dx, dy)
}

function movableLayerInfo(doc: PsDocument, ids?: readonly string[]) {
  const selected = ids?.length ? ids : doc.selectedLayerIds
  const selectedSet = new Set(selected)
  return doc.layers
    .filter((layer) => selectedSet.has(layer.id))
    .filter((layer) => layer.kind !== "group" && !layer.locked && !layer.lockAll && !layer.lockMove)
    .map((layer) => ({ layer, bounds: alphaBounds(layer.canvas) }))
    .filter((info): info is { layer: Layer; bounds: { x: number; y: number; w: number; h: number } } => !!info.bounds)
}

function unionRects(rects: { x: number; y: number; w: number; h: number }[]) {
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function moveLayerPixels(layer: Layer, dx: number, dy: number) {
  const ix = Math.round(dx)
  const iy = Math.round(dy)
  if (!ix && !iy) return
  translateCanvasPixels(layer.canvas, ix, iy)
  translateCanvasPixels(layer.mask, ix, iy)
  for (const filter of layer.smartFilters ?? []) {
    if (filter.maskLinked !== false) translateCanvasPixels(filter.mask, ix, iy)
  }
  if (layer.frame?.imageCanvas) translateCanvasPixels(layer.frame.imageCanvas, ix, iy)
}

export function alignLayersInDocument(doc: PsDocument, align: LayerAlignMode, ids?: readonly string[]) {
  const infos = movableLayerInfo(doc, ids)
  if (infos.length < 2) return doc
  const target = unionRects(infos.map((i) => i.bounds))
  for (const { layer, bounds } of infos) {
    let dx = 0
    let dy = 0
    if (align === "left") dx = target.x - bounds.x
    if (align === "center-x") dx = target.x + target.w / 2 - (bounds.x + bounds.w / 2)
    if (align === "right") dx = target.x + target.w - (bounds.x + bounds.w)
    if (align === "top") dy = target.y - bounds.y
    if (align === "center-y") dy = target.y + target.h / 2 - (bounds.y + bounds.h / 2)
    if (align === "bottom") dy = target.y + target.h - (bounds.y + bounds.h)
    moveLayerPixels(layer, dx, dy)
  }
  return { ...doc, layers: [...doc.layers] }
}

export function distributeLayersInDocument(doc: PsDocument, axis: LayerDistributeAxis, ids?: readonly string[]) {
  const infos = movableLayerInfo(doc, ids)
  if (infos.length < 3) return doc
  const sorted = [...infos].sort((a, b) => {
    const ac = axis === "horizontal" ? a.bounds.x + a.bounds.w / 2 : a.bounds.y + a.bounds.h / 2
    const bc = axis === "horizontal" ? b.bounds.x + b.bounds.w / 2 : b.bounds.y + b.bounds.h / 2
    return ac - bc
  })
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const firstCenter =
    axis === "horizontal"
      ? first.bounds.x + first.bounds.w / 2
      : first.bounds.y + first.bounds.h / 2
  const lastCenter =
    axis === "horizontal"
      ? last.bounds.x + last.bounds.w / 2
      : last.bounds.y + last.bounds.h / 2
  const step = (lastCenter - firstCenter) / (sorted.length - 1)
  sorted.forEach(({ layer, bounds }, index) => {
    const currentCenter = axis === "horizontal" ? bounds.x + bounds.w / 2 : bounds.y + bounds.h / 2
    const desiredCenter = firstCenter + step * index
    moveLayerPixels(layer, axis === "horizontal" ? desiredCenter - currentCenter : 0, axis === "vertical" ? desiredCenter - currentCenter : 0)
  })
  return { ...doc, layers: [...doc.layers] }
}
