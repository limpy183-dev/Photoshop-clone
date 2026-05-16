"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type {
  AdjustmentProps,
  BlendMode,
  BrushPreset,
  BrushSettings,
  CanvasPatch,
  ColorManagementSettings,
  CloneSourceSettings,
  CountMarker,
  ColorSampler,
  AssetLibraryItem,
  DocumentModeSettings,
  DocumentReport,
  DocumentMetadata,
  EraserSettings,
  GradientSettings,
  Guide,
  HistoryEntry,
  HistorySnapshot,
  Layer,
  LayerComp,
  LayerKind,
  LayerSnapshot,
  LayerStyle,
  MacroAction,
  MacroStep,
  Note,
  PaintBucketSettings,
  PathProps,
  PrintSettings,
  PluginDescriptor,
  PsDocument,
  Selection,
  SelectionOptions,
  ShapeProps,
  Slice,
  SmartFilter,
  SmartObjectSource,
  SymmetrySettings,
  TextProps,
  ThreeDScene,
  TimelineFrame,
  ToolId,
  TransformState,
  VariableDataSet,
  VideoLayerProps,
} from "./types"
import { createSmartObjectSource, markSmartObjectLinked, replaceSmartObjectContents } from "./smart-objects"
import { compositeLayer, getNativeComposite } from "./blend-modes"
import { loadPreferencesFromStorage, recordHistoryLogEntryFromStorage } from "./preferences-engine"
import {
  borderSelectionMask,
  contractSelectionMask,
  expandSelectionMask,
  featherMask,
  maskBounds,
  rasterizeShape,
  rasterizeText,
  selectionFromMask,
  selectionToMaskCanvas,
  smoothSelectionMask,
} from "./tool-helpers"
import { assertCanvasSize } from "./canvas-limits"

/* ----------------------------- helpers --------------------------------- */

interface DirtyRect {
  x: number
  y: number
  w: number
  h: number
}

type LayerChangeHints = {
  ids?: readonly string[]
  bounds?: Record<string, DirtyRect>
}

type ChangedLayerIds = readonly string[] | "all" | LayerChangeHints
type LayerAlignMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom"
type LayerDistributeAxis = "horizontal" | "vertical"

export type DocumentStorageKind = "new" | "download" | "file-system-access" | "opened-file" | "snapshot"
export type DocumentFileKind = "project" | "psd" | "image"

export interface FileSystemWritableFileStreamLike {
  write(data: Blob | string): Promise<void>
  close(): Promise<void>
}

export interface FileSystemFileHandleLike {
  name: string
  createWritable(): Promise<FileSystemWritableFileStreamLike>
}

export interface DocumentLifecycleState {
  dirty: boolean
  savedHistoryIndex: number
  savedAt?: number
  fileName?: string
  fileKind?: DocumentFileKind
  storage?: DocumentStorageKind
  fileHandle?: FileSystemFileHandleLike
  lastSaveNote?: string
}

const MAX_HISTORY_PATCHES = 24
const MAX_HISTORY_PATCH_AREA_RATIO = 0.42
const MAX_HISTORY_PATCH_CHAIN_AREA_RATIO = 0.9

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/** Read the undo limit from user preferences (defaults to 50). */
function getUndoLimit(): number {
  try {
    return loadPreferencesFromStorage().undoLimit
  } catch {}
  return 50
}

/** Fast deep clone for plain objects/arrays — avoids JSON.parse(JSON.stringify(...)) overhead */
function deepClonePlain<T>(obj: T): T {
  if (typeof structuredClone === "function") return structuredClone(obj)
  // Fallback (very old browsers): JSON round-trip
  return JSON.parse(JSON.stringify(obj))
}

/* ----------- compressed history storage ----------- */
/** Keep the N most recent history entries uncompressed for fast undo */
const COMPRESS_AFTER_N = 12

/**
 * Compress a canvas to a WebP Blob for memory-efficient storage.
 * Returns the blob, or null if compression fails.
 */
function compressCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/webp",
        0.92,
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * Decompress a Blob back to a canvas for rendering.
 */
async function decompressBlob(blob: Blob, width: number, height: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

/** Map from compressed canvas placeholder ID → blob */
const _compressedCanvasStore = new Map<string, Blob>()
let _compressedIdCounter = 0

/**
 * Create a tiny 1×1 placeholder canvas that represents a compressed entry.
 * The actual pixel data is stored as a Blob in _compressedCanvasStore.
 */
function createCompressedPlaceholder(blobId: string): HTMLCanvasElement {
  const c = makeCanvas(1, 1)
  c.__compressedBlobId = blobId
  return c
}

/** Check if a canvas is a compressed placeholder */
function isCompressedCanvas(canvas: HTMLCanvasElement | null | undefined): boolean {
  return !!(canvas && canvas.__compressedBlobId)
}

/** Get the blob ID from a compressed placeholder */
function getCompressedBlobId(canvas: HTMLCanvasElement): string | null {
  return canvas.__compressedBlobId ?? null
}

/**
 * Compress old history entries in the background to reduce memory.
 * Called after push-history when there are enough entries.
 */
function scheduleHistoryCompression(entries: HistoryEntry[], currentIndex: number) {
  const start = 0
  const end = Math.max(0, currentIndex - COMPRESS_AFTER_N)
  if (end <= start) return

  const scheduleCompress = typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 100)

  scheduleCompress(async () => {
    for (let i = start; i < end; i++) {
      const entry = entries[i]
      if (!entry) continue
      for (const layerSnap of entry.layers) {
        if (!layerSnap.canvas || isCompressedCanvas(layerSnap.canvas)) continue
        if (layerSnap.canvas.width <= 1 && layerSnap.canvas.height <= 1) continue

        const blob = await compressCanvasToBlob(layerSnap.canvas)
        if (blob) {
          const blobId = `hblob_${_compressedIdCounter++}`
          _compressedCanvasStore.set(blobId, blob)
          const w = layerSnap.canvas.width
          const h = layerSnap.canvas.height
          layerSnap.canvas = createCompressedPlaceholder(blobId)
          layerSnap.canvas!.__origW = w
          layerSnap.canvas!.__origH = h
        }
      }
    }
  })
}

/**
 * Decompress a layer snapshot's canvas if it's compressed.
 * Returns the original canvas if not compressed.
 */
export async function ensureDecompressed(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const blobId = getCompressedBlobId(canvas)
  if (!blobId) return canvas
  const blob = _compressedCanvasStore.get(blobId)
  if (!blob) return canvas
  const w = canvas.__origW ?? 1
  const h = canvas.__origH ?? 1
  const restored = await decompressBlob(blob, w, h)
  // Clean up the compressed blob to avoid leaking
  _compressedCanvasStore.delete(blobId)
  return restored
}

function cloneCanvas(src: HTMLCanvasElement | null | undefined): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null
  if (!src || typeof src.getContext !== "function") return null
  const c = document.createElement("canvas")
  c.width = src.width
  c.height = src.height
  c.getContext("2d")!.drawImage(src, 0, 0)
  return c
}

/**
 * Async canvas clone using createImageBitmap — moves the expensive GPU→CPU
 * pixel readback off the main thread so the UI stays responsive.
 */
async function cloneCanvasAsync(src: HTMLCanvasElement | null | undefined): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null
  if (!src || typeof src.getContext !== "function") return null
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(src)
      const c = document.createElement("canvas")
      c.width = src.width
      c.height = src.height
      c.getContext("2d")!.drawImage(bitmap, 0, 0)
      bitmap.close()
      return c
    } catch {
      // Fallback to sync
    }
  }
  return cloneCanvas(src)
}

function makeCanvas(w: number, h: number, fill?: string): HTMLCanvasElement {
  const size = assertCanvasSize(w, h)
  if (typeof document === "undefined") {
    return { width: size.width, height: size.height, getContext: () => null } as unknown as HTMLCanvasElement
  }
  const c = document.createElement("canvas")
  c.width = size.width
  c.height = size.height
  if (fill) {
    const ctx = c.getContext("2d")!
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, size.width, size.height)
  }
  return c
}

function isLayerChangeHints(value: ChangedLayerIds | undefined): value is LayerChangeHints {
  return !!value && value !== "all" && !Array.isArray(value)
}

