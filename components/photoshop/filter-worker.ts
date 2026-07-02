/**
 * Async filter execution helpers.
 *
 * Browser-local filters run in a module worker with transferable pixel buffers.
 * A small inline worker remains as a fallback for older bundlers that cannot
 * construct the registry worker; filters needing extra document/layer context
 * stay on the main thread because their inputs are not a single ImageData.
 */

import { FILTERS, getFilter } from "./filters"
import { workerSource } from "./filter-worker-source"
import { planTileGrid } from "./performance-engine"
import { emitRuntimeEvent } from "./runtime-telemetry"

export interface FilterBatchOperation {
  filterId: string
  params: Record<string, number | string | boolean>
}

export interface FilterProgressEvent {
  completed: number
  total: number
  filterId: string
}

interface FilterWorkerRequest {
  id: number
  filterId?: string
  operations?: FilterBatchOperation[]
  width: number
  height: number
  buffer: ArrayBuffer
  params: Record<string, number | string | boolean>
}

interface FilterWorkerResponse {
  id: number
  width: number
  height: number
  buffer?: ArrayBuffer
  error?: string
  progress?: FilterProgressEvent
}

let _worker: Worker | null = null
let _workerKind: "registry" | "inline" | null = null
let _workerFailed = false
let _registryWorkerUnavailable = false
let _inlineWorkerUnavailable = false
let _nextId = 0
const _pending = new Map<number, {
  resolve: (data: ImageData) => void
  reject: (err: Error) => void
  progress?: (event: FilterProgressEvent) => void
}>()

const CONTEXT_REQUIRED_FILTERS = new Set([
  "match-color",
  "apply-image",
  "calculations",
])

const INLINE_WORKER_SUPPORTED_FILTERS = [
  "invert",
  "grayscale",
  "desaturate",
  "sepia",
  "threshold",
  "posterize",
  "exposure",
  "brightness-contrast",
  "gaussian-blur",
  "box-blur",
  "motion-blur",
  "sharpen",
  "unsharp-mask",
  "noise",
  "ripple",
  "clouds",
  "difference-clouds",
  "fibers",
  "radial-blur",
  "surface-blur",
  "lens-blur",
  "oil-paint",
  "high-pass",
  "offset",
  "custom-convolution",
  "custom-filter",
  "lighting-effects",
  "field-blur",
  "iris-blur",
  "tilt-shift",
  "path-blur",
  "spin-blur",
] as const

type WorkerSupportedFilter = string

const INLINE_WORKER_FILTER_SET = new Set<string>(INLINE_WORKER_SUPPORTED_FILTERS)
const WORKER_FILTER_SET = new Set<string>(getWorkerSupportedFilterIds())

export function getWorkerSupportedFilterIds() {
  return Object.keys(FILTERS)
    .filter((filterId) => !CONTEXT_REQUIRED_FILTERS.has(filterId))
    .sort()
}

export function isFilterWorkerSupported(filterId: string): filterId is WorkerSupportedFilter {
  return WORKER_FILTER_SET.has(filterId)
}

export function getFilterWorkerSupport() {
  return {
    strategy: "registry-module-worker-for-context-free-filters-with-context-main-thread-fallback",
    supportedFilters: getWorkerSupportedFilterIds(),
  }
}

export function getInlineFilterWorkerSupport() {
  return {
    strategy: "inline-worker-fallback-for-bundler-compatibility",
    supportedFilters: [...INLINE_WORKER_SUPPORTED_FILTERS].sort(),
  }
}

export type FilterWorkerAuditStrategy = "worker" | "main-thread-typed-array" | "main-thread-context"

export interface FilterWorkerAuditEntry {
  filterId: string
  name: string
  category: string
  strategy: FilterWorkerAuditStrategy
  transferableImageData: boolean
  reason: string
}

