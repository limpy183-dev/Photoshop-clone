import { makeCanvas } from "./canvas-utils"
import { estimateCanvasBytes, estimateDataUrlBytes } from "./purge-commands"
import type {
  HistoryEntry,
  HistorySnapshot,
  Layer,
  LayerSnapshot,
  LayerStyle,
  PsDocument,
  TimelineFrame,
  VideoLayerProps,
} from "./types"

/** Keep the N most recent history entries uncompressed for fast undo. */
export const COMPRESS_AFTER_N = 12

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

/** Decompress a Blob back to a canvas for rendering. */
async function decompressBlob(blob: Blob, width: number, height: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

/** Map from compressed canvas placeholder ID to blob. */
const compressedCanvasStore = new Map<string, Blob>()
let compressedIdCounter = 0

/**
 * Create a tiny 1x1 placeholder canvas that represents a compressed entry.
 * The actual pixel data is stored as a Blob in compressedCanvasStore.
 */
function createCompressedPlaceholder(blobId: string): HTMLCanvasElement {
  const c = makeCanvas(1, 1)
  c.__compressedBlobId = blobId
  return c
}

/** Check if a canvas is a compressed placeholder. */
export function isCompressedCanvas(canvas: HTMLCanvasElement | null | undefined): boolean {
  return !!(canvas && canvas.__compressedBlobId)
}

/** Get the blob ID from a compressed placeholder. */
function getCompressedBlobId(canvas: HTMLCanvasElement): string | null {
  return canvas.__compressedBlobId ?? null
}

/**
 * Free any compressed-canvas blobs referenced by these history entries from
 * compressedCanvasStore. Called when entries are dropped from history (undo
 * limit trim, redo branch discard, history reset, etc.) so the global blob
 * store does not grow unbounded across long editing sessions.
 */
function releaseEntryBlobs(entry: HistoryEntry | null | undefined): void {
  if (!entry?.layers) return
  for (const layerSnap of entry.layers) {
    if (!layerSnap?.canvas || !isCompressedCanvas(layerSnap.canvas)) continue
    const blobId = getCompressedBlobId(layerSnap.canvas)
    if (blobId) compressedCanvasStore.delete(blobId)
  }
}

/** Bulk-release blobs from many entries. */
export function releaseEntriesBlobs(entries: ReadonlyArray<HistoryEntry | null | undefined>): void {
  for (const entry of entries) releaseEntryBlobs(entry)
}

interface HistoryMemoryEstimateContext {
  canvases: Set<HTMLCanvasElement>
  compressedBlobIds: Set<string>
}

function makeHistoryMemoryEstimateContext(): HistoryMemoryEstimateContext {
  return { canvases: new Set(), compressedBlobIds: new Set() }
}

function estimateCanvasAllocationBytes(
  canvas: HTMLCanvasElement | null | undefined,
  context: HistoryMemoryEstimateContext,
) {
  if (!canvas) return 0
  if (isCompressedCanvas(canvas)) {
    const blobId = getCompressedBlobId(canvas)
    if (!blobId || context.compressedBlobIds.has(blobId)) return 0
    context.compressedBlobIds.add(blobId)
    return compressedCanvasStore.get(blobId)?.size ?? estimateCanvasBytes({
      width: canvas.__origW ?? canvas.width,
      height: canvas.__origH ?? canvas.height,
    })
  }
  if (context.canvases.has(canvas)) return 0
  context.canvases.add(canvas)
  return estimateCanvasBytes(canvas)
}

function estimateLayerSnapshotBytes(snapshot: LayerSnapshot, context: HistoryMemoryEstimateContext) {
  let bytes = estimateCanvasAllocationBytes(snapshot.canvas, context)
  bytes += estimateCanvasAllocationBytes(snapshot.mask, context)
  for (const patch of snapshot.canvasPatches ?? []) bytes += estimateCanvasAllocationBytes(patch.canvas, context)
  if (snapshot.frame?.imageCanvas) bytes += estimateCanvasAllocationBytes(snapshot.frame.imageCanvas, context)
  if (snapshot.smartSource?.canvas) bytes += estimateCanvasAllocationBytes(snapshot.smartSource.canvas, context)
  for (const filter of snapshot.smartFilters ?? []) bytes += estimateCanvasAllocationBytes(filter.mask, context)
  bytes += estimateDataUrlBytes(snapshot.video?.posterDataUrl)
  return bytes
}

function estimateHistoryEntryBytes(
  entry: HistoryEntry | null | undefined,
  context: HistoryMemoryEstimateContext,
) {
  if (!entry) return 0
  let bytes = estimateDataUrlBytes(entry.thumb)
  for (const snapshot of entry.layers) bytes += estimateLayerSnapshotBytes(snapshot, context)
  bytes += estimateCanvasAllocationBytes(entry.selection?.mask, context)
  bytes += estimateCanvasAllocationBytes(entry.quickMaskCanvas, context)
  for (const channel of entry.channels ?? []) bytes += estimateCanvasAllocationBytes(channel.canvas, context)
  return bytes
}

function estimateHistoryEntriesBytes(entries: ReadonlyArray<HistoryEntry | null | undefined>) {
  const context = makeHistoryMemoryEstimateContext()
  return entries.reduce((sum, entry) => sum + estimateHistoryEntryBytes(entry, context), 0)
}

function estimateStyleClipboardBytes(style: LayerStyle | null) {
  if (!style) return 0
  try {
    return JSON.stringify(style).length * 2
  } catch {
    return 0
  }
}

export interface EditorHistoryLike {
  entries: HistoryEntry[]
  index: number
}

export interface EditorHistoryStorageDocument {
  id: string
  layers: readonly Pick<Layer, "video">[]
  timelineFrames?: readonly Pick<TimelineFrame, "thumbnail">[]
}

export interface EditorHistoryStorageState {
  activeDocId: string | null
  documents: readonly EditorHistoryStorageDocument[]
  histories: Record<string, EditorHistoryLike | undefined>
  snapshots: Record<string, readonly HistorySnapshot[] | undefined>
  closedDocuments: readonly {
    doc: EditorHistoryStorageDocument
    history?: EditorHistoryLike
    snapshots?: readonly HistorySnapshot[]
  }[]
  actions: readonly { steps: readonly { entry: HistoryEntry }[] }[]
  clipboard?: { canvas?: HTMLCanvasElement | null } | null
  styleClipboard: LayerStyle | null
}

export function estimateClipboardPurgeBytes(state: Pick<EditorHistoryStorageState, "clipboard" | "styleClipboard">) {
  return estimateCanvasBytes(state.clipboard?.canvas) + estimateStyleClipboardBytes(state.styleClipboard)
}

export function estimateUndoPurgeBytes(state: Pick<EditorHistoryStorageState, "activeDocId" | "histories">) {
  const docId = state.activeDocId
  if (!docId) return 0
  const history = state.histories[docId]
  if (!history) return 0
  return estimateHistoryEntriesBytes(history.entries.filter((_, index) => index !== history.index))
}

export function estimateHistoriesPurgeBytes(
  state: Pick<EditorHistoryStorageState, "documents" | "histories" | "snapshots" | "closedDocuments">,
) {
  const context = makeHistoryMemoryEstimateContext()
  let bytes = 0
  for (const doc of state.documents) {
    const history = state.histories[doc.id]
    if (history) {
      for (const [index, entry] of history.entries.entries()) {
        if (index !== history.index) bytes += estimateHistoryEntryBytes(entry, context)
      }
    }
    for (const snapshot of state.snapshots[doc.id] ?? []) bytes += estimateHistoryEntryBytes(snapshot.entry, context)
  }
  for (const record of state.closedDocuments) {
    const history = record.history
    if (history) {
      for (const [index, entry] of history.entries.entries()) {
        if (index !== history.index) bytes += estimateHistoryEntryBytes(entry, context)
      }
    }
    for (const snapshot of record.snapshots ?? []) bytes += estimateHistoryEntryBytes(snapshot.entry, context)
  }
  return bytes
}

function estimateFilterPreviewPurgeBytes(previews: Record<string, HTMLCanvasElement>) {
  const context = makeHistoryMemoryEstimateContext()
  return Object.values(previews).reduce((sum, canvas) => sum + estimateCanvasAllocationBytes(canvas, context), 0)
}

export function purgeFilterPreviewCache(previews: Record<string, HTMLCanvasElement>) {
  const bytes = estimateFilterPreviewPurgeBytes(previews)
  for (const key of Object.keys(previews)) delete previews[key]
  return bytes
}

function estimateVideoLayerCacheBytes(layer: Pick<Layer, "video"> | Pick<LayerSnapshot, "video">) {
  return estimateDataUrlBytes(layer.video?.posterDataUrl)
}

function estimateVideoCacheInEntry(entry: HistoryEntry | null | undefined) {
  if (!entry) return 0
  return entry.layers.reduce((sum, layer) => sum + estimateVideoLayerCacheBytes(layer), 0)
}

function estimateVideoCacheInDoc(doc: EditorHistoryStorageDocument) {
  let bytes = doc.layers.reduce((sum, layer) => sum + estimateVideoLayerCacheBytes(layer), 0)
  for (const frame of doc.timelineFrames ?? []) bytes += estimateDataUrlBytes(frame.thumbnail)
  return bytes
}

export function estimateVideoCachePurgeBytes(
  state: Pick<EditorHistoryStorageState, "documents" | "histories" | "snapshots" | "closedDocuments" | "actions">,
) {
  let bytes = 0
  for (const doc of state.documents) {
    bytes += estimateVideoCacheInDoc(doc)
    for (const entry of state.histories[doc.id]?.entries ?? []) bytes += estimateVideoCacheInEntry(entry)
    for (const snapshot of state.snapshots[doc.id] ?? []) bytes += estimateVideoCacheInEntry(snapshot.entry)
  }
  for (const record of state.closedDocuments) {
    bytes += estimateVideoCacheInDoc(record.doc)
    for (const entry of record.history?.entries ?? []) bytes += estimateVideoCacheInEntry(entry)
    for (const snapshot of record.snapshots ?? []) bytes += estimateVideoCacheInEntry(snapshot.entry)
  }
  for (const action of state.actions) {
    for (const step of action.steps) bytes += estimateVideoCacheInEntry(step.entry)
  }
  return bytes
}

function stripVideoLayerCache<T extends { video?: VideoLayerProps }>(layer: T): T {
  if (!layer.video?.posterDataUrl) return layer
  const { posterDataUrl: _posterDataUrl, ...video } = layer.video
  return { ...layer, video } as T
}

function stripVideoFrameCache(frame: TimelineFrame): TimelineFrame {
  if (!frame.thumbnail) return frame
  const { thumbnail: _thumbnail, ...rest } = frame
  return rest as TimelineFrame
}

export function stripVideoCacheFromDoc(doc: PsDocument): PsDocument {
  let changed = false
  const layers = doc.layers.map((layer) => {
    const next = stripVideoLayerCache(layer)
    if (next !== layer) changed = true
    return next
  })
  const timelineFrames = doc.timelineFrames?.map((frame) => {
    const next = stripVideoFrameCache(frame)
    if (next !== frame) changed = true
    return next
  })
  if (!changed) return doc
  return { ...doc, layers, timelineFrames }
}

export function stripVideoCacheFromEntry(entry: HistoryEntry): HistoryEntry {
  let changed = false
  const layers = entry.layers.map((layer) => {
    const next = stripVideoLayerCache(layer)
    if (next !== layer) changed = true
    return next
  })
  return changed ? { ...entry, layers } : entry
}

export function stripVideoCacheFromSnapshots(snapshots: HistorySnapshot[] | undefined): HistorySnapshot[] {
  if (!snapshots?.length) return snapshots ?? []
  return snapshots.map((snapshot) => {
    const entry = stripVideoCacheFromEntry(snapshot.entry)
    return entry === snapshot.entry ? snapshot : { ...snapshot, entry }
  })
}

export function stripVideoCacheFromHistory<T extends EditorHistoryLike | undefined>(history: T): T {
  if (!history) return history
  let changed = false
  const entries = history.entries.map((entry) => {
    const next = stripVideoCacheFromEntry(entry)
    if (next !== entry) changed = true
    return next
  })
  return (changed ? { ...history, entries } : history) as T
}

/**
 * Compress old history entries in the background to reduce memory.
 * Called after push-history when there are enough entries.
 */
export function scheduleHistoryCompression(entries: HistoryEntry[], currentIndex: number) {
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
          const blobId = `hblob_${compressedIdCounter++}`
          compressedCanvasStore.set(blobId, blob)
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
 * Decompress all compressed-placeholder canvases in a history entry, mutating
 * each layer snapshot in place to point at a real HTMLCanvasElement carrying
 * the original pixels. Subsequent visits skip the work because the snapshot's
 * canvas is no longer a placeholder.
 */
export async function prepareEntryForRestore(entry: HistoryEntry): Promise<void> {
  if (!entry?.layers?.length) return
  await Promise.all(
    entry.layers.map(async (layerSnap) => {
      if (!layerSnap.canvas || !isCompressedCanvas(layerSnap.canvas)) return
      const blobId = getCompressedBlobId(layerSnap.canvas)
      if (!blobId) return
      const blob = compressedCanvasStore.get(blobId)
      if (!blob) return
      const w = layerSnap.canvas.__origW ?? 1
      const h = layerSnap.canvas.__origH ?? 1
      try {
        const restored = await decompressBlob(blob, w, h)
        layerSnap.canvas = restored
        compressedCanvasStore.delete(blobId)
      } catch {
        // Keep the placeholder so restore code can decline to overwrite pixels.
      }
    }),
  )
}