function normalizeDirtyRect(rect: DirtyRect | undefined, width: number, height: number): DirtyRect | null {
  if (!rect) return null
  const x1 = Math.max(0, Math.floor(rect.x))
  const y1 = Math.max(0, Math.floor(rect.y))
  const x2 = Math.min(width, Math.ceil(rect.x + rect.w))
  const y2 = Math.min(height, Math.ceil(rect.y + rect.h))
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function cloneCanvasPatch(src: HTMLCanvasElement, rect: DirtyRect): CanvasPatch | null {
  if (typeof src.getContext !== "function") return null
  const patchCanvas = makeCanvas(rect.w, rect.h)
  patchCanvas.getContext("2d")!.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  return { ...rect, canvas: patchCanvas }
}

function canPatchSnapshot(
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

function materializeLayerSnapshotCanvas(
  snap: LayerSnapshot,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const patches = snap.canvasPatches
  if (!patches?.length) return snap.canvas
  const materialized = makeCanvas(width, height)
  const ctx = materialized.getContext?.("2d")
  if (!ctx) return snap.canvas
  if (snap.canvas) ctx.drawImage(snap.canvas, 0, 0)
  for (const patch of patches) {
    ctx.clearRect(patch.x, patch.y, patch.w, patch.h)
    ctx.drawImage(patch.canvas, patch.x, patch.y)
  }
  snap.canvas = materialized
  snap.canvasPatches = undefined
  return materialized
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

function snapshotPixelsEqual(a: LayerSnapshot | undefined, b: LayerSnapshot | undefined) {
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

function adjacentRestoreRect(
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

function drawSnapshotRegion(ctx: CanvasRenderingContext2D, snap: LayerSnapshot, rect: DirtyRect) {
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

function drawSnapshotFull(ctx: CanvasRenderingContext2D, snap: LayerSnapshot, width: number, height: number) {
  ctx.clearRect(0, 0, width, height)
  if (snap.canvas) ctx.drawImage(snap.canvas, 0, 0)
  for (const patch of snap.canvasPatches ?? []) {
    ctx.clearRect(patch.x, patch.y, patch.w, patch.h)
    ctx.drawImage(patch.canvas, patch.x, patch.y)
  }
}

/* ----------- alpha bounds cache (WeakMap auto-invalidates on new canvas) ----------- */
const _alphaBoundsCache = new WeakMap<HTMLCanvasElement, { x: number; y: number; w: number; h: number } | null>()

function alphaBounds(canvas: HTMLCanvasElement) {
  const cached = _alphaBoundsCache.get(canvas)
  if (cached !== undefined) return cached
  const ctx = canvas.getContext?.("2d")
  if (!ctx) return null
  const w = canvas.width
  const h = canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 8) {
        any = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const result = any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
  _alphaBoundsCache.set(canvas, result)
  return result
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
  if (layer.frame?.imageCanvas) translateCanvasPixels(layer.frame.imageCanvas, ix, iy)
}

function translatePath(path: PathProps | null | undefined, dx: number, dy: number): PathProps | null | undefined {
  if (!path) return path
  return {
    ...path,
    points: path.points.map((point) => ({
      ...point,
      x: point.x + dx,
      y: point.y + dy,
      cp1: point.cp1 ? { x: point.cp1.x + dx, y: point.cp1.y + dy } : undefined,
      cp2: point.cp2 ? { x: point.cp2.x + dx, y: point.cp2.y + dy } : undefined,
    })),
  }
}

function cloneLayerIntoDocument(layer: Layer, targetWidth: number, targetHeight: number, sourceWidth: number, sourceHeight: number): Layer {
  const bounds = layer.kind === "group" ? null : alphaBounds(layer.canvas)
  const shouldCenter = sourceWidth !== targetWidth || sourceHeight !== targetHeight
  const dx = shouldCenter && bounds ? Math.round(targetWidth / 2 - (bounds.x + bounds.w / 2)) : 0
  const dy = shouldCenter && bounds ? Math.round(targetHeight / 2 - (bounds.y + bounds.h / 2)) : 0
  const canvas = makeCanvas(targetWidth, targetHeight)
  canvas.getContext("2d")!.drawImage(layer.canvas, dx, dy)
  const mask = layer.mask ? makeCanvas(targetWidth, targetHeight) : null
  if (mask && layer.mask) mask.getContext("2d")!.drawImage(layer.mask, dx, dy)
  const frameImage = layer.frame?.imageCanvas ? makeCanvas(targetWidth, targetHeight) : null
  if (frameImage && layer.frame?.imageCanvas) frameImage.getContext("2d")!.drawImage(layer.frame.imageCanvas, dx, dy)

  return {
    ...layer,
    id: uid("layer"),
    name: `${layer.name} copy`,
    locked: false,
    lockAll: false,
    canvas,
    mask,
    maskEnabled: layer.maskEnabled,
    vectorMask: translatePath(layer.vectorMask, dx, dy) ?? null,
    parentId: undefined,
    childIds: undefined,
    linkGroupId: undefined,
    text: layer.text ? { ...deepClonePlain(layer.text), x: layer.text.x + dx, y: layer.text.y + dy } : undefined,
    shape: layer.shape ? { ...layer.shape, x: layer.shape.x + dx, y: layer.shape.y + dy } : undefined,
    path: translatePath(layer.path, dx, dy) ?? undefined,
    frame: layer.frame ? { ...layer.frame, x: layer.frame.x + dx, y: layer.frame.y + dy, imageCanvas: frameImage } : undefined,
    artboard: layer.artboard ? { ...layer.artboard, x: layer.artboard.x + dx, y: layer.artboard.y + dy } : undefined,
    threeD: layer.threeD ? deepClonePlain(layer.threeD) : undefined,
    video: layer.video ? deepClonePlain(layer.video) : undefined,
    smartFilters: layer.smartFilters ? deepClonePlain(layer.smartFilters) : undefined,
    smartSource: layer.smartSource
      ? {
          width: layer.smartSource.width,
          height: layer.smartSource.height,
          canvas: cloneCanvas(layer.smartSource.canvas),
        }
      : undefined,
  }
}

function cloneLayerExact(layer: Layer, idMap: Map<string, string>): Layer {
  const nextId = idMap.get(layer.id) ?? uid("layer")
  idMap.set(layer.id, nextId)
  return {
    ...layer,
    id: nextId,
    canvas: cloneCanvas(layer.canvas) ?? makeCanvas(layer.canvas.width, layer.canvas.height),
    mask: layer.mask ? cloneCanvas(layer.mask) : layer.mask,
    maskEnabled: layer.maskEnabled,
    vectorMask: layer.vectorMask ? deepClonePlain(layer.vectorMask) : null,
    childIds: layer.childIds?.map((id) => idMap.get(id) ?? id),
    parentId: layer.parentId ? idMap.get(layer.parentId) : undefined,
    text: layer.text ? deepClonePlain(layer.text) : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    path: layer.path ? deepClonePlain(layer.path) : undefined,
    adjustment: layer.adjustment ? deepClonePlain(layer.adjustment) : undefined,
    frame: layer.frame
      ? { ...layer.frame, imageCanvas: layer.frame.imageCanvas ? cloneCanvas(layer.frame.imageCanvas) : null }
      : undefined,
    artboard: layer.artboard ? { ...layer.artboard } : undefined,
    threeD: layer.threeD ? deepClonePlain(layer.threeD) : undefined,
    video: layer.video ? deepClonePlain(layer.video) : undefined,
    smartFilters: layer.smartFilters ? deepClonePlain(layer.smartFilters) : undefined,
    smartSource: layer.smartSource
      ? {
          width: layer.smartSource.width,
          height: layer.smartSource.height,
          canvas: cloneCanvas(layer.smartSource.canvas),
        }
      : undefined,
  }
}

function duplicateDocumentDeep(doc: PsDocument): PsDocument {
  const idMap = new Map<string, string>()
  doc.layers.forEach((layer) => idMap.set(layer.id, uid("layer")))
  const layers = doc.layers.map((layer) => cloneLayerExact(layer, idMap))
  const duplicated: PsDocument = {
    ...doc,
    id: uid("doc"),
    name: `${doc.name.replace(/\s+copy(?:\s+\d+)?$/i, "")} copy`,
    layers,
    activeLayerId: idMap.get(doc.activeLayerId) ?? layers[layers.length - 1]?.id ?? "",
    selectedLayerIds: doc.selectedLayerIds.map((id) => idMap.get(id)).filter(Boolean) as string[],
    selection: {
      ...doc.selection,
      mask: doc.selection.mask ? cloneCanvas(doc.selection.mask) : null,
    },
    guides: doc.guides ? deepClonePlain(doc.guides) : undefined,
    notes: doc.notes ? deepClonePlain(doc.notes) : undefined,
    slices: doc.slices ? deepClonePlain(doc.slices) : undefined,
    counts: doc.counts ? deepClonePlain(doc.counts) : undefined,
    colorSamplers: doc.colorSamplers ? deepClonePlain(doc.colorSamplers) : undefined,
    comps: doc.comps ? deepClonePlain(doc.comps) : undefined,
    channels: doc.channels ? doc.channels.map((channel) => ({ ...channel, id: uid("alpha"), canvas: cloneCanvas(channel.canvas) ?? makeCanvas(doc.width, doc.height) })) : undefined,
    quickMaskCanvas: doc.quickMaskCanvas ? cloneCanvas(doc.quickMaskCanvas) : null,
    stylePresets: doc.stylePresets ? deepClonePlain(doc.stylePresets) : undefined,
    gradientPresets: doc.gradientPresets ? deepClonePlain(doc.gradientPresets) : undefined,
    characterStyles: doc.characterStyles ? deepClonePlain(doc.characterStyles) : undefined,
    paragraphStyles: doc.paragraphStyles ? deepClonePlain(doc.paragraphStyles) : undefined,
    assetLibrary: doc.assetLibrary ? deepClonePlain(doc.assetLibrary) : undefined,
    timelineFrames: doc.timelineFrames ? deepClonePlain(doc.timelineFrames) : undefined,
    plugins: doc.plugins ? deepClonePlain(doc.plugins) : undefined,
    variableDataSets: doc.variableDataSets ? deepClonePlain(doc.variableDataSets) : undefined,
    modeSettings: doc.modeSettings ? deepClonePlain(doc.modeSettings) : undefined,
    reports: doc.reports ? deepClonePlain(doc.reports) : undefined,
    metadata: doc.metadata ? { ...deepClonePlain(doc.metadata), title: `${doc.metadata.title ?? doc.name} copy`, modifiedAt: new Date().toISOString() } : undefined,
    colorManagement: doc.colorManagement ? deepClonePlain(doc.colorManagement) : undefined,
    printSettings: doc.printSettings ? deepClonePlain(doc.printSettings) : undefined,
    smartObjectParent: undefined,
  }
  if (!duplicated.selectedLayerIds.length && duplicated.activeLayerId) duplicated.selectedLayerIds = [duplicated.activeLayerId]
  return duplicated
}

function alignLayersInDocument(doc: PsDocument, align: LayerAlignMode, ids?: readonly string[]) {
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

function distributeLayersInDocument(doc: PsDocument, axis: LayerDistributeAxis, ids?: readonly string[]) {
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

type DocumentIds = {
  doc: string
  backgroundLayer: string
  layer: string
}

export function makeDocument(
  name: string,
  w: number,
  h: number,
  bg = "#ffffff",
  ids?: DocumentIds,
): PsDocument {
  const bgLayer: Layer = {
    id: ids?.backgroundLayer ?? uid("layer"),
    name: "Background",
    kind: "raster",
    visible: true,
    locked: true,
    opacity: 1,
    blendMode: "normal",
    canvas: makeCanvas(w, h, bg),
  }
  const layer1: Layer = {
    id: ids?.layer ?? uid("layer"),
    name: "Layer 1",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: makeCanvas(w, h),
  }
  return {
    id: ids?.doc ?? uid("doc"),
    name,
    width: w,
    height: h,
    zoom: 1,
    layers: [bgLayer, layer1],
    activeLayerId: layer1.id,
    selectedLayerIds: [layer1.id],
    background: bg,
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    rotation: 0,
    guides: [],
    showGrid: false,
    showSmartGuides: true,
    gridSize: 50,
    snap: true,
    snapToGrid: false,
    snapToGuides: true,
    quickMask: false,
    quickMaskCanvas: null,
    rulerUnits: "px",
    rulerOrigin: { x: 0, y: 0 },
    gridColor: "#78b4ff",
    gridSubdivisions: 1,
    gridOpacity: 0.42,
    showPixelGrid: false,
    slices: [],
    colorSamplers: [],
    globalLight: { angle: 120, altitude: 30 },
    metadata: {
      title: name,
      author: "",
      description: "",
      copyright: "",
      keywords: [],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    colorManagement: {
      assignedProfile: "sRGB IEC61966-2.1",
      workingSpace: "sRGB IEC61966-2.1",
      renderingIntent: "relative-colorimetric",
      blackPointCompensation: true,
      proofProfile: "None",
      proofColors: false,
      gamutWarning: false,
    },
    printSettings: {
      paperSize: "Letter",
      orientation: "portrait",
      scale: 100,
      bleedMm: 0,
      cropMarks: false,
      registrationMarks: false,
      colorHandling: "app",
      proofPrint: false,
      printerProfile: "Working CMYK",
      paperColor: "#ffffff",
      marksOffsetMm: 4,
      pagePosition: "center",
    },
    modeSettings: { mode: "RGB" },
    plugins: [],
    variableDataSets: [],
  }
}

export function blendToComposite(b: BlendMode): GlobalCompositeOperation {
  const map: Record<BlendMode, GlobalCompositeOperation> = {
    normal: "source-over",
    dissolve: "source-over",
    behind: "destination-over",
    clear: "destination-out",
    darken: "darken",
    multiply: "multiply",
    "color-burn": "color-burn",
    "linear-burn": "color-burn",
    "darker-color": "darken",
    lighten: "lighten",
    screen: "screen",
    "color-dodge": "color-dodge",
    "linear-dodge": "color-dodge",
    "lighter-color": "lighten",
    overlay: "overlay",
    "soft-light": "soft-light",
    "hard-light": "hard-light",
    "vivid-light": "overlay",
    "linear-light": "lighten",
    "pin-light": "hard-light",
    "hard-mix": "hard-light",
    difference: "difference",
    exclusion: "exclusion",
    subtract: "destination-out",
    divide: "destination-out",
    hue: "hue",
    saturation: "saturation",
    color: "color",
    luminosity: "luminosity",
  }
  return map[b]
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isLayerLocked(layer: Layer | undefined | null) {
  return !!layer && (layer.locked || layer.lockAll)
}

function blocksLayerMove(layer: Layer | undefined | null) {
  return isLayerLocked(layer) || !!layer?.lockMove
}

type GlobalLight = NonNullable<PsDocument["globalLight"]>

function normalizeGlobalLight(light: GlobalLight): GlobalLight {
  return {
    angle: clamp(Math.round(Number.isFinite(light.angle) ? light.angle : 120), -180, 180),
    altitude: clamp(Math.round(Number.isFinite(light.altitude) ? light.altitude : 30), 0, 90),
  }
}

function offsetFromGlobalLight(effect: { angle?: number; distance?: number; offsetX?: number; offsetY?: number }, angle: number) {
  const distance = effect.distance ?? Math.hypot(effect.offsetX ?? 0, effect.offsetY ?? 0)
  const radians = (angle * Math.PI) / 180
  return {
    angle,
    distance,
    offsetX: -Math.cos(radians) * distance,
    offsetY: Math.sin(radians) * distance,
  }
}

function applyGlobalLightToStyle(style: LayerStyle | undefined, light: GlobalLight): LayerStyle | undefined {
  if (!style) return style
  let next: LayerStyle | undefined = style
  const editable = () => {
    if (next === style) next = deepClonePlain(style)
    return next!
  }
  if (style.dropShadow && (style.dropShadow.useGlobalLight ?? true)) {
    const target = editable()
    target.dropShadow = {
      ...target.dropShadow!,
      ...offsetFromGlobalLight(target.dropShadow!, light.angle),
    }
  }
  if (style.innerShadow && (style.innerShadow.useGlobalLight ?? true)) {
    const target = editable()
    target.innerShadow = {
      ...target.innerShadow!,
      ...offsetFromGlobalLight(target.innerShadow!, light.angle),
    }
  }
  if (style.bevel && (style.bevel.useGlobalLight ?? true)) {
    const target = editable()
    target.bevel = {
      ...target.bevel!,
      angle: light.angle,
      altitude: light.altitude,
    }
  }
  return next
}

/* ---------------------------- state shape ------------------------------ */

interface DocHistory {
  entries: HistoryEntry[]
  index: number
}

interface ClosedDocumentRecord {
  id: string
  doc: PsDocument
  history: DocHistory | undefined
  snapshots: HistorySnapshot[]
  lifecycle: DocumentLifecycleState | undefined
  closedAt: number
}

interface EditorState {
  documents: PsDocument[]
  activeDocId: string | null
  tool: ToolId
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  paintBucket: PaintBucketSettings
  eraser: EraserSettings
  cloneSource: CloneSourceSettings
  symmetry: SymmetrySettings
  selectionOptions: SelectionOptions
  transform: TransformState | null
  brushPresets: BrushPreset[]
  /** per-document undo history */
  histories: Record<string, DocHistory>
  /** named per-document history snapshots */
  snapshots: Record<string, HistorySnapshot[]>
  /** recorded macro actions */
  actions: MacroAction[]
  recordingActionId: string | null
  isPlayingAction: boolean
  /** in-memory clipboard (pixels copied from a layer/selection) */
  clipboard: { width: number; height: number; canvas: HTMLCanvasElement } | null
  /** in-memory clipboard for Layer FX settings */
  styleClipboard: LayerStyle | null
  /** in-memory closed document stack for Reopen Closed Document. */
  closedDocuments: ClosedDocumentRecord[]
  /** per-document dirty/saved identity and browser storage state */
  documentLifecycle: Record<string, DocumentLifecycleState>
}

function changedLayerIdsForHistoryLog(changedLayerIds: ChangedLayerIds | undefined): string[] | undefined {
  if (!changedLayerIds) return undefined
  if (changedLayerIds === "all") return ["all"]
  if (Array.isArray(changedLayerIds)) return [...(changedLayerIds as readonly string[])]
  return "ids" in changedLayerIds && changedLayerIds.ids?.length ? [...changedLayerIds.ids] : undefined
}

function toolSettingsForHistoryLog(state: EditorState): Record<string, unknown> | undefined {
  if (["brush", "pencil", "mixer-brush", "history-brush", "art-history-brush"].includes(state.tool)) {
    return {
      size: state.brush.size,
      hardness: state.brush.hardness,
      opacity: state.brush.opacity,
      flow: state.brush.flow,
      smoothing: state.brush.smoothing,
    }
  }
  if (state.tool === "gradient") return { ...state.gradient }
  if (state.tool === "paint-bucket") return { ...state.paintBucket }
  if (state.tool === "eraser" || state.tool === "magic-eraser" || state.tool === "background-eraser") return { ...state.eraser }
  if (state.tool === "clone-stamp" || state.tool === "pattern-stamp") {
    return {
      aligned: state.cloneSource.aligned,
      sample: state.cloneSource.sample,
      scale: state.cloneSource.scale,
      rotation: state.cloneSource.rotation,
      showOverlay: state.cloneSource.showOverlay,
    }
  }
  if (["marquee-rect", "marquee-ellipse", "lasso", "lasso-polygon", "lasso-magnetic", "magic-wand", "quick-selection", "object-select"].includes(state.tool)) {
    return { ...state.selectionOptions }
  }
  return undefined
}

export type Action =
  | { type: "hydrate-settings"; settings: Partial<Pick<EditorState, "tool" | "foreground" | "background" | "brush" | "gradient" | "symmetry">> }
  | { type: "set-tool"; tool: ToolId }
  | { type: "set-foreground"; color: string }
  | { type: "set-background"; color: string }
  | { type: "swap-colors" }
  | { type: "reset-colors" }
  | { type: "set-brush"; brush: Partial<BrushSettings> }
  | { type: "set-gradient"; gradient: Partial<GradientSettings> }
  | { type: "set-paint-bucket"; paintBucket: Partial<PaintBucketSettings> }
  | { type: "set-eraser"; eraser: Partial<EraserSettings> }
  | { type: "set-clone-source"; cloneSource: Partial<CloneSourceSettings> }
  | { type: "set-selection-options"; selectionOptions: Partial<SelectionOptions> }
  | { type: "set-symmetry"; symmetry: Partial<SymmetrySettings> }
  | { type: "set-transform"; transform: TransformState }
  | { type: "clear-transform" }
  | { type: "apply-brush-preset"; preset: BrushPreset }
  | { type: "add-brush-preset"; preset: BrushPreset }
  | { type: "remove-brush-preset"; id: string }
  | { type: "set-brush-presets"; presets: BrushPreset[] }
  | { type: "new-document"; doc: PsDocument; entry: HistoryEntry; lifecycle?: Partial<DocumentLifecycleState> }
  | { type: "close-document"; id: string }
  | { type: "close-other-documents"; keepId: string }
  | { type: "reopen-closed-document"; id?: string }
  | { type: "move-layers-to-document"; sourceDocId: string; targetDocId: string; layerIds: string[]; copy?: boolean }
  | { type: "activate-document"; id: string }
  | { type: "set-zoom"; zoom: number }
  | { type: "set-rotation"; rotation: 0 | 90 | 180 | 270 }
  | { type: "toggle-grid" }
  | { type: "set-grid-size"; size: number }
  | { type: "set-ruler-units"; units: PsDocument["rulerUnits"] }
  | { type: "set-grid-color"; color: string }
  | { type: "set-grid-subdivisions"; subdivisions: number }
  | { type: "set-grid-opacity"; opacity: number }
  | { type: "toggle-pixel-grid" }
  | { type: "toggle-snap" }
  | { type: "toggle-snap-grid" }
  | { type: "toggle-snap-guides" }
  | { type: "set-show-smart-guides"; show: boolean }
  | { type: "add-guide"; guide: Guide }
  | { type: "update-guide"; id: string; patch: Partial<Guide> }
  | { type: "move-guide"; id: string; position: number }
  | { type: "remove-guide"; id: string }
  | { type: "clear-guides" }
  | { type: "set-quick-mask"; on: boolean; canvas?: HTMLCanvasElement | null }
  | { type: "set-selection"; selection: Selection }
  | { type: "add-layer"; layer: Layer }
  | { type: "remove-layer"; id: string }
  | { type: "duplicate-layer"; id: string }
  | { type: "set-active-layer"; id: string }
  | { type: "set-selected-layers"; ids: string[]; activeId: string }
  | { type: "toggle-layer-visibility"; id: string }
  | { type: "set-layer-visibility"; id: string; visible: boolean }
  | { type: "toggle-layer-lock"; id: string }
  | { type: "toggle-layer-clipped"; id: string }
  | { type: "set-layer-opacity"; id: string; opacity: number }
  | { type: "set-layer-fill-opacity"; id: string; fillOpacity: number }
  | { type: "set-layer-blend"; id: string; blendMode: BlendMode }
  | { type: "set-layer-style"; id: string; style: LayerStyle | undefined }
  | { type: "set-layer-mask"; id: string; mask: HTMLCanvasElement | null }
  | { type: "set-layer-mask-enabled"; id: string; enabled: boolean }
  | { type: "set-layer-text"; id: string; text: TextProps | undefined }
  | { type: "set-layer-shape"; id: string; shape: ShapeProps }
  | { type: "set-layer-path"; id: string; path: PathProps | undefined }
  | { type: "set-layer-kind"; id: string; kind: LayerKind }
  | { type: "set-layer-3d"; id: string; scene: ThreeDScene | undefined }
  | { type: "set-layer-video"; id: string; video: VideoLayerProps | undefined }
  | { type: "set-layer-smart"; id: string; smart: boolean }
  | { type: "set-layer-smart-link"; id: string; source: Partial<SmartObjectSource> }
  | { type: "set-layer-smart-link-status"; id: string; status: NonNullable<SmartObjectSource["status"]> }
  | { type: "replace-smart-object-contents"; id: string; canvas: HTMLCanvasElement; source?: Partial<SmartObjectSource> }
  | { type: "update-smart-object-parent"; parentDocId: string; layerId: string; canvas: HTMLCanvasElement }
  | { type: "rename-layer"; id: string; name: string }
  | { type: "move-layer"; id: string; direction: "up" | "down" }
  | { type: "merge-down"; id: string }
  | { type: "merge-selected" }
  | { type: "flatten" }
  | { type: "link-selected" }
  | { type: "unlink-selected" }
  | { type: "group-selected"; groupId: string }
  | { type: "ungroup"; groupId: string }
  | { type: "toggle-group-expanded"; id: string }
  | { type: "push-history"; entry: HistoryEntry }
  | {
      type: "restore-history"
      index: number
      entry: HistoryEntry
      restoredLayers: Layer[]
      activeLayerId: string
      selectedLayerIds: string[]
    }
  | { type: "restore-history-entry"; entry: HistoryEntry }
  | { type: "add-history-snapshot"; docId: string; snapshot: HistorySnapshot }
  | { type: "delete-history-snapshot"; docId: string; snapshotId: string }
  | { type: "add-action"; action: MacroAction }
  | { type: "set-actions"; actions: MacroAction[] }
  | { type: "delete-action"; id: string }
  | { type: "start-recording-action"; id: string }
  | { type: "stop-recording-action" }
  | { type: "append-action-step"; actionId: string; step: MacroStep }
  | { type: "clear-action-steps"; id: string }
  | { type: "set-playing-action"; playing: boolean }
  | { type: "resize-document"; width: number; height: number }
  | { type: "resize-canvas"; width: number; height: number; offsetX: number; offsetY: number; fill: string }
  | { type: "set-clipboard"; canvas: HTMLCanvasElement }
  | { type: "clear-clipboard" }
  | { type: "set-style-clipboard"; style: LayerStyle | null }
  | { type: "set-layer-vector-mask"; id: string; mask: PathProps | null }
  | { type: "set-layer-adjustment"; id: string; adjustment: AdjustmentProps }
  | { type: "set-layer-smart-filters"; id: string; smartFilters: SmartFilter[] }
  | { type: "set-style-presets"; presets: NonNullable<PsDocument["stylePresets"]> }
  | { type: "set-asset-library"; assets: AssetLibraryItem[] }
  | { type: "set-timeline-frames"; frames: TimelineFrame[] }
  | { type: "set-global-light"; globalLight: GlobalLight }
  | { type: "set-document-metadata"; metadata: DocumentMetadata }
  | { type: "set-color-management"; settings: ColorManagementSettings }
  | { type: "set-print-settings"; settings: PrintSettings }
  | { type: "set-document-mode-settings"; colorMode: PsDocument["colorMode"]; settings?: DocumentModeSettings }
  | { type: "set-plugins"; plugins: PluginDescriptor[] }
  | { type: "set-variable-data-sets"; dataSets: VariableDataSet[] }
  | { type: "add-document-report"; report: DocumentReport }
  | { type: "clear-document-reports" }
  | { type: "set-layer-color-label"; id: string; label: Layer["colorLabel"] }
  | { type: "align-layers"; align: LayerAlignMode; ids?: string[] }
  | { type: "distribute-layers"; axis: LayerDistributeAxis; ids?: string[] }
  | { type: "reorder-layer"; id: string; targetId: string; position: "above" | "below" | "into" }
  | { type: "reorder-layers"; ids: string[]; targetId: string; position: "above" | "below" | "into" }
  | { type: "add-note"; note: Note }
  | { type: "update-note"; id: string; patch: Partial<Note> }
  | { type: "remove-note"; id: string }
  | { type: "add-slice"; slice: Slice }
  | { type: "update-slice"; id: string; patch: Partial<Slice> }
  | { type: "set-active-slice"; id: string | null }
  | { type: "remove-slice"; id: string }
  | { type: "clear-slices" }
  | { type: "add-count"; count: CountMarker }
  | { type: "remove-count"; id: string }
  | { type: "clear-counts" }
  | { type: "set-count-group"; group: string }
  | { type: "add-color-sampler"; sampler: ColorSampler }
  | { type: "update-color-sampler"; id: string; patch: Partial<ColorSampler> }
  | { type: "remove-color-sampler"; id: string }
  | { type: "clear-color-samplers" }
  | { type: "save-comp"; comp: LayerComp }
  | { type: "apply-comp"; id: string }
  | { type: "remove-comp"; id: string }
  | { type: "set-measurement"; m: PsDocument["measurement"] }
  | { type: "set-gradient-stops"; stops: GradientSettings["stops"] }
  | { type: "grow-selection"; amount: number }
  | { type: "contract-selection"; amount: number }
  | { type: "similar-selection"; tolerance: number }
  | { type: "stamp-visible" }
  | { type: "toggle-layer-lock-transparency"; id: string }
  | { type: "toggle-layer-lock-draw"; id: string }
  | { type: "toggle-layer-lock-move"; id: string }
  | { type: "toggle-layer-lock-all"; id: string }
  | { type: "feather-selection"; radius: number }
  | { type: "border-selection"; width: number }
  | { type: "smooth-selection"; radius: number }
  | { type: "save-selection"; channel: { id: string; name: string; canvas: HTMLCanvasElement } }
  | { type: "load-selection"; channelId: string }
  | { type: "update-channel"; channelId: string; patch: Partial<{ name: string; canvas: HTMLCanvasElement }> }
  | { type: "delete-channel"; channelId: string }
  | { type: "mark-document-dirty"; id: string }
  | { type: "mark-document-saved"; id: string; lifecycle?: Partial<DocumentLifecycleState> }
  | { type: "set-document-lifecycle"; id: string; lifecycle: Partial<DocumentLifecycleState> }

const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  { id: "soft-30", name: "Soft Round 30", size: 30, hardness: 0, spacing: 25, settings: { tipShape: "round", smoothing: 18 } },
  { id: "soft-60", name: "Soft Round 60", size: 60, hardness: 0, spacing: 25, settings: { tipShape: "round", smoothing: 22 } },
  { id: "hard-15", name: "Hard Round 15", size: 15, hardness: 100, spacing: 18, settings: { tipShape: "round", smoothing: 4 } },
  { id: "hard-50", name: "Hard Round 50", size: 50, hardness: 100, spacing: 18, settings: { tipShape: "round", smoothing: 6 } },
  {
    id: "calligraphy",
    name: "Calligraphy 25",
    size: 25,
    hardness: 92,
    spacing: 8,
    settings: { tipShape: "round", angleJitter: 4, roundnessJitter: 55, angleControl: "tilt" },
  },
  {
    id: "airbrush",
    name: "Airbrush 80",
    size: 80,
    hardness: 0,
    spacing: 5,
    settings: { tipShape: "round", flow: 28, opacityJitter: 12, flowControl: "pressure", buildUp: true },
  },
  { id: "fine", name: "Fine Detail 4", size: 4, hardness: 100, spacing: 5, settings: { tipShape: "round", smoothing: 35 } },
  {
    id: "marker",
    name: "Marker 40",
    size: 40,
    hardness: 70,
    spacing: 10,
    settings: { tipShape: "square", opacity: 88, flow: 72, wetEdges: true },
  },
  {
    id: "bristle-dry",
    name: "Dry Bristle 42",
    size: 42,
    hardness: 65,
    spacing: 12,
    settings: { tipShape: "bristle", texture: { enabled: true, pattern: "canvas", mode: "multiply", depth: 55, depthJitter: 20, minDepth: 12, scale: 90 }, purity: -8 },
  },
  {
    id: "erodible-chalk",
    name: "Erodible Chalk 36",
    size: 36,
    hardness: 78,
    spacing: 16,
    settings: { tipShape: "erodible", noise: true, texture: { enabled: true, pattern: "paper", mode: "subtract", depth: 46, depthJitter: 28, minDepth: 8, scale: 120 } },
  },
]

const DOCUMENT_DIRTY_ACTIONS = new Set<Action["type"]>([
  "add-layer",
  "remove-layer",
  "duplicate-layer",
  "toggle-layer-visibility",
  "set-layer-visibility",
  "toggle-layer-lock",
  "toggle-layer-clipped",
  "set-layer-opacity",
  "set-layer-fill-opacity",
  "set-layer-blend",
  "set-layer-style",
  "set-layer-mask",
  "set-layer-mask-enabled",
  "set-layer-text",
  "set-layer-shape",
  "set-layer-path",
  "set-layer-kind",
  "set-layer-3d",
  "set-layer-video",
  "set-layer-smart",
  "set-layer-smart-link",
  "set-layer-smart-link-status",
  "replace-smart-object-contents",
  "rename-layer",
  "move-layer",
  "merge-down",
  "merge-selected",
  "flatten",
  "link-selected",
  "unlink-selected",
  "group-selected",
  "ungroup",
  "resize-document",
  "resize-canvas",
  "set-layer-vector-mask",
  "set-layer-adjustment",
  "set-layer-smart-filters",
  "set-style-presets",
  "set-asset-library",
  "set-timeline-frames",
  "set-global-light",
  "set-document-metadata",
  "set-color-management",
  "set-print-settings",
  "set-document-mode-settings",
  "set-plugins",
  "set-variable-data-sets",
  "add-document-report",
  "clear-document-reports",
  "set-layer-color-label",
  "align-layers",
  "distribute-layers",
  "reorder-layer",
  "add-note",
  "update-note",
  "remove-note",
  "add-slice",
  "update-slice",
  "set-active-slice",
  "remove-slice",
  "clear-slices",
  "add-count",
  "remove-count",
  "clear-counts",
  "set-count-group",
  "add-color-sampler",
  "update-color-sampler",
  "remove-color-sampler",
  "clear-color-samplers",
  "save-comp",
  "apply-comp",
  "remove-comp",
  "set-measurement",
  "set-gradient-stops",
  "grow-selection",
  "contract-selection",
  "similar-selection",
  "stamp-visible",
  "toggle-layer-lock-transparency",
  "toggle-layer-lock-draw",
  "toggle-layer-lock-move",
  "toggle-layer-lock-all",
  "feather-selection",
  "border-selection",
  "smooth-selection",
  "save-selection",
  "load-selection",
  "update-channel",
  "delete-channel",
])

function makeDocumentLifecycle(
  doc: PsDocument,
  savedHistoryIndex = 0,
  patch: Partial<DocumentLifecycleState> = {},
): DocumentLifecycleState {
  return {
    dirty: false,
    savedHistoryIndex,
    storage: "new",
    fileName: doc.name,
    ...patch,
  }
}

function currentHistoryIndex(state: EditorState, docId: string) {
  return state.histories[docId]?.index ?? 0
}

function documentLifecycleFor(state: EditorState, doc: PsDocument) {
  return state.documentLifecycle[doc.id] ?? makeDocumentLifecycle(doc, currentHistoryIndex(state, doc.id))
}

function isDocumentDirtyInState(state: EditorState, docId: string) {
  const doc = state.documents.find((candidate) => candidate.id === docId)
  if (!doc) return false
  const lifecycle = documentLifecycleFor(state, doc)
  return lifecycle.dirty || lifecycle.savedHistoryIndex !== currentHistoryIndex(state, docId)
}

function withDocumentLifecyclePatch(
  state: EditorState,
  docId: string,
  patch: Partial<DocumentLifecycleState>,
): EditorState {
  const doc = state.documents.find((candidate) => candidate.id === docId)
  if (!doc) return state
  return {
    ...state,
    documentLifecycle: {
      ...state.documentLifecycle,
      [docId]: {
        ...documentLifecycleFor(state, doc),
        ...patch,
      },
    },
  }
}

function dirtyDocIdsForAction(action: Action, state: EditorState) {
  if (action.type === "move-layers-to-document") {
    return action.copy ? [action.targetDocId] : [action.sourceDocId, action.targetDocId]
  }
  if (action.type === "update-smart-object-parent") return [action.parentDocId]
  if (!DOCUMENT_DIRTY_ACTIONS.has(action.type)) return []
  return state.activeDocId ? [state.activeDocId] : []
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "hydrate-settings":
      return { ...state, ...action.settings }
    case "set-tool":
      return { ...state, tool: action.tool }
    case "set-foreground":
      return { ...state, foreground: action.color }
    case "set-background":
      return { ...state, background: action.color }
    case "swap-colors":
      return { ...state, foreground: state.background, background: state.foreground }
    case "reset-colors":
      return { ...state, foreground: "#000000", background: "#ffffff" }
    case "set-brush":
      return { ...state, brush: { ...state.brush, ...action.brush } }
    case "set-gradient":
      return { ...state, gradient: { ...state.gradient, ...action.gradient } }
    case "set-paint-bucket":
      return { ...state, paintBucket: { ...state.paintBucket, ...action.paintBucket } }
    case "set-eraser":
      return { ...state, eraser: { ...state.eraser, ...action.eraser } }
    case "set-clone-source":
      return { ...state, cloneSource: { ...state.cloneSource, ...action.cloneSource } }
    case "set-selection-options":
      return { ...state, selectionOptions: { ...state.selectionOptions, ...action.selectionOptions } }
    case "set-symmetry":
      return { ...state, symmetry: { ...state.symmetry, ...action.symmetry } }
    case "set-transform":
      return { ...state, transform: action.transform }
    case "clear-transform":
      return { ...state, transform: null }
    case "apply-brush-preset":
      return {
        ...state,
        brush: {
          ...state.brush,
          size: action.preset.size,
          hardness: action.preset.hardness,
          spacing: action.preset.spacing,
          ...(action.preset.settings ?? {}),
        },
      }
    case "add-brush-preset":
      return { ...state, brushPresets: [...state.brushPresets, action.preset] }
    case "remove-brush-preset":
      return { ...state, brushPresets: state.brushPresets.filter((p) => p.id !== action.id) }
    case "set-brush-presets":
      return { ...state, brushPresets: action.presets }
    case "new-document":
      return {
        ...state,
        documents: [...state.documents, action.doc],
        activeDocId: action.doc.id,
        histories: {
          ...state.histories,
          [action.doc.id]: { entries: [action.entry], index: 0 },
        },
        snapshots: {
          ...state.snapshots,
          [action.doc.id]: [],
        },
        documentLifecycle: {
          ...state.documentLifecycle,
          [action.doc.id]: makeDocumentLifecycle(action.doc, 0, action.lifecycle),
        },
        closedDocuments: state.closedDocuments.filter((record) => record.doc.id !== action.doc.id),
      }
    case "close-document": {
      const closing = state.documents.find((d) => d.id === action.id)
      const docs = state.documents.filter((d) => d.id !== action.id)
      const activeDocId =
        state.activeDocId === action.id ? docs[docs.length - 1]?.id ?? null : state.activeDocId
      const histories = { ...state.histories }
      delete histories[action.id]
      const snapshots = { ...state.snapshots }
      delete snapshots[action.id]
      const documentLifecycle = { ...state.documentLifecycle }
      const closingLifecycle = documentLifecycle[action.id]
      delete documentLifecycle[action.id]
      const closedDocuments = closing
        ? [
            {
              id: uid("closed"),
              doc: closing,
              history: state.histories[action.id],
              snapshots: state.snapshots[action.id] ?? [],
              lifecycle: closingLifecycle,
              closedAt: Date.now(),
            },
            ...state.closedDocuments.filter((record) => record.doc.id !== closing.id),
          ].slice(0, 12)
        : state.closedDocuments
      return { ...state, documents: docs, activeDocId, histories, snapshots, documentLifecycle, closedDocuments }
    }
    case "close-other-documents": {
      const keep = state.documents.find((d) => d.id === action.keepId)
      if (!keep) return state
      const closing = state.documents.filter((d) => d.id !== action.keepId)
      const histories: Record<string, DocHistory> = state.histories[keep.id]
        ? { [keep.id]: state.histories[keep.id] }
        : {}
      const snapshots: Record<string, HistorySnapshot[]> = { [keep.id]: state.snapshots[keep.id] ?? [] }
      const documentLifecycle: Record<string, DocumentLifecycleState> = state.documentLifecycle[keep.id]
        ? { [keep.id]: state.documentLifecycle[keep.id] }
        : {}
      const closedDocuments = [
        ...closing.map((doc) => ({
          id: uid("closed"),
          doc,
          history: state.histories[doc.id],
          snapshots: state.snapshots[doc.id] ?? [],
          lifecycle: state.documentLifecycle[doc.id],
          closedAt: Date.now(),
        })),
        ...state.closedDocuments,
      ].slice(0, 12)
      return { ...state, documents: [keep], activeDocId: keep.id, histories, snapshots, documentLifecycle, closedDocuments }
    }
    case "reopen-closed-document": {
      const index = action.id
        ? state.closedDocuments.findIndex((record) => record.id === action.id)
        : 0
      const record = state.closedDocuments[index]
      if (!record) return state
      const closedDocuments = state.closedDocuments.filter((_, i) => i !== index)
      return {
        ...state,
        documents: [...state.documents.filter((doc) => doc.id !== record.doc.id), record.doc],
        activeDocId: record.doc.id,
        histories: record.history
          ? { ...state.histories, [record.doc.id]: record.history }
          : state.histories,
        snapshots: { ...state.snapshots, [record.doc.id]: record.snapshots },
        documentLifecycle: {
          ...state.documentLifecycle,
          [record.doc.id]: record.lifecycle ?? makeDocumentLifecycle(record.doc, record.history?.index ?? 0),
        },
        closedDocuments,
      }
    }
    case "move-layers-to-document": {
      if (action.sourceDocId === action.targetDocId || !action.layerIds.length) return state
      const source = state.documents.find((doc) => doc.id === action.sourceDocId)
      const target = state.documents.find((doc) => doc.id === action.targetDocId)
      if (!source || !target) return state
      const ids = new Set(action.layerIds)
      const layersToMove = source.layers.filter((layer) => ids.has(layer.id) && layer.kind !== "group")
      if (!layersToMove.length) return state
      const copied = layersToMove.map((layer) => cloneLayerIntoDocument(layer, target.width, target.height, source.width, source.height))
      const documents = state.documents.map((doc) => {
        if (doc.id === target.id) {
          const selectedLayerIds = copied.map((layer) => layer.id)
          return {
            ...doc,
            layers: [...doc.layers, ...copied],
            activeLayerId: selectedLayerIds[selectedLayerIds.length - 1] ?? doc.activeLayerId,
            selectedLayerIds,
          }
        }
        if (!action.copy && doc.id === source.id && source.layers.length > layersToMove.length) {
          const remaining = doc.layers.filter((layer) => !ids.has(layer.id))
          const activeLayerId = remaining.some((layer) => layer.id === doc.activeLayerId)
            ? doc.activeLayerId
            : remaining[remaining.length - 1].id
          return {
            ...doc,
            layers: remaining,
            activeLayerId,
            selectedLayerIds: [activeLayerId],
          }
        }
        return doc
      })
      return { ...state, documents, activeDocId: target.id }
    }
    case "activate-document":
      return { ...state, activeDocId: action.id }
    case "set-zoom":
      return mutateActiveDoc(state, (d) => ({ ...d, zoom: clamp(action.zoom, 0.05, 32) }))
    case "set-rotation":
      return mutateActiveDoc(state, (d) => ({ ...d, rotation: action.rotation }))
    case "toggle-grid":
      return mutateActiveDoc(state, (d) => ({ ...d, showGrid: !d.showGrid }))
    case "set-grid-size":
      return mutateActiveDoc(state, (d) => ({ ...d, gridSize: Math.max(2, action.size) }))
    case "set-ruler-units":
      return mutateActiveDoc(state, (d) => ({ ...d, rulerUnits: action.units }))
    case "set-grid-color":
      return mutateActiveDoc(state, (d) => ({ ...d, gridColor: action.color }))
    case "set-grid-subdivisions":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        gridSubdivisions: clamp(Math.round(action.subdivisions), 1, 16),
      }))
    case "set-grid-opacity":
      return mutateActiveDoc(state, (d) => ({ ...d, gridOpacity: clamp(action.opacity, 0.05, 1) }))
    case "toggle-pixel-grid":
      return mutateActiveDoc(state, (d) => ({ ...d, showPixelGrid: !d.showPixelGrid }))
    case "toggle-snap":
      return mutateActiveDoc(state, (d) => ({ ...d, snap: !d.snap }))
    case "toggle-snap-grid":
      return mutateActiveDoc(state, (d) => ({ ...d, snapToGrid: !d.snapToGrid }))
    case "toggle-snap-guides":
      return mutateActiveDoc(state, (d) => ({ ...d, snapToGuides: !d.snapToGuides }))
    case "set-show-smart-guides":
      return mutateActiveDoc(state, (d) => ({ ...d, showSmartGuides: action.show }))
    case "add-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: [...(d.guides ?? []), action.guide],
      }))
    case "update-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: (d.guides ?? []).map((g) => (g.id === action.id ? { ...g, ...action.patch } : g)),
      }))
    case "move-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: (d.guides ?? []).map((g) =>
          g.id === action.id ? { ...g, position: action.position } : g,
        ),
      }))
    case "remove-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: (d.guides ?? []).filter((g) => g.id !== action.id),
      }))
    case "clear-guides":
      return mutateActiveDoc(state, (d) => ({ ...d, guides: [] }))
    case "set-quick-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        quickMask: action.on,
        quickMaskCanvas: action.canvas !== undefined ? action.canvas : d.quickMaskCanvas,
      }))
    case "set-selection":
      return mutateActiveDoc(state, (d) => ({ ...d, selection: action.selection }))
    case "add-layer":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: [...d.layers, action.layer],
        activeLayerId: action.layer.id,
        selectedLayerIds: [action.layer.id],
      }))
    case "remove-layer":
      return mutateActiveDoc(state, (d) => {
        if (d.layers.length <= 1) return d
        const target = d.layers.find((l) => l.id === action.id)
        if (isLayerLocked(target)) return d
        const layers = d.layers.filter((l) => l.id !== action.id)
        const activeLayerId =
          d.activeLayerId === action.id ? layers[layers.length - 1].id : d.activeLayerId
        return {
          ...d,
          layers,
          activeLayerId,
          selectedLayerIds: d.selectedLayerIds.filter((id) => id !== action.id).concat(
            d.selectedLayerIds.includes(action.id) ? [activeLayerId] : [],
          ),
        }
      })
    case "duplicate-layer":
      return mutateActiveDoc(state, (d) => {
        const idx = d.layers.findIndex((l) => l.id === action.id)
        if (idx < 0) return d
        const src = d.layers[idx]
        const newCanvas = makeCanvas(d.width, d.height)
        newCanvas.getContext?.("2d")?.drawImage(src.canvas, 0, 0)
        const copy: Layer = {
          ...src,
          id: uid("layer"),
          name: `${src.name} copy`,
          locked: false,
          canvas: newCanvas,
          mask: src.mask ? cloneCanvas(src.mask) ?? undefined : undefined,
          maskEnabled: src.maskEnabled,
          threeD: src.threeD ? deepClonePlain(src.threeD) : undefined,
          video: src.video ? deepClonePlain(src.video) : undefined,
          linkGroupId: undefined,
        }
        const layers = [...d.layers.slice(0, idx + 1), copy, ...d.layers.slice(idx + 1)]
        return {
          ...d,
          layers,
          activeLayerId: copy.id,
          selectedLayerIds: [copy.id],
        }
      })
    case "set-active-layer":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        activeLayerId: action.id,
        selectedLayerIds: [action.id],
      }))
    case "set-selected-layers":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        activeLayerId: action.activeId,
        selectedLayerIds: action.ids.length ? action.ids : [action.activeId],
      }))
    case "toggle-layer-visibility":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, visible: !l.visible } : l)),
      }))
    case "set-layer-visibility":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, visible: action.visible } : l)),
      }))
    case "toggle-layer-lock":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id ? { ...l, locked: !l.locked } : l)),
      }))
    case "toggle-layer-clipped":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, clipped: !l.clipped } : l)),
      }))
    case "set-layer-opacity":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l) ? { ...l, opacity: clamp(action.opacity, 0, 1) } : l,
        ),
      }))
    case "set-layer-fill-opacity":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l) ? { ...l, fillOpacity: clamp(action.fillOpacity, 0, 1) } : l,
        ),
      }))
    case "set-layer-blend":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, blendMode: action.blendMode } : l)),
      }))
    case "set-layer-style":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, style: action.style } : l)),
      }))
    case "set-layer-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, mask: action.mask, maskEnabled: action.mask ? l.maskEnabled ?? true : undefined } : l)),
      }))
    case "set-layer-mask-enabled":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, maskEnabled: action.enabled } : l)),
      }))
    case "set-layer-text":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => {
          if (l.id !== action.id) return l
          if (isLayerLocked(l) || l.lockDraw) return l
          if (typeof l.canvas.getContext === "function") {
            const ctx = l.canvas.getContext("2d")!
            ctx.clearRect(0, 0, l.canvas.width, l.canvas.height)
            if (action.text) rasterizeText(l.canvas, action.text)
          }
          return { ...l, text: action.text }
        }),
      }))
    case "set-layer-shape":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => {
          if (l.id !== action.id) return l
          if (isLayerLocked(l) || l.lockDraw) return l
          if (typeof l.canvas.getContext === "function") {
            const ctx = l.canvas.getContext("2d")!
            ctx.clearRect(0, 0, l.canvas.width, l.canvas.height)
            rasterizeShape(l.canvas, action.shape)
          }
          return { ...l, shape: action.shape }
        }),
      }))
    case "set-layer-path":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, path: action.path } : l)),
      }))
    case "set-layer-kind":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, kind: action.kind } : l)),
      }))
    case "set-layer-3d":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, kind: action.scene ? "3d" : l.kind, threeD: action.scene } : l,
        ),
      }))
    case "set-layer-video":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, kind: action.video ? "video" : l.kind, video: action.video } : l,
        ),
      }))
    case "set-layer-smart":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? {
                ...l,
                kind: action.smart ? "smart-object" : l.kind === "smart-object" ? "raster" : l.kind,
                smartObject: action.smart,
                smartSource: action.smart
                  ? createSmartObjectSource(l.canvas, {
                      name: l.name,
                      linkType: "embedded",
                      status: "embedded",
                      embedded: true,
                    })
                  : undefined,
              }
            : l,
        ),
      }))
    case "set-layer-smart-link":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? markSmartObjectLinked(l, action.source)
            : l,
        ),
      }))
    case "set-layer-smart-link-status":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && (l.smartObject || l.kind === "smart-object") && !isLayerLocked(l)
            ? {
                ...l,
                smartSource: l.smartSource
                  ? { ...l.smartSource, status: action.status }
                  : createSmartObjectSource(l.canvas, { name: l.name, status: action.status }),
              }
            : l,
        ),
      }))
    case "replace-smart-object-contents":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? replaceSmartObjectContents(l, action.canvas, action.source)
            : l,
        ),
      }))
    case "update-smart-object-parent": {
      const source = cloneCanvas(action.canvas)
      const documents = state.documents.map((doc) => {
        if (doc.id !== action.parentDocId) return doc
        return {
          ...doc,
          layers: doc.layers.map((layer) => {
            if (layer.id !== action.layerId) return layer
            const canvas = makeCanvas(doc.width, doc.height)
            const ctx = canvas.getContext("2d")!
            ctx.drawImage(action.canvas, 0, 0)
            return {
              ...layer,
              kind: "smart-object" as const,
              smartObject: true,
              canvas,
              smartSource: {
                width: action.canvas.width,
                height: action.canvas.height,
                canvas: source,
              },
            }
          }),
        }
      })
      return { ...state, documents, activeDocId: action.parentDocId }
    }
    case "rename-layer":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, name: action.name } : l)),
      }))
    case "move-layer":
      return mutateActiveDoc(state, (d) => {
        const idx = d.layers.findIndex((l) => l.id === action.id)
        if (idx < 0) return d
        if (blocksLayerMove(d.layers[idx])) return d
        const swap = action.direction === "up" ? idx + 1 : idx - 1
        if (swap < 0 || swap >= d.layers.length) return d
        const layers = [...d.layers]
        ;[layers[idx], layers[swap]] = [layers[swap], layers[idx]]
        return { ...d, layers }
      })
    case "merge-down":
      return mutateActiveDoc(state, (d) => {
        const idx = d.layers.findIndex((l) => l.id === action.id)
        if (idx <= 0) return d
        const top = d.layers[idx]
        const below = d.layers[idx - 1]
        if (isLayerLocked(top) || isLayerLocked(below)) return d
        const ctx = below.canvas.getContext?.("2d")
        if (ctx) {
          compositeLayer(ctx, top.canvas, top.blendMode, top.opacity, top.fillOpacity ?? 1)
        }
        const layers = d.layers.filter((_, i) => i !== idx)
        return { ...d, layers, activeLayerId: below.id, selectedLayerIds: [below.id] }
      })
    case "merge-selected":
      return mutateActiveDoc(state, (d) => {
        if (d.selectedLayerIds.length < 2) return d
        if (d.layers.some((layer) => d.selectedLayerIds.includes(layer.id) && isLayerLocked(layer))) return d
        const indices = d.selectedLayerIds
          .map((id) => d.layers.findIndex((l) => l.id === id))
          .filter((i) => i >= 0)
          .sort((a, b) => a - b)
        if (indices.length < 2) return d
        const baseIdx = indices[0]
        const baseLayer = d.layers[baseIdx]
        const merged = makeCanvas(d.width, d.height)
        const mctx = merged.getContext?.("2d")
        if (mctx) {
          for (const i of indices) {
            const l = d.layers[i]
            compositeLayer(mctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
          }
        }
        const layers = d.layers
          .filter((_, i) => !indices.includes(i) || i === baseIdx)
          .map((l) =>
            l.id === baseLayer.id
              ? { ...l, canvas: merged, blendMode: "normal" as BlendMode, opacity: 1 }
              : l,
          )
        return {
          ...d,
          layers,
          activeLayerId: baseLayer.id,
          selectedLayerIds: [baseLayer.id],
        }
      })
    case "flatten":
      return mutateActiveDoc(state, (d) => {
        const flat = makeCanvas(d.width, d.height, d.background)
        const ctx = flat.getContext?.("2d")
        if (ctx) {
          for (const l of d.layers) {
            if (!l.visible) continue
            compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
          }
        }
        const layer: Layer = {
          id: uid("layer"),
          name: "Background",
          kind: "raster",
          visible: true,
          locked: true,
          opacity: 1,
          blendMode: "normal",
          canvas: flat,
        }
        return { ...d, layers: [layer], activeLayerId: layer.id, selectedLayerIds: [layer.id] }
      })
    case "link-selected":
      return mutateActiveDoc(state, (d) => {
        if (d.selectedLayerIds.length < 2) return d
        const existing =
          d.layers.find((l) => d.selectedLayerIds.includes(l.id) && l.linkGroupId)?.linkGroupId ??
          uid("link")
        return {
          ...d,
          layers: d.layers.map((l) =>
            d.selectedLayerIds.includes(l.id) ? { ...l, linkGroupId: existing } : l,
          ),
        }
      })
    case "unlink-selected":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          d.selectedLayerIds.includes(l.id) ? { ...l, linkGroupId: undefined } : l,
        ),
      }))
    case "group-selected":
      return mutateActiveDoc(state, (d) => {
        const ids = d.selectedLayerIds.length
          ? d.selectedLayerIds
          : d.activeLayerId
            ? [d.activeLayerId]
            : []
        // If no layer is selected at all, create an empty group on top.
        if (ids.length < 1) {
          const group: Layer = {
            id: action.groupId,
            name: "Group",
            kind: "group",
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: "normal",
            canvas: makeCanvas(d.width, d.height),
            childIds: [],
            expanded: true,
          }
          return {
            ...d,
            layers: [...d.layers, group],
            activeLayerId: group.id,
            selectedLayerIds: [group.id],
          }
        }
        // Insert a group layer just above the highest selected
        const indices = ids
          .map((id) => d.layers.findIndex((l) => l.id === id))
          .filter((i) => i >= 0)
        const topIdx = Math.max(...indices)
        const group: Layer = {
          id: action.groupId,
          name: "Group",
          kind: "group",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          canvas: makeCanvas(d.width, d.height),
          childIds: ids,
          expanded: true,
        }
        const layers = [...d.layers]
        layers.splice(topIdx + 1, 0, group)
        // Tag children with parentId
        const tagged = layers.map((l) => (ids.includes(l.id) ? { ...l, parentId: group.id } : l))
        return {
          ...d,
          layers: tagged,
          activeLayerId: group.id,
          selectedLayerIds: [group.id],
        }
      })
    case "ungroup":
      return mutateActiveDoc(state, (d) => {
        const layers = d.layers.filter((l) => l.id !== action.groupId)
        const cleaned = layers.map((l) =>
          l.parentId === action.groupId ? { ...l, parentId: undefined } : l,
        )
        const newActive = cleaned[cleaned.length - 1]?.id ?? ""
        return {
          ...d,
          layers: cleaned,
          activeLayerId: newActive,
          selectedLayerIds: newActive ? [newActive] : [],
        }
      })
    case "toggle-group-expanded":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && l.kind === "group" ? { ...l, expanded: !l.expanded } : l,
        ),
      }))
    case "push-history": {
      if (!state.activeDocId) return state
      const cur = state.histories[state.activeDocId]
      const trimmed = cur ? cur.entries.slice(0, cur.index + 1) : []
      const next = [...trimmed, action.entry].slice(-getUndoLimit())
      // Schedule background compression of older entries to free canvas memory
      if (next.length > COMPRESS_AFTER_N) {
        scheduleHistoryCompression(next, next.length - 1)
      }
      return {
        ...state,
        histories: {
          ...state.histories,
          [state.activeDocId]: { entries: next, index: next.length - 1 },
        },
        documentLifecycle: {
          ...state.documentLifecycle,
          [state.activeDocId]: {
            ...documentLifecycleFor(state, state.documents.find((doc) => doc.id === state.activeDocId)!),
            dirty: true,
          },
        },
      }
    }
    case "restore-history": {
      if (!state.activeDocId) return state
      const docId = state.activeDocId
      const docs = state.documents.map((d) => {
        if (d.id !== docId) return d
        return {
          ...d,
          layers: action.restoredLayers,
          activeLayerId: action.activeLayerId,
          selectedLayerIds: action.selectedLayerIds,
          width: action.entry.width ?? d.width,
          height: action.entry.height ?? d.height,
          selection: action.entry.selection ? { ...action.entry.selection, mask: action.entry.selection.mask ? cloneCanvas(action.entry.selection.mask) : null } : d.selection,
          guides: action.entry.guides ? deepClonePlain(action.entry.guides) : d.guides,
          comps: action.entry.comps ? deepClonePlain(action.entry.comps) : d.comps,
          channels: action.entry.channels ? action.entry.channels.map(c => ({ ...c, canvas: cloneCanvas(c.canvas)! })) : d.channels,
          notes: action.entry.notes ? deepClonePlain(action.entry.notes) : d.notes,
          slices: action.entry.slices ? deepClonePlain(action.entry.slices) : d.slices,
          counts: action.entry.counts ? deepClonePlain(action.entry.counts) : d.counts,
          colorSamplers: action.entry.colorSamplers ? deepClonePlain(action.entry.colorSamplers) : d.colorSamplers,
          quickMask: action.entry.quickMask ?? d.quickMask,
          quickMaskCanvas: action.entry.quickMaskCanvas ? cloneCanvas(action.entry.quickMaskCanvas) : d.quickMaskCanvas,
          colorMode: action.entry.colorMode ?? d.colorMode,
          modeSettings: action.entry.modeSettings ? deepClonePlain(action.entry.modeSettings) : d.modeSettings,
          variableDataSets: action.entry.variableDataSets ? deepClonePlain(action.entry.variableDataSets) : d.variableDataSets,
          assetLibrary: action.entry.assetLibrary ? deepClonePlain(action.entry.assetLibrary) : d.assetLibrary,
        }
      })
      return {
        ...state,
        documents: docs,
        histories: {
          ...state.histories,
          [docId]: { ...state.histories[docId], index: action.index },
        },
      }
    }
    case "restore-history-entry": {
      if (!state.activeDocId) return state
      const docId = state.activeDocId
      const docs = state.documents.map((d) => {
        if (d.id !== docId) return d
        return {
          ...d,
          layers: restoreFromEntry(d, action.entry),
          activeLayerId: action.entry.activeLayerId,
          selectedLayerIds: action.entry.selectedLayerIds,
          width: action.entry.width ?? d.width,
          height: action.entry.height ?? d.height,
          selection: action.entry.selection ? { ...action.entry.selection, mask: action.entry.selection.mask ? cloneCanvas(action.entry.selection.mask) : null } : d.selection,
          guides: action.entry.guides ? deepClonePlain(action.entry.guides) : d.guides,
          comps: action.entry.comps ? deepClonePlain(action.entry.comps) : d.comps,
          channels: action.entry.channels ? action.entry.channels.map(c => ({ ...c, canvas: cloneCanvas(c.canvas)! })) : d.channels,
          notes: action.entry.notes ? deepClonePlain(action.entry.notes) : d.notes,
          slices: action.entry.slices ? deepClonePlain(action.entry.slices) : d.slices,
          counts: action.entry.counts ? deepClonePlain(action.entry.counts) : d.counts,
          colorSamplers: action.entry.colorSamplers ? deepClonePlain(action.entry.colorSamplers) : d.colorSamplers,
          quickMask: action.entry.quickMask ?? d.quickMask,
          quickMaskCanvas: action.entry.quickMaskCanvas ? cloneCanvas(action.entry.quickMaskCanvas) : d.quickMaskCanvas,
          colorMode: action.entry.colorMode ?? d.colorMode,
          modeSettings: action.entry.modeSettings ? deepClonePlain(action.entry.modeSettings) : d.modeSettings,
          variableDataSets: action.entry.variableDataSets ? deepClonePlain(action.entry.variableDataSets) : d.variableDataSets,
          assetLibrary: action.entry.assetLibrary ? deepClonePlain(action.entry.assetLibrary) : d.assetLibrary,
        }
      })
      return { ...state, documents: docs }
    }
    case "add-history-snapshot":
      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [action.docId]: [...(state.snapshots[action.docId] ?? []), action.snapshot],
        },
      }
    case "delete-history-snapshot":
      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [action.docId]: (state.snapshots[action.docId] ?? []).filter((s) => s.id !== action.snapshotId),
        },
      }
    case "add-action":
      return { ...state, actions: [...state.actions, action.action], recordingActionId: action.action.id }
    case "set-actions":
      return { ...state, actions: action.actions, recordingActionId: null }
    case "delete-action":
      return {
        ...state,
        actions: state.actions.filter((a) => a.id !== action.id),
        recordingActionId: state.recordingActionId === action.id ? null : state.recordingActionId,
      }
    case "start-recording-action":
      return { ...state, recordingActionId: action.id }
    case "stop-recording-action":
      return { ...state, recordingActionId: null }
    case "append-action-step":
      return {
        ...state,
        actions: state.actions.map((recorded) =>
          recorded.id === action.actionId
            ? { ...recorded, steps: [...recorded.steps, action.step], updatedAt: action.step.createdAt }
            : recorded,
        ),
      }
    case "clear-action-steps":
      return {
        ...state,
        actions: state.actions.map((recorded) =>
          recorded.id === action.id ? { ...recorded, steps: [], updatedAt: Date.now() } : recorded,
        ),
      }
    case "set-playing-action":
      return { ...state, isPlayingAction: action.playing }
    case "resize-document":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        width: action.width,
        height: action.height,
      }))
    case "resize-canvas":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        width: action.width,
        height: action.height,
        selection: {
          ...d.selection,
          bounds: d.selection.bounds ? { ...d.selection.bounds, x: d.selection.bounds.x + action.offsetX, y: d.selection.bounds.y + action.offsetY } : null,
        },
        guides: d.guides ? d.guides.map(g => ({ ...g, position: g.position + (g.orientation === "horizontal" ? action.offsetY : action.offsetX) })) : undefined,
        slices: d.slices ? d.slices.map(s => ({ ...s, x: s.x + action.offsetX, y: s.y + action.offsetY })) : undefined,
        notes: d.notes ? d.notes.map(n => ({ ...n, x: n.x + action.offsetX, y: n.y + action.offsetY })) : undefined,
        counts: d.counts ? d.counts.map(c => ({ ...c, x: c.x + action.offsetX, y: c.y + action.offsetY })) : undefined,
        colorSamplers: d.colorSamplers ? d.colorSamplers.map(s => ({ ...s, x: s.x + action.offsetX, y: s.y + action.offsetY })) : undefined,
        layers: d.layers.map(l => {
          const updated = { ...l }
          if (updated.shape) updated.shape = { ...updated.shape, x: updated.shape.x + action.offsetX, y: updated.shape.y + action.offsetY }
          if (updated.text) updated.text = { ...updated.text, x: updated.text.x + action.offsetX, y: updated.text.y + action.offsetY }
          if (updated.frame) updated.frame = { ...updated.frame, x: updated.frame.x + action.offsetX, y: updated.frame.y + action.offsetY }
          if (updated.path) updated.path = { ...updated.path, points: updated.path.points.map(p => ({ x: p.x + action.offsetX, y: p.y + action.offsetY, cp1: p.cp1 ? { x: p.cp1.x + action.offsetX, y: p.cp1.y + action.offsetY } : undefined, cp2: p.cp2 ? { x: p.cp2.x + action.offsetX, y: p.cp2.y + action.offsetY } : undefined })) }
          if (updated.vectorMask) updated.vectorMask = { ...updated.vectorMask, points: updated.vectorMask.points.map(p => ({ x: p.x + action.offsetX, y: p.y + action.offsetY, cp1: p.cp1 ? { x: p.cp1.x + action.offsetX, y: p.cp1.y + action.offsetY } : undefined, cp2: p.cp2 ? { x: p.cp2.x + action.offsetX, y: p.cp2.y + action.offsetY } : undefined })) }
          return updated
        })
      }))
    case "set-clipboard":
      return {
        ...state,
        clipboard: {
          width: action.canvas.width,
          height: action.canvas.height,
          canvas: action.canvas,
        },
      }
    case "clear-clipboard":
      return { ...state, clipboard: null }
    case "set-style-clipboard":
      return { ...state, styleClipboard: action.style ? deepClonePlain(action.style) : null }
    case "set-layer-vector-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, vectorMask: action.mask } : l)),
      }))
    case "set-layer-adjustment":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, adjustment: action.adjustment } : l)),
      }))
    case "set-layer-smart-filters":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, smartFilters: action.smartFilters } : l)),
      }))
    case "set-style-presets":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        stylePresets: action.presets,
      }))
    case "set-asset-library":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        assetLibrary: action.assets,
      }))
    case "set-timeline-frames":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        timelineFrames: action.frames,
      }))
    case "set-global-light":
      return mutateActiveDoc(state, (d) => {
        const globalLight = normalizeGlobalLight(action.globalLight)
        return {
          ...d,
          globalLight,
          layers: d.layers.map((layer) =>
            layer.style ? { ...layer, style: applyGlobalLightToStyle(layer.style, globalLight) } : layer,
          ),
        }
      })
    case "set-document-metadata":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        metadata: {
          ...(d.metadata ?? {}),
          ...action.metadata,
          modifiedAt: new Date().toISOString(),
        },
      }))
    case "set-color-management":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorManagement: action.settings,
      }))
    case "set-print-settings":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        printSettings: action.settings,
      }))
    case "set-document-mode-settings":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorMode: action.colorMode,
        modeSettings: action.settings ?? { mode: action.colorMode },
      }))
    case "set-plugins":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        plugins: action.plugins,
      }))
    case "set-variable-data-sets":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        variableDataSets: action.dataSets,
      }))
    case "add-document-report":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        reports: [action.report, ...(d.reports ?? [])].slice(0, 12),
      }))
    case "clear-document-reports":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        reports: [],
      }))
    case "set-layer-color-label":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id ? { ...l, colorLabel: action.label } : l)),
      }))
    case "align-layers":
      return mutateActiveDoc(state, (d) => alignLayersInDocument(d, action.align, action.ids))
    case "distribute-layers":
      return mutateActiveDoc(state, (d) => distributeLayersInDocument(d, action.axis, action.ids))
    case "reorder-layer": {
      return mutateActiveDoc(state, (d) => {
        const fromIdx = d.layers.findIndex((l) => l.id === action.id)
        const toIdx = d.layers.findIndex((l) => l.id === action.targetId)
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return d
        if (blocksLayerMove(d.layers[fromIdx])) return d
        const layers = [...d.layers]
        const [moved] = layers.splice(fromIdx, 1)
        let insertAt = layers.findIndex((l) => l.id === action.targetId)
        if (insertAt < 0) insertAt = layers.length
        if (action.position === "above") insertAt += 1
        const target = d.layers.find((l) => l.id === action.targetId)
        let parentId: string | undefined = moved.parentId
        if (action.position === "into" && target?.kind === "group") {
          parentId = target.id
        } else if (target?.parentId) {
          parentId = target.parentId
        } else if (action.position !== "into") {
          parentId = undefined
        }
        const updated = { ...moved, parentId }
        layers.splice(insertAt, 0, updated)
        return { ...d, layers }
      })
    }
    case "reorder-layers": {
      return mutateActiveDoc(state, (d) => {
        const ids = action.ids.filter((id, index, arr) => arr.indexOf(id) === index)
        if (!ids.length || ids.includes(action.targetId)) return d
        const idSet = new Set(ids)
        const moving = d.layers.filter((layer) => idSet.has(layer.id))
        if (moving.length !== ids.length || moving.some(blocksLayerMove)) return d
        const target = d.layers.find((layer) => layer.id === action.targetId)
        if (!target) return d
        const remaining = d.layers.filter((layer) => !idSet.has(layer.id))
        let insertAt = remaining.findIndex((layer) => layer.id === action.targetId)
        if (insertAt < 0) insertAt = remaining.length
        if (action.position === "above") insertAt += 1
        const parentId =
          action.position === "into" && target.kind === "group"
            ? target.id
            : target.parentId && action.position !== "into"
              ? target.parentId
              : undefined
        const updated = moving.map((layer) => ({ ...layer, parentId }))
        const layers = [...remaining]
        layers.splice(insertAt, 0, ...updated)
        return { ...d, layers }
      })
    }
    case "add-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        notes: [...(d.notes ?? []), action.note],
      }))
    case "update-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        notes: (d.notes ?? []).map((n) => (n.id === action.id ? { ...n, ...action.patch } : n)),
      }))
    case "remove-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        notes: (d.notes ?? []).filter((n) => n.id !== action.id),
      }))
    case "add-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        slices: [...(d.slices ?? []), action.slice],
        selectedSliceId: action.slice.id,
      }))
    case "update-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        slices: (d.slices ?? []).map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      }))
    case "set-active-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        selectedSliceId: action.id && (d.slices ?? []).some((slice) => slice.id === action.id) ? action.id : undefined,
      }))
    case "remove-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        slices: (d.slices ?? []).filter((s) => s.id !== action.id),
        selectedSliceId: d.selectedSliceId === action.id ? undefined : d.selectedSliceId,
      }))
    case "clear-slices":
      return mutateActiveDoc(state, (d) => ({ ...d, slices: [], selectedSliceId: undefined }))
    case "add-count":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        counts: [...(d.counts ?? []), action.count],
      }))
    case "remove-count":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        counts: (d.counts ?? []).filter((c) => c.id !== action.id),
      }))
    case "clear-counts":
      return mutateActiveDoc(state, (d) => ({ ...d, counts: [] }))
    case "set-count-group":
      return mutateActiveDoc(state, (d) => ({ ...d, countGroup: action.group }))
    case "add-color-sampler":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorSamplers: [action.sampler, ...(d.colorSamplers ?? []).filter((sampler) => sampler.id !== action.sampler.id)].slice(0, 4),
      }))
    case "update-color-sampler":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorSamplers: (d.colorSamplers ?? []).map((sampler) => sampler.id === action.id ? { ...sampler, ...action.patch } : sampler),
      }))
    case "remove-color-sampler":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorSamplers: (d.colorSamplers ?? []).filter((sampler) => sampler.id !== action.id),
      }))
    case "clear-color-samplers":
      return mutateActiveDoc(state, (d) => ({ ...d, colorSamplers: [] }))
    case "save-comp":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        comps: [...(d.comps ?? []).filter((c) => c.id !== action.comp.id), action.comp],
      }))
    case "apply-comp":
      return mutateActiveDoc(state, (d) => {
        const comp = (d.comps ?? []).find((c) => c.id === action.id)
        if (!comp) return d
        return {
          ...d,
          layers: d.layers.map((l) => {
            const s = comp.state[l.id]
            if (!s) return l
            if (isLayerLocked(l)) return l
            return {
              ...l,
              visible: s.visible,
              opacity: s.opacity,
              fillOpacity: s.fillOpacity,
              blendMode: s.blendMode,
              clipped: s.clipped,
              maskEnabled: s.maskEnabled,
              vectorMask: s.vectorMask ? deepClonePlain(s.vectorMask) : s.vectorMask,
              style: s.style ? deepClonePlain(s.style) : s.style,
              text: s.text ? deepClonePlain(s.text) : s.text,
              shape: s.shape ? { ...s.shape } : s.shape,
              path: s.path ? deepClonePlain(s.path) : s.path,
              adjustment: s.adjustment ? deepClonePlain(s.adjustment) : s.adjustment,
              smartFilters: s.smartFilters ? deepClonePlain(s.smartFilters) : s.smartFilters,
              colorLabel: s.colorLabel,
            }
          }),
          activeLayerId: comp.activeLayerId && d.layers.some((l) => l.id === comp.activeLayerId) ? comp.activeLayerId : d.activeLayerId,
          selectedLayerIds: comp.selectedLayerIds?.filter((id) => d.layers.some((l) => l.id === id)).length
            ? comp.selectedLayerIds.filter((id) => d.layers.some((l) => l.id === id))
            : d.selectedLayerIds,
        }
      })
    case "remove-comp":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        comps: (d.comps ?? []).filter((c) => c.id !== action.id),
      }))
    case "set-measurement":
      return mutateActiveDoc(state, (d) => ({ ...d, measurement: action.m }))
    case "set-gradient-stops":
      return { ...state, gradient: { ...state.gradient, stops: action.stops } }
    case "grow-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const amount = Math.round(action.amount)
        const mask = amount >= 0 ? expandSelectionMask(base, amount) : contractSelectionMask(base, -amount)
        return { ...d, selection: selectionFromMask(mask, "freehand", d.selection.feather) }
      })
    case "contract-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const amount = Math.round(action.amount)
        const mask = amount >= 0 ? contractSelectionMask(base, amount) : expandSelectionMask(base, -amount)
        return { ...d, selection: selectionFromMask(mask, "freehand", d.selection.feather) }
      })
    case "similar-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const activeLayer = d.layers.find((l) => l.id === d.activeLayerId)
        if (!activeLayer || typeof activeLayer.canvas.getContext !== "function") return d
        const tol = action.tolerance
        const maskCanvas = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!maskCanvas) return d
        const selectionMask = maskCanvas.getContext("2d")!.getImageData(0, 0, d.width, d.height)
        const src = activeLayer.canvas.getContext("2d")!.getImageData(0, 0, d.width, d.height)
        const out = new Uint8ClampedArray(src.data.length)
        let rSum = 0, gSum = 0, bSum = 0, count = 0
        for (let i = 0; i < src.data.length; i += 4) {
          if (selectionMask.data[i + 3] > 0 && src.data[i + 3] > 0) {
            rSum += src.data[i]
            gSum += src.data[i + 1]
            bSum += src.data[i + 2]
            count++
          }
        }
        if (count === 0) return d
        const rAvg = Math.round(rSum / count)
        const gAvg = Math.round(gSum / count)
        const bAvg = Math.round(bSum / count)
        // Build new mask: pixel is selected if its color is within tolerance of the average.
        for (let i = 0; i < src.data.length; i += 4) {
          const r = src.data[i]
          const g = src.data[i + 1]
          const b = src.data[i + 2]
          const a = src.data[i + 3]
          if (a === 0) {
            out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0
            continue
          }
          const dr = Math.abs(r - rAvg)
          const dg = Math.abs(g - gAvg)
          const db = Math.abs(b - bAvg)
          if (dr <= tol && dg <= tol && db <= tol) {
            out[i] = 255
            out[i + 1] = 255
            out[i + 2] = 255
            out[i + 3] = 255
          } else {
            out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0
          }
        }
        const newMask = makeCanvas(d.width, d.height)
        newMask.getContext("2d")!.putImageData(new ImageData(out, d.width, d.height), 0, 0)
        return { ...d, selection: selectionFromMask(newMask, "wand") }
      })
    case "stamp-visible":
      return mutateActiveDoc(state, (d) => {
        const stamp = makeCanvas(d.width, d.height)
        const sctx = stamp.getContext("2d")!
        for (const l of d.layers) {
          if (!l.visible) continue
          if (typeof l.canvas.getContext !== "function") continue
          compositeLayer(sctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
        }
        const newId = uid("layer")
        const newLayer: Layer = {
          id: newId,
          name: "Stamp Visible",
          kind: "raster",
          visible: true,
          locked: false,
          opacity: 1,
          fillOpacity: 1,
          blendMode: "normal",
          canvas: stamp,
        }
        return {
          ...d,
          layers: [...d.layers, newLayer],
          activeLayerId: newId,
          selectedLayerIds: [newId],
        }
      })
    case "toggle-layer-lock-transparency":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockTransparency: !l.lockTransparency } : l,
        ),
      }))
    case "toggle-layer-lock-draw":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockDraw: !l.lockDraw } : l,
        ),
      }))
    case "toggle-layer-lock-move":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockMove: !l.lockMove } : l,
        ),
      }))
    case "toggle-layer-lock-all":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockAll: !l.lockAll, locked: !l.lockAll } : l,
        ),
      }))
    case "feather-selection":
      return mutateActiveDoc(state, (d) => {
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const r = Math.max(0, action.radius)
        const next = featherMask(base, r)
        return { ...d, selection: selectionFromMask(next, "freehand", r) }
      })
    case "border-selection":
      return mutateActiveDoc(state, (d) => {
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const next = borderSelectionMask(base, Math.max(1, action.width))
        return { ...d, selection: selectionFromMask(next, "freehand") }
      })
    case "smooth-selection":
      return mutateActiveDoc(state, (d) => {
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const next = smoothSelectionMask(base, Math.max(1, action.radius))
        return { ...d, selection: selectionFromMask(next, "freehand", d.selection.feather) }
      })
    case "save-selection":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        channels: [...(d.channels ?? []), action.channel],
      }))
    case "load-selection":
      return mutateActiveDoc(state, (d) => {
        const ch = (d.channels ?? []).find((c) => c.id === action.channelId)
        if (!ch) return d
        // Compute bounds from channel mask
        const ctx = ch.canvas.getContext("2d")!
        const img = ctx.getImageData(0, 0, d.width, d.height)
        let minX = d.width, minY = d.height, maxX = 0, maxY = 0
        let any = false
        for (let y = 0; y < d.height; y++) {
          for (let x = 0; x < d.width; x++) {
            if (img.data[(y * d.width + x) * 4 + 3] > 0) {
              any = true
              if (x < minX) minX = x
              if (y < minY) minY = y
              if (x > maxX) maxX = x
              if (y > maxY) maxY = y
            }
          }
        }
        if (!any) return d
        const cloned = makeCanvas(d.width, d.height)
        cloned.getContext("2d")!.drawImage(ch.canvas, 0, 0)
        return {
          ...d,
          selection: {
            bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
            shape: "rect",
            mask: cloned,
          },
        }
      })
    case "update-channel":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        channels: (d.channels ?? []).map((channel) =>
          channel.id === action.channelId ? { ...channel, ...action.patch } : channel,
        ),
      }))
    case "delete-channel":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        channels: (d.channels ?? []).filter((c) => c.id !== action.channelId),
      }))
    case "mark-document-dirty":
      return withDocumentLifecyclePatch(state, action.id, { dirty: true })
    case "mark-document-saved":
      return withDocumentLifecyclePatch(state, action.id, {
        dirty: false,
        savedAt: Date.now(),
        savedHistoryIndex: currentHistoryIndex(state, action.id),
        ...action.lifecycle,
      })
    case "set-document-lifecycle":
      return withDocumentLifecyclePatch(state, action.id, action.lifecycle)
    default:
      return state
  }
}

