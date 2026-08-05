/**
 * Shared maths and commit plumbing for the adjustment dialogs.
 *
 * These take everything they need as arguments — the document, the layer, the
 * commit callback — so they carry no React state and the dialogs in
 * `components/photoshop/adjustments/` can each import just what they use.
 */

import { makeCanvas } from "@/editor/canvas/utils"
import { compositeLayer } from "@/editor/blend-modes"
import type { Layer, PsDocument } from "@/editor/types"

export function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")
}

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * Composite the active document into a temporary canvas (matches how the
 * Color Range dialog samples colors). We need this for eyedropper-style
 * sampling because layers are stored separately.
 */
export function compositeDocument(doc: PsDocument): HTMLCanvasElement {
  const c = makeCanvas(doc.width, doc.height)
  const ctx = c.getContext("2d")!
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, doc.width, doc.height)
  for (const l of doc.layers) {
    if (!l.visible) continue
    compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
  }
  return c
}

export function activeRasterLayer(doc: PsDocument): Layer | null {
  for (const l of doc.layers) {
    if (!l.visible || l.locked) continue
    if (l.kind === "adjustment") continue
    return l
  }
  return null
}

export function commitFilterResult(
  doc: PsDocument,
  layer: Layer,
  result: ImageData,
  label: string,
  commit: (label: string, ids: string[]) => void,
) {
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) return
  ctx.putImageData(result, 0, 0)
  commit(label, [layer.id])
  void doc
}