export function getFilterWorkerAudit() {
  const entries: FilterWorkerAuditEntry[] = Object.values(FILTERS)
    .map((filter) => {
      if (isFilterWorkerSupported(filter.id)) {
        return {
          filterId: filter.id,
          name: filter.name,
          category: filter.category,
          strategy: "worker" as const,
          transferableImageData: true,
          reason: "Registry module worker imports the filter registry and accepts transferable ImageData buffers.",
        }
      }
      if (CONTEXT_REQUIRED_FILTERS.has(filter.id)) {
        return {
          filterId: filter.id,
          name: filter.name,
          category: filter.category,
          strategy: "main-thread-context" as const,
          transferableImageData: false,
          reason: "Requires additional document/layer context that is not represented by a single transferable ImageData buffer.",
        }
      }
      return {
        filterId: filter.id,
        name: filter.name,
        category: filter.category,
        strategy: "main-thread-typed-array" as const,
        transferableImageData: true,
        reason: "Pure ImageData algorithm is audited for typed-array I/O but is not currently enabled for worker execution.",
      }
    })
    .sort((a, b) => a.filterId.localeCompare(b.filterId))

  return {
    totalFilters: entries.length,
    workerSupportedCount: entries.filter((entry) => entry.strategy === "worker").length,
    typedArrayFallbackCount: entries.filter((entry) => entry.strategy === "main-thread-typed-array").length,
    contextRequiredCount: entries.filter((entry) => entry.strategy === "main-thread-context").length,
    entries,
  }
}

export interface WorkerFallbackInput {
  filterId: string
  workerAvailable?: boolean
  workerSupported?: boolean
  workerFailed?: boolean
}

export interface WorkerFallbackPlan {
  strategy: "worker" | "main-thread-fallback"
  reason: "worker-ready" | "unsupported-filter" | "worker-unavailable" | "worker-failed"
  retryWorker: boolean
}

export function planWorkerFallback(input: WorkerFallbackInput): WorkerFallbackPlan {
  const workerSupported = input.workerSupported ?? isFilterWorkerSupported(input.filterId)
  if (!workerSupported) {
    return { strategy: "main-thread-fallback", reason: "unsupported-filter", retryWorker: false }
  }
  if (input.workerFailed) {
    return { strategy: "main-thread-fallback", reason: "worker-failed", retryWorker: false }
  }
  if (input.workerAvailable === false) {
    return { strategy: "main-thread-fallback", reason: "worker-unavailable", retryWorker: false }
  }
  return { strategy: "worker", reason: "worker-ready", retryWorker: true }
}

export interface ExpensiveFilterTilingOptions {
  tileSize?: number
  memoryBudgetMB?: number
}

export interface ExpensiveFilterTilingPlan {
  filterId: string
  strategy: "single-frame" | "tiled-main-thread" | "tiled-worker-preferred"
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  overlap: number
  yieldEveryTiles: number
  estimatedTilePixels: number
  warnings: string[]
}

function numParam(params: Record<string, number | string | boolean>, key: string, fallback: number) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

function suggestedFilterOverlap(filterId: string, params: Record<string, number | string | boolean>) {
  switch (filterId) {
    case "gaussian-blur":
    case "box-blur":
      return Math.max(0, Math.ceil(numParam(params, "radius", 4)))
    case "motion-blur":
      return Math.max(0, Math.ceil(numParam(params, "distance", 12)))
    case "unsharp-mask":
      return Math.max(1, Math.ceil(numParam(params, "radius", 1)))
    case "sharpen":
      return 1
    case "ripple":
      return params.size === "large" ? 40 : params.size === "small" ? 5 : 15
    case "lens-blur":
      return Math.max(1, Math.ceil(numParam(params, "radius", 10)))
    case "surface-blur":
      return Math.max(1, Math.ceil(numParam(params, "radius", 5)))
    case "oil-paint":
      return Math.max(1, Math.ceil(numParam(params, "cleanliness", 4)))
    case "high-pass":
      return Math.max(1, Math.ceil(numParam(params, "radius", 10)))
    case "custom-convolution":
    case "lighting-effects":
      return 1
    default:
      return 0
  }
}

function isExpensiveFilter(filterId: string) {
  return [
    "gaussian-blur",
    "box-blur",
    "motion-blur",
    "unsharp-mask",
    "sharpen",
    "ripple",
    "clouds",
    "difference-clouds",
    "fibers",
    "lens-blur",
    "surface-blur",
    "oil-paint",
    "high-pass",
    "custom-convolution",
    "lighting-effects",
  ].includes(filterId)
}