function mutateActiveDoc(state: EditorState, fn: (d: PsDocument) => PsDocument): EditorState {
  if (!state.activeDocId) return state
  return {
    ...state,
    documents: state.documents.map((d) => (d.id === state.activeDocId ? fn(d) : d)),
  }
}

/* --------------------------- render bus -------------------------------- */

class RenderBus {
  private listeners = new Set<() => void>()
  private rafId: number | null = null

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  requestRender() {
    if (this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.listeners.forEach((cb) => cb())
    })
  }
}

/* --------------------------- snapshot api ------------------------------ */

function canReuseCanvasSnapshot(
  snapshot: HTMLCanvasElement | null | undefined,
  live: HTMLCanvasElement | null | undefined,
) {
  return !!snapshot && !!live && snapshot.width === live.width && snapshot.height === live.height
}

function snapshotLayers(
  doc: PsDocument,
  previousEntry?: HistoryEntry,
  changedLayerIds?: ChangedLayerIds,
): LayerSnapshot[] {
  const previousById = new Map(previousEntry?.layers.map((l) => [l.id, l]) ?? [])
  const changeHints = isLayerChangeHints(changedLayerIds) ? changedLayerIds : undefined
  const inferredChangedLayerIds =
    changedLayerIds === undefined
      ? new Set([doc.activeLayerId, ...doc.selectedLayerIds].filter(Boolean))
      : null
  const hintedChangedLayerIds = changeHints
    ? new Set(changeHints.ids ?? Object.keys(changeHints.bounds ?? {}))
    : null
  const changedSet =
    changedLayerIds === "all"
      ? null
      : Array.isArray(changedLayerIds)
        ? new Set(changedLayerIds)
        : hintedChangedLayerIds ?? inferredChangedLayerIds

  return doc.layers.map((l) => {
    const previous = previousById.get(l.id)
    const layerIsChanged =
      changedLayerIds === "all" || !previous || (changedSet ? changedSet.has(l.id) : true)
    const dirtyRect = normalizeDirtyRect(changeHints?.bounds?.[l.id], l.canvas.width, l.canvas.height)
    const patch =
      layerIsChanged && canPatchSnapshot(previous, l.canvas, dirtyRect)
        ? cloneCanvasPatch(l.canvas, dirtyRect!)
        : null
    const reuseCanvas =
      !!patch || (!layerIsChanged && canReuseCanvasSnapshot(previous?.canvas, l.canvas))
    const reuseMask =
      !layerIsChanged &&
      l.mask &&
      previous?.mask &&
      canReuseCanvasSnapshot(previous.mask, l.mask)
    const reuseFrameImage =
      !layerIsChanged &&
      l.frame?.imageCanvas &&
      previous?.frame?.imageCanvas &&
      canReuseCanvasSnapshot(previous.frame.imageCanvas, l.frame.imageCanvas)
    const reuseSmartSource =
      !layerIsChanged &&
      l.smartSource?.canvas &&
      previous?.smartSource?.canvas &&
      canReuseCanvasSnapshot(previous.smartSource.canvas, l.smartSource.canvas)

    const canvasPatches = patch
      ? [...(previous?.canvasPatches ?? []), patch]
      : reuseCanvas
        ? previous?.canvasPatches
        : undefined

    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      visible: l.visible,
      locked: l.locked,
      lockTransparency: l.lockTransparency,
      lockDraw: l.lockDraw,
      lockMove: l.lockMove,
      lockAll: l.lockAll,
      smartObject: l.smartObject,
      opacity: l.opacity,
      fillOpacity: l.fillOpacity,
      advancedBlending: l.advancedBlending ? deepClonePlain(l.advancedBlending) : undefined,
      blendMode: l.blendMode,
      linkGroupId: l.linkGroupId,
      canvas: reuseCanvas ? previous!.canvas : cloneCanvas(l.canvas),
      canvasPatches,
      mask: l.mask ? (reuseMask ? previous!.mask : cloneCanvas(l.mask)) : null,
      maskEnabled: l.maskEnabled,
      vectorMask: l.vectorMask ? deepClonePlain(l.vectorMask) : null,
      clipped: l.clipped,
      style: l.style ? deepClonePlain(l.style) : undefined,
      childIds: l.childIds ? [...l.childIds] : undefined,
      parentId: l.parentId,
      expanded: l.expanded,
      text: l.text ? deepClonePlain(l.text) : undefined,
      shape: l.shape ? { ...l.shape } : undefined,
      path: l.path ? deepClonePlain(l.path) : undefined,
      adjustment: l.adjustment ? deepClonePlain(l.adjustment) : undefined,
      frame: l.frame
        ? {
            ...l.frame,
            imageCanvas: l.frame.imageCanvas
              ? reuseFrameImage
                ? previous!.frame!.imageCanvas
                : cloneCanvas(l.frame.imageCanvas)
              : null,
          }
        : undefined,
      artboard: l.artboard ? { ...l.artboard } : undefined,
      threeD: l.threeD ? deepClonePlain(l.threeD) : undefined,
      video: l.video ? deepClonePlain(l.video) : undefined,
      colorLabel: l.colorLabel,
      smartFilters: l.smartFilters ? deepClonePlain(l.smartFilters) : undefined,
      smartSource: l.smartSource
        ? {
            width: l.smartSource.width,
            height: l.smartSource.height,
            canvas: l.smartSource.canvas
              ? reuseSmartSource
                ? previous!.smartSource!.canvas
                : cloneCanvas(l.smartSource.canvas)
              : null,
          }
        : undefined,
    }
  })
}

