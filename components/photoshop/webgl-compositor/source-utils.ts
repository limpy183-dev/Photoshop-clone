import type { Layer } from "../types"
import { appendPathToCanvas } from "../vector-path-operations"
import type { WebGLRect } from "./types"

export function cropWebGLSource(source: TexImageSource, rect: WebGLRect): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(rect.w))
  canvas.height = Math.max(1, Math.round(rect.h))
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(source as CanvasImageSource, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  return canvas
}

export function rasterizeVectorMaskForWebGL(layer: Pick<Layer, "vectorMask">, width: number, height: number, tileRect?: WebGLRect): HTMLCanvasElement | null {
  const vectorMask = layer.vectorMask
  if (!vectorMask || !vectorMask.closed || vectorMask.points.length < 3) return null
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(tileRect?.w ?? width))
  canvas.height = Math.max(1, Math.round(tileRect?.h ?? height))
  const ctx = canvas.getContext("2d")!
  ctx.save()
  if (tileRect) ctx.translate(-tileRect.x, -tileRect.y)
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  appendPathToCanvas(ctx, vectorMask)
  ctx.fill("evenodd")
  ctx.restore()
  return canvas
}

export function cropOptionalSource(source: TexImageSource | null | undefined, tileRect: WebGLRect | undefined) {
  if (!source || !tileRect) return source ?? null
  return cropWebGLSource(source, tileRect)
}