const TILE_COMPATIBLE_FILTERS = new Set([
  "invert",
  "grayscale",
  "desaturate",
  "sepia",
  "threshold",
  "posterize",
  "exposure",
  "brightness-contrast",
  "hue-saturation",
  "vibrance",
  "black-white",
  "color-balance",
  "photo-filter",
  "channel-mixer",
  "color-lookup",
  "gradient-map",
  "gaussian-blur",
  "box-blur",
  "motion-blur",
  "sharpen",
  "unsharp-mask",
  "noise",
  "surface-blur",
  "lens-blur",
  "oil-paint",
  "high-pass",
  "custom-convolution",
])

function isTileCompatibleFilter(filterId: string) {
  return TILE_COMPATIBLE_FILTERS.has(filterId)
}

export function planExpensiveFilterTiling(
  filterId: string,
  width: number,
  height: number,
  params: Record<string, number | string | boolean> = {},
  options: ExpensiveFilterTilingOptions = {},
): ExpensiveFilterTilingPlan {
  const tileSize = Math.max(1, Math.round(options.tileSize ?? 512))
  const grid = planTileGrid(width, height, tileSize)
  const expensive = isExpensiveFilter(filterId)
  const shouldTile = isTileCompatibleFilter(filterId) && grid.tileCount > 1 && (expensive || width * height >= 16_000_000)
  const warnings: string[] = []

  if (shouldTile && suggestedFilterOverlap(filterId, params) > 0) {
    warnings.push("Neighborhood filter needs overlap to avoid tile edge artifacts.")
  }

  return {
    filterId,
    strategy: shouldTile
      ? isFilterWorkerSupported(filterId)
        ? "tiled-worker-preferred"
        : "tiled-main-thread"
      : "single-frame",
    tileSize,
    tileColumns: grid.tileColumns,
    tileRows: grid.tileRows,
    tileCount: grid.tileCount,
    overlap: suggestedFilterOverlap(filterId, params),
    yieldEveryTiles: grid.tileCount > 16 ? 4 : 8,
    estimatedTilePixels: tileSize * tileSize,
    warnings,
  }
}

function attachWorkerHandlers(worker: Worker) {
  worker.onmessage = (event: MessageEvent<FilterWorkerResponse>) => {
    const response = event.data
    const pending = _pending.get(response.id)
    if (!pending) return
    if (response.progress) {
      pending.progress?.(response.progress)
      return
    }
    _pending.delete(response.id)
    if (response.error || !response.buffer) {
      pending.reject(new Error(response.error ?? "Filter worker returned no image data"))
      return
    }
    pending.resolve(new ImageData(new Uint8ClampedArray(response.buffer), response.width, response.height))
  }
  worker.onerror = (event) => {
    _workerFailed = true
    _worker = null
    _workerKind = null
    worker.terminate()
    const message = event.message || "Filter worker failed"
    for (const [id, pending] of _pending) {
      pending.reject(new Error(message))
      _pending.delete(id)
    }
  }
}

async function createRegistryWorker(): Promise<Worker | null> {
  if (_registryWorkerUnavailable || typeof Worker === "undefined" || typeof URL === "undefined") return null
  try {
    const { createRegistryFilterWorker } = await import("./filter-registry-worker-factory")
    return createRegistryFilterWorker()
  } catch {
    _registryWorkerUnavailable = true
    return null
  }
}

function createInlineWorker(): Worker | null {
  if (_inlineWorkerUnavailable || typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return null
  try {
    const blob = new Blob([workerSource()], { type: "text/javascript" })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url, { type: "module" })
    URL.revokeObjectURL(url)
    return worker
  } catch {
    _inlineWorkerUnavailable = true
    return null
  }
}

async function getWorker(filterId?: string): Promise<Worker | null> {
  if (_workerFailed || typeof Worker === "undefined") return null
  if (_worker) {
    if (_workerKind === "inline" && (!filterId || !INLINE_WORKER_FILTER_SET.has(filterId))) return null
    return _worker
  }

  _worker = await createRegistryWorker()
  _workerKind = _worker ? "registry" : null
  if (!_worker && filterId && INLINE_WORKER_FILTER_SET.has(filterId)) {
    _worker = createInlineWorker()
    _workerKind = _worker ? "inline" : null
  }
  if (_worker) {
    attachWorkerHandlers(_worker)
    return _worker
  }
  return null
}