function buildHistoryThumb(doc: PsDocument): string {
  if (typeof document === "undefined") return ""
  const t = document.createElement("canvas")
  const max = 32
  const ratio = Math.min(max / doc.width, max / doc.height)
  t.width = Math.max(1, Math.floor(doc.width * ratio))
  t.height = Math.max(1, Math.floor(doc.height * ratio))
  const ctx = t.getContext("2d")
  if (!ctx) return ""
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, t.width, t.height)
  for (const l of doc.layers) {
    if (!l.visible) continue
    if (typeof l.canvas.getContext !== "function") continue
    ctx.save()
    ctx.globalAlpha = l.opacity * (l.fillOpacity ?? 1)
    ctx.globalCompositeOperation = getNativeComposite(l.blendMode) ?? "source-over"
    ctx.drawImage(l.canvas, 0, 0, t.width, t.height)
    ctx.restore()
  }
  try {
    return t.toDataURL("image/png")
  } catch {
    return ""
  }
}

const SKIP_HISTORY_THUMB_LABELS = new Set([
  "Brush Stroke",
  "Pencil",
  "Eraser",
  "Blur",
  "Sharpen",
  "Smudge",
  "Dodge",
  "Burn",
  "Sponge",
  "Clone Stamp",
  "History Brush",
  "Spot Healing",
  "Healing Brush",
  "Remove Tool",
])

