import type { LargeDocumentTileViewMetadata, PsDocument } from "./types"
import { TiledBackingStore } from "./tiled-backing-store"
import { createTileEditDocument } from "./large-document"

export const PSB_TILE_VIEW_LAYER_ID = "psb-composite"
export const PSB_TILE_VIEW_SOURCE_VERSION = "full-resolution"

const tileStores = new Map<string, TiledBackingStore>()

export function registerPsbTileViewStore(docId: string, store: TiledBackingStore) {
  tileStores.set(docId, store)
}

export function forgetPsbTileViewStore(docId: string) {
  tileStores.delete(docId)
}

export function getPsbTileViewMetadata(doc: PsDocument | null | undefined): LargeDocumentTileViewMetadata | null {
  return doc?.metadata?.largeDocumentTileView ?? null
}

export function hasPsbTileViewStore(docId: string) {
  return tileStores.has(docId)
}

function storesFor(docIds?: readonly string[]) {
  if (!docIds?.length) return [...tileStores.entries()]
  const requested = new Set(docIds)
  return [...tileStores.entries()].filter(([docId]) => requested.has(docId))
}

export function estimatePsbTileViewCacheBytes(docIds?: readonly string[]) {
  return storesFor(docIds).reduce((sum, [, store]) => sum + store.estimateCacheBytes(), 0)
}

export function purgePsbTileViewCaches(docIds?: readonly string[]) {
  const stores = storesFor(docIds).map(([, store]) => store)
  const estimatedBytes = stores.reduce((sum, store) => sum + store.estimateCacheBytes(), 0)
  void Promise.allSettled(stores.map((store) => store.purgeCache()))
  return estimatedBytes
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
      bitmap.close()
      return canvas
    } catch {
      // Fall through to the Image/data-URL path used by fixture DOMs.
    }
  }
  const dataUrl = await blobToDataUrl(blob)
  return dataUrlToCanvas(dataUrl)
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error ?? new Error("Could not read PSB tile"))
      reader.readAsDataURL(blob)
    })
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`
}

function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const fixtureCanvas = fixtureDataUrlToCanvas(dataUrl)
  if (fixtureCanvas) return Promise.resolve(fixtureCanvas)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, image.naturalWidth || 1)
      canvas.height = Math.max(1, image.naturalHeight || 1)
      canvas.getContext("2d")!.drawImage(image, 0, 0)
      resolve(canvas)
    }
    image.onerror = () => reject(new Error("Could not decode PSB tile"))
    image.src = dataUrl
  })
}

function fixtureDataUrlToCanvas(dataUrl: string): HTMLCanvasElement | null {
  const payload = dataUrl.split(",", 2)[1]
  if (!payload) return null
  try {
    const parsed = JSON.parse(atob(payload)) as { width?: unknown; height?: unknown; fill?: unknown }
    if (typeof parsed.fill !== "string") return null
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(Number(parsed.width) || 1))
    canvas.height = Math.max(1, Math.round(Number(parsed.height) || 1))
    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.fillStyle = parsed.fill
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    return canvas
  } catch {
    return null
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
  if (!match) return new Blob([], { type: "image/png" })
  const type = match[1] || "image/png"
  const payload = match[3] ?? ""
  const binary = match[2] ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Could not encode PSB tile"))
      }, "image/png")
    })
  }
  if (typeof canvas.toDataURL === "function") return Promise.resolve(dataUrlToBlob(canvas.toDataURL("image/png")))
  return Promise.reject(new Error("Could not encode PSB tile"))
}

export async function openPsbTileEditDocument(
  doc: PsDocument,
  col: number,
  row: number,
): Promise<PsDocument | null> {
  const tileView = getPsbTileViewMetadata(doc)
  if (!tileView) return null
  const tile = await readPsbTileViewCanvas(doc.id, col, row)
  if (!tile) return null
  const safeCol = Math.max(0, Math.round(col))
  const safeRow = Math.max(0, Math.round(row))
  return createTileEditDocument({
    parentDocId: doc.id,
    sourceName: tileView.sourceName,
    col: safeCol,
    row: safeRow,
    sourceX: safeCol * tileView.tileSize,
    sourceY: safeRow * tileView.tileSize,
    originalWidth: tileView.originalWidth,
    originalHeight: tileView.originalHeight,
    tileSize: tileView.tileSize,
    canvas: tile,
  })
}

export async function commitPsbTileEditDocument(tileDoc: PsDocument): Promise<boolean> {
  const edit = tileDoc.metadata?.largeDocumentTileEdit
  const canvas = tileDoc.layers[0]?.canvas
  if (!edit || !canvas) return false
  return writePsbTileViewCanvas(edit.parentDocId, edit.tile.col, edit.tile.row, canvas)
}

export async function readPsbTileViewCanvas(docId: string, col: number, row: number): Promise<HTMLCanvasElement | null> {
  const store = tileStores.get(docId)
  if (!store) return null
  const blob = await store.readLayerTile({
    layerId: PSB_TILE_VIEW_LAYER_ID,
    layerKind: "raster",
    sourceVersion: PSB_TILE_VIEW_SOURCE_VERSION,
    col,
    row,
  })
  if (!blob) return null
  return blobToCanvas(blob)
}

export async function writePsbTileViewCanvas(docId: string, col: number, row: number, canvas: HTMLCanvasElement): Promise<boolean> {
  const store = tileStores.get(docId)
  if (!store) return false
  await store.writeLayerTile({
    layerId: PSB_TILE_VIEW_LAYER_ID,
    layerKind: "raster",
    sourceVersion: PSB_TILE_VIEW_SOURCE_VERSION,
    col,
    row,
  }, await canvasToPngBlob(canvas))
  return true
}