function runFilterOnMainThread(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
  onProgress?: (event: FilterProgressEvent) => void,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const schedule = typeof requestIdleCallback === "function"
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 50 })
      : (cb: () => void) => setTimeout(cb, 0)

    schedule(() => {
      try {
        const filter = getFilter(filterId)
        if (!filter) {
          reject(new Error(`Filter not found: ${filterId}`))
          return
        }
        const result = filter.apply(src, params)
        onProgress?.({ completed: 1, total: 1, filterId })
        resolve(result)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}

function abortError(message: string) {
  return new DOMException(message, "AbortError")
}

function timeoutError(message: string) {
  return new DOMException(message, "TimeoutError")
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

interface CancellationOptions {
  signal?: AbortSignal
  timeoutMs?: number
  abortMessage: string
  timeoutMessage: string
  onCancel?: () => void
}

function withCancellation<T>(operation: Promise<T>, options: CancellationOptions): Promise<T> {
  if (options.signal?.aborted) {
    options.onCancel?.()
    return Promise.reject(abortError(options.abortMessage))
  }

  const timeoutMs = typeof options.timeoutMs === "number" ? Math.max(1, Math.round(options.timeoutMs)) : null
  if (!options.signal && timeoutMs === null) return operation

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener("abort", onAbort)
    }
    const finishResolve = (value: T) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      options.onCancel?.()
      finishReject(abortError(options.abortMessage))
    }

    if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true })
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        options.onCancel?.()
        finishReject(timeoutError(options.timeoutMessage))
      }, timeoutMs)
    }

    operation.then(
      (value) => finishResolve(value),
      (error) => finishReject(error),
    )
  })
}

export interface FilterAsyncOptions {
  fallbackOnWorkerError?: boolean
  workerExecutor?: (
    filterId: string,
    src: ImageData,
    params: Record<string, number | string | boolean>,
  ) => Promise<ImageData>
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (event: FilterProgressEvent) => void
}

/**
 * Apply a filter asynchronously. Context-free registry filters run
 * off-main-thread; filters that need extra document context use the scheduled
 * main-thread path from the caller that can supply that context.
 */
export function applyFilterAsync(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
  options: FilterAsyncOptions = {},
): Promise<ImageData> {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException("Filter processing cancelled", "AbortError"))
  }
  if (isFilterWorkerSupported(filterId)) {
    if (options.workerExecutor) {
      return withCancellation(options.workerExecutor(filterId, src, params), {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        abortMessage: "Filter processing cancelled",
        timeoutMessage: `Filter worker timed out after ${Math.max(1, Math.round(options.timeoutMs ?? 0))}ms`,
      }).then((result) => {
        options.onProgress?.({ completed: 1, total: 1, filterId })
        return result
      }).catch((err) => {
        if (isAbortError(err)) throw err
        _workerFailed = true
        emitRuntimeEvent("worker-fallback", {
          component: "filter-worker",
          operation: filterId,
          reason: "executor-failed",
          fallback: "main-thread",
          recoverable: true,
        })
        if (options.fallbackOnWorkerError === false) {
          throw err instanceof Error ? err : new Error(String(err))
        }
        return runFilterOnMainThread(filterId, src, params, options.onProgress)
      })
    }

    return getWorker(filterId).then((worker) => {
      if (!worker) {
        emitRuntimeEvent("worker-fallback", {
          component: "filter-worker",
          operation: filterId,
          reason: "worker-unavailable",
          fallback: "main-thread",
          recoverable: true,
        })
        return runFilterOnMainThread(filterId, src, params, options.onProgress)
      }
      const id = _nextId++
      const buffer = new ArrayBuffer(src.data.byteLength)
      new Uint8ClampedArray(buffer).set(src.data)
      const request: FilterWorkerRequest = {
        id,
        filterId,
        width: src.width,
        height: src.height,
        buffer,
        params,
      }
      const workerPromise = new Promise<ImageData>((resolve, reject) => {
        _pending.set(id, { resolve, reject, progress: options.onProgress })
        worker.postMessage(request, [buffer])
      })
      return withCancellation(workerPromise, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        abortMessage: "Filter processing cancelled",
        timeoutMessage: `Filter worker timed out after ${Math.max(1, Math.round(options.timeoutMs ?? 0))}ms`,
        onCancel: () => {
          _pending.delete(id)
        },
      }).catch((err) => {
        if (isAbortError(err)) throw err
        _workerFailed = true
        emitRuntimeEvent("worker-fallback", {
          component: "filter-worker",
          operation: filterId,
          reason: "worker-failed",
          fallback: "main-thread",
          recoverable: true,
        })
        if (options.fallbackOnWorkerError === false) {
          throw err instanceof Error ? err : new Error(String(err))
        }
        return runFilterOnMainThread(filterId, src, params, options.onProgress)
      })
    })
  }

  return runFilterOnMainThread(filterId, src, params, options.onProgress)
}