function makeHistoryEntry(
  doc: PsDocument,
  label: string,
  previousEntry?: HistoryEntry,
  changedLayerIds?: ChangedLayerIds,
): HistoryEntry {
  // Reuse previous auxiliary canvas clones if they haven't changed
  const reuseSelectionMask = previousEntry?.selection?.mask != null
    && doc.selection.mask === previousEntry.selection.mask
  const reuseQuickMask = previousEntry?.quickMaskCanvas != null
    && doc.quickMaskCanvas === previousEntry.quickMaskCanvas
  const reuseChannels = previousEntry?.channels != null
    && doc.channels === previousEntry.channels

  return {
    id: uid("h"),
    label,
    layers: snapshotLayers(doc, previousEntry, changedLayerIds),
    activeLayerId: doc.activeLayerId,
    selectedLayerIds: [...doc.selectedLayerIds],
    thumb: SKIP_HISTORY_THUMB_LABELS.has(label) ? previousEntry?.thumb : buildHistoryThumb(doc),
    width: doc.width,
    height: doc.height,
    selection: {
      ...doc.selection,
      mask: reuseSelectionMask
        ? previousEntry!.selection!.mask
        : doc.selection.mask ? cloneCanvas(doc.selection.mask) : null,
    },
    guides: doc.guides ? deepClonePlain(doc.guides) : undefined,
    comps: doc.comps ? deepClonePlain(doc.comps) : undefined,
    channels: reuseChannels
      ? previousEntry!.channels
      : doc.channels ? doc.channels.map(c => ({ ...c, canvas: cloneCanvas(c.canvas)! })) : undefined,
    notes: doc.notes ? deepClonePlain(doc.notes) : undefined,
    slices: doc.slices ? deepClonePlain(doc.slices) : undefined,
    counts: doc.counts ? deepClonePlain(doc.counts) : undefined,
    colorSamplers: doc.colorSamplers ? deepClonePlain(doc.colorSamplers) : undefined,
    quickMask: doc.quickMask,
    quickMaskCanvas: reuseQuickMask
      ? previousEntry!.quickMaskCanvas
      : doc.quickMaskCanvas ? cloneCanvas(doc.quickMaskCanvas) : null,
    colorMode: doc.colorMode,
    modeSettings: doc.modeSettings ? deepClonePlain(doc.modeSettings) : undefined,
    variableDataSets: doc.variableDataSets ? deepClonePlain(doc.variableDataSets) : undefined,
    assetLibrary: doc.assetLibrary ? deepClonePlain(doc.assetLibrary) : undefined,
  }
}

