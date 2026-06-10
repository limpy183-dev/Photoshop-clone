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
  /** Per-document prefix for OPFS scratch keys so concurrent stores never collide. */
  scratchNamespace?: string
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

export type LayerTileKind = "raster" | "smart-object" | "3d" | "text" | "shape" | "vector" | "adjustment"

export interface LayerTileAddressInput {
  layerId: string
  layerKind: LayerTileKind
  col: number
  row: number
  sourceVersion?: string | number
  cameraKey?: string
}

export interface LayerTileAddress extends LayerTileAddressInput {
  key: string
}

export interface LayerTileRecord extends TileRecord {
  layerId: string
  layerKind: LayerTileKind
  sourceVersion?: string | number
  cameraKey?: string
}

export interface LayerTileInvalidation {
  layerId: string
  layerKind?: LayerTileKind
  rect?: DirtyRect
  sourceVersion?: string | number
  cameraKey?: string
  reason?: "source-changed" | "camera-changed" | "layer-edited" | "manual"
}

function positiveInt(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(1, Math.round(next))
}

export function tileKey(col: number, row: number) {
  return `${col}:${row}`
}

function sanitizeKeyPart(value: string | number | undefined, fallback: string) {
  const raw = value === undefined || value === null ? fallback : String(value)
  return raw.replace(/[^a-zA-Z0-9_.-]+/g, "_")
}

