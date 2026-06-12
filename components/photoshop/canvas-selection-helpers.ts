import { maskAlphaEpoch } from "./canvas-compositor-cache"
import { selectBackgroundMask, selectionToMaskCanvas } from "./tool-helpers"
import type { Layer, PsDocument } from "./types"

export function createRemoveMask(
  points: { x: number; y: number }[],
  brushSize: number,
  width: number,
  height: number,
): ImageData {
  const mask = new ImageData(width, height)
  const data = mask.data

  for (let index = 0; index < data.length; index += 4) {
    data[index + 3] = 0
  }

  if (points.length === 0) return mask

  const radius = brushSize / 2
  for (const point of points) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(point.x)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(point.y)))

    for (let deltaY = -radius; deltaY <= radius; deltaY++) {
      for (let deltaX = -radius; deltaX <= radius; deltaX++) {
        const pixelX = x + deltaX
        const pixelY = y + deltaY

        if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
          if (distance <= radius) {
            const index = (pixelY * width + pixelX) * 4
            data[index + 3] = 255
          }
        }
      }
    }
  }

  return mask
}

export function clipToSelection(context: CanvasRenderingContext2D, document: PsDocument) {
  const selection = document.selection
  if (!selection.bounds) return
  if (selection.mask) {
    context.save()
    context.beginPath()
    context.rect(
      selection.bounds.x,
      selection.bounds.y,
      selection.bounds.w,
      selection.bounds.h,
    )
    context.clip()
    return
  }
  context.beginPath()
  if (selection.shape === "ellipse") {
    context.ellipse(
      selection.bounds.x + selection.bounds.w / 2,
      selection.bounds.y + selection.bounds.h / 2,
      selection.bounds.w / 2,
      selection.bounds.h / 2,
      0,
      0,
      Math.PI * 2,
    )
  } else {
    context.rect(
      selection.bounds.x,
      selection.bounds.y,
      selection.bounds.w,
      selection.bounds.h,
    )
  }
  context.clip()
}

export function autoPickLayer(
  document: PsDocument,
  point: { x: number; y: number },
): Layer | null {
  for (let index = document.layers.length - 1; index >= 0; index--) {
    const layer = document.layers[index] as Layer
    if (!layer.visible || layer.kind === "group") continue
    if (typeof layer.canvas.getContext !== "function") continue
    const context = layer.canvas.getContext("2d")!
    const pixel = context.getImageData(
      Math.floor(point.x),
      Math.floor(point.y),
      1,
      1,
    ).data
    if (pixel[3] > 8) return layer
  }
  return null
}

export type AlphaBoundsRect = {
  x: number
  y: number
  w: number
  h: number
} | null

const alphaBoundsCache = new WeakMap<HTMLCanvasElement, {
  epoch: number
  width: number
  height: number
  result: AlphaBoundsRect
}>()

export function alphaBounds(canvas: HTMLCanvasElement): AlphaBoundsRect {
  const context = canvas.getContext("2d")
  if (!context) return null
  const width = canvas.width
  const height = canvas.height
  const cached = alphaBoundsCache.get(canvas)
  if (
    cached &&
    cached.epoch === maskAlphaEpoch &&
    cached.width === width &&
    cached.height === height
  ) {
    return cached.result
  }
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let hasPixels = false
  for (let y = 0; y < height; y++) {
    let rowStart = y * width * 4 + 3
    for (let x = 0; x < width; x++, rowStart += 4) {
      if (data[rowStart] > 8) {
        hasPixels = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const result: AlphaBoundsRect = hasPixels
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : null
  alphaBoundsCache.set(canvas, {
    epoch: maskAlphaEpoch,
    width,
    height,
    result,
  })
  return result
}

export function applySelectionMaskToCanvas(
  canvas: HTMLCanvasElement,
  document: PsDocument,
) {
  const mask = selectionToMaskCanvas(
    document.width,
    document.height,
    document.selection,
  )
  if (!mask) return
  const context = canvas.getContext("2d")
  if (!context) return
  context.save()
  context.globalCompositeOperation = "destination-in"
  context.drawImage(mask, 0, 0)
  context.restore()
}

export function selectBackgroundMaskFromImage(
  canvas: HTMLCanvasElement,
  tolerance: number,
) {
  return selectBackgroundMask(canvas, tolerance)
}
