import { planTileGrid, type DirtyRect } from "./performance-engine"
import { planProgressivePreview } from "./progressive-preview"

export interface ProgressiveRenderPlanInput {
  width: number
  height: number
  viewport?: DirtyRect
  dirtyRects?: DirtyRect[]
  tileSize?: number
}

export interface ProgressiveRenderPlan {
  mode: "full-only" | "preview-then-full"
  previewScale: number
  tileKeys: string[]
  fullResolutionDelayMs: number
  pixelCount: number
}

function rectCenter(rect: DirtyRect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

function tileDistance(col: number, row: number, tileSize: number, anchors: DirtyRect[]) {
  if (!anchors.length) return 0
  const cx = col * tileSize + tileSize / 2
  const cy = row * tileSize + tileSize / 2
  let best = Number.POSITIVE_INFINITY
  for (const anchor of anchors) {
    const ac = rectCenter(anchor)
    best = Math.min(best, Math.hypot(cx - ac.x, cy - ac.y))
  }
  return best
}

function dirtyKeysForRects(rects: DirtyRect[] | undefined, width: number, height: number, tileSize: number) {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const rect of rects ?? []) {
    const x0 = Math.max(0, Math.floor(rect.x))
    const y0 = Math.max(0, Math.floor(rect.y))
    const x1 = Math.min(width, Math.ceil(rect.x + rect.w))
    const y1 = Math.min(height, Math.ceil(rect.y + rect.h))
    if (x1 <= x0 || y1 <= y0) continue
    const col0 = Math.floor(x0 / tileSize)
    const row0 = Math.floor(y0 / tileSize)
    const col1 = Math.floor((x1 - 1) / tileSize)
    const row1 = Math.floor((y1 - 1) / tileSize)
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const key = `${col}:${row}`
        if (!seen.has(key)) {
          seen.add(key)
          keys.push(key)
        }
      }
    }
  }
  return keys
}

export function planProgressiveRender(input: ProgressiveRenderPlanInput): ProgressiveRenderPlan {
  const preview = planProgressivePreview({ width: input.width, height: input.height })
  const tileSize = Math.max(1, Math.round(input.tileSize ?? 512))
  const grid = planTileGrid(input.width, input.height, tileSize)
  const anchors = input.dirtyRects?.length ? input.dirtyRects : input.viewport ? [input.viewport] : []
  const tiles: Array<{ key: string; distance: number }> = []
  for (let row = 0; row < grid.tileRows; row++) {
    for (let col = 0; col < grid.tileColumns; col++) {
      tiles.push({ key: `${col}:${row}`, distance: tileDistance(col, row, tileSize, anchors) })
    }
  }
  tiles.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key))
  const firstPreview = preview.stages.find((stage) => !stage.final)
  const fullStage = preview.stages.find((stage) => stage.final) ?? preview.stages[preview.stages.length - 1]
  const previewScale = firstPreview?.scale ?? 1
  const dirtyKeys = dirtyKeysForRects(input.dirtyRects, input.width, input.height, tileSize)
  const orderedKeys = [
    ...dirtyKeys,
    ...tiles.map((tile) => tile.key).filter((key) => !dirtyKeys.includes(key)),
  ]
  return {
    mode: preview.shouldStage ? "preview-then-full" : "full-only",
    previewScale: preview.shouldStage ? Math.max(0.25, previewScale) : 1,
    tileKeys: orderedKeys,
    fullResolutionDelayMs: fullStage.delayMs,
    pixelCount: preview.pixelCount,
  }
}
