import { maskAlphaEpoch } from "@/editor/canvas/compositor-cache"
import { makeCanvas, selectBackgroundMask, selectionToMaskCanvas } from "@/editor/tool/helpers"
import type { Layer, PsDocument, Selection } from "@/editor/types"

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

/**
 * Hit-test text layers by their *box*, not by glyph coverage.
 *
 * `autoPickLayer` requires an opaque pixel, so clicking the gap between two
 * letters (or inside a counter) misses the layer entirely — which made
 * double-click-to-edit feel broken. Text editing wants the looser bounding-box
 * behaviour Photoshop has, so this walks top-down and returns the first text
 * layer whose rendered bounds (or declared paragraph box, when the raster is
 * empty because the layer is mid-edit) contain the point.
 */
export function pickTextLayerAt(
  document: PsDocument,
  point: { x: number; y: number },
  padding = 6,
): Layer | null {
  for (let index = document.layers.length - 1; index >= 0; index--) {
    const layer = document.layers[index] as Layer
    if (!layer.visible || layer.kind !== "text" || !layer.text) continue
    if (typeof layer.canvas.getContext !== "function") continue
    const text = layer.text
    const bounds = alphaBounds(layer.canvas) ?? {
      x: text.x,
      y: text.y,
      w: text.boxWidth ?? text.size * 4,
      h: text.boxHeight ?? (text.leading ?? text.size * 1.2),
    }
    if (
      point.x >= bounds.x - padding &&
      point.x <= bounds.x + bounds.w + padding &&
      point.y >= bounds.y - padding &&
      point.y <= bounds.y + bounds.h + padding
    ) {
      return layer
    }
  }
  return null
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

/**
 * Lift the selected pixels of `snapshot` into their own canvas, and (unless
 * `copy`) erase them from `snapshot`.
 *
 * This is what makes the move tool move a *selection* rather than the whole
 * layer: the float rides the cursor while the punched-through snapshot stays
 * put. Returns null when there is no selection, which leaves callers on the
 * plain whole-layer path.
 */
export function liftSelectionFloat(
  document: PsDocument,
  snapshot: HTMLCanvasElement,
  copy: boolean,
): HTMLCanvasElement | null {
  if (!document.selection.bounds) return null
  const mask = selectionToMaskCanvas(document.width, document.height, document.selection)
  if (!mask) return null

  const float = makeCanvas(document.width, document.height)
  const fctx = float.getContext("2d")
  if (!fctx) return null
  fctx.drawImage(snapshot, 0, 0)
  fctx.globalCompositeOperation = "destination-in"
  fctx.drawImage(mask, 0, 0)

  if (!copy) {
    const sctx = snapshot.getContext("2d")
    if (sctx) {
      sctx.save()
      sctx.globalCompositeOperation = "destination-out"
      sctx.drawImage(mask, 0, 0)
      sctx.restore()
    }
  }
  return float
}

/** The document's selection translated by (dx, dy), mask included. */
export function translateSelection(document: PsDocument, dx: number, dy: number): Selection {
  const bounds = document.selection.bounds
  const shifted: Selection = {
    ...document.selection,
    bounds: bounds ? { ...bounds, x: bounds.x + dx, y: bounds.y + dy } : null,
  }
  if (document.selection.mask) {
    const moved = makeCanvas(document.width, document.height)
    moved.getContext("2d")?.drawImage(document.selection.mask, dx, dy)
    shifted.mask = moved
  }
  return shifted
}

export function selectBackgroundMaskFromImage(
  canvas: HTMLCanvasElement,
  tolerance: number,
) {
  return selectBackgroundMask(canvas, tolerance)
}