export function createLayerTileAddress(input: LayerTileAddressInput): LayerTileAddress {
  const colValue = Number(input.col)
  const rowValue = Number(input.row)
  const col = Number.isFinite(colValue) ? Math.max(0, Math.round(colValue)) : 0
  const row = Number.isFinite(rowValue) ? Math.max(0, Math.round(rowValue)) : 0
  const versionOrCamera =
    input.layerKind === "3d"
      ? sanitizeKeyPart(input.cameraKey, "default-camera")
      : sanitizeKeyPart(input.sourceVersion, "unversioned")
  return {
    ...input,
    col,
    row,
    key: `${input.layerKind}:${sanitizeKeyPart(input.layerId, "layer")}:${versionOrCamera}:${col}:${row}`,
  }
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

function rectsIntersect(a: DirtyRect, b: DirtyRect) {
  const ax1 = a.x + a.w
  const ay1 = a.y + a.h
  const bx1 = b.x + b.w
  const by1 = b.y + b.h
  return a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 && a.x < bx1 && ax1 > b.x && a.y < by1 && ay1 > b.y
}

function tileRectForAddress(address: LayerTileAddress, plan: TiledBackingStorePlan): DirtyRect {
  const x = address.col * plan.tileSize
  const y = address.row * plan.tileSize
  return {
    x,
    y,
    w: Math.max(0, Math.min(plan.tileSize, plan.width - x)),
    h: Math.max(0, Math.min(plan.tileSize, plan.height - y)),
  }
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

let storeCounter = 0

export class TiledBackingStore {
  readonly plan: TiledBackingStorePlan
  private readonly scratchNs: string
  private readonly tiles = new Map<string, TileRecord>()
  private readonly memory = new Map<string, Blob>()
  private readonly layerTiles = new Map<string, LayerTileRecord>()
  private readonly layerMemory = new Map<string, Blob>()

  constructor(input: TiledBackingStorePlanInput) {
    this.plan = planTiledBackingStore(input)
    // Fall back to a per-instance counter so unnamespaced stores still get
    // unique scratch keys; capped to keep keys within the OPFS key length.
    const ns = sanitizeKeyPart(input.scratchNamespace ?? "", "").slice(0, 40)
    this.scratchNs = ns || `store${++storeCounter}`
    for (const tile of tileRecordsForPlan(this.plan)) this.tiles.set(tile.key, tile)
  }

  private scratchTileKey(key: string) {
    return `tile-${this.scratchNs}-${key.replace(":", "-")}`
  }

  private scratchLayerTileKey(key: string) {
    return `layer-tile-${this.scratchNs}-${key.replace(/[^a-zA-Z0-9_.-]+/g, "-")}`
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
      const result = await writeScratchBlob(this.scratchTileKey(key), blob)
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
    if (tile.storage === "opfs") return readScratchBlob(this.scratchTileKey(key))
    return this.memory.get(key) ?? null
  }

  async deleteTile(key: string): Promise<void> {
    this.memory.delete(key)
    await deleteScratchKey(this.scratchTileKey(key))
    this.tiles.delete(key)
  }

  async writeLayerTile(addressInput: LayerTileAddressInput | LayerTileAddress, blob: Blob): Promise<"memory" | "opfs"> {
    const address = "key" in addressInput ? addressInput : createLayerTileAddress(addressInput)
    const rect = tileRectForAddress(address, this.plan)
    const record: LayerTileRecord = {
      key: address.key,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      dirty: false,
      bytes: Math.max(0, rect.w * rect.h * BYTES_PER_PIXEL),
      storage: "memory",
      layerId: address.layerId,
      layerKind: address.layerKind,
      sourceVersion: address.sourceVersion,
      cameraKey: address.cameraKey,
    }
    this.layerTiles.set(address.key, record)
    if (this.plan.strategy === "spill-to-opfs") {
      const result = await writeScratchBlob(this.scratchLayerTileKey(address.key), blob)
      record.storage = result === "persisted" ? "opfs" : "memory"
      if (record.storage === "memory") this.layerMemory.set(address.key, blob)
      return record.storage
    }
    this.layerMemory.set(address.key, blob)
    return "memory"
  }

  async readLayerTile(addressInput: LayerTileAddressInput | LayerTileAddress): Promise<Blob | null> {
    const address = "key" in addressInput ? addressInput : createLayerTileAddress(addressInput)
    const tile = this.layerTiles.get(address.key)
    if (!tile || tile.dirty) return null
    if (tile.storage === "opfs") return readScratchBlob(this.scratchLayerTileKey(address.key))
    return this.layerMemory.get(address.key) ?? null
  }

  async getOrRenderLayerTile(
    addressInput: LayerTileAddressInput | LayerTileAddress,
    render: (address: LayerTileAddress) => Blob | Promise<Blob>,
  ): Promise<Blob> {
    const address = "key" in addressInput ? addressInput : createLayerTileAddress(addressInput)
    const cached = await this.readLayerTile(address)
    if (cached) return cached
    const rendered = await render(address)
    await this.writeLayerTile(address, rendered)
    return rendered
  }

  invalidateLayerTiles(invalidation: LayerTileInvalidation): string[] {
    const dirtied: string[] = []
    for (const record of this.layerTiles.values()) {
      if (record.layerId !== invalidation.layerId) continue
      if (invalidation.layerKind && record.layerKind !== invalidation.layerKind) continue
      if (invalidation.sourceVersion !== undefined && record.sourceVersion === invalidation.sourceVersion) continue
      if (invalidation.cameraKey !== undefined && record.cameraKey === invalidation.cameraKey) continue
      if (invalidation.rect && !rectsIntersect(record, invalidation.rect)) continue
      record.dirty = true
      this.layerMemory.delete(record.key)
      dirtied.push(record.key)
    }
    return dirtied.sort()
  }

  dirtyLayerTiles(layerId?: string): LayerTileRecord[] {
    return [...this.layerTiles.values()].filter((tile) => tile.dirty && (!layerId || tile.layerId === layerId))
  }

  estimateCacheBytes(): number {
    let bytes = 0
    for (const blob of this.memory.values()) bytes += blob.size
    for (const blob of this.layerMemory.values()) bytes += blob.size
    for (const tile of this.tiles.values()) {
      if (tile.storage === "opfs") bytes += tile.bytes
    }
    for (const tile of this.layerTiles.values()) {
      if (tile.storage === "opfs") bytes += tile.bytes
    }
    return bytes
  }

  async purgeCache(): Promise<number> {
    const estimatedBytes = this.estimateCacheBytes()
    this.memory.clear()
    this.layerMemory.clear()

    const scratchDeletes: Promise<unknown>[] = []
    for (const tile of this.tiles.values()) {
      if (tile.storage === "opfs") scratchDeletes.push(deleteScratchKey(this.scratchTileKey(tile.key)))
      tile.storage = "memory"
      tile.dirty = true
    }
    for (const tile of this.layerTiles.values()) {
      if (tile.storage === "opfs") {
        scratchDeletes.push(deleteScratchKey(this.scratchLayerTileKey(tile.key)))
      }
    }
    this.layerTiles.clear()

    await Promise.allSettled(scratchDeletes)
    return estimatedBytes
  }
}