export interface FilterBatchOptions {
  onProgress?: (event: FilterProgressEvent) => void
  fallbackOnWorkerError?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  workerExecutor?: (
    src: ImageData,
    operations: FilterBatchOperation[],
  ) => Promise<ImageData>
}

export async function applyFilterBatch(
  src: ImageData,
  operations: FilterBatchOperation[],
  options: FilterBatchOptions = {},
): Promise<ImageData> {
  if (operations.length === 0) {
    return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  }
  if (options.signal?.aborted) {
    throw new DOMException("Filter batch cancelled", "AbortError")
  }

  const canUseWorker = operations.every((operation) => isFilterWorkerSupported(operation.filterId))
  const canUseInlineWorker = operations.every((operation) => INLINE_WORKER_FILTER_SET.has(operation.filterId))
  if (canUseWorker && options.workerExecutor) {
    return withCancellation(options.workerExecutor(src, operations), {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      abortMessage: "Filter batch cancelled",
      timeoutMessage: `Filter batch worker timed out after ${Math.max(1, Math.round(options.timeoutMs ?? 0))}ms`,
    }).then((result) => {
      options.onProgress?.({
        completed: operations.length,
        total: operations.length,
        filterId: operations[operations.length - 1]?.filterId ?? "",
      })
      return result
    }).catch((err) => {
      if (isAbortError(err)) throw err
      _workerFailed = true
      emitRuntimeEvent("worker-fallback", {
        component: "filter-worker",
        operation: "batch",
        reason: "executor-failed",
        fallback: "main-thread",
        recoverable: true,
      })
      if (options.fallbackOnWorkerError === false) {
        throw err instanceof Error ? err : new Error(String(err))
      }
      return runFilterBatchOnMainThread(src, operations, options.onProgress, options.signal)
    })
  }
  const worker = canUseWorker ? await getWorker(canUseInlineWorker ? operations[0]?.filterId : undefined) : null
  if (worker) {
    const id = _nextId++
    const buffer = new ArrayBuffer(src.data.byteLength)
    new Uint8ClampedArray(buffer).set(src.data)
    const request: FilterWorkerRequest = {
      id,
      operations,
      width: src.width,
      height: src.height,
      buffer,
      params: {},
    }
    const workerPromise = new Promise<ImageData>((resolve, reject) => {
      _pending.set(id, { resolve, reject, progress: options.onProgress })
      worker.postMessage(request, [buffer])
    })
    return withCancellation(workerPromise, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      abortMessage: "Filter batch cancelled",
      timeoutMessage: `Filter batch worker timed out after ${Math.max(1, Math.round(options.timeoutMs ?? 0))}ms`,
      onCancel: () => {
        _pending.delete(id)
      },
    }).catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") throw err
      _workerFailed = true
      emitRuntimeEvent("worker-fallback", {
        component: "filter-worker",
        operation: "batch",
        reason: "worker-failed",
        fallback: "main-thread",
        recoverable: true,
      })
      if (options.fallbackOnWorkerError === false) {
        throw err instanceof Error ? err : new Error(String(err))
      }
      return runFilterBatchOnMainThread(src, operations, options.onProgress, options.signal)
    })
  }

  return runFilterBatchOnMainThread(src, operations, options.onProgress, options.signal)
}