/**
 * Async version of snapshotLayers — uses createImageBitmap for non-blocking
 * canvas cloning. Only changed layers need cloning; unchanged layers reuse
 * previous snapshot references.
 */
async function snapshotLayersAsync(
  doc: PsDocument,
  previousEntry?: HistoryEntry,
  changedLayerIds?: ChangedLayerIds,
): Promise<LayerSnapshot[]> {
  const previousById = new Map(previousEntry?.layers.map((l) => [l.id, l]) ?? [])
  const changeHints = isLayerChangeHints(changedLayerIds) ? changedLayerIds : undefined
  const inferredChangedLayerIds =
    changedLayerIds === undefined
      ? new Set([doc.activeLayerId, ...doc.selectedLayerIds].filter(Boolean))
      : null
  const hintedChangedLayerIds = changeHints
    ? new Set(changeHints.ids ?? Object.keys(changeHints.bounds ?? {}))
    : null
  const changedSet =
    changedLayerIds === "all"
      ? null
      : Array.isArray(changedLayerIds)
        ? new Set(changedLayerIds)
        : hintedChangedLayerIds ?? inferredChangedLayerIds

  // Build per-layer info synchronously (cheap), collect async clone promises
  const layerInfos = doc.layers.map((l) => {
    const previous = previousById.get(l.id)
    const layerIsChanged =
      changedLayerIds === "all" || !previous || (changedSet ? changedSet.has(l.id) : true)
    const dirtyRect = normalizeDirtyRect(changeHints?.bounds?.[l.id], l.canvas.width, l.canvas.height)
    const patch =
      layerIsChanged && canPatchSnapshot(previous, l.canvas, dirtyRect)
        ? cloneCanvasPatch(l.canvas, dirtyRect!)
        : null
    const reuseCanvas =
      !!patch || (!layerIsChanged && canReuseCanvasSnapshot(previous?.canvas, l.canvas))
    const reuseMask =
      !layerIsChanged &&
      l.mask &&
      previous?.mask &&
      canReuseCanvasSnapshot(previous.mask, l.mask)
    const reuseFrameImage =
      !layerIsChanged &&
      l.frame?.imageCanvas &&
      previous?.frame?.imageCanvas &&
      canReuseCanvasSnapshot(previous.frame.imageCanvas, l.frame.imageCanvas)
    const reuseSmartSource =
      !layerIsChanged &&
      l.smartSource?.canvas &&
      previous?.smartSource?.canvas &&
      canReuseCanvasSnapshot(previous.smartSource.canvas, l.smartSource.canvas)
    return { l, previous, layerIsChanged, patch, reuseCanvas, reuseMask, reuseFrameImage, reuseSmartSource }
  })

  // Fire off all async canvas clones in parallel
  const clonePromises = layerInfos.map(async (info) => {
    const { l, previous, reuseCanvas, reuseMask, reuseFrameImage, reuseSmartSource } = info
    const canvas = reuseCanvas ? previous!.canvas : await cloneCanvasAsync(l.canvas)
    const mask = l.mask ? (reuseMask ? previous!.mask : await cloneCanvasAsync(l.mask)) : null
    const frameImage = l.frame?.imageCanvas
      ? reuseFrameImage
        ? previous!.frame!.imageCanvas
        : await cloneCanvasAsync(l.frame.imageCanvas)
      : null
    const smartSourceCanvas = l.smartSource?.canvas
      ? reuseSmartSource
        ? previous!.smartSource!.canvas ?? null
        : await cloneCanvasAsync(l.smartSource.canvas)
      : null
    return { canvas, mask, frameImage, smartSourceCanvas }
  })

  const clonedCanvases = await Promise.all(clonePromises)

  // Build snapshots synchronously using the pre-cloned canvases
  return layerInfos.map((info, i) => {
    const { l, previous, patch, reuseCanvas } = info
    const { canvas, mask, frameImage, smartSourceCanvas } = clonedCanvases[i]
    const canvasPatches = patch
      ? [...(previous?.canvasPatches ?? []), patch]
      : reuseCanvas
        ? previous?.canvasPatches
        : undefined

    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      visible: l.visible,
      locked: l.locked,
      lockTransparency: l.lockTransparency,
      lockDraw: l.lockDraw,
      lockMove: l.lockMove,
      lockAll: l.lockAll,
      smartObject: l.smartObject,
      opacity: l.opacity,
      fillOpacity: l.fillOpacity,
      advancedBlending: l.advancedBlending ? deepClonePlain(l.advancedBlending) : undefined,
      blendMode: l.blendMode,
      linkGroupId: l.linkGroupId,
      canvas,
      canvasPatches,
      mask,
      maskEnabled: l.maskEnabled,
      vectorMask: l.vectorMask ? deepClonePlain(l.vectorMask) : null,
      clipped: l.clipped,
      style: l.style ? deepClonePlain(l.style) : undefined,
      childIds: l.childIds ? [...l.childIds] : undefined,
      parentId: l.parentId,
      expanded: l.expanded,
      text: l.text ? deepClonePlain(l.text) : undefined,
      shape: l.shape ? { ...l.shape } : undefined,
      path: l.path ? deepClonePlain(l.path) : undefined,
      adjustment: l.adjustment ? deepClonePlain(l.adjustment) : undefined,
      frame: l.frame
        ? { ...l.frame, imageCanvas: frameImage }
        : undefined,
      artboard: l.artboard ? { ...l.artboard } : undefined,
      threeD: l.threeD ? deepClonePlain(l.threeD) : undefined,
      video: l.video ? deepClonePlain(l.video) : undefined,
      colorLabel: l.colorLabel,
      smartFilters: l.smartFilters ? deepClonePlain(l.smartFilters) : undefined,
      smartSource: l.smartSource
        ? {
            width: l.smartSource.width,
            height: l.smartSource.height,
            canvas: smartSourceCanvas,
          }
        : undefined,
    }
  })
}

async function makeHistoryEntryAsync(
  doc: PsDocument,
  label: string,
  previousEntry?: HistoryEntry,
  changedLayerIds?: ChangedLayerIds,
): Promise<HistoryEntry> {
  // Reuse previous auxiliary canvas clones if they haven't changed
  const reuseSelectionMask = previousEntry?.selection?.mask != null
    && doc.selection.mask === previousEntry.selection.mask
  const reuseQuickMask = previousEntry?.quickMaskCanvas != null
    && doc.quickMaskCanvas === previousEntry.quickMaskCanvas
  const reuseChannels = previousEntry?.channels != null
    && doc.channels === previousEntry.channels

  return {
    id: uid("h"),
    label,
    layers: await snapshotLayersAsync(doc, previousEntry, changedLayerIds),
    activeLayerId: doc.activeLayerId,
    selectedLayerIds: [...doc.selectedLayerIds],
    thumb: previousEntry?.thumb,
    width: doc.width,
    height: doc.height,
    selection: {
      ...doc.selection,
      mask: reuseSelectionMask
        ? previousEntry!.selection!.mask
        : doc.selection.mask ? cloneCanvas(doc.selection.mask) : null,
    },
    guides: doc.guides ? deepClonePlain(doc.guides) : undefined,
    comps: doc.comps ? deepClonePlain(doc.comps) : undefined,
    channels: reuseChannels
      ? previousEntry!.channels
      : doc.channels ? doc.channels.map(c => ({ ...c, canvas: cloneCanvas(c.canvas)! })) : undefined,
    notes: doc.notes ? deepClonePlain(doc.notes) : undefined,
    slices: doc.slices ? deepClonePlain(doc.slices) : undefined,
    counts: doc.counts ? deepClonePlain(doc.counts) : undefined,
    colorSamplers: doc.colorSamplers ? deepClonePlain(doc.colorSamplers) : undefined,
    quickMask: doc.quickMask,
    quickMaskCanvas: reuseQuickMask
      ? previousEntry!.quickMaskCanvas
      : doc.quickMaskCanvas ? cloneCanvas(doc.quickMaskCanvas) : null,
    colorMode: doc.colorMode,
    modeSettings: doc.modeSettings ? deepClonePlain(doc.modeSettings) : undefined,
    variableDataSets: doc.variableDataSets ? deepClonePlain(doc.variableDataSets) : undefined,
    assetLibrary: doc.assetLibrary ? deepClonePlain(doc.assetLibrary) : undefined,
  }
}

function restoreFromEntry(
  doc: PsDocument,
  entry: HistoryEntry,
  options?: { currentEntry?: HistoryEntry; direction?: "undo" | "redo" | null },
): Layer[] {
  const currentById = new Map(options?.currentEntry?.layers.map((l) => [l.id, l]) ?? [])
  return entry.layers.map((snap) => {
    const existing = doc.layers.find((l) => l.id === snap.id)
    const currentSnap = currentById.get(snap.id)
    const canvas =
      existing && existing.canvas.width === doc.width && existing.canvas.height === doc.height
        ? existing.canvas
        : makeCanvas(doc.width, doc.height)
    const ctx = canvas.getContext?.("2d")
    if (ctx) {
      // When there is no existing layer (e.g. redo after creating a new layer),
      // always draw the full snapshot to ensure the layer's pixels are restored.
      if (!existing) {
        drawSnapshotFull(ctx, snap, doc.width, doc.height)
      } else if (!snapshotPixelsEqual(snap, currentSnap)) {
        const partialRect = adjacentRestoreRect(snap, currentSnap, options?.direction ?? null)
        if (partialRect) {
          drawSnapshotRegion(ctx, snap, partialRect)
        } else {
          drawSnapshotFull(ctx, snap, doc.width, doc.height)
        }
      }
    }
    let mask: HTMLCanvasElement | null | undefined = undefined
    if (snap.mask) {
      if (existing?.mask && currentSnap?.mask === snap.mask && canReuseCanvasSnapshot(existing.mask, snap.mask)) {
        mask = existing.mask
      } else {
        const m = makeCanvas(doc.width, doc.height)
        m.getContext("2d")!.drawImage(snap.mask, 0, 0)
        mask = m
      }
    } else if (snap.mask === null) {
      mask = null
    }
    return {
      id: snap.id,
      name: snap.name,
      kind: snap.kind ?? "raster",
      visible: snap.visible,
      locked: snap.locked,
      lockTransparency: snap.lockTransparency,
      lockDraw: snap.lockDraw,
      lockMove: snap.lockMove,
      lockAll: snap.lockAll,
      smartObject: snap.smartObject,
      opacity: snap.opacity,
      fillOpacity: snap.fillOpacity,
      advancedBlending: snap.advancedBlending,
      blendMode: snap.blendMode,
      linkGroupId: snap.linkGroupId,
      canvas,
      mask: mask === undefined ? existing?.mask : mask,
      maskEnabled: snap.maskEnabled,
      vectorMask: snap.vectorMask ?? null,
      clipped: snap.clipped,
      style: snap.style,
      childIds: snap.childIds,
      parentId: snap.parentId,
      expanded: snap.expanded,
      text: snap.text,
      shape: snap.shape,
      path: snap.path,
      adjustment: snap.adjustment,
      frame: snap.frame,
      artboard: snap.artboard,
      threeD: snap.threeD,
      video: snap.video,
      colorLabel: snap.colorLabel,
      smartFilters: snap.smartFilters,
      smartSource: snap.smartSource
        ? {
            width: snap.smartSource.width,
            height: snap.smartSource.height,
            canvas:
              currentSnap?.smartSource?.canvas === snap.smartSource.canvas && existing?.smartSource?.canvas
                ? existing.smartSource.canvas
                : cloneCanvas(snap.smartSource.canvas),
          }
        : undefined,
    }
  })
}

function renderSmartObjectDocument(doc: PsDocument) {
  const canvas = makeCanvas(doc.width, doc.height)
  const ctx = canvas.getContext("2d")!
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group" || layer.kind === "adjustment") continue
    compositeLayer(ctx, layer.canvas, layer.blendMode, layer.opacity, layer.fillOpacity ?? 1)
  }
  return canvas
}

/* ---------------------------- context ---------------------------------- */

interface EditorContextValue {
  documents: PsDocument[]
  activeDocId: string | null
  tool: ToolId
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  paintBucket: PaintBucketSettings
  eraser: EraserSettings
  cloneSource: CloneSourceSettings
  symmetry: SymmetrySettings
  selectionOptions: SelectionOptions
  transform: TransformState | null
  brushPresets: BrushPreset[]
  history: HistoryEntry[]
  historyIndex: number
  snapshots: HistorySnapshot[]
  closedDocuments: Array<{ id: string; name: string; width: number; height: number; closedAt: number }>
  documentStatuses: Record<string, DocumentLifecycleState>
  actions: MacroAction[]
  recordingActionId: string | null
  isPlayingAction: boolean
  activeDoc: PsDocument | null
  activeLayer: Layer | null
  selectedLayers: Layer[]
  clipboard: EditorState["clipboard"]
  styleClipboard: LayerStyle | null
  dispatch: React.Dispatch<Action>
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  requestRender: () => void
  subscribeRender: (cb: () => void) => () => void
  newLayer: (kind?: LayerKind) => void
  newGroup: () => void
  jumpHistory: (index: number) => void
  createHistorySnapshot: (name?: string) => void
  restoreHistorySnapshot: (snapshotId: string) => void
  deleteHistorySnapshot: (snapshotId: string) => void
  createAction: (name?: string) => void
  startRecordingAction: (id: string) => void
  stopRecordingAction: () => void
  playAction: (id: string) => void
  deleteAction: (id: string) => void
  clearAction: (id: string) => void
  createDocument: (doc: PsDocument, label?: string, lifecycle?: Partial<DocumentLifecycleState>) => void
  duplicateDocument: (id?: string) => void
  requestCloseDocument: (id?: string) => void
  closeOtherDocuments: (id?: string) => void
  reopenClosedDocument: (id?: string) => void
  markDocumentSaved: (id: string, lifecycle?: Partial<DocumentLifecycleState>) => void
  setDocumentLifecycle: (id: string, lifecycle: Partial<DocumentLifecycleState>) => void
  moveLayersToDocument: (sourceDocId: string, targetDocId: string, layerIds: string[], copy?: boolean) => void
  copySelection: (cut?: boolean) => void
  pasteAsLayer: () => void
  resizeDocument: (w: number, h: number, resample?: "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper") => void
  resizeCanvas: (w: number, h: number, anchorX: number, anchorY: number, fill: string) => void
  toggleQuickMask: () => void
  addLayerMask: () => void
  editSmartObject: (layer?: Layer | null) => void
  updateSmartObjectParent: () => void
  beginTransform: (layer: Layer) => void
  commitTransform: () => void
  flipLayer: (axis: "horizontal" | "vertical") => void
  rotateLayer: (deg: number) => void
  filterPreviews: Record<string, HTMLCanvasElement>
  setFilterPreview: (layerId: string, canvas: HTMLCanvasElement | null) => void
}

