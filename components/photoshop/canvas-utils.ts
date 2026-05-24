/* ------------------------------------------------------------------ */
/*  Canvas helpers                                                      */
/*                                                                      */
/*  SSR-safe canvas factory. During server rendering we return a small  */
/*  stub object so module-level constructions don't crash; on the       */
/*  client we hand back a real HTMLCanvasElement.                       */
/* ------------------------------------------------------------------ */

import { assertCanvasSize } from "./canvas-limits"

export type CanvasPoolBucket = "small" | "medium" | "large"

export interface CanvasPoolBucketStats {
  hits: number
  misses: number
  releases: number
  evictions: number
  size: number
}

export interface CanvasPoolStats {
  hits: number
  misses: number
  releases: number
  evictions: number
  hitRate: number
  byBucket: Record<CanvasPoolBucket, CanvasPoolBucketStats>
}

interface PooledCanvas {
  canvas: HTMLCanvasElement
  width: number
  height: number
  area: number
  releasedAt: number
}

const MAX_PER_BUCKET = 12
const BUCKETS: readonly CanvasPoolBucket[] = ["small", "medium", "large"]
const _pools: Record<CanvasPoolBucket, PooledCanvas[]> = {
  small: [],
  medium: [],
  large: [],
}
const _stats: Record<CanvasPoolBucket, Omit<CanvasPoolBucketStats, "size">> = {
  small: { hits: 0, misses: 0, releases: 0, evictions: 0 },
  medium: { hits: 0, misses: 0, releases: 0, evictions: 0 },
  large: { hits: 0, misses: 0, releases: 0, evictions: 0 },
}

function bucketForArea(area: number): CanvasPoolBucket {
  if (area <= 512 * 512) return "small"
  if (area <= 2048 * 2048) return "medium"
  return "large"
}

/**
 * Create a sized HTMLCanvasElement, optionally filled with `fill`.
 *
 * During SSR (`document` undefined) this returns an object that satisfies
 * the structural HTMLCanvasElement shape — width/height/getContext — but
 * with a null 2D context. Callers that need a real canvas must guard on
 * the runtime themselves.
 */
export function makeCanvas(w: number, h: number, fill?: string): HTMLCanvasElement {
  const size = assertCanvasSize(w, h)
  if (typeof document === "undefined") {
    return {
      width: size.width,
      height: size.height,
      getContext: () => null,
    } as unknown as HTMLCanvasElement
  }
  const c = document.createElement("canvas")
  c.width = size.width
  c.height = size.height
  if (fill) {
    const ctx = c.getContext("2d")
    if (ctx) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, size.width, size.height)
    }
  }
  return c
}

export function acquirePooledCanvas(w: number, h: number, fill?: string): HTMLCanvasElement {
  const size = assertCanvasSize(w, h)
  const area = size.width * size.height
  const bucket = bucketForArea(area)
  const pool = _pools[bucket]
  for (let i = pool.length - 1; i >= 0; i--) {
    const candidate = pool[i]
    if (candidate.width !== size.width || candidate.height !== size.height) continue
    pool.splice(i, 1)
    _stats[bucket].hits += 1
    const ctx = candidate.canvas.getContext("2d")
    if (ctx) {
      ctx.clearRect(0, 0, size.width, size.height)
      if (fill) {
        ctx.fillStyle = fill
        ctx.fillRect(0, 0, size.width, size.height)
      }
    }
    return candidate.canvas
  }
  _stats[bucket].misses += 1
  return makeCanvas(size.width, size.height, fill)
}

export function releasePooledCanvas(canvas: HTMLCanvasElement, now = Date.now()): void {
  const width = Math.max(1, Math.round(canvas.width))
  const height = Math.max(1, Math.round(canvas.height))
  const area = width * height
  const bucket = bucketForArea(area)
  const pool = _pools[bucket]
  if (pool.length >= MAX_PER_BUCKET) {
    _stats[bucket].evictions += 1
    return
  }
  _stats[bucket].releases += 1
  pool.push({ canvas, width, height, area, releasedAt: now })
}

export function cleanupIdleCanvases(options: {
  now?: number
  maxIdleMs?: number
  oversizedArea?: number
} = {}): number {
  const now = options.now ?? Date.now()
  const maxIdleMs = Math.max(0, options.maxIdleMs ?? 30_000)
  const oversizedArea = Math.max(1, options.oversizedArea ?? 4096 * 4096)
  let evicted = 0
  for (const bucket of BUCKETS) {
    const pool = _pools[bucket]
    for (let i = pool.length - 1; i >= 0; i--) {
      const candidate = pool[i]
      if (candidate.area < oversizedArea || now - candidate.releasedAt < maxIdleMs) continue
      pool.splice(i, 1)
      _stats[bucket].evictions += 1
      evicted += 1
    }
  }
  return evicted
}

export function getCanvasPoolStats(): CanvasPoolStats {
  const byBucket = {} as Record<CanvasPoolBucket, CanvasPoolBucketStats>
  let hits = 0
  let misses = 0
  let releases = 0
  let evictions = 0
  for (const bucket of BUCKETS) {
    const base = _stats[bucket]
    hits += base.hits
    misses += base.misses
    releases += base.releases
    evictions += base.evictions
    byBucket[bucket] = {
      ...base,
      size: _pools[bucket].length,
    }
  }
  return {
    hits,
    misses,
    releases,
    evictions,
    hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
    byBucket,
  }
}

export function resetCanvasPoolForTests(): void {
  for (const bucket of BUCKETS) {
    _pools[bucket] = []
    _stats[bucket] = { hits: 0, misses: 0, releases: 0, evictions: 0 }
  }
}