async function runFilterBatchOnMainThread(
  src: ImageData,
  operations: FilterBatchOperation[],
  onProgress?: (event: FilterProgressEvent) => void,
  signal?: AbortSignal,
) {
  let current = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  for (let i = 0; i < operations.length; i++) {
    if (signal?.aborted) {
      throw new DOMException("Filter batch cancelled", "AbortError")
    }
    const operation = operations[i]
    current = await runFilterOnMainThread(operation.filterId, current, operation.params)
    onProgress?.({ completed: i + 1, total: operations.length, filterId: operation.filterId })
  }
  return current
}

export interface TiledFilterOptions {
  tileSize?: number
  overlap?: number
  useWorker?: boolean
  signal?: AbortSignal
  yieldEveryTiles?: number
  onProgress?: (event: FilterProgressEvent) => void
}

/**
 * Apply a filter in bounded tiles. The caller can choose overlap large enough
 * for neighborhood-based filters and opt into worker-backed tiles when the
 * filter has a worker implementation.
 */
export async function applyFilterTiled(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
  options: TiledFilterOptions = {},
): Promise<ImageData> {
  const filter = getFilter(filterId)
  if (!filter) throw new Error(`Filter not found: ${filterId}`)
  const plan = planExpensiveFilterTiling(filterId, src.width, src.height, params, { tileSize: options.tileSize })
  const tileSize = Math.max(1, Math.round(options.tileSize ?? plan.tileSize))
  const overlap = Math.max(0, Math.round(options.overlap ?? plan.overlap))
  const yieldEveryTiles = Math.max(1, Math.round(options.yieldEveryTiles ?? plan.yieldEveryTiles))
  const out = new ImageData(src.width, src.height)
  let processedTiles = 0

  for (let tileY = 0; tileY < src.height; tileY += tileSize) {
    if (options.signal?.aborted) throw new DOMException("Filter processing cancelled", "AbortError")
    await Promise.resolve()
    for (let tileX = 0; tileX < src.width; tileX += tileSize) {
      if (options.signal?.aborted) throw new DOMException("Filter processing cancelled", "AbortError")
      const x0 = Math.max(0, tileX - overlap)
      const y0 = Math.max(0, tileY - overlap)
      const x1 = Math.min(src.width, tileX + tileSize + overlap)
      const y1 = Math.min(src.height, tileY + tileSize + overlap)
      const tileW = x1 - x0
      const tileH = y1 - y0
      const tile = new ImageData(tileW, tileH)
      for (let y = 0; y < tileH; y++) {
        const srcStart = ((y0 + y) * src.width + x0) * 4
        const dstStart = y * tileW * 4
        tile.data.set(src.data.slice(srcStart, srcStart + tileW * 4), dstStart)
      }
      const filtered =
        options.useWorker && isFilterWorkerSupported(filterId)
          ? await applyFilterAsync(filterId, tile, params, { signal: options.signal })
          : filter.apply(tile, params)
      const writeW = Math.min(tileSize, src.width - tileX)
      const writeH = Math.min(tileSize, src.height - tileY)
      const readOffsetX = tileX - x0
      const readOffsetY = tileY - y0
      for (let y = 0; y < writeH; y++) {
        const srcStart = ((readOffsetY + y) * tileW + readOffsetX) * 4
        const dstStart = ((tileY + y) * src.width + tileX) * 4
        out.data.set(filtered.data.slice(srcStart, srcStart + writeW * 4), dstStart)
      }
      processedTiles++
      options.onProgress?.({ completed: processedTiles, total: plan.tileCount, filterId })
      if (processedTiles % yieldEveryTiles === 0) await Promise.resolve()
    }
  }

  return out
}

/**
 * Apply a filter on a downsampled version of the image for fast preview,
 * then upscale the result back to original size.
 *
 * @param scaleFactor - downsample factor (e.g. 0.25 for 4x reduction)
 */