const EditorContext = React.createContext<EditorContextValue | null>(null)

const initialDoc = makeDocument("Untitled-1", 1200, 800, "#ffffff", {
  doc: "doc_initial",
  backgroundLayer: "layer_background",
  layer: "layer_initial",
})

const initialState: EditorState = {
  documents: [initialDoc],
  activeDocId: initialDoc.id,
  tool: "brush",
  foreground: "#000000",
  background: "#ffffff",
  brush: {
    size: 30,
    hardness: 80,
    opacity: 100,
    flow: 100,
    smoothing: 10,
    spacing: 25,
    tipShape: "round",
    sizeControl: "off",
    angleControl: "off",
    roundnessControl: "off",
    opacityControl: "off",
    flowControl: "off",
  },
  gradient: { type: "linear", reverse: false },
  paintBucket: { tolerance: 32, contiguous: true },
  eraser: {
    sampling: "continuous",
    limits: "find-edges",
    tolerance: 42,
    antiAlias: true,
    protectForeground: false,
  },
  cloneSource: {
    activePresetId: null,
    presets: [],
    aligned: true,
    sample: "current-layer",
    scale: 100,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    showOverlay: false,
  },
  symmetry: { enabled: false, axis: "vertical" },
  brushPresets: DEFAULT_BRUSH_PRESETS,
  clipboard: null,
  styleClipboard: null,
  closedDocuments: [],
  documentLifecycle: {
    [initialDoc.id]: makeDocumentLifecycle(initialDoc, 0),
  },
  transform: null,
  /** Current selection options for selection tools */
  selectionOptions: {
    mode: "new",
    feather: 0,
    antiAlias: true,
    tolerance: 32,
    contiguous: true,
    sampleAllLayers: false,
  },
  histories: {
    [initialDoc.id]: {
      entries: [
        {
          id: "history_initial",
          label: "New Document",
          layers: snapshotLayers(initialDoc),
          activeLayerId: initialDoc.activeLayerId,
          selectedLayerIds: [...initialDoc.selectedLayerIds],
        },
      ],
      index: 0,
    },
  },
  snapshots: {
    [initialDoc.id]: [],
  },
  actions: [],
  recordingActionId: null,
  isPlayingAction: false,
}

/* ---- localStorage persistence for user settings ---- */
const SETTINGS_KEY = "ps-editor-settings"

function loadPersistedSettings(): Partial<EditorState> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return {}
    const s = JSON.parse(raw)
    const out: Partial<EditorState> = {}
    if (s.foreground) out.foreground = s.foreground
    if (s.background) out.background = s.background
    if (s.brush && typeof s.brush === "object") out.brush = { ...initialState.brush, ...s.brush }
    if (s.gradient && typeof s.gradient === "object") out.gradient = { ...initialState.gradient, ...s.gradient }
    if (s.symmetry && typeof s.symmetry === "object") out.symmetry = { ...initialState.symmetry, ...s.symmetry }
    return out
  } catch { return {} }
}

