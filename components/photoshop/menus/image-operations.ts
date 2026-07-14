import { makeCanvas } from "../editor-context"
import { compositeLayer } from "../blend-modes"
import type { Layer, PsDocument } from "../types"

/**
 * Pure pixel/document operations backing the Image menu commands.
 * Callers own dispatch/commit; these helpers only mutate the canvases
 * exactly as the inline menu handlers previously did.
 */

export function applyAutoContrastToCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const mins = [255, 255, 255]
  const maxs = [0, 0, 0]
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    for (let k = 0; k < 3; k++) {
      if (src.data[i + k] < mins[k]) mins[k] = src.data[i + k]
      if (src.data[i + k] > maxs[k]) maxs[k] = src.data[i + k]
    }
  }
  for (let i = 0; i < src.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const range = Math.max(1, maxs[k] - mins[k])
      src.data[i + k] = Math.max(0, Math.min(255, ((src.data[i + k] - mins[k]) * 255) / range))
    }
  }
  ctx.putImageData(src, 0, 0)
}

export function applyAutoColorToCanvas(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d")!
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    sumR += src.data[i]
    sumG += src.data[i + 1]
    sumB += src.data[i + 2]
    count++
  }
  if (count === 0) return false
  const gray = (sumR + sumG + sumB) / (3 * count)
  const gains = [gray / Math.max(1, sumR / count), gray / Math.max(1, sumG / count), gray / Math.max(1, sumB / count)]
  for (let i = 0; i < src.data.length; i += 4) {
    src.data[i] = Math.max(0, Math.min(255, src.data[i] * gains[0]))
    src.data[i + 1] = Math.max(0, Math.min(255, src.data[i + 1] * gains[1]))
    src.data[i + 2] = Math.max(0, Math.min(255, src.data[i + 2] * gains[2]))
  }
  ctx.putImageData(src, 0, 0)
  return true
}

export function applyAutoWhiteBalanceToCanvas(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d")!
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    sumR += src.data[i]
    sumG += src.data[i + 1]
    sumB += src.data[i + 2]
    count++
  }
  if (count === 0) return false
  const avgR = sumR / count
  const avgG = sumG / count
  const avgB = sumB / count
  const gray = (avgR + avgG + avgB) / 3
  const sR = gray / Math.max(1, avgR)
  const sG = gray / Math.max(1, avgG)
  const sB = gray / Math.max(1, avgB)
  for (let i = 0; i < src.data.length; i += 4) {
    src.data[i] = Math.max(0, Math.min(255, src.data[i] * sR))
    src.data[i + 1] = Math.max(0, Math.min(255, src.data[i + 1] * sG))
    src.data[i + 2] = Math.max(0, Math.min(255, src.data[i + 2] * sB))
  }
  ctx.putImageData(src, 0, 0)
  return true
}

export function flipDocumentLayers(doc: PsDocument, axis: "horizontal" | "vertical") {
  for (const layer of doc.layers) {
    if (typeof layer.canvas.getContext !== "function") continue
    const tmp = makeCanvas(layer.canvas.width, layer.canvas.height)
    const ctx = tmp.getContext("2d")!
    if (axis === "horizontal") {
      ctx.translate(layer.canvas.width, 0)
      ctx.scale(-1, 1)
    } else {
      ctx.translate(0, layer.canvas.height)
      ctx.scale(1, -1)
    }
    ctx.drawImage(layer.canvas, 0, 0)
    const lctx = layer.canvas.getContext("2d")!
    lctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    lctx.drawImage(tmp, 0, 0)
  }
}

