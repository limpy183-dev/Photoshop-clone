/**
 * Tiled document backing store.
 *
 * A document is split into fixed-size tiles. Each tile holds raw RGBA
 * pixel data (`Uint8ClampedArray`). Tiles are tracked as dirty/clean,
 * registered with the {@link MemoryBudgetTracker}, and can be spilled
 * to OPFS when memory pressure rises. The store does not draw pixels —
 * it just holds them and exposes range-read/range-write APIs so the
 * compositor (canvas-view) can stay agnostic of where bytes live.
 *
 * Pure planner helpers are exported so callers (and unit tests) can
 * reason about tile counts and memory pressure without instantiating
 * the runtime store.
 */

import {
  estimateImageBytes as _estimateImageBytes,
  getGlobalMemoryBudget,
  type MemoryBudgetTracker,
  type MemoryCategory,
} from "./memory-budget"
import { isOPFSSupported, readScratchBlob, writeScratchBlob, deleteScratchKey } from "./opfs-scratch"
import { planTileGrid } from "./performance-engine"
import { unionDirtyRect, type DirtyRect, isEmptyDirtyRect, intersectDirtyRect } from "./dirty-rect"

const BYTES_PER_PIXEL = 4
const DEFAULT_TILE_SIZE = 512
const MAX_LIVE_TILE_BYTES_DEFAULT = 192 * 1024 * 1024
const MEMORY_CATEGORY: MemoryCategory = "tile-cache"

export interface TileBackingStoreOptions {
  tileSize?: number
  documentId?: string
  budget?: MemoryBudgetTracker
  maxLiveTileBytes?: number
  enableOPFSSpill?: boolean
}

export interface TileBackingStorePlanInput {
  width: number
  height: number
  tileSize?: number
  layerCount?: number
  memoryBudgetMB?: number
}

export interface TileBackingStorePlan {
  width: number
  height: number
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  bytesPerTile: number
  fullDocumentBytes: number
  estimatedLiveBytes: number
  spillRequired: boolean
  recommendedMaxLiveTiles: number
  recommendation: "in-memory" | "tile-and-spill" | "tile-and-aggressive-spill"
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
}

export function planTiledBackingStore(input: TileBackingStorePlanInput): TileBackingStorePlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const tileSize = positiveInt(input.tileSize, DEFAULT_TILE_SIZE)
  const grid = planTileGrid(width, height, tileSize)
  const layerCount = Math.max(1, positiveInt(input.layerCount, 1))
  const memoryBudgetMB = positiveInt(input.memoryBudgetMB, 1024)
  const bytesPerTile = tileSize * tileSize * BYTES_PER_PIXEL
  const fullDocumentBytes = width * height * BYTES_PER_PIXEL * layerCount
  const budgetBytes = memoryBudgetMB * 1024 * 1024
  const recommendedMaxLiveTiles = Math.max(
    1,
    Math.floor((budgetBytes * 0.4) / Math.max(1, bytesPerTile * layerCount)),
  )
  const estimatedLiveBytes = Math.min(fullDocumentBytes, recommendedMaxLiveTiles * bytesPerTile * layerCount)
  const spillRequired = fullDocumentBytes > budgetBytes / 2
  const aggressive = fullDocumentBytes > budgetBytes

  return {
    width,
    height,
    tileSize,
    tileColumns: grid.tileColumns,
    tileRows: grid.tileRows,
    tileCount: grid.tileCount,
    bytesPerTile,
    fullDocumentBytes,
    estimatedLiveBytes,
    spillRequired,
    recommendedMaxLiveTiles,
    recommendation: aggressive ? "tile-and-aggressive-spill" : spillRequired ? "tile-and-spill" : "in-memory",
  }
}

export type TileCoordKey = string

export function tileKey(col: number, row: number): TileCoordKey {
  return `${col},${row}`
}

