/**
 * Incremental (differential) autosave.
 *
 * Rather than serializing the whole document on every tick, the planner
 * compares per-layer fingerprints against the last persisted snapshot
 * and produces a delta — only the changed layers get re-serialized. The
 * base snapshot is rebuilt periodically or when the diff chain grows
 * too long, so a recovery never has to replay an unbounded number of
 * deltas.
 *
 * Persistence is layered:
 *  - small documents stay in IndexedDB / localStorage as a single blob.
 *  - large documents persist the base snapshot in OPFS and each delta
 *    as a separate scratch blob, keyed by document id + revision.
 *
 * Pure planner functions are exported so unit tests can verify
 * decisions without a real runtime.
 */

import { writeScratchBlob, readScratchBlob, deleteScratchKey } from "./opfs-scratch"

const DEFAULT_BASE_INTERVAL = 8
const DEFAULT_MAX_CHAIN_BYTES = 12 * 1024 * 1024
const DEFAULT_INLINE_THRESHOLD = 256 * 1024

export interface IncrementalLayerSnapshot {
  id: string
  /** A monotonic version counter the editor bumps on edit. */
  version: number
  /** Optional fingerprint (content hash) of the layer payload. Two
   *  layers with the same version + fingerprint are considered
   *  unchanged. */
  fingerprint?: string
  /** Serialized payload. */
  serialized: string
}

export interface IncrementalAutosaveBase {
  documentId: string
  documentVersion: number
  createdAt: number
  layers: IncrementalLayerSnapshot[]
}

export interface IncrementalAutosaveDelta {
  documentId: string
  documentVersion: number
  baseVersion: number
  baseSequence: number
  sequence: number
  createdAt: number
  changedLayers: IncrementalLayerSnapshot[]
  removedLayerIds: string[]
}

export interface IncrementalAutosavePlanInput {
  documentId: string
  documentVersion: number
  layers: IncrementalLayerSnapshot[]
  base?: IncrementalAutosaveBase | null
  pendingDeltas?: IncrementalAutosaveDelta[]
  baseInterval?: number
  maxChainBytes?: number
}

export type IncrementalAutosaveStrategy = "skip" | "delta" | "rebase"

export interface IncrementalAutosavePlan {
  strategy: IncrementalAutosaveStrategy
  reason:
    | "no-change"
    | "no-base"
    | "delta-applicable"
    | "delta-chain-too-long"
    | "delta-chain-too-large"
    | "document-version-stale"
  changedLayerIds: string[]
  removedLayerIds: string[]
  estimatedDeltaBytes: number
  nextSequence: number
}

function serializedLength(layers: readonly IncrementalLayerSnapshot[]) {
  let total = 0
  for (const layer of layers) total += layer.serialized.length
  return total
}

function deltaBytes(delta: IncrementalAutosaveDelta) {
  return serializedLength(delta.changedLayers)
}

export function planIncrementalAutosave(input: IncrementalAutosavePlanInput): IncrementalAutosavePlan {
  const base = input.base ?? null
  const pending = input.pendingDeltas ?? []
  const baseInterval = Math.max(1, Math.round(input.baseInterval ?? DEFAULT_BASE_INTERVAL))
  const maxChainBytes = Math.max(1024, Math.round(input.maxChainBytes ?? DEFAULT_MAX_CHAIN_BYTES))
  const nextSequence = (pending[pending.length - 1]?.sequence ?? 0) + 1

  if (!base) {
    return {
      strategy: "rebase",
      reason: "no-base",
      changedLayerIds: input.layers.map((layer) => layer.id),
      removedLayerIds: [],
      estimatedDeltaBytes: serializedLength(input.layers),
      nextSequence: 1,
    }
  }

  if (input.documentVersion < base.documentVersion) {
    return {
      strategy: "rebase",
      reason: "document-version-stale",
      changedLayerIds: input.layers.map((layer) => layer.id),
      removedLayerIds: [],
      estimatedDeltaBytes: serializedLength(input.layers),
      nextSequence: 1,
    }
  }

  const baseLayers = new Map(base.layers.map((layer) => [layer.id, layer]))
  for (const delta of pending) {
    for (const layer of delta.changedLayers) baseLayers.set(layer.id, layer)
    for (const id of delta.removedLayerIds) baseLayers.delete(id)
  }

  const incomingIds = new Set(input.layers.map((layer) => layer.id))
  const changed: IncrementalLayerSnapshot[] = []
  for (const layer of input.layers) {
    const previous = baseLayers.get(layer.id)
    if (!previous) {
      changed.push(layer)
      continue
    }
    if (previous.version !== layer.version) {
      changed.push(layer)
      continue
    }
    if (layer.fingerprint && previous.fingerprint && layer.fingerprint !== previous.fingerprint) {
      changed.push(layer)
      continue
    }
  }
  const removed: string[] = []
  for (const id of baseLayers.keys()) {
    if (!incomingIds.has(id)) removed.push(id)
  }

  if (!changed.length && !removed.length) {
    return {
      strategy: "skip",
      reason: "no-change",
      changedLayerIds: [],
      removedLayerIds: [],
      estimatedDeltaBytes: 0,
      nextSequence,
    }
  }

  if (pending.length >= baseInterval) {
    return {
      strategy: "rebase",
      reason: "delta-chain-too-long",
      changedLayerIds: changed.map((layer) => layer.id),
      removedLayerIds: removed,
      estimatedDeltaBytes: serializedLength(changed),
      nextSequence: 1,
    }
  }

  const projectedChainBytes = pending.reduce((acc, delta) => acc + deltaBytes(delta), 0) + serializedLength(changed)
  if (projectedChainBytes > maxChainBytes) {
    return {
      strategy: "rebase",
      reason: "delta-chain-too-large",
      changedLayerIds: changed.map((layer) => layer.id),
      removedLayerIds: removed,
      estimatedDeltaBytes: serializedLength(changed),
      nextSequence: 1,
    }
  }

  return {
    strategy: "delta",
    reason: "delta-applicable",
    changedLayerIds: changed.map((layer) => layer.id),
    removedLayerIds: removed,
    estimatedDeltaBytes: serializedLength(changed),
    nextSequence,
  }
}

