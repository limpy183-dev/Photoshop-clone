"use client"

import { openRegisteredIndexedDB, STORAGE_RESOURCES } from "./storage-registry"

const STORE_NAME = "imports"

export const STARTUP_IMAGE_IMPORT_PARAM = "startupImport"

type StartupImportRecord = {
  id: string
  name: string
  type: string
  lastModified: number
  createdAt: number
  blob: Blob
}

function canUseIndexedDB() {
  try {
    return typeof window !== "undefined" && typeof window.indexedDB !== "undefined" && !!window.indexedDB
  } catch {
    return false
  }
}

function openStartupImportDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDB()) {
      reject(new Error("Browser storage is not available for image handoff."))
      return
    }
    const request = openRegisteredIndexedDB(STORAGE_RESOURCES.startupHandoff)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open image handoff storage."))
  })
}

function makeStartupImportId() {
  return `image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function isSafeStartupImportId(id: string) {
  return /^[a-z0-9_-]{1,120}$/i.test(id)
}

export async function writeStartupImageImport(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.")
  const db = await openStartupImportDB()
  const id = makeStartupImportId()
  const record: StartupImportRecord = {
    id,
    name: file.name || "Imported image",
    type: file.type,
    lastModified: file.lastModified || Date.now(),
    createdAt: Date.now(),
    blob: file,
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    store.put(record)
    tx.oncomplete = () => {
      db.close()
      resolve(id)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error("Could not store the selected image."))
    }
  })
}

export async function deleteStartupImageImport(id: string) {
  if (!isSafeStartupImportId(id)) return
  const db = await openStartupImportDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error("Could not clear image handoff storage."))
    }
  })
}

export async function readStartupImageImport(id: string): Promise<File | null> {
  if (!isSafeStartupImportId(id)) return null
  const db = await openStartupImportDB()
  const record = await new Promise<StartupImportRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve(request.result as StartupImportRecord | undefined)
    request.onerror = () => reject(request.error ?? new Error("Could not read the selected image."))
    tx.oncomplete = () => db.close()
  })
  if (!record) return null
  return new File([record.blob], record.name, {
    type: record.type,
    lastModified: record.lastModified,
  })
}