export interface TileSlot {
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
  dirty: boolean
  /** Monotonic timestamp updated when the tile is touched. */
  lastTouchedAt: number
  data: Uint8ClampedArray | null
  /** OPFS scratch key when the tile is spilled. */
  scratchKey?: string
  /** Allocation id used in the memory budget tracker. */
  allocationId: string
}

export interface TileSnapshot {
  col: number
  row: number
  width: number
  height: number
  dirty: boolean
  resident: boolean
  spilled: boolean
}

export class TiledBackingStore {
  readonly width: number
  readonly height: number
  readonly tileSize: number
  readonly tileColumns: number
  readonly tileRows: number
  readonly tileCount: number
  private readonly slots: TileSlot[]
  private readonly slotByKey: Map<TileCoordKey, TileSlot>
  private readonly budget: MemoryBudgetTracker
  private readonly maxLiveTileBytes: number
  private readonly bytesPerTile: number
  private readonly documentId: string
  private readonly enableOPFSSpill: boolean
  private liveBytes = 0
  private touchCounter = 0

  constructor(width: number, height: number, options: TileBackingStoreOptions = {}) {
    this.width = positiveInt(width, 1)
    this.height = positiveInt(height, 1)
    this.tileSize = positiveInt(options.tileSize, DEFAULT_TILE_SIZE)
    const grid = planTileGrid(this.width, this.height, this.tileSize)
    this.tileColumns = grid.tileColumns
    this.tileRows = grid.tileRows
    this.tileCount = grid.tileCount
    this.budget = options.budget ?? getGlobalMemoryBudget()
    this.bytesPerTile = this.tileSize * this.tileSize * BYTES_PER_PIXEL
    this.maxLiveTileBytes = positiveInt(options.maxLiveTileBytes, MAX_LIVE_TILE_BYTES_DEFAULT)
    this.documentId = options.documentId ?? `doc-${Math.random().toString(36).slice(2, 10)}`
    this.enableOPFSSpill = options.enableOPFSSpill !== false && isOPFSSupported()
    this.slots = new Array<TileSlot>(this.tileCount)
    this.slotByKey = new Map()

    let index = 0
    for (let row = 0; row < this.tileRows; row++) {
      for (let col = 0; col < this.tileColumns; col++) {
        const x = col * this.tileSize
        const y = row * this.tileSize
        const w = Math.min(this.tileSize, this.width - x)
        const h = Math.min(this.tileSize, this.height - y)
        const slot: TileSlot = {
          col,
          row,
          x,
          y,
          width: w,
          height: h,
          dirty: false,
          lastTouchedAt: 0,
          data: null,
          allocationId: `tile/${this.documentId}/${col},${row}`,
        }
        this.slots[index++] = slot
        this.slotByKey.set(tileKey(col, row), slot)
      }
    }
  }

  /** Lookup a slot by coordinates, returns null if outside the grid. */
  getSlot(col: number, row: number): TileSlot | null {
    if (col < 0 || col >= this.tileColumns || row < 0 || row >= this.tileRows) return null
    return this.slotByKey.get(tileKey(col, row)) ?? null
  }

  /** Lookup a slot for a pixel coordinate. */
  slotAt(x: number, y: number): TileSlot | null {
    const col = Math.floor(x / this.tileSize)
    const row = Math.floor(y / this.tileSize)
    return this.getSlot(col, row)
  }

