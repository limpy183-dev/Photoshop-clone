/**
 * OPFS scratch storage.
 *
 * Wraps the Origin Private File System for scratch artifacts that should
 * outlive a single browser tab but stay sandboxed to the origin: tile
 * spill-over, incremental autosave deltas, transient large blobs.
 *
 * The module exposes a small async key/value API with sync-friendly
 * planners that other modules can unit-test without a real runtime.
 * Where OPFS is unavailable (Safari + Worker contexts where the API was
 * not exposed, older browsers, SSR) the runtime falls back to an
 * in-memory Map so callers do not need a separate code path.
 */

const SCRATCH_ROOT = "ps-scratch"
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
const QUOTA_RESERVE_RATIO = 0.1
const KEY_PATTERN = /^[a-zA-Z0-9._-]{1,160}$/

export interface ScratchQuotaSnapshot {
  usage: number
  quota: number
  available: number
  reserveBytes: number
}

export interface ScratchStoragePlanInput {
  pendingWriteBytes: number
  currentUsageBytes: number
  quotaBytes: number
  maxScratchBytes?: number
  reserveRatio?: number
}

export interface ScratchStoragePlan {
  strategy: "persist" | "in-memory-fallback" | "reject"
  reason:
    | "ok"
    | "quota-exhausted"
    | "exceeds-scratch-budget"
    | "reserve-exhausted"
    | "no-quota-data"
  projectedUsageBytes: number
  effectiveLimitBytes: number
}

function positiveNumber(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(0, next)
}

export function planScratchStorage(input: ScratchStoragePlanInput): ScratchStoragePlan {
  const pending = positiveNumber(input.pendingWriteBytes, 0)
  const current = positiveNumber(input.currentUsageBytes, 0)
  const quota = positiveNumber(input.quotaBytes, 0)
  const reserveRatio = Math.max(0, Math.min(0.9, input.reserveRatio ?? QUOTA_RESERVE_RATIO))
  const maxScratchBytes = positiveNumber(input.maxScratchBytes, DEFAULT_MAX_BYTES)
  const projectedUsageBytes = pending + current

  if (quota <= 0) {
    return {
      strategy: "in-memory-fallback",
      reason: "no-quota-data",
      projectedUsageBytes,
      effectiveLimitBytes: maxScratchBytes,
    }
  }

  const reserveBytes = Math.floor(quota * reserveRatio)
  const effectiveLimitBytes = Math.min(maxScratchBytes, Math.max(0, quota - reserveBytes))

  if (effectiveLimitBytes <= 0) {
    return { strategy: "reject", reason: "reserve-exhausted", projectedUsageBytes, effectiveLimitBytes }
  }
  if (projectedUsageBytes > quota) {
    return { strategy: "reject", reason: "quota-exhausted", projectedUsageBytes, effectiveLimitBytes }
  }
  if (projectedUsageBytes > effectiveLimitBytes) {
    return {
      strategy: "in-memory-fallback",
      reason: "exceeds-scratch-budget",
      projectedUsageBytes,
      effectiveLimitBytes,
    }
  }

  return { strategy: "persist", reason: "ok", projectedUsageBytes, effectiveLimitBytes }
}

export function isValidScratchKey(key: unknown): key is string {
  return typeof key === "string" && KEY_PATTERN.test(key)
}

export function assertValidScratchKey(key: unknown): asserts key is string {
  if (!isValidScratchKey(key)) {
    throw new Error("OPFS scratch key must be 1-160 chars of [a-zA-Z0-9._-]")
  }
}

interface OPFSDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OPFSFileHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  values(): AsyncIterableIterator<{ kind: string; name: string }>
}

interface OPFSFileHandleLike {
  name: string
  createWritable(): Promise<{
    write(data: Blob | BufferSource | string): Promise<void>
    close(): Promise<void>
  }>
  getFile(): Promise<Blob>
}

