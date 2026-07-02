/**
 * Local libraries store.
 *
 * The Libraries panel persists user-collected reusable assets — typically
 * images that the user wants to drop onto multiple documents as smart
 * objects. Records are stored in IndexedDB so they survive across
 * sessions and can hold blobs without bloating localStorage.
 *
 * Adobe's cloud Creative Cloud Libraries are explicitly out of scope per
 * BOUNDARIES.md. This module is the in-browser equivalent: a local,
 * per-origin gallery of images and reusable assets the user collects.
 */

import { dispatchPhotoshopEvent } from "./events"
import { openRegisteredIndexedDB, STORAGE_RESOURCES } from "./storage-registry"

export interface LibraryAssetRecord {
  id: string
  name: string
  kind: "image" | "color" | "text"
  /** Original file mime-type if the asset is an image. */
  mimeType?: string
  /** Width in pixels at import time. */
  width?: number
  /** Height in pixels at import time. */
  height?: number
  /** Raw asset bytes for images. */
  blob?: Blob
  /** Pre-baked low-res thumbnail data URL for the grid preview. */
  thumbnail?: string
  /** Color hex string when kind === "color". */
  color?: string
  /** Text payload when kind === "text". */
  text?: string
  description?: string
  tags: string[]
  group?: string
  createdAt: number
  updatedAt?: number
  sizeBytes?: number
}

export interface LibraryAssetFilter {
  query?: string
  group?: string
}

const STORE_NAME = "assets"
const CHANGE_EVENT = "ps-libraries-changed"
const MAX_THUMB_DIM = 192

export function parseLibraryTagInput(input: string, limit = 16): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  for (const token of input.split(/[,\n]/)) {
    const normalized = token.trim().toLowerCase().replace(/\s+/g, "-").replace(/^-+|-+$/g, "")
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    tags.push(normalized.slice(0, 40))
    if (tags.length >= limit) break
  }
  return tags
}

export function filterLocalLibraryAssets(records: readonly LibraryAssetRecord[], filter: LibraryAssetFilter = {}): LibraryAssetRecord[] {
  const group = filter.group?.trim()
  const terms = tokenizeLibraryQuery(filter.query)
  return records.filter((asset) => {
    if (group && group !== "all" && asset.group !== group) return false
    if (!terms.length) return true
    const haystack = [
      asset.name,
      asset.kind,
      asset.group ?? "",
      asset.description ?? "",
      asset.color ?? "",
      asset.text ?? "",
      asset.mimeType ?? "",
      ...asset.tags,
    ].join(" ").toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

function tokenizeLibraryQuery(query: string | undefined): string[] {
  return (query ?? "").toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean)
}

function isIndexedDBAvailable() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined"
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = openRegisteredIndexedDB(STORAGE_RESOURCES.libraries)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("createdAt", "createdAt")
        store.createIndex("group", "group")
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  if (!isIndexedDBAvailable()) {
    throw new Error("IndexedDB is not available in this environment.")
  }
  const db = await openDB()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const store = tx.objectStore(STORE_NAME)
      let result: T | undefined
      Promise.resolve(action(store)).then((value) => {
        result = value
      }).catch(reject)
      tx.oncomplete = () => resolve(result as T)
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"))
      tx.onerror = () => reject(tx.error ?? new Error("Transaction error"))
    })
  } finally {
    db.close()
  }
}

export async function listLibraryAssets(): Promise<LibraryAssetRecord[]> {
  if (!isIndexedDBAvailable()) return []
  try {
    return await withStore("readonly", (store) => {
      return new Promise<LibraryAssetRecord[]>((resolve, reject) => {
        const req = store.getAll()
        req.onsuccess = () => {
          const records = (req.result as LibraryAssetRecord[]).slice()
          records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
          resolve(records)
        }
        req.onerror = () => reject(req.error)
      })
    })
  } catch {
    return []
  }
}

export async function putLibraryAsset(record: LibraryAssetRecord): Promise<void> {
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.put(record)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  })
  emitChange()
}

export async function deleteLibraryAsset(id: string): Promise<void> {
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  })
  emitChange()
}

export async function clearLibraryAssets(): Promise<void> {
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  })
  emitChange()
}

export function subscribeLibraryChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const listener = () => handler()
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

function emitChange() {
  if (typeof window === "undefined") return
  dispatchPhotoshopEvent(CHANGE_EVENT)
}

/**
 * Reads a file into a {@link LibraryAssetRecord}. Generates a bounded
 * thumbnail data URL alongside the original blob so the grid can render
 * even when the blob is multi-megabyte.
 */
export async function libraryAssetFromFile(file: File): Promise<LibraryAssetRecord> {
  const bitmap = await createImageBitmap(file)
  const baseName = file.name.replace(/\.[^.]+$/, "") || "Asset"
  const thumbnail = await renderThumbnail(bitmap, MAX_THUMB_DIM)
  bitmap.close?.()
  return {
    id: `lib_${Math.random().toString(36).slice(2, 12)}`,
    name: baseName.slice(0, 80),
    kind: "image",
    mimeType: file.type || guessMime(file.name),
    blob: file,
    width: bitmap.width,
    height: bitmap.height,
    thumbnail,
    tags: [],
    group: "Imported",
    createdAt: Date.now(),
    sizeBytes: file.size,
  }
}

export async function libraryAssetFromCanvas(canvas: HTMLCanvasElement, name = "Snapshot"): Promise<LibraryAssetRecord> {
  const blob = await canvasToBlob(canvas, "image/png")
  const thumbnail = await renderThumbnail(canvas, MAX_THUMB_DIM)
  return {
    id: `lib_${Math.random().toString(36).slice(2, 12)}`,
    name: name.slice(0, 80),
    kind: "image",
    mimeType: "image/png",
    blob,
    width: canvas.width,
    height: canvas.height,
    thumbnail,
    tags: [],
    group: "From Document",
    createdAt: Date.now(),
    sizeBytes: blob?.size,
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), type)
  })
}

async function renderThumbnail(source: ImageBitmap | HTMLCanvasElement, maxDim: number): Promise<string | undefined> {
  if (typeof document === "undefined") return undefined
  const srcW = "width" in source ? source.width : 0
  const srcH = "height" in source ? source.height : 0
  if (!srcW || !srcH) return undefined
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return undefined
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "medium"
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
  return canvas.toDataURL("image/jpeg", 0.78)
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return canvas
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "png": return "image/png"
    case "jpg":
    case "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    case "avif": return "image/avif"
    case "svg": return "image/svg+xml"
    default: return "application/octet-stream"
  }
}

export function libraryStorageReady(): boolean {
  return isIndexedDBAvailable()
}
