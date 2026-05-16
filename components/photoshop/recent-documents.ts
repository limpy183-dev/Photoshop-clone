"use client"

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

/* Track whether IndexedDB is the current source */
let _idbAvailable: boolean | null = null
function canUseIDB() {
  if (_idbAvailable === null) _idbAvailable = isIndexedDBAvailable()
  return _idbAvailable
}

/* =================== localStorage helpers =================== */

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function readRecentDocuments(): RecentDocument[] {
  if (!canUseStorage()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeRecentDocument)
      .filter((item): item is RecentDocument => !!item)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export function rememberRecentDocument(entry: Omit<RecentDocument, "id" | "updatedAt"> & { id?: string; updatedAt?: number; thumbnail?: string }) {
  if (!canUseStorage()) return
  try {
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
      thumbnail: entry.thumbnail,
    }
    const recents = readRecentDocuments().filter((item) => item.id !== id && item.name !== next.name)
    localStorage.setItem(RECENTS_KEY, JSON.stringify([next, ...recents].slice(0, MAX_RECENTS)))
    window.dispatchEvent(new CustomEvent("ps-recents-changed"))
  } catch {
    pruneRecentDocuments()
  }
}

export function removeRecentDocument(id: string) {
  if (!canUseStorage()) return
  localStorage.setItem(RECENTS_KEY, JSON.stringify(readRecentDocuments().filter((item) => item.id !== id)))
  window.dispatchEvent(new CustomEvent("ps-recents-changed"))
}

export function pruneRecentDocuments() {
  if (!canUseStorage()) return
  try {
    const recents = readRecentDocuments().slice(0, Math.max(1, Math.floor(MAX_RECENTS / 2)))
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
  } catch { }
}

export function readAutosave(): RecentDocument | null {
  if (!canUseStorage()) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null")
    return normalizeRecentDocument(parsed)
  } catch {
    return null
  }
}

/**
 * Read autosaved documents. Prefers IndexedDB (much larger capacity) and
 * falls back to localStorage for compatibility.
 */
export function readAutosaves(): AutosaveDocument[] {
  // Try IndexedDB asynchronously — for the synchronous API we still read localStorage as a baseline.
  // Callers that need the IDB data can use readAutosavesAsync().
  if (!canUseStorage()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTOSAVE_COLLECTION_KEY) ?? "[]")
    if (Array.isArray(parsed)) {
      return parsed
        .map(normalizeAutosaveDocument)
        .filter((item): item is AutosaveDocument => !!item)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }
  } catch {}
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
 */
export function writeAutosaves(entries: Array<Omit<AutosaveDocument, "id" | "kind" | "updatedAt"> & { id?: string; updatedAt?: number }>) {
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
  if (canUseIDB()) {
    writeAutosavesIDB(payload).catch(() => {})
  }

  // Also write to localStorage (with size limit) as synchronous fallback
  if (!canUseStorage()) return
  try {
    const lsPayload = payload.filter((entry) => entry.serialized.length <= MAX_STORED_DOCUMENT_CHARS)
    if (!lsPayload.length) {
      localStorage.removeItem(AUTOSAVE_COLLECTION_KEY)
      localStorage.removeItem(AUTOSAVE_KEY)
      return
    }
    localStorage.setItem(AUTOSAVE_COLLECTION_KEY, JSON.stringify(lsPayload))
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(lsPayload[0]))
  } catch {
    localStorage.removeItem(AUTOSAVE_COLLECTION_KEY)
  }
}

export function writeAutosave(entry: Omit<RecentDocument, "id" | "kind" | "updatedAt">) {
  if (!canUseStorage()) return
  try {
    if (entry.serialized.length > MAX_STORED_DOCUMENT_CHARS) {
      localStorage.removeItem(AUTOSAVE_KEY)
      return
    }
    const payload: RecentDocument = {
      id: "autosave",
      kind: "autosave",
      name: entry.name,
      serialized: entry.serialized,
      updatedAt: Date.now(),
    }
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload))
  } catch {
    localStorage.removeItem(AUTOSAVE_KEY)
  }
}

/** Clear autosave data from both IndexedDB and localStorage. */
export function clearAutosave() {
  if (canUseIDB()) {
    clearAutosaveIDB().catch(() => {})
  }
  if (!canUseStorage()) return
  localStorage.removeItem(AUTOSAVE_KEY)
  localStorage.removeItem(AUTOSAVE_COLLECTION_KEY)
}

function hashString(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
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
    name: item.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160) || "Untitled",
    kind: item.kind as RecentDocument["kind"],
    serialized,
    updatedAt: item.updatedAt,
    fileName: typeof item.fileName === "string" ? item.fileName.slice(0, 180) : undefined,
    storage: typeof item.storage === "string" ? item.storage as RecentDocument["storage"] : undefined,
    thumbnail: typeof (item as RecentDocument).thumbnail === "string" ? (item as RecentDocument).thumbnail : undefined,
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