/**
 * Apply a list of deltas on top of a base snapshot, producing the most
 * recent full layer list. Mirrors the planner's bookkeeping so a
 * recovery flow can rebuild state deterministically.
 */
export function applyIncrementalDeltas(
  base: IncrementalAutosaveBase,
  deltas: readonly IncrementalAutosaveDelta[],
): IncrementalLayerSnapshot[] {
  const byId = new Map(base.layers.map((layer) => [layer.id, layer]))
  for (const delta of deltas) {
    for (const layer of delta.changedLayers) byId.set(layer.id, layer)
    for (const id of delta.removedLayerIds) byId.delete(id)
  }
  return [...byId.values()]
}

export interface IncrementalAutosavePersistence {
  /** Write a base snapshot for the document. */
  saveBase(base: IncrementalAutosaveBase): Promise<void>
  /** Append a delta on top of the current base. */
  saveDelta(delta: IncrementalAutosaveDelta): Promise<void>
  /** Read the base snapshot and all pending deltas, sorted ascending. */
  load(documentId: string): Promise<{ base: IncrementalAutosaveBase | null; deltas: IncrementalAutosaveDelta[] }>
  /** Drop the base and all deltas for a document. */
  clear(documentId: string): Promise<void>
}

export interface NearIdenticalDeltaOptions {
  similarityThreshold?: number
}

export interface AutosaveCompactionOptions extends NearIdenticalDeltaOptions {
  maxDeltas?: number
}

export interface AutosaveCompactionResult {
  compacted: boolean
  reason: "already-compact" | "near-identical-deltas" | "chain-too-long"
  base: IncrementalAutosaveBase
  deltas: IncrementalAutosaveDelta[]
}

const BASE_KEY_PREFIX = "autosave-base-"
const DELTA_KEY_PREFIX = "autosave-delta-"

function baseKey(documentId: string) {
  return `${BASE_KEY_PREFIX}${documentId}`
}

function deltaKey(documentId: string, sequence: number) {
  return `${DELTA_KEY_PREFIX}${documentId}-${String(sequence).padStart(6, "0")}`
}

function stringSimilarity(a: string, b: string) {
  if (a === b) return 1
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  const min = Math.min(a.length, b.length)
  let same = 0
  for (let i = 0; i < min; i++) {
    if (a.charCodeAt(i) === b.charCodeAt(i)) same += 1
  }
  return same / max
}

function sameRemovedIds(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((item, index) => item === sortedB[index])
}

function nearIdenticalLayers(
  a: readonly IncrementalLayerSnapshot[],
  b: readonly IncrementalLayerSnapshot[],
  threshold: number,
) {
  if (a.length !== b.length) return false
  const byId = new Map(a.map((layer) => [layer.id, layer]))
  for (const next of b) {
    const previous = byId.get(next.id)
    if (!previous) return false
    if (previous.fingerprint && next.fingerprint && previous.fingerprint === next.fingerprint) continue
    if (stringSimilarity(previous.serialized, next.serialized) < threshold) return false
  }
  return true
}

export function mergeNearIdenticalDeltas(
  deltas: readonly IncrementalAutosaveDelta[],
  options: NearIdenticalDeltaOptions = {},
): IncrementalAutosaveDelta[] {
  const threshold = Math.max(0, Math.min(1, options.similarityThreshold ?? 0.96))
  const merged: IncrementalAutosaveDelta[] = []
  for (const delta of deltas) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.documentId === delta.documentId &&
      sameRemovedIds(previous.removedLayerIds, delta.removedLayerIds) &&
      nearIdenticalLayers(previous.changedLayers, delta.changedLayers, threshold)
    ) {
      merged[merged.length - 1] = delta
    } else {
      merged.push(delta)
    }
  }
  return merged
}

