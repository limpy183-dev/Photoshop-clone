/**
 * Non-fatal "layer health" analysis surfaced as warnings above the layer list —
 * empty layers, hidden layers, layers fully masked out, and a coarse memory
 * estimate.
 *
 * Every probe downsamples to at most 64x64 before reading pixels back, because
 * this runs on each document change and a full readback of a large document
 * would stall the frame. That makes the answers approximate by design: they
 * drive a warning badge, never a compositing decision.
 */

import { makeCanvas } from "@/editor/canvas/utils"
import type { PsDocument } from "@/editor/types"

export interface LayerHealthWarning {
  id: string
  layerId?: string
  message: string
  severity: "warn" | "info"
}

export /** Cheap downscaled probe — true if the canvas has any non-transparent pixel. */
function canvasHasPixels(canvas: HTMLCanvasElement): boolean {
  const sw = Math.max(1, Math.min(64, canvas.width))
  const sh = Math.max(1, Math.min(64, canvas.height))
  const probe = makeCanvas(sw, sh)
  const ctx = probe.getContext("2d", { willReadFrequently: true })
  if (!ctx) return true
  try {
    ctx.clearRect(0, 0, sw, sh)
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, sw, sh)
    const data = ctx.getImageData(0, 0, sw, sh).data
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true
  } catch {
    return true
  }
  return false
}

/** True if a mask is effectively all-black (fully hides its layer). */
export function maskFullyHidden(mask: HTMLCanvasElement): boolean {
  const sw = Math.max(1, Math.min(64, mask.width))
  const sh = Math.max(1, Math.min(64, mask.height))
  const probe = makeCanvas(sw, sh)
  const ctx = probe.getContext("2d", { willReadFrequently: true })
  if (!ctx) return false
  try {
    ctx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, sw, sh)
    const data = ctx.getImageData(0, 0, sw, sh).data
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 8) return false
    }
  } catch {
    return false
  }
  return true
}

/** Surface non-fatal "layer health" issues a user would want flagged. */
export function analyzeLayerHealth(doc: PsDocument): { warnings: LayerHealthWarning[]; emptyIds: Set<string> } {
  const warnings: LayerHealthWarning[] = []
  const emptyIds = new Set<string>()
  for (const layer of doc.layers) {
    if (layer.kind === "group") continue
    const isPixel = !layer.kind || layer.kind === "raster"
    if (isPixel && !layer.smartObject && layer.kind !== "smart-object" && !canvasHasPixels(layer.canvas)) {
      emptyIds.add(layer.id)
      warnings.push({ id: `empty-${layer.id}`, layerId: layer.id, message: `"${layer.name}" is empty`, severity: "warn" })
    }
    if (layer.visible === false) {
      warnings.push({ id: `hidden-${layer.id}`, layerId: layer.id, message: `"${layer.name}" is hidden`, severity: "info" })
    }
    if (layer.mask && maskFullyHidden(layer.mask)) {
      warnings.push({ id: `masked-${layer.id}`, layerId: layer.id, message: `"${layer.name}" is fully hidden by its mask`, severity: "warn" })
    }
  }
  const bytes = doc.width * doc.height * 4 * Math.max(1, doc.layers.length)
  if (bytes > 320 * 1024 * 1024) {
    warnings.push({
      id: "memory",
      message: `High memory: ~${Math.round(bytes / (1024 * 1024))} MB across ${doc.layers.length} layers`,
      severity: "warn",
    })
  }
  return { warnings, emptyIds }
}
