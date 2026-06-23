"use client"

import { loadPreferencesFromStorage } from "./preferences-engine"
import {
  browserLocalStorage,
  readClientStorageJson,
  removeClientStorageItem,
  writeClientStorageJson,
  type ClientStorageKey,
} from "./client-storage"
import { dispatchPhotoshopEvent } from "./events"

export interface RecentDocument {
  id: string
  name: string
  kind: "project" | "psd" | "image" | "autosave"
  updatedAt: number
  serialized: string
  fileName?: string
  storage?: "new" | "download" | "file-system-access" | "opened-file" | "snapshot"
  /** Small base64 thumbnail data URL for the recent documents list. */
  thumbnail?: string
}

export interface AutosaveDocument extends RecentDocument {
  kind: "autosave"
  documentId: string
}

const RECENTS_KEY = "ps-recent-documents-v1"
export const AUTOSAVE_KEY = "ps-autosave-document-v1"
export const AUTOSAVE_COLLECTION_KEY = "ps-autosave-documents-v2"
const RECENTS_STORAGE: ClientStorageKey<unknown[]> = {
  key: RECENTS_KEY,
  version: 1,
  privacy: "project-data",
  description: "Recent project/image documents, including serialized project snapshots and thumbnails.",
  fallback: [],
}
const AUTOSAVE_STORAGE: ClientStorageKey<unknown | null> = {
  key: AUTOSAVE_KEY,
  version: 1,
  privacy: "autosave",
  description: "Legacy single-document autosave recovery payload.",
  fallback: null,
}
const AUTOSAVE_COLLECTION_STORAGE: ClientStorageKey<unknown[]> = {
  key: AUTOSAVE_COLLECTION_KEY,
  version: 2,
  privacy: "autosave",
  description: "Autosave recovery collection for multiple open documents.",
  fallback: [],
}
const MAX_RECENTS = 8
const MAX_STORED_DOCUMENT_CHARS = 8_000_000
const RECENT_KINDS = new Set<RecentDocument["kind"]>(["project", "psd", "image", "autosave"])

/* =================== IndexedDB autosave helpers =================== */

const IDB_NAME = "ps-autosave-db"
const IDB_VERSION = 1
const IDB_STORE = "autosaves"

function isIndexedDBAvailable() {
  try {
    return typeof window !== "undefined" && typeof window.indexedDB !== "undefined" && !!window.indexedDB
  } catch {
    return false
  }
}

function openAutosaveDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) { reject(new Error("IndexedDB not available")); return }
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "documentId" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readAutosavesIDB(): Promise<AutosaveDocument[]> {
  const db = await openAutosaveDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly")
    const store = tx.objectStore(IDB_STORE)
    const request = store.getAll()
    request.onsuccess = () => {
      const results = (request.result ?? [])
        .map(normalizeAutosaveDocument)
        .filter((item): item is AutosaveDocument => !!item)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(results)
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

async function writeAutosavesIDB(entries: AutosaveDocument[]): Promise<void> {
  const db = await openAutosaveDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite")
    const store = tx.objectStore(IDB_STORE)
    store.clear()
    for (const entry of entries) {
      store.put(entry)
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function clearAutosaveIDB(): Promise<void> {
  const db = await openAutosaveDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite")
    const store = tx.objectStore(IDB_STORE)
    store.clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function removeAutosaveIDB(documentId: string): Promise<void> {
  const db = await openAutosaveDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite")
    const store = tx.objectStore(IDB_STORE)
    store.delete(documentId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

/* Track whether IndexedDB is the current source */
let _idbAvailable: boolean | null = null
function canUseIDB() {
  if (_idbAvailable === null) _idbAvailable = isIndexedDBAvailable()
  return _idbAvailable
}

/* =================== localStorage helpers =================== */

function canUseStorage() {
  return !!browserLocalStorage()
}

function recentDocumentsLimit() {
  try {
    const limit = loadPreferencesFromStorage().fileHandling.recentFilesLimit
    if (!Number.isFinite(limit)) return MAX_RECENTS
    return Math.min(100, Math.max(0, Math.floor(limit)))
  } catch {
    return MAX_RECENTS
  }
}

export function readRecentDocuments(): RecentDocument[] {
  if (!canUseStorage()) return []
  const parsed = readClientStorageJson(RECENTS_STORAGE)
  if (!Array.isArray(parsed)) return []
  return parsed
    .map(normalizeRecentDocument)
    .filter((item): item is RecentDocument => !!item)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function rememberRecentDocument(entry: Omit<RecentDocument, "id" | "updatedAt"> & { id?: string; updatedAt?: number; thumbnail?: string }) {
  if (!canUseStorage()) return
  try {
    const limit = recentDocumentsLimit()
    if (limit === 0) {
      removeClientStorageItem(RECENTS_STORAGE)
      dispatchPhotoshopEvent("ps-recents-changed")
      return
    }
    if (entry.serialized.length > MAX_STORED_DOCUMENT_CHARS) {
      pruneRecentDocuments()
      return
    }
    const id = entry.id ?? `${entry.kind}_${hashString(entry.name + entry.serialized.slice(0, 256))}`
    const next: RecentDocument = {
      id,
      name: entry.name,
      kind: entry.kind,
      serialized: entry.serialized,
      updatedAt: entry.updatedAt ?? Date.now(),
      fileName: entry.fileName,
      storage: entry.storage,
      thumbnail: safeThumbnail(entry.thumbnail),
    }
    const recents = readRecentDocuments().filter((item) => item.id !== id && item.name !== next.name)
    const result = writeClientStorageJson(RECENTS_STORAGE, [next, ...recents].slice(0, limit))
    if (!result.ok) throw result.error ?? new Error(result.reason)
    dispatchPhotoshopEvent("ps-recents-changed")
  } catch {
    pruneRecentDocuments()
  }
}

export function removeRecentDocument(id: string) {
  if (!canUseStorage()) return
  writeClientStorageJson(RECENTS_STORAGE, readRecentDocuments().filter((item) => item.id !== id))
  dispatchPhotoshopEvent("ps-recents-changed")
}

export function pruneRecentDocuments() {
  if (!canUseStorage()) return
  try {
    const limit = recentDocumentsLimit()
    if (limit === 0) {
      removeClientStorageItem(RECENTS_STORAGE)
      return
    }
    const recents = readRecentDocuments().slice(0, Math.max(1, Math.floor(limit / 2)))
    writeClientStorageJson(RECENTS_STORAGE, recents)
  } catch { }
}

export function readAutosave(): RecentDocument | null {
  if (!canUseStorage()) return null
  return normalizeRecentDocument(readClientStorageJson(AUTOSAVE_STORAGE))
}

/**
 * Read autosaved documents. Prefers IndexedDB (much larger capacity) and
 * falls back to localStorage for compatibility.
 */
export function readAutosaves(): AutosaveDocument[] {
  // Try IndexedDB asynchronously — for the synchronous API we still read localStorage as a baseline.
  // Callers that need the IDB data can use readAutosavesAsync().
  if (!canUseStorage()) return []
  const parsed = readClientStorageJson(AUTOSAVE_COLLECTION_STORAGE)
  if (Array.isArray(parsed)) {
    return parsed
      .map(normalizeAutosaveDocument)
      .filter((item): item is AutosaveDocument => !!item)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
  const legacy = readAutosave()
  return legacy ? [{ ...legacy, kind: "autosave", documentId: legacy.id }] : []
}

/** Async version that reads from IndexedDB first, falling back to localStorage. */
export async function readAutosavesAsync(): Promise<AutosaveDocument[]> {
  if (canUseIDB()) {
    try {
      const results = await readAutosavesIDB()
      if (results.length) return results
    } catch {}
  }
  return readAutosaves()
}

/**
 * Write autosaved documents. Writes to both IndexedDB (for large documents)
 * and localStorage (for fast synchronous recovery on next load).
 * IndexedDB has no practical size limit; localStorage is capped at ~5MB.
 * Resolves true when at least one backend accepted the write.
 */
export function writeAutosaves(entries: Array<Omit<AutosaveDocument, "id" | "kind" | "updatedAt"> & { id?: string; updatedAt?: number }>): Promise<boolean> {
  const payload: AutosaveDocument[] = entries
    .map((entry) => ({
      id: entry.id ?? `autosave_${entry.documentId}`,
      kind: "autosave" as const,
      documentId: entry.documentId,
      name: entry.name,
      serialized: entry.serialized,
      updatedAt: entry.updatedAt ?? Date.now(),
      fileName: entry.fileName,
      storage: entry.storage,
    }))

  // Write to IndexedDB (no size limit)
  const idbWrite = canUseIDB()
    ? writeAutosavesIDB(payload).then(() => true, () => false)
    : Promise.resolve(false)

  // Also write to localStorage (with size limit) as synchronous fallback.
  // On failure (quota, all entries oversized) keep the previous good
  // collection — IndexedDB may still hold the full payload.
  let storedLocally = false
  if (canUseStorage()) {
    try {
      const lsPayload = payload.filter((entry) => entry.serialized.length <= MAX_STORED_DOCUMENT_CHARS)
      if (lsPayload.length) {
        const collectionResult = writeClientStorageJson(AUTOSAVE_COLLECTION_STORAGE, lsPayload)
        const legacyResult = writeClientStorageJson(AUTOSAVE_STORAGE, lsPayload[0])
        if (collectionResult.ok || legacyResult.ok) storedLocally = true
      }
    } catch {}
  }

  return idbWrite.then((storedInIDB) => storedInIDB || storedLocally)
}

export function writeAutosave(entry: Omit<RecentDocument, "id" | "kind" | "updatedAt">) {
  if (!canUseStorage()) return
  try {
    if (entry.serialized.length > MAX_STORED_DOCUMENT_CHARS) {
      removeClientStorageItem(AUTOSAVE_STORAGE)
      return
    }
    const payload: RecentDocument = {
      id: "autosave",
      kind: "autosave",
      name: entry.name,
      serialized: entry.serialized,
      updatedAt: Date.now(),
    }
    writeClientStorageJson(AUTOSAVE_STORAGE, payload)
  } catch {
    removeClientStorageItem(AUTOSAVE_STORAGE)
  }
}

/** Clear autosave data from both IndexedDB and localStorage. */
export function clearAutosave() {
  if (canUseIDB()) {
    clearAutosaveIDB().catch(() => {})
  }
  if (!canUseStorage()) return
  removeClientStorageItem(AUTOSAVE_STORAGE)
  removeClientStorageItem(AUTOSAVE_COLLECTION_STORAGE)
}

/** Remove a single document's autosave from both IndexedDB and localStorage. */
export function removeAutosave(documentId: string) {
  if (canUseIDB()) {
    removeAutosaveIDB(documentId).catch(() => {})
  }
  if (!canUseStorage()) return
  try {
    const remaining = readAutosaves().filter((entry) => entry.documentId !== documentId)
    if (!remaining.length) {
      removeClientStorageItem(AUTOSAVE_COLLECTION_STORAGE)
      removeClientStorageItem(AUTOSAVE_STORAGE)
      return
    }
    writeClientStorageJson(AUTOSAVE_COLLECTION_STORAGE, remaining)
    writeClientStorageJson(AUTOSAVE_STORAGE, remaining[0])
  } catch {}
}

function hashString(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Recent-document thumbnails are rendered as `<img src={recent.thumbnail}>`
 * in the recent-documents dialog. localStorage / IndexedDB content is
 * untrusted (a malicious imported project can autosave a recent entry, an
 * extension can mutate storage, etc.), so we accept only base64-encoded
 * data URLs of known image MIME types and below a sane size. Anything
 * that fails the check is dropped — the dialog renders a folder icon
 * placeholder instead.
 */
const SAFE_THUMBNAIL_DATA_URL =
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i
const MAX_THUMBNAIL_CHARS = 200_000
const BIDI_AND_ZERO_WIDTH_CONTROLS = /[\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g

function safeThumbnail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (value.length === 0 || value.length > MAX_THUMBNAIL_CHARS) return undefined
  if (!SAFE_THUMBNAIL_DATA_URL.test(value)) return undefined
  return value
}

function safeRecentText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(BIDI_AND_ZERO_WIDTH_CONTROLS, "")
    .trim()
    .slice(0, maxLength)
}

function normalizeRecentDocument(value: unknown): RecentDocument | null {
  if (!value || typeof value !== "object") return null
  const item = value as Partial<RecentDocument> & { snapshot?: unknown }
  const serialized = typeof item.serialized === "string" ? item.serialized : typeof item.snapshot === "string" ? item.snapshot : undefined
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof serialized !== "string" ||
    typeof item.updatedAt !== "number" ||
    !Number.isFinite(item.updatedAt) ||
    !RECENT_KINDS.has(item.kind as RecentDocument["kind"])
  ) {
    return null
  }
  return {
    id: item.id.slice(0, 120),
    name: safeRecentText(item.name, 160) || "Untitled",
    kind: item.kind as RecentDocument["kind"],
    serialized,
    updatedAt: item.updatedAt,
    fileName: typeof item.fileName === "string" ? safeRecentText(item.fileName, 180) : undefined,
    storage: typeof item.storage === "string" ? item.storage as RecentDocument["storage"] : undefined,
    thumbnail: safeThumbnail((item as RecentDocument).thumbnail),
  }
}

function normalizeAutosaveDocument(value: unknown): AutosaveDocument | null {
  const recent = normalizeRecentDocument(value)
  if (!recent || recent.kind !== "autosave" || !value || typeof value !== "object") return null
  const documentId = (value as Partial<AutosaveDocument>).documentId
  if (typeof documentId !== "string" || !documentId.trim()) return null
  return {
    ...recent,
    kind: "autosave",
    documentId: documentId.slice(0, 120),
  }
}