export function compactIncrementalAutosaveChain(
  base: IncrementalAutosaveBase,
  deltas: readonly IncrementalAutosaveDelta[],
  options: AutosaveCompactionOptions = {},
): AutosaveCompactionResult {
  const maxDeltas = Math.max(1, Math.round(options.maxDeltas ?? 4))
  const merged = mergeNearIdenticalDeltas(deltas, options)
  const shouldCompact = merged.length !== deltas.length || merged.length > maxDeltas
  if (!shouldCompact) {
    return { compacted: false, reason: "already-compact", base, deltas: [...merged] }
  }
  const last = deltas[deltas.length - 1]
  const nextBase: IncrementalAutosaveBase = {
    ...base,
    documentVersion: last?.documentVersion ?? base.documentVersion,
    createdAt: Date.now(),
    layers: applyIncrementalDeltas(base, deltas),
  }
  return {
    compacted: true,
    reason: merged.length !== deltas.length ? "near-identical-deltas" : "chain-too-long",
    base: nextBase,
    deltas: [],
  }
}

async function blobToJson<T>(blob: Blob): Promise<T> {
  if (blob.type === "application/json+gzip" && typeof DecompressionStream !== "undefined") {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"))
    return JSON.parse(await new Response(stream).text()) as T
  }
  return JSON.parse(await blob.text()) as T
}

export async function compressAutosaveDelta(delta: IncrementalAutosaveDelta): Promise<Blob> {
  const json = JSON.stringify(delta)
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([json], { type: "application/json" }).stream().pipeThrough(new CompressionStream("gzip"))
    const compressed = await new Response(stream).arrayBuffer()
    return new Blob([compressed], { type: "application/json+gzip" })
  }
  return new Blob([json], { type: "application/json" })
}

export async function runIncrementalAutosaveCompaction(
  persistence: IncrementalAutosavePersistence,
  documentId: string,
  options: AutosaveCompactionOptions = {},
): Promise<AutosaveCompactionResult | null> {
  const loaded = await persistence.load(documentId)
  if (!loaded.base) return null
  const compacted = compactIncrementalAutosaveChain(loaded.base, loaded.deltas, options)
  if (!compacted.compacted) return compacted
  await persistence.clear(documentId)
  await persistence.saveBase(compacted.base)
  for (const delta of compacted.deltas) await persistence.saveDelta(delta)
  return compacted
}

export interface ScheduledAutosaveCompaction<T> {
  result: Promise<T | "cancelled">
  cancel(): void
}

export function scheduleIncrementalAutosaveCompaction<T>(
  task: () => T | Promise<T>,
  options: {
    requestIdle?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
    cancelIdle?: (id: number) => void
    timeoutMs?: number
  } = {},
): ScheduledAutosaveCompaction<T> {
  const requestIdle =
    options.requestIdle ??
    ((callback: IdleRequestCallback) => {
      const id = setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0)
      return Number(id)
    })
  const cancelIdle = options.cancelIdle ?? ((id: number) => clearTimeout(id))
  let pending = true
  let idleId: number | null = null
  let resolveResult: (value: T | "cancelled") => void = () => {}
  const result = new Promise<T | "cancelled">((resolve) => {
    resolveResult = resolve
  })
  idleId = requestIdle(async () => {
    pending = false
    idleId = null
    resolveResult(await task())
  }, { timeout: options.timeoutMs ?? 2_000 })

  return {
    result,
    cancel() {
      if (!pending) return
      pending = false
      if (idleId !== null) cancelIdle(idleId)
      idleId = null
      resolveResult("cancelled")
    },
  }
}

export function createOPFSAutosavePersistence(): IncrementalAutosavePersistence {
  return {
    async saveBase(base) {
      const blob = new Blob([JSON.stringify(base)], { type: "application/json" })
      await writeScratchBlob(baseKey(base.documentId), blob)
    },
    async saveDelta(delta) {
      const blob = await compressAutosaveDelta(delta)
      await writeScratchBlob(deltaKey(delta.documentId, delta.sequence), blob)
    },
    async load(documentId) {
      const baseBlob = await readScratchBlob(baseKey(documentId))
      const base = baseBlob ? (JSON.parse(await baseBlob.text()) as IncrementalAutosaveBase) : null
      const deltas: IncrementalAutosaveDelta[] = []
      if (base) {
        // Look up to 999 deltas; well above what the planner allows.
        for (let sequence = 1; sequence < 1000; sequence++) {
          const blob = await readScratchBlob(deltaKey(documentId, sequence))
          if (!blob) break
          deltas.push(await blobToJson<IncrementalAutosaveDelta>(blob))
        }
      }
      return { base, deltas }
    },
    async clear(documentId) {
      await deleteScratchKey(baseKey(documentId))
      for (let sequence = 1; sequence < 1000; sequence++) {
        const key = deltaKey(documentId, sequence)
        const blob = await readScratchBlob(key)
        if (!blob) break
        await deleteScratchKey(key)
      }
    },
  }
}

/**
 * Decide whether the chunk should be inlined (small) or persisted to
 * scratch (large). Keeps small writes out of OPFS so they stay fast.
 */
export function shouldInlineAutosaveChunk(byteLength: number, threshold = DEFAULT_INLINE_THRESHOLD) {
  return byteLength <= Math.max(0, threshold)
}
