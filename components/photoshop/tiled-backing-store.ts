import { planTileGrid, type DirtyRect } from "./performance-engine"
import { writeScratchBlob, readScratchBlob, deleteScratchKey } from "./opfs-scratch"

const BYTES_PER_PIXEL = 4
const MIB = 1024 * 1024

export interface TiledBackingStorePlanInput {
  width: number
  height: number
  tileSize?: number
  bytesPerPixel?: number
  memoryBudgetMB?: number
}

export interface TiledBackingStorePlan {
  width: number
  height: number
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  tileBytes: number
  totalBytes: number
  memoryBudgetBytes: number
  strategy: "resident" | "spill-to-opfs"
}

export interface TileRecord {
  key: string
  x: number
  y: number
  w: number
  h: number
  dirty: boolean
  bytes: number
  storage: "memory" | "opfs"
}

function positiveInt(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(1, Math.round(next))
}

export function tileKey(col: number, row: number) {
  return `${col}:${row}`
}

export function planTiledBackingStore(input: TiledBackingStorePlanInput): TiledBackingStorePlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const tileSize = positiveInt(input.tileSize, 512)
  const bytesPerPixel = positiveInt(input.bytesPerPixel, BYTES_PER_PIXEL)
  const memoryBudgetBytes = positiveInt(input.memoryBudgetMB, 256) * MIB
  const grid = planTileGrid(width, height, tileSize)
  const tileBytes = tileSize * tileSize * bytesPerPixel
  const totalBytes = width * height * bytesPerPixel
  return {
    width,
    height,
    ...grid,
    tileBytes,
    totalBytes,
    memoryBudgetBytes,
    strategy: totalBytes > memoryBudgetBytes ? "spill-to-opfs" : "resident",
  }
}

export function dirtyRectToTileKeys(rect: DirtyRect, plan: TiledBackingStorePlan): string[] {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(plan.width, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(plan.height, Math.ceil(rect.y + rect.h))
  if (x1 <= x0 || y1 <= y0) return []
  const col0 = Math.floor(x0 / plan.tileSize)
  const row0 = Math.floor(y0 / plan.tileSize)
  const col1 = Math.floor((x1 - 1) / plan.tileSize)
  const row1 = Math.floor((y1 - 1) / plan.tileSize)
  const keys: string[] = []
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) keys.push(tileKey(col, row))
  }
  return keys
}

export function tileRecordsForPlan(plan: TiledBackingStorePlan): TileRecord[] {
  const records: TileRecord[] = []
  for (let row = 0; row < plan.tileRows; row++) {
    for (let col = 0; col < plan.tileColumns; col++) {
      const x = col * plan.tileSize
      const y = row * plan.tileSize
      const w = Math.min(plan.tileSize, plan.width - x)
      const h = Math.min(plan.tileSize, plan.height - y)
      records.push({
        key: tileKey(col, row),
        x,
        y,
        w,
        h,
        dirty: false,
        bytes: w * h * BYTES_PER_PIXEL,
        storage: "memory",
      })
    }
  }
  return records
}

export class TiledBackingStore {
  readonly plan: TiledBackingStorePlan
  private readonly tiles = new Map<string, TileRecord>()
  private readonly memory = new Map<string, Blob>()

  constructor(input: TiledBackingStorePlanInput) {
    this.plan = planTiledBackingStore(input)
    for (const tile of tileRecordsForPlan(this.plan)) this.tiles.set(tile.key, tile)
  }

  markDirty(rect: DirtyRect): string[] {
    const keys = dirtyRectToTileKeys(rect, this.plan)
    for (const key of keys) {
      const tile = this.tiles.get(key)
      if (tile) tile.dirty = true
    }
    return keys
  }

  dirtyTiles(): TileRecord[] {
    return [...this.tiles.values()].filter((tile) => tile.dirty)
  }

  async writeTile(key: string, blob: Blob): Promise<"memory" | "opfs"> {
    const tile = this.tiles.get(key)
    if (!tile) throw new Error(`Unknown tile: ${key}`)
    if (this.plan.strategy === "spill-to-opfs") {
      const result = await writeScratchBlob(`tile-${key.replace(":", "-")}`, blob)
      tile.storage = result === "persisted" ? "opfs" : "memory"
      if (tile.storage === "memory") this.memory.set(key, blob)
      tile.dirty = false
      return tile.storage
    }
    this.memory.set(key, blob)
    tile.storage = "memory"
    tile.dirty = false
    return "memory"
  }

  async readTile(key: string): Promise<Blob | null> {
    const tile = this.tiles.get(key)
    if (!tile) return null
    if (tile.storage === "opfs") return readScratchBlob(`tile-${key.replace(":", "-")}`)
    return this.memory.get(key) ?? null
  }

  async deleteTile(key: string): Promise<void> {
    this.memory.delete(key)
    await deleteScratchKey(`tile-${key.replace(":", "-")}`)
    this.tiles.delete(key)
  }
}

