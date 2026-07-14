import { canvasLimitLabel, canvasSizeError, clampCanvasSize } from "./canvas-limits"
import { planTiledBackingStore } from "./tile-store"
import type { PsbLargeDocumentOpenPlan } from "./raster-codecs-types"

export function planPsbLargeDocumentOpen(input: {
  width: number
  height: number
  fileName?: string
  tileSize?: number
  layerCount?: number
  memoryBudgetMB?: number
}): PsbLargeDocumentOpenPlan {
  const width = Math.max(1, Math.round(Number(input.width) || 1))
  const height = Math.max(1, Math.round(Number(input.height) || 1))
  const fileName = input.fileName || "PSB document"
  const tileSize = Math.max(128, Math.round(Number(input.tileSize) || 512))
  const fitsBrowserCanvas = !canvasSizeError(width, height, "PSB canvas")
  const halfWidth = Math.max(1, Math.round(width * 0.5))
  const halfHeight = Math.max(1, Math.round(height * 0.5))
  const halfError = canvasSizeError(halfWidth, halfHeight, "50% PSB canvas")
  const overview = clampCanvasSize(width, height)
  const overviewScale = Math.min(1, overview.width / width, overview.height / height)
  const tilePlan = planTiledBackingStore({
    width,
    height,
    tileSize,
    layerCount: input.layerCount,
    memoryBudgetMB: input.memoryBudgetMB,
  })
  const defaultError = fitsBrowserCanvas
    ? null
    : `${fileName} is ${width} x ${height} px, which exceeds this browser canvas limit (${canvasLimitLabel()}). open at 50% scale or use tile view, or downscale the PSB before opening for full-document editing.`
  return {
    width,
    height,
    fileName,
    fitsBrowserCanvas,
    defaultError,
    downscale50: {
      scale: 0.5,
      width: halfWidth,
      height: halfHeight,
      fits: !halfError,
      error: halfError,
    },
    tileView: {
      tileSize: tilePlan.tileSize,
      tileColumns: tilePlan.tileColumns,
      tileRows: tilePlan.tileRows,
      tileCount: tilePlan.tileCount,
      overviewScale,
      overviewWidth: overview.width,
      overviewHeight: overview.height,
      recommendation: tilePlan.recommendation,
    },
  }
}