  /**
   * Find every slot that intersects a rect. Returned in row-major order
   * so callers can stream tile reads/writes in cache-friendly sequence.
   */
  slotsForRect(rect: DirtyRect): TileSlot[] {
    if (isEmptyDirtyRect(rect)) return []
    const colStart = Math.max(0, Math.floor(rect.x / this.tileSize))
    const rowStart = Math.max(0, Math.floor(rect.y / this.tileSize))
    const colEnd = Math.min(this.tileColumns - 1, Math.floor((rect.x + rect.w - 1) / this.tileSize))
    const rowEnd = Math.min(this.tileRows - 1, Math.floor((rect.y + rect.h - 1) / this.tileSize))
    const result: TileSlot[] = []
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const slot = this.getSlot(col, row)
        if (slot) result.push(slot)
      }
    }
    return result
  }

  /** Mark a region dirty without yet allocating pixel buffers. */
  markDirty(rect: DirtyRect): TileSlot[] {
    const slots = this.slotsForRect(rect)
    for (const slot of slots) {
      slot.dirty = true
      slot.lastTouchedAt = ++this.touchCounter
    }
    return slots
  }

  /**
   * Return a list of dirty slots intersecting `rect`. If `rect` is
   * omitted, returns all dirty slots.
   */
  collectDirty(rect?: DirtyRect): TileSlot[] {
    if (!rect) {
      return this.slots.filter((slot) => slot.dirty)
    }
    return this.slotsForRect(rect).filter((slot) => slot.dirty)
  }

  /** Clear the dirty flag on every slot. */
  clearDirty(): void {
    for (const slot of this.slots) slot.dirty = false
  }

  /**
   * Lazily allocate the slot's data buffer and return it. When the live
   * budget is exhausted, the least-recently-touched slot is evicted via
   * {@link evictOnce} before the new buffer is created.
   */
  async ensureResident(slot: TileSlot): Promise<Uint8ClampedArray> {
    if (slot.data) {
      slot.lastTouchedAt = ++this.touchCounter
      return slot.data
    }

    if (slot.scratchKey) {
      const blob = await readScratchBlob(slot.scratchKey)
      if (blob) {
        const buffer = await blob.arrayBuffer()
        const data = new Uint8ClampedArray(buffer)
        await deleteScratchKey(slot.scratchKey).catch(() => {})
        slot.scratchKey = undefined
        await this.acceptResident(slot, data)
        return data
      }
    }

    const data = new Uint8ClampedArray(slot.width * slot.height * BYTES_PER_PIXEL)
    await this.acceptResident(slot, data)
    return data
  }

  /** Read RGBA pixels into `imageData` for the given rect. */
  async readRect(rect: DirtyRect): Promise<ImageData | null> {
    const clipped = intersectDirtyRect(rect, { x: 0, y: 0, w: this.width, h: this.height })
    if (isEmptyDirtyRect(clipped)) return null
    if (typeof ImageData === "undefined") return null
    const out = new ImageData(clipped.w, clipped.h)
    const slots = this.slotsForRect(clipped)
    for (const slot of slots) {
      const tileRect = { x: slot.x, y: slot.y, w: slot.width, h: slot.height }
      const overlap = intersectDirtyRect(clipped, tileRect)
      if (isEmptyDirtyRect(overlap)) continue
      const data = await this.ensureResident(slot)
      for (let yy = 0; yy < overlap.h; yy++) {
        const srcY = overlap.y - slot.y + yy
        const dstY = overlap.y - clipped.y + yy
        const srcStart = (srcY * slot.width + (overlap.x - slot.x)) * BYTES_PER_PIXEL
        const dstStart = (dstY * clipped.w + (overlap.x - clipped.x)) * BYTES_PER_PIXEL
        out.data.set(data.subarray(srcStart, srcStart + overlap.w * BYTES_PER_PIXEL), dstStart)
      }
    }
    return out
  }

  /** Write RGBA pixels from `image` covering `rect`. */
  async writeRect(rect: DirtyRect, image: ImageData): Promise<void> {
    const clipped = intersectDirtyRect(rect, { x: 0, y: 0, w: this.width, h: this.height })
    if (isEmptyDirtyRect(clipped)) return
    const slots = this.slotsForRect(clipped)
    for (const slot of slots) {
      const tileRect = { x: slot.x, y: slot.y, w: slot.width, h: slot.height }
      const overlap = intersectDirtyRect(clipped, tileRect)
      if (isEmptyDirtyRect(overlap)) continue
      const data = await this.ensureResident(slot)
      for (let yy = 0; yy < overlap.h; yy++) {
        const srcY = overlap.y - clipped.y + yy
        const dstY = overlap.y - slot.y + yy
        const srcStart = (srcY * image.width + (overlap.x - clipped.x)) * BYTES_PER_PIXEL
        const dstStart = (dstY * slot.width + (overlap.x - slot.x)) * BYTES_PER_PIXEL
        data.set(image.data.subarray(srcStart, srcStart + overlap.w * BYTES_PER_PIXEL), dstStart)
      }
      slot.dirty = true
      slot.lastTouchedAt = ++this.touchCounter
    }
  }

  /**
   * Spill resident tiles to OPFS scratch until live bytes drop below
   * `targetBytes`. Returns the slots that were spilled.
   */
  async evict(targetBytes?: number): Promise<TileSlot[]> {
    const target = positiveInt(targetBytes, Math.floor(this.maxLiveTileBytes * 0.6))
    const candidates = this.slots
      .filter((slot) => slot.data !== null)
      .sort((a, b) => a.lastTouchedAt - b.lastTouchedAt)
    const evicted: TileSlot[] = []
    for (const slot of candidates) {
      if (this.liveBytes <= target) break
      const wasSpilled = await this.spillSlot(slot)
      if (wasSpilled) evicted.push(slot)
    }
    return evicted
  }

  /** Per-slot resident/spilled summary; useful for diagnostics. */
  snapshot(): TileSnapshot[] {
    return this.slots.map((slot) => ({
      col: slot.col,
      row: slot.row,
      width: slot.width,
      height: slot.height,
      dirty: slot.dirty,
      resident: slot.data !== null,
      spilled: !!slot.scratchKey && slot.data === null,
    }))
  }

  /** Free every slot, deleting any scratch entries. */
  async dispose(): Promise<void> {
    for (const slot of this.slots) {
      if (slot.data) {
        this.budget.release(slot.allocationId)
        slot.data = null
      }
      if (slot.scratchKey) {
        await deleteScratchKey(slot.scratchKey).catch(() => {})
        slot.scratchKey = undefined
      }
    }
    this.liveBytes = 0
  }

  getLiveBytes(): number {
    return this.liveBytes
  }

  /**
   * Compute the union dirty rect across every dirty tile. Returns an
   * empty rect when there is nothing to flush.
   */
  dirtyUnion(): DirtyRect {
    let acc: DirtyRect = { x: 0, y: 0, w: 0, h: 0 }
    for (const slot of this.slots) {
      if (!slot.dirty) continue
      acc = unionDirtyRect(acc, { x: slot.x, y: slot.y, w: slot.width, h: slot.height })
    }
    return acc
  }

  private async acceptResident(slot: TileSlot, data: Uint8ClampedArray) {
    const bytes = data.byteLength
    if (this.liveBytes + bytes > this.maxLiveTileBytes) {
      await this.evict(Math.max(0, this.maxLiveTileBytes - bytes))
    }
    const decision = this.budget.request({ id: slot.allocationId, category: MEMORY_CATEGORY, bytes })
    if (decision.evictionRequested) {
      await this.evict(Math.max(0, this.maxLiveTileBytes - bytes))
    }
    slot.data = data
    slot.lastTouchedAt = ++this.touchCounter
    this.liveBytes += bytes
    this.budget.commit({ id: slot.allocationId, category: MEMORY_CATEGORY, bytes })
  }

  private async spillSlot(slot: TileSlot): Promise<boolean> {
    if (!slot.data) return false
    const data = slot.data
    if (this.enableOPFSSpill) {
      const key = `tile-${this.documentId}-${slot.col}-${slot.row}`
      try {
        await writeScratchBlob(key, new Blob([new Uint8Array(data.buffer.slice(0))]))
        slot.scratchKey = key
      } catch {
        // best effort
      }
    }
    this.liveBytes -= data.byteLength
    this.budget.release(slot.allocationId)
    slot.data = null
    return true
  }
}

export function createTiledBackingStore(width: number, height: number, options?: TileBackingStoreOptions) {
  return new TiledBackingStore(width, height, options)
}