type StorageManagerLike = {
  getDirectory?: () => Promise<OPFSDirectoryHandleLike>
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

function getStorageManager(): StorageManagerLike | null {
  if (typeof navigator === "undefined") return null
  const sm = (navigator as unknown as { storage?: StorageManagerLike }).storage
  return sm ?? null
}

export function isOPFSSupported(): boolean {
  const sm = getStorageManager()
  return !!sm && typeof sm.getDirectory === "function"
}

let _scratchDir: Promise<OPFSDirectoryHandleLike | null> | null = null
const _memoryFallback = new Map<string, Blob>()

async function getScratchDir(): Promise<OPFSDirectoryHandleLike | null> {
  if (_scratchDir) return _scratchDir
  const sm = getStorageManager()
  if (!sm?.getDirectory) {
    _scratchDir = Promise.resolve(null)
    return _scratchDir
  }
  _scratchDir = (async () => {
    try {
      const root = await openRegisteredOpfsRoot(STORAGE_RESOURCES.scratch, sm)
      if (!root) return null
      const dirHandle = (root as unknown as {
        getDirectoryHandle?: (name: string, options?: { create?: boolean }) => Promise<OPFSDirectoryHandleLike>
      }).getDirectoryHandle
      if (typeof dirHandle === "function") {
        return await dirHandle.call(root, SCRATCH_ROOT, { create: true })
      }
      return root
    } catch {
      return null
    }
  })()
  return _scratchDir
}

export async function estimateScratchQuota(): Promise<ScratchQuotaSnapshot | null> {
  const sm = getStorageManager()
  if (!sm?.estimate) return null
  try {
    const result = await sm.estimate()
    const usage = positiveNumber(result.usage, 0)
    const quota = positiveNumber(result.quota, 0)
    const reserveBytes = Math.floor(quota * QUOTA_RESERVE_RATIO)
    return {
      usage,
      quota,
      available: Math.max(0, quota - usage - reserveBytes),
      reserveBytes,
    }
  } catch {
    return null
  }
}

export async function writeScratchBlob(key: string, blob: Blob): Promise<"persisted" | "in-memory"> {
  assertValidScratchKey(key)
  const dir = await getScratchDir()
  if (!dir) {
    _memoryFallback.set(key, blob)
    return "in-memory"
  }
  try {
    await writeWithRegisteredQuotaRecovery(
      STORAGE_RESOURCES.scratch,
      async () => {
        const fileHandle = await dir.getFileHandle(key, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
      },
      clearScratchDirectory,
    )
    _memoryFallback.delete(key)
    return "persisted"
  } catch {
    _memoryFallback.set(key, blob)
    return "in-memory"
  }
}

export async function readScratchBlob(key: string): Promise<Blob | null> {
  assertValidScratchKey(key)
  const fallback = _memoryFallback.get(key)
  if (fallback) return fallback
  const dir = await getScratchDir()
  if (!dir) return null
  try {
    const fileHandle = await dir.getFileHandle(key, { create: false })
    return await fileHandle.getFile()
  } catch {
    return null
  }
}

export async function deleteScratchKey(key: string): Promise<void> {
  assertValidScratchKey(key)
  _memoryFallback.delete(key)
  const dir = await getScratchDir()
  if (!dir) return
  try {
    await dir.removeEntry(key)
  } catch {
    // best effort
  }
}

export async function listScratchKeys(): Promise<string[]> {
  const dir = await getScratchDir()
  if (!dir) return [..._memoryFallback.keys()]
  const keys: string[] = []
  try {
    for await (const entry of dir.values()) {
      if (entry.kind === "file" && isValidScratchKey(entry.name)) keys.push(entry.name)
    }
  } catch {
    return [..._memoryFallback.keys()]
  }
  for (const key of _memoryFallback.keys()) {
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

export async function clearScratchDirectory(): Promise<void> {
  _memoryFallback.clear()
  const dir = await getScratchDir()
  if (!dir) return
  const removable: string[] = []
  try {
    for await (const entry of dir.values()) {
      if (entry.kind === "file" && isValidScratchKey(entry.name)) removable.push(entry.name)
    }
  } catch {
    return
  }
  await Promise.all(
    removable.map((name) =>
      dir.removeEntry(name).catch(() => {
        // best effort cleanup
      }),
    ),
  )
}

/**
 * Test seam: reset the cached directory handle and in-memory fallback so
 * tests can call this between runs. Production code should not need this.
 */
export function _resetScratchStateForTests(): void {
  _scratchDir = null
  _memoryFallback.clear()
}
import {
  openRegisteredOpfsRoot,
  STORAGE_RESOURCES,
  writeWithRegisteredQuotaRecovery,
} from "./storage-registry"
