"use client"

import { emitRuntimeEvent } from "./runtime-telemetry"

export type StorageKind = "localStorage" | "sessionStorage" | "indexedDB" | "opfs"
export type StorageSensitivity = "preference" | "project-data" | "diagnostic"

export interface StorageResource {
  id: string
  kind: StorageKind
  name: string
  owner: string
  schemaVersion: number
  migrationVersions: readonly number[]
  quotaPolicy: string
  sensitivity: StorageSensitivity
  resettable: boolean
  exportable: boolean
}

function resource(input: Omit<StorageResource, "migrationVersions">): StorageResource {
  return Object.freeze({
    ...input,
    migrationVersions: Object.freeze([
      Math.max(0, input.schemaVersion - 2),
      Math.max(0, input.schemaVersion - 1),
      input.schemaVersion,
    ]),
  })
}

export const STORAGE_RESOURCES = {
  learningQuery: resource({
    id: "learning-query",
    kind: "sessionStorage",
    name: "ps-learning-index-query",
    owner: "learning-and-discover",
    schemaVersion: 2,
    quotaPolicy: "one bounded UTF-16 query, evicted at session end",
    sensitivity: "preference",
    resettable: true,
    exportable: false,
  }),
  recentDocuments: resource({
    id: "recent-documents",
    kind: "indexedDB",
    name: "ps-autosave-db",
    owner: "document-recovery",
    schemaVersion: 2,
    quotaPolicy: "bounded recent/autosave collection with localStorage fallback",
    sensitivity: "project-data",
    resettable: true,
    exportable: true,
  }),
  libraries: resource({
    id: "libraries",
    kind: "indexedDB",
    name: "ps-libraries",
    owner: "libraries-panel",
    schemaVersion: 2,
    quotaPolicy: "user-managed assets; reject writes on quota exhaustion",
    sensitivity: "project-data",
    resettable: true,
    exportable: true,
  }),
  startupHandoff: resource({
    id: "startup-handoff",
    kind: "indexedDB",
    name: "ps-startup-file-handoff",
    owner: "startup-file-handoff",
    schemaVersion: 2,
    quotaPolicy: "temporary records deleted after successful import",
    sensitivity: "project-data",
    resettable: true,
    exportable: false,
  }),
  assetDirectories: resource({
    id: "asset-directories",
    kind: "indexedDB",
    name: "ps-image-assets-generator",
    owner: "image-assets-generator",
    schemaVersion: 2,
    quotaPolicy: "one structured-clone directory handle per document",
    sensitivity: "project-data",
    resettable: true,
    exportable: false,
  }),
  scratch: resource({
    id: "scratch",
    kind: "opfs",
    name: "ps-scratch",
    owner: "scratch-storage",
    schemaVersion: 2,
    quotaPolicy: "reserve 15 percent of origin quota and evict scratch artifacts first",
    sensitivity: "project-data",
    resettable: true,
    exportable: false,
  }),
} as const

export function getStorageResourceRegistry(): StorageResource[] {
  return Object.values(STORAGE_RESOURCES)
}

export interface VersionedStoragePayload<T> {
  schemaVersion: number
  payload: T
}

export function migrateRegisteredPayload<T>(
  descriptor: StorageResource,
  stored: VersionedStoragePayload<T>,
  migrate: (payload: T, fromVersion: number, toVersion: number) => T,
): VersionedStoragePayload<T> | null {
  if (!descriptor.migrationVersions.includes(stored.schemaVersion)) return null
  let payload = stored.payload
  for (let version = stored.schemaVersion; version < descriptor.schemaVersion; version++) {
    payload = migrate(payload, version, version + 1)
  }
  return { schemaVersion: descriptor.schemaVersion, payload }
}

export async function writeWithRegisteredQuotaRecovery<T>(
  descriptor: StorageResource,
  write: () => Promise<T>,
  evict: () => Promise<void>,
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error
    emitRuntimeEvent("storage-failure", {
      component: descriptor.id,
      operation: "write",
      reason: "quota",
      recoverable: true,
    })
    await evict()
    return write()
  }
}

export async function runRegisteredAtomicTransaction<T>(
  operation: () => Promise<T>,
  controls: { commit: () => void; abort: () => void },
): Promise<T> {
  try {
    const value = await operation()
    controls.commit()
    return value
  } catch (error) {
    controls.abort()
    throw error
  }
}

export function openRegisteredIndexedDB(
  descriptor: StorageResource,
): IDBOpenDBRequest {
  if (descriptor.kind !== "indexedDB") {
    throw new Error(`${descriptor.id} is not an IndexedDB resource.`)
  }
  return indexedDB.open(descriptor.name, descriptor.schemaVersion)
}

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readRegisteredSessionString(
  descriptor: StorageResource,
): string | null {
  if (descriptor.kind !== "sessionStorage") {
    throw new Error(`${descriptor.id} is not a sessionStorage resource.`)
  }
  try {
    return browserSessionStorage()?.getItem(descriptor.name) ?? null
  } catch {
    return null
  }
}

export function writeRegisteredSessionString(
  descriptor: StorageResource,
  value: string,
): boolean {
  if (descriptor.kind !== "sessionStorage") {
    throw new Error(`${descriptor.id} is not a sessionStorage resource.`)
  }
  try {
    const storage = browserSessionStorage()
    if (!storage) return false
    storage.setItem(descriptor.name, value.slice(0, 500))
    return true
  } catch {
    return false
  }
}

export async function openRegisteredOpfsRoot<T>(
  descriptor: StorageResource,
  storageManager: { getDirectory?: () => Promise<T> },
): Promise<T | null> {
  if (descriptor.kind !== "opfs") throw new Error(`${descriptor.id} is not an OPFS resource.`)
  if (!storageManager.getDirectory) return null
  return storageManager.getDirectory()
}