export function applyFilterPreview(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
  scaleFactor = 0.25,
): ImageData {
  const filter = getFilter(filterId)
  if (!filter) return src

  const srcW = src.width
  const srcH = src.height
  const previewW = Math.max(1, Math.round(srcW * scaleFactor))
  const previewH = Math.max(1, Math.round(srcH * scaleFactor))

  const small = new ImageData(previewW, previewH)
  const xRatio = srcW / previewW
  const yRatio = srcH / previewH
  for (let y = 0; y < previewH; y++) {
    const srcY = Math.floor(y * yRatio)
    for (let x = 0; x < previewW; x++) {
      const srcX = Math.floor(x * xRatio)
      const si = (srcY * srcW + srcX) * 4
      const di = (y * previewW + x) * 4
      small.data[di] = src.data[si]
      small.data[di + 1] = src.data[si + 1]
      small.data[di + 2] = src.data[si + 2]
      small.data[di + 3] = src.data[si + 3]
    }
  }

  const filtered = filter.apply(small, params)

  const result = new ImageData(srcW, srcH)
  const fxRatio = previewW / srcW
  const fyRatio = previewH / srcH
  for (let y = 0; y < srcH; y++) {
    const fy = y * fyRatio
    const fy0 = Math.floor(fy)
    const fy1 = Math.min(previewH - 1, fy0 + 1)
    const ty = fy - fy0
    for (let x = 0; x < srcW; x++) {
      const fx = x * fxRatio
      const fx0 = Math.floor(fx)
      const fx1 = Math.min(previewW - 1, fx0 + 1)
      const tx = fx - fx0
      const di = (y * srcW + x) * 4
      for (let c = 0; c < 4; c++) {
        const v00 = filtered.data[(fy0 * previewW + fx0) * 4 + c]
        const v10 = filtered.data[(fy0 * previewW + fx1) * 4 + c]
        const v01 = filtered.data[(fy1 * previewW + fx0) * 4 + c]
        const v11 = filtered.data[(fy1 * previewW + fx1) * 4 + c]
        const top = v00 + (v10 - v00) * tx
        const bot = v01 + (v11 - v01) * tx
        result.data[di + c] = Math.round(top + (bot - top) * ty)
      }
    }
  }

  return result
}

/**
 * Batch pixel reader - reads a region once and provides fast lookups.
 * Avoids repeated single-pixel getImageData calls during brush strokes.
 */
export class PixelBatchReader {
  private data: Uint8ClampedArray | null = null
  private x0 = 0
  private y0 = 0
  private w = 0
  private h = 0
  private canvasW = 0
  private canvasH = 0
  private ctx: CanvasRenderingContext2D | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvasW = canvas.width
    this.canvasH = canvas.height
    this.ctx = canvas.getContext("2d")
  }

  readRegion(x: number, y: number, w: number, h: number) {
    if (!this.ctx) return
    this.x0 = Math.max(0, Math.floor(x))
    this.y0 = Math.max(0, Math.floor(y))
    this.w = Math.min(this.canvasW - this.x0, Math.ceil(w))
    this.h = Math.min(this.canvasH - this.y0, Math.ceil(h))
    if (this.w <= 0 || this.h <= 0) {
      this.data = null
      return
    }
    this.data = this.ctx.getImageData(this.x0, this.y0, this.w, this.h).data
  }

  contains(x: number, y: number): boolean {
    if (!this.data) return false
    const px = Math.floor(x) - this.x0
    const py = Math.floor(y) - this.y0
    return px >= 0 && px < this.w && py >= 0 && py < this.h
  }

  getPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null {
    if (!this.data) return null
    const px = Math.floor(x) - this.x0
    const py = Math.floor(y) - this.y0
    if (px < 0 || px >= this.w || py < 0 || py >= this.h) return null
    const i = (py * this.w + px) * 4
    return {
      r: this.data[i],
      g: this.data[i + 1],
      b: this.data[i + 2],
      a: this.data[i + 3],
    }
  }

  ensureContains(x: number, y: number, padding: number) {
    if (this.contains(x, y)) return
    const newX = Math.floor(x) - padding
    const newY = Math.floor(y) - padding
    const newW = padding * 2 + 1
    const newH = padding * 2 + 1
    this.readRegion(newX, newY, newW, newH)
  }
}