export function layerAlphaBounds(layer: Layer) {
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  let minX = layer.canvas.width
  let minY = layer.canvas.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < layer.canvas.height; y++) {
    for (let x = 0; x < layer.canvas.width; x++) {
      if (img.data[(y * layer.canvas.width + x) * 4 + 3] <= 8) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX >= minX ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export function documentContentBounds(doc: PsDocument) {
  const bounds = doc.layers.filter((layer) => layer.visible && layer.kind !== "group").map(layerAlphaBounds).filter(Boolean) as { x: number; y: number; w: number; h: number }[]
  if (!bounds.length) return null
  const left = Math.min(...bounds.map((b) => b.x))
  const top = Math.min(...bounds.map((b) => b.y))
  const right = Math.max(...bounds.map((b) => b.x + b.w))
  const bottom = Math.max(...bounds.map((b) => b.y + b.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function cropDocumentLayersToBounds(doc: PsDocument, bounds: { x: number; y: number; w: number; h: number }) {
  for (const layer of doc.layers) {
    const next = makeCanvas(bounds.w, bounds.h)
    next.getContext("2d")!.drawImage(layer.canvas, -bounds.x, -bounds.y)
    layer.canvas.width = bounds.w
    layer.canvas.height = bounds.h
    layer.canvas.getContext("2d")!.clearRect(0, 0, bounds.w, bounds.h)
    layer.canvas.getContext("2d")!.drawImage(next, 0, 0)
    if (layer.mask) {
      const mask = makeCanvas(bounds.w, bounds.h)
      mask.getContext("2d")!.drawImage(layer.mask, -bounds.x, -bounds.y)
      layer.mask.width = bounds.w
      layer.mask.height = bounds.h
      layer.mask.getContext("2d")!.clearRect(0, 0, bounds.w, bounds.h)
      layer.mask.getContext("2d")!.drawImage(mask, 0, 0)
    }
    if (layer.text) layer.text = { ...layer.text, x: layer.text.x - bounds.x, y: layer.text.y - bounds.y }
    if (layer.shape) layer.shape = { ...layer.shape, x: layer.shape.x - bounds.x, y: layer.shape.y - bounds.y }
  }
  doc.width = bounds.w
  doc.height = bounds.h
}

export function rotateDocumentLayers(doc: PsDocument, deg: number) {
  const w = doc.width
  const h = doc.height
  const radians = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const newW = Math.max(1, Math.ceil(w * cos + h * sin))
  const newH = Math.max(1, Math.ceil(w * sin + h * cos))
  const rotateCanvasInPlace = (canvas: HTMLCanvasElement | null | undefined, fill?: string) => {
    if (!canvas || typeof canvas.getContext !== "function") return
    const tmp = makeCanvas(newW, newH)
    const ctx = tmp.getContext("2d")!
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, newW, newH)
    }
    ctx.translate(newW / 2, newH / 2)
    ctx.rotate(radians)
    ctx.drawImage(canvas, -w / 2, -h / 2)
    canvas.width = newW
    canvas.height = newH
    const lctx = canvas.getContext("2d")!
    lctx.clearRect(0, 0, newW, newH)
    lctx.drawImage(tmp, 0, 0)
  }
  const rotatePoint = (x: number, y: number) => {
    const dx = x - w / 2
    const dy = y - h / 2
    return {
      x: newW / 2 + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: newH / 2 + dx * Math.sin(radians) + dy * Math.cos(radians),
    }
  }
  for (const layer of doc.layers) {
    rotateCanvasInPlace(layer.canvas)
    rotateCanvasInPlace(layer.mask)
    if (layer.frame?.imageCanvas) rotateCanvasInPlace(layer.frame.imageCanvas)
    if (layer.text) {
      const p = rotatePoint(layer.text.x, layer.text.y)
      layer.text = { ...layer.text, x: p.x, y: p.y }
    }
    if (layer.shape) {
      const center = rotatePoint(layer.shape.x + layer.shape.w / 2, layer.shape.y + layer.shape.h / 2)
      layer.shape = { ...layer.shape, x: center.x - layer.shape.w / 2, y: center.y - layer.shape.h / 2 }
    }
    if (layer.path) {
      layer.path = {
        ...layer.path,
        points: layer.path.points.map((point) => {
          const p = rotatePoint(point.x, point.y)
          const cp1 = point.cp1 ? rotatePoint(point.cp1.x, point.cp1.y) : undefined
          const cp2 = point.cp2 ? rotatePoint(point.cp2.x, point.cp2.y) : undefined
          return { ...point, ...p, cp1, cp2 }
        }),
      }
    }
    if (layer.vectorMask) {
      layer.vectorMask = {
        ...layer.vectorMask,
        points: layer.vectorMask.points.map((point) => {
          const p = rotatePoint(point.x, point.y)
          const cp1 = point.cp1 ? rotatePoint(point.cp1.x, point.cp1.y) : undefined
          const cp2 = point.cp2 ? rotatePoint(point.cp2.x, point.cp2.y) : undefined
          return { ...point, ...p, cp1, cp2 }
        }),
      }
    }
  }
  doc.width = newW
  doc.height = newH
}

export function flattenVisibleLayers(doc: PsDocument, backgroundFill?: string) {
  const flat = makeCanvas(doc.width, doc.height)
  const ctx = flat.getContext("2d")!
  if (backgroundFill) {
    ctx.fillStyle = backgroundFill
    ctx.fillRect(0, 0, doc.width, doc.height)
  }
  for (const l of doc.layers) {
    if (!l.visible) continue
    if (typeof l.canvas.getContext !== "function") continue
    compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
  }
  return flat
}

export function safeExportName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_") || "Untitled"
}