function savePersistedSettings(state: EditorState) {
  try {
    const s = {
      foreground: state.foreground,
      background: state.background,
      brush: {
        size: state.brush.size,
        hardness: state.brush.hardness,
        opacity: state.brush.opacity,
        flow: state.brush.flow,
        smoothing: state.brush.smoothing,
        spacing: state.brush.spacing,
        tipShape: state.brush.tipShape,
      },
      gradient: state.gradient,
      symmetry: state.symmetry,
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
}

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = React.useReducer(reducer, initialState)
  const stateRef = React.useRef(state)
  stateRef.current = state
  const dispatch = React.useCallback((action: Action) => {
    const before = stateRef.current
    rawDispatch(action)
    for (const docId of dirtyDocIdsForAction(action, before)) {
      rawDispatch({ type: "mark-document-dirty", id: docId })
    }
  }, [])

  React.useEffect(() => {
    const persisted = loadPersistedSettings()
    if (Object.keys(persisted).length) dispatch({ type: "hydrate-settings", settings: persisted })
  }, [])

  // Auto-save settings to localStorage (debounced)
  React.useEffect(() => {
    const t = window.setTimeout(() => savePersistedSettings(state), 300)
    return () => window.clearTimeout(t)
  }, [state.tool, state.foreground, state.background, state.brush, state.gradient, state.symmetry])

  const renderBusRef = React.useRef<RenderBus | null>(null)
  if (renderBusRef.current === null) renderBusRef.current = new RenderBus()
  const requestRender = React.useCallback(() => renderBusRef.current!.requestRender(), [])
  const subscribeRender = React.useCallback(
    (cb: () => void) => renderBusRef.current!.subscribe(cb),
    [],
  )
  const [closeRequest, setCloseRequest] = React.useState<{ ids: string[]; currentId: string; saving?: boolean } | null>(null)
  const closeRequestRef = React.useRef(closeRequest)
  closeRequestRef.current = closeRequest

  const closeIdsNow = React.useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => stateRef.current.documents.some((doc) => doc.id === id))
    for (const id of unique) rawDispatch({ type: "close-document", id })
    if (unique.length) requestRender()
  }, [requestRender])

  const requestCloseDocuments = React.useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => stateRef.current.documents.some((doc) => doc.id === id))
    if (!unique.length) return
    const dirtyId = unique.find((id) => isDocumentDirtyInState(stateRef.current, id))
    if (!dirtyId) {
      closeIdsNow(unique)
      return
    }
    setCloseRequest({ ids: unique, currentId: dirtyId })
  }, [closeIdsNow])

  const finishPendingClose = React.useCallback((docId: string, closeDocument: boolean) => {
    const request = closeRequestRef.current
    if (!request) return
    if (closeDocument) rawDispatch({ type: "close-document", id: docId })
    const remaining = request.ids.filter((id) => id !== docId && stateRef.current.documents.some((doc) => doc.id === id))
    const dirtyId = remaining.find((id) => isDocumentDirtyInState(stateRef.current, id))
    if (dirtyId) {
      setCloseRequest({ ids: remaining, currentId: dirtyId })
    } else {
      for (const id of remaining) rawDispatch({ type: "close-document", id })
      setCloseRequest(null)
    }
    requestRender()
  }, [requestRender])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string; success?: boolean }>).detail
      const request = closeRequestRef.current
      if (!request || !detail?.docId || detail.docId !== request.currentId) return
      if (detail.success) {
        finishPendingClose(detail.docId, true)
      } else {
        setCloseRequest((current) => current ? { ...current, saving: false } : current)
      }
    }
    window.addEventListener("ps-document-saved", handler as EventListener)
    return () => window.removeEventListener("ps-document-saved", handler as EventListener)
  }, [finishPendingClose])

  React.useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!stateRef.current.documents.some((doc) => isDocumentDirtyInState(stateRef.current, doc.id))) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  const activeDoc = React.useMemo(
    () => state.documents.find((d) => d.id === state.activeDocId) ?? null,
    [state.documents, state.activeDocId],
  )
  const activeLayer = React.useMemo(
    () => activeDoc?.layers.find((l) => l.id === activeDoc.activeLayerId) ?? null,
    [activeDoc],
  )
  const selectedLayers = React.useMemo(() => {
    if (!activeDoc) return []
    return activeDoc.layers.filter((l) => activeDoc.selectedLayerIds.includes(l.id))
  }, [activeDoc])

  const docHistory = activeDoc
    ? state.histories[activeDoc.id] ?? { entries: [], index: -1 }
    : { entries: [], index: -1 }
  const docSnapshots = activeDoc ? state.snapshots[activeDoc.id] ?? [] : []
  const documentStatuses = React.useMemo(() => {
    const result: Record<string, DocumentLifecycleState> = {}
    for (const doc of state.documents) {
      const lifecycle = documentLifecycleFor(state, doc)
      result[doc.id] = {
        ...lifecycle,
        dirty: lifecycle.dirty || lifecycle.savedHistoryIndex !== currentHistoryIndex(state, doc.id),
      }
    }
    return result
  }, [state.documents, state.documentLifecycle, state.histories])

  React.useEffect(() => {
    requestRender()
  }, [activeDoc, requestRender])

  // Initialize SSR-safe canvases on the client
  React.useEffect(() => {
    let needsInit = false
    state.documents.forEach((d) => {
      d.layers.forEach((l) => {
        if (!l.canvas || typeof (l.canvas as HTMLCanvasElement).getContext !== "function") {
          needsInit = true
        }
      })
    })
    if (needsInit) {
      state.documents.forEach((d, di) => {
        d.layers.forEach((l, li) => {
          if (!l.canvas || typeof (l.canvas as HTMLCanvasElement).getContext !== "function") {
            const c = document.createElement("canvas")
            c.width = d.width
            c.height = d.height
            if (di === 0 && li === 0) {
              const ctx = c.getContext("2d")!
              ctx.fillStyle = d.background
              ctx.fillRect(0, 0, d.width, d.height)
            }
            l.canvas = c
          }
        })
      })
      const did = state.activeDocId
      if (did) {
        const doc = state.documents.find((x) => x.id === did)
        if (doc) {
          dispatch({
            type: "push-history",
            entry: makeHistoryEntry(doc, "New Document"),
          })
        }
      }
      requestRender()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filterPreviewsRef = React.useRef<Record<string, HTMLCanvasElement>>({})
  const snapshotQueueRef = React.useRef<Promise<void>>(Promise.resolve())
  const setFilterPreview = React.useCallback((layerId: string, canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      filterPreviewsRef.current[layerId] = canvas
    } else {
      delete filterPreviewsRef.current[layerId]
    }
    requestRender()
  }, [requestRender])

  const commit = React.useCallback(
    (label: string, changedLayerIds?: ChangedLayerIds) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId) ?? null
      if (!doc) return
      const docHistory = current.histories[doc.id]
      const previousEntry = docHistory?.entries[docHistory.index]

      // ALL commits use async canvas cloning (createImageBitmap) to avoid
      // blocking the main thread with GPU→CPU pixel readbacks.
      const skipThumb = SKIP_HISTORY_THUMB_LABELS.has(label)
      snapshotQueueRef.current = snapshotQueueRef.current.then(async () => {
        // Re-fetch latest document and prev entry inside the queue to prevent stale references
        const latestDoc = stateRef.current.documents.find((d) => d.id === doc.id) ?? doc
        const latestHist = stateRef.current.histories[doc.id]
        const latestPrevEntry = latestHist?.entries[latestHist.index]

        const entry = await makeHistoryEntryAsync(latestDoc, label, latestPrevEntry, changedLayerIds)
        const logState = stateRef.current
        try {
          recordHistoryLogEntryFromStorage(label, {
            documentName: latestDoc.name,
            tool: logState.tool,
            changedLayerIds: changedLayerIdsForHistoryLog(changedLayerIds),
            toolSettings: toolSettingsForHistoryLog(logState),
          })
        } catch {}

        // Generate thumbnail asynchronously if not a paint tool
        if (!skipThumb) {
          const thumbDoc = stateRef.current.documents.find((d) => d.id === doc.id) ?? latestDoc
          const scheduleThumb = typeof requestIdleCallback === "function" ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0)
          scheduleThumb(() => {
            entry.thumb = buildHistoryThumb(thumbDoc)
          })
        }

        React.startTransition(() => {
          dispatch({ type: "push-history", entry })
          const finalState = stateRef.current
          if (finalState.recordingActionId && !finalState.isPlayingAction) {
            dispatch({
              type: "append-action-step",
              actionId: finalState.recordingActionId,
              step: { id: uid("step"), label, createdAt: Date.now(), entry },
            })
          }
        })
      }).catch(console.error)

      // Trigger render immediately for responsiveness
      requestRender()
    },
    [requestRender],
  )

  const jumpHistory = React.useCallback(
    (index: number) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId)
      if (!doc) return
      const docHist = current.histories[doc.id]
      if (!docHist) return
      const safeIdx = clamp(index, 0, docHist.entries.length - 1)
      const entry = docHist.entries[safeIdx]
      const currentEntry = docHist.entries[docHist.index]
      const direction = safeIdx < docHist.index ? "undo" : safeIdx > docHist.index ? "redo" : null
      const restoredLayers = restoreFromEntry(doc, entry, { currentEntry, direction })
      dispatch({
        type: "restore-history",
        index: safeIdx,
        entry,
        restoredLayers,
        activeLayerId: entry.activeLayerId,
        selectedLayerIds: entry.selectedLayerIds,
      })
      requestRender()
    },
    [requestRender],
  )

  const createHistorySnapshot = React.useCallback(
    (name?: string) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId)
      if (!doc) return
      const docHistory = current.histories[doc.id]
      const previousEntry = docHistory?.entries[docHistory.index]
      const entry = makeHistoryEntry(doc, name || `Snapshot ${new Date().toLocaleTimeString()}`, previousEntry, "all")
      dispatch({
        type: "add-history-snapshot",
        docId: doc.id,
        snapshot: {
          id: uid("snapshot"),
          name: name || entry.label,
          createdAt: Date.now(),
          entry,
        },
      })
    },
    [],
  )

  const restoreHistorySnapshot = React.useCallback(
    (snapshotId: string) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId)
      if (!doc) return
      const snapshot = (current.snapshots[doc.id] ?? []).find((s) => s.id === snapshotId)
      if (!snapshot) return
      dispatch({ type: "restore-history-entry", entry: snapshot.entry })
      requestRender()
    },
    [requestRender],
  )

  const deleteHistorySnapshot = React.useCallback((snapshotId: string) => {
    const current = stateRef.current
    const docId = current.activeDocId
    if (!docId) return
    dispatch({ type: "delete-history-snapshot", docId, snapshotId })
  }, [])

  const createAction = React.useCallback((name?: string) => {
    const createdAt = Date.now()
    dispatch({
      type: "add-action",
      action: {
        id: uid("action"),
        name: name || `Action ${new Date(createdAt).toLocaleTimeString()}`,
        createdAt,
        updatedAt: createdAt,
        steps: [],
      },
    })
  }, [])

  const startRecordingAction = React.useCallback((id: string) => {
    dispatch({ type: "start-recording-action", id })
  }, [])

  const stopRecordingAction = React.useCallback(() => {
    dispatch({ type: "stop-recording-action" })
  }, [])

  const playAction = React.useCallback(
    async (id: string) => {
      const action = stateRef.current.actions.find((a) => a.id === id)
      if (!action || !action.steps.length) return
      dispatch({ type: "set-playing-action", playing: true })
      try {
        for (const step of action.steps) {
          dispatch({ type: "restore-history-entry", entry: step.entry })
          requestRender()
          await new Promise((resolve) => window.setTimeout(resolve, 60))
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0))
        const current = stateRef.current
        const doc = current.documents.find((d) => d.id === current.activeDocId)
        if (doc) {
          const docHistory = current.histories[doc.id]
          const previousEntry = docHistory?.entries[docHistory.index]
          dispatch({
            type: "push-history",
            entry: makeHistoryEntry(doc, `Play Action: ${action.name}`, previousEntry, "all"),
          })
        }
      } finally {
        dispatch({ type: "set-playing-action", playing: false })
        requestRender()
      }
    },
    [requestRender],
  )

  const deleteAction = React.useCallback((id: string) => {
    dispatch({ type: "delete-action", id })
  }, [])

  const clearAction = React.useCallback((id: string) => {
    dispatch({ type: "clear-action-steps", id })
  }, [])

  const newLayer = React.useCallback(
    (kind: LayerKind = "raster") => {
      if (!activeDoc) return
      const c = makeCanvas(activeDoc.width, activeDoc.height)
      const layer: Layer = {
        id: uid("layer"),
        name: kind === "raster" ? `Layer ${activeDoc.layers.length}` : `${kind} ${activeDoc.layers.length}`,
        kind,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: c,
      }
      dispatch({ type: "add-layer", layer })
      setTimeout(() => commit("New Layer", [layer.id]), 0)
    },
    [activeDoc, commit],
  )

  const newGroup = React.useCallback(() => {
    if (!activeDoc) return
    const groupId = uid("group")
    dispatch({ type: "group-selected", groupId })
    setTimeout(() => commit("New Group", [groupId, ...activeDoc.selectedLayerIds]), 0)
  }, [activeDoc, commit])

  const createDocument = React.useCallback(
    (doc: PsDocument, label = "New Document", lifecycle?: Partial<DocumentLifecycleState>) => {
      const entry = makeHistoryEntry(doc, label)
      dispatch({ type: "new-document", doc, entry, lifecycle })
      requestRender()
    },
    [requestRender],
  )

  const duplicateDocument = React.useCallback(
    (id?: string) => {
      const current = stateRef.current
      const source = current.documents.find((doc) => doc.id === (id ?? current.activeDocId))
      if (!source) return
      const duplicated = duplicateDocumentDeep(source)
      const entry = makeHistoryEntry(duplicated, "Duplicate Document")
      dispatch({ type: "new-document", doc: duplicated, entry })
      requestRender()
    },
    [requestRender],
  )

  const requestCloseDocument = React.useCallback((id?: string) => {
    const closeId = id ?? stateRef.current.activeDocId
    if (!closeId) return
    requestCloseDocuments([closeId])
  }, [requestCloseDocuments])

  const closeOtherDocuments = React.useCallback((id?: string) => {
    const keepId = id ?? stateRef.current.activeDocId
    if (!keepId) return
    const ids = stateRef.current.documents.filter((doc) => doc.id !== keepId).map((doc) => doc.id)
    const dirtyId = ids.find((docId) => isDocumentDirtyInState(stateRef.current, docId))
    if (dirtyId) {
      requestCloseDocuments(ids)
      return
    }
    dispatch({ type: "close-other-documents", keepId })
    requestRender()
  }, [dispatch, requestCloseDocuments, requestRender])

  const reopenClosedDocument = React.useCallback((id?: string) => {
    dispatch({ type: "reopen-closed-document", id })
    requestRender()
  }, [requestRender])

  const markDocumentSaved = React.useCallback((id: string, lifecycle?: Partial<DocumentLifecycleState>) => {
    dispatch({ type: "mark-document-saved", id, lifecycle })
  }, [dispatch])

  const setDocumentLifecycle = React.useCallback((id: string, lifecycle: Partial<DocumentLifecycleState>) => {
    dispatch({ type: "set-document-lifecycle", id, lifecycle })
  }, [dispatch])

  const moveLayersToDocument = React.useCallback(
    (sourceDocId: string, targetDocId: string, layerIds: string[], copy = true) => {
      dispatch({ type: "move-layers-to-document", sourceDocId, targetDocId, layerIds, copy })
      requestRender()
      window.setTimeout(() => {
        const doc = stateRef.current.documents.find((candidate) => candidate.id === targetDocId)
        if (doc) {
          const docHistory = stateRef.current.histories[doc.id]
          dispatch({
            type: "push-history",
            entry: makeHistoryEntry(doc, copy ? "Copy Layers Between Documents" : "Move Layers Between Documents", docHistory?.entries[docHistory.index], doc.selectedLayerIds),
          })
        }
      }, 0)
    },
    [requestRender],
  )

  const editSmartObject = React.useCallback(
    (layer?: Layer | null) => {
      const parent = stateRef.current.documents.find((doc) => doc.id === stateRef.current.activeDocId)
      const sourceLayer = layer ?? parent?.layers.find((candidate) => candidate.id === parent.activeLayerId)
      if (!parent || !sourceLayer || (!sourceLayer.smartObject && sourceLayer.kind !== "smart-object")) return
      const source = sourceLayer.smartSource?.canvas ?? sourceLayer.canvas
      const width = sourceLayer.smartSource?.width ?? source.width
      const height = sourceLayer.smartSource?.height ?? source.height
      const editableLayer: Layer = {
        id: uid("layer"),
        name: `${sourceLayer.name} Source`,
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cloneCanvas(source) ?? makeCanvas(width, height),
      }
      const doc: PsDocument = {
        ...makeDocument(`${sourceLayer.name}.psb`, width, height, parent.background),
        id: uid("smartdoc"),
        layers: [editableLayer],
        activeLayerId: editableLayer.id,
        selectedLayerIds: [editableLayer.id],
        background: "transparent",
        smartObjectParent: { docId: parent.id, layerId: sourceLayer.id },
      }
      const entry = makeHistoryEntry(doc, "Open Smart Object")
      dispatch({ type: "new-document", doc, entry })
      requestRender()
    },
    [requestRender],
  )

  const updateSmartObjectParent = React.useCallback(() => {
    const current = stateRef.current
    const doc = current.documents.find((candidate) => candidate.id === current.activeDocId)
    if (!doc?.smartObjectParent) return
    const rendered = renderSmartObjectDocument(doc)
    dispatch({
      type: "update-smart-object-parent",
      parentDocId: doc.smartObjectParent.docId,
      layerId: doc.smartObjectParent.layerId,
      canvas: rendered,
    })
    window.setTimeout(() => commit("Update Smart Object", [doc.smartObjectParent!.layerId]), 0)
    requestRender()
  }, [commit, requestRender])

  const copySelection = React.useCallback(
    (cut = false) => {
      if (!activeDoc || !activeLayer) return
      if (typeof activeLayer.canvas.getContext !== "function") return
      const sel = activeDoc.selection.bounds
      const sx = sel ? Math.max(0, Math.floor(sel.x)) : 0
      const sy = sel ? Math.max(0, Math.floor(sel.y)) : 0
      const sw = sel
        ? Math.max(1, Math.min(activeDoc.width - sx, Math.floor(sel.w)))
        : activeDoc.width
      const sh = sel
        ? Math.max(1, Math.min(activeDoc.height - sy, Math.floor(sel.h)))
        : activeDoc.height
      const tmp = makeCanvas(sw, sh)
      tmp.getContext("2d")!.drawImage(activeLayer.canvas, -sx, -sy)
      // If selection has a mask, apply it
      if (sel && activeDoc.selection.mask) {
        const mctx = tmp.getContext("2d")!
        mctx.globalCompositeOperation = "destination-in"
        mctx.drawImage(activeDoc.selection.mask, -sx, -sy)
      }
      dispatch({ type: "set-clipboard", canvas: tmp })
      if (cut && !activeLayer.locked) {
        const ctx = activeLayer.canvas.getContext("2d")!
        if (activeDoc.selection.mask) {
          // Cut where mask is opaque
          ctx.save()
          ctx.globalCompositeOperation = "destination-out"
          ctx.drawImage(activeDoc.selection.mask, 0, 0)
          ctx.restore()
        } else {
          ctx.clearRect(sx, sy, sw, sh)
        }
        commit("Cut", [activeLayer.id])
      }
    },
    [activeDoc, activeLayer, commit],
  )

  const pasteAsLayer = React.useCallback(() => {
    const clip = state.clipboard
    if (!activeDoc || !clip) return
    const c = makeCanvas(activeDoc.width, activeDoc.height)
    const sel = activeDoc.selection.bounds
    const dx = sel ? sel.x : Math.max(0, (activeDoc.width - clip.width) / 2)
    const dy = sel ? sel.y : Math.max(0, (activeDoc.height - clip.height) / 2)
    c.getContext("2d")!.drawImage(clip.canvas, dx, dy)
    const layer: Layer = {
      id: uid("layer"),
      name: "Pasted Layer",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      canvas: c,
    }
    dispatch({ type: "add-layer", layer })
    setTimeout(() => commit("Paste", [layer.id]), 0)
  }, [activeDoc, state.clipboard, commit])

  const resizeDocument = React.useCallback(
    (w: number, h: number, resample: "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper" = "bicubic") => {
      if (!activeDoc) return
      const newW = Math.max(1, Math.floor(w))
      const newH = Math.max(1, Math.floor(h))
      const smoothing = resample !== "nearest"
      const quality: ImageSmoothingQuality =
        resample === "nearest" ? "low" : resample === "bilinear" ? "medium" : "high"
      for (const layer of activeDoc.layers) {
        if (typeof layer.canvas.getContext !== "function") continue
        const tmp = makeCanvas(newW, newH)
        const tctx = tmp.getContext("2d")!
        tctx.imageSmoothingEnabled = smoothing
        tctx.imageSmoothingQuality = quality
        tctx.drawImage(layer.canvas, 0, 0, newW, newH)
        layer.canvas.width = newW
        layer.canvas.height = newH
        const ctx = layer.canvas.getContext("2d")!
        ctx.clearRect(0, 0, newW, newH)
        ctx.drawImage(tmp, 0, 0)
        if (layer.mask) {
          const tmp2 = makeCanvas(newW, newH)
          const mtmp = tmp2.getContext("2d")!
          mtmp.imageSmoothingEnabled = smoothing
          mtmp.imageSmoothingQuality = quality
          mtmp.drawImage(layer.mask, 0, 0, newW, newH)
          layer.mask.width = newW
          layer.mask.height = newH
          const mctx = layer.mask.getContext("2d")!
          mctx.clearRect(0, 0, newW, newH)
          mctx.drawImage(tmp2, 0, 0)
        }
      }
      dispatch({ type: "resize-document", width: newW, height: newH })
      setTimeout(() => commit(`Image Size ${newW}x${newH} (${resample})`, "all"), 0)
    },
    [activeDoc, commit],
  )

  const resizeCanvas = React.useCallback(
    (w: number, h: number, anchorX: number, anchorY: number, fill: string) => {
      if (!activeDoc) return
      const newW = Math.max(1, Math.floor(w))
      const newH = Math.max(1, Math.floor(h))
      // anchorX/Y: 0=left/top, 0.5=center, 1=right/bottom
      const dx = (newW - activeDoc.width) * anchorX
      const dy = (newH - activeDoc.height) * anchorY
      const resizeCanvasInPlace = (canvas: HTMLCanvasElement, dx: number, dy: number, fill?: string) => {
        const tmp = makeCanvas(newW, newH)
        const tctx = tmp.getContext("2d")!
        if (fill && fill !== "transparent") {
          tctx.fillStyle = fill
          tctx.fillRect(0, 0, newW, newH)
        }
        tctx.drawImage(canvas, dx, dy)
        canvas.width = newW
        canvas.height = newH
        const ctx = canvas.getContext("2d")!
        ctx.clearRect(0, 0, newW, newH)
        ctx.drawImage(tmp, 0, 0)
      }

      activeDoc.layers.forEach((layer, idx) => {
        if (layer.canvas && typeof layer.canvas.getContext === "function") {
          resizeCanvasInPlace(layer.canvas, dx, dy, idx === 0 ? fill : undefined)
        }
        if (layer.mask) resizeCanvasInPlace(layer.mask, dx, dy)
      })

      if (activeDoc.selection.mask) resizeCanvasInPlace(activeDoc.selection.mask, dx, dy)
      if (activeDoc.quickMaskCanvas) resizeCanvasInPlace(activeDoc.quickMaskCanvas, dx, dy)
      activeDoc.channels?.forEach(ch => {
        if (ch.canvas) resizeCanvasInPlace(ch.canvas, dx, dy)
      })
      dispatch({
        type: "resize-canvas",
        width: newW,
        height: newH,
        offsetX: dx,
        offsetY: dy,
        fill,
      })
      setTimeout(() => commit(`Canvas Size ${newW}×${newH}`, "all"), 0)
    },
    [activeDoc, commit],
  )

  const toggleQuickMask = React.useCallback(() => {
    if (!activeDoc) return
    if (activeDoc.quickMask) {
      const mask = activeDoc.quickMaskCanvas
      if (mask) {
        const bounds = maskBounds(mask)
        const cloned = cloneCanvas(mask)
        if (bounds && cloned) {
          dispatch({
            type: "set-selection",
            selection: { bounds, shape: "freehand", mask: cloned },
          })
        } else {
          dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
        }
      }
      dispatch({ type: "set-quick-mask", on: false, canvas: null })
    } else {
      const canvas =
        selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection) ??
        makeCanvas(activeDoc.width, activeDoc.height)
      dispatch({ type: "set-quick-mask", on: true, canvas })
    }
  }, [activeDoc])

  const addLayerMask = React.useCallback(() => {
    if (!activeDoc || !activeLayer) return
    const mask = makeCanvas(activeDoc.width, activeDoc.height, "#ffffff")
    // If selection exists, only reveal that part
    if (activeDoc.selection.bounds) {
      const ctx = mask.getContext("2d")!
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
      ctx.fillStyle = "#fff"
      if (activeDoc.selection.mask) {
        ctx.drawImage(activeDoc.selection.mask, 0, 0)
      } else {
        const b = activeDoc.selection.bounds
        if (activeDoc.selection.shape === "ellipse") {
          ctx.beginPath()
          ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(b.x, b.y, b.w, b.h)
        }
      }
    }
    dispatch({ type: "set-layer-mask", id: activeLayer.id, mask })
    setTimeout(() => commit("Add Layer Mask", [activeLayer.id]), 0)
  }, [activeDoc, activeLayer, commit])

  const value: EditorContextValue = React.useMemo(() => ({
    documents: state.documents,
    activeDocId: state.activeDocId,
    tool: state.tool,
    foreground: state.foreground,
    background: state.background,
    brush: state.brush,
    gradient: state.gradient,
    paintBucket: state.paintBucket,
    eraser: state.eraser,
    cloneSource: state.cloneSource,
    symmetry: state.symmetry,
    selectionOptions: state.selectionOptions,
    transform: state.transform,
    brushPresets: state.brushPresets,
    history: docHistory.entries,
    historyIndex: docHistory.index,
    snapshots: docSnapshots,
    closedDocuments: state.closedDocuments.map((record) => ({
      id: record.id,
      name: record.doc.name,
      width: record.doc.width,
      height: record.doc.height,
      closedAt: record.closedAt,
    })),
    documentStatuses,
    actions: state.actions,
    recordingActionId: state.recordingActionId,
    isPlayingAction: state.isPlayingAction,
    activeDoc,
    activeLayer,
    selectedLayers,
    clipboard: state.clipboard,
    styleClipboard: state.styleClipboard,
    dispatch,
    commit,
    requestRender,
    subscribeRender,
    newLayer,
    newGroup,
    jumpHistory,
    createHistorySnapshot,
    restoreHistorySnapshot,
    deleteHistorySnapshot,
    createAction,
    startRecordingAction,
    stopRecordingAction,
    playAction,
    deleteAction,
    clearAction,
    createDocument,
    duplicateDocument,
    requestCloseDocument,
    closeOtherDocuments,
    reopenClosedDocument,
    markDocumentSaved,
    setDocumentLifecycle,
    moveLayersToDocument,
    copySelection,
    pasteAsLayer,
    resizeDocument,
    resizeCanvas,
    toggleQuickMask,
    addLayerMask,
    editSmartObject,
    updateSmartObjectParent,
    beginTransform: (layer: Layer) => {
      if (!activeDoc) return
      const snapshot = makeCanvas(activeDoc.width, activeDoc.height)
      snapshot.getContext("2d")!.drawImage(layer.canvas, 0, 0)
      const bounds = alphaBounds(layer.canvas) ?? { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height }
      dispatch({ type: "set-transform", transform: {
        active: true,
        layerId: layer.id,
        source: snapshot,
        bounds,
        tx: 0,
        ty: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        referencePoint: "mc",
        constrainProportions: true,
        interpolation: "bicubic",
      } })
      dispatch({ type: "set-tool", tool: "transform" })
    },
    commitTransform: () => {
      if (!activeDoc) return
      const t = state.transform
      if (!t) return
      const layer = activeDoc.layers.find((l) => l.id === t.layerId)
      if (!layer) {
        dispatch({ type: "clear-transform" })
        return
      }
      const ctx = layer.canvas.getContext("2d")!
      ctx.clearRect(0, 0, activeDoc.width, activeDoc.height)
      if (t.source) {
        const ref = t.referencePoint ?? "mc"
        const xFactor = ref.endsWith("l") ? 0 : ref.endsWith("r") ? 1 : 0.5
        const yFactor = ref.startsWith("t") ? 0 : ref.startsWith("b") ? 1 : 0.5
        const cx = t.bounds.x + t.bounds.w * xFactor
        const cy = t.bounds.y + t.bounds.h * yFactor
        ctx.save()
        ctx.imageSmoothingEnabled = t.interpolation !== "nearest"
        ctx.imageSmoothingQuality =
          t.interpolation === "bilinear" ? "medium" : t.interpolation === "nearest" ? "low" : "high"
        ctx.translate(cx + t.tx, cy + t.ty)
        ctx.rotate((t.rotation * Math.PI) / 180)
        ctx.transform(
          1,
          Math.tan(((t.skewY ?? 0) * Math.PI) / 180),
          Math.tan(((t.skewX ?? 0) * Math.PI) / 180),
          1,
          0,
          0,
        )
        ctx.scale(t.scaleX, t.scaleY)
        ctx.translate(-cx, -cy)
        ctx.drawImage(t.source, 0, 0)
        ctx.restore()
      }
      dispatch({ type: "clear-transform" })
      requestRender()
      commit("Free Transform", [layer.id])
    },
    flipLayer: (axis: "horizontal" | "vertical") => {
      if (!activeDoc || !activeLayer || activeLayer.locked) return
      if (typeof activeLayer.canvas.getContext !== "function") return
      const tmp = makeCanvas(activeLayer.canvas.width, activeLayer.canvas.height)
      const ctx = tmp.getContext("2d")!
      if (axis === "horizontal") {
        ctx.translate(activeLayer.canvas.width, 0)
        ctx.scale(-1, 1)
      } else {
        ctx.translate(0, activeLayer.canvas.height)
        ctx.scale(1, -1)
      }
      ctx.drawImage(activeLayer.canvas, 0, 0)
      const lc = activeLayer.canvas.getContext("2d")!
      lc.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
      lc.drawImage(tmp, 0, 0)
      requestRender()
      commit(`Flip Layer ${axis}`, [activeLayer.id])
    },
    rotateLayer: (deg: number) => {
      if (!activeDoc || !activeLayer || activeLayer.locked) return
      const w = activeLayer.canvas.width
      const h = activeLayer.canvas.height
      const tmp = makeCanvas(w, h)
      const ctx = tmp.getContext("2d")!
      ctx.translate(w / 2, h / 2)
      ctx.rotate((deg * Math.PI) / 180)
      ctx.drawImage(activeLayer.canvas, -w / 2, -h / 2)
      const lc = activeLayer.canvas.getContext("2d")!
      lc.clearRect(0, 0, w, h)
      lc.drawImage(tmp, 0, 0)
      requestRender()
      commit(`Rotate Layer ${deg}\u00b0`, [activeLayer.id])
    },
    filterPreviews: filterPreviewsRef.current,
    setFilterPreview,
  }), [
    state.documents, state.activeDocId, state.tool, state.foreground, state.background,
    state.brush, state.gradient, state.paintBucket, state.eraser, state.cloneSource, state.symmetry, state.selectionOptions,
    state.transform, state.brushPresets, state.clipboard, state.styleClipboard, state.closedDocuments,
    state.actions, state.recordingActionId, state.isPlayingAction, documentStatuses,
    docHistory.entries, docHistory.index, docSnapshots,
    activeDoc, activeLayer, selectedLayers,
    dispatch, commit, requestRender, subscribeRender,
    newLayer, newGroup, jumpHistory, createHistorySnapshot, restoreHistorySnapshot,
    deleteHistorySnapshot, createAction, startRecordingAction, stopRecordingAction,
    playAction, deleteAction, clearAction, createDocument, duplicateDocument, requestCloseDocument, closeOtherDocuments,
    reopenClosedDocument, markDocumentSaved, setDocumentLifecycle, moveLayersToDocument, copySelection, pasteAsLayer,
    resizeDocument, resizeCanvas, toggleQuickMask, addLayerMask, editSmartObject, updateSmartObjectParent,
    setFilterPreview,
  ])

  const closeTarget = closeRequest
    ? state.documents.find((doc) => doc.id === closeRequest.currentId) ?? null
    : null
  const savePendingClose = () => {
    if (!closeTarget) return
    setCloseRequest((current) => current ? { ...current, saving: true } : current)
    window.dispatchEvent(new CustomEvent("ps-save-document", { detail: { docId: closeTarget.id, mode: "save", reason: "close" } }))
  }
  const discardPendingClose = () => {
    if (!closeTarget) return
    finishPendingClose(closeTarget.id, true)
  }

  return (
    <EditorContext.Provider value={value}>
      {children}
      <Dialog open={!!closeTarget} onOpenChange={(open) => {
        if (!open && !closeRequest?.saving) setCloseRequest(null)
      }}>
        <DialogContent className="max-w-[420px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
          <DialogHeader>
            <DialogTitle>Save changes to {closeTarget?.name ?? "document"}?</DialogTitle>
            <DialogDescription className="text-[12px] text-[var(--ps-text-dim)]">
              Closing without saving will discard changes made since the last save in this browser session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseRequest(null)} disabled={closeRequest?.saving}>
              Cancel
            </Button>
            <Button variant="outline" onClick={discardPendingClose} disabled={closeRequest?.saving}>
              Don't Save
            </Button>
            <Button onClick={savePendingClose} disabled={closeRequest?.saving}>
              {closeRequest?.saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EditorContext.Provider>
  )
}

export function useEditor() {
  const ctx = React.useContext(EditorContext)
  if (!ctx) throw new Error("useEditor must be used within EditorProvider")
  return ctx
}

export function useRenderSubscription(cb: () => void) {
  const { subscribeRender } = useEditor()
  React.useEffect(() => subscribeRender(cb), [cb, subscribeRender])
}

export { makeCanvas, cloneCanvas, makeHistoryEntry }
