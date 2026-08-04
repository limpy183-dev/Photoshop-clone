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

/** Everything a stroke needs to stay inside the active selection. */
export interface SelectionClip {
  /** The selection, as a mask over the whole document. */
  mask: HTMLCanvasElement
  /** The target's own pixels from *outside* the selection. */
  outside: HTMLCanvasElement
}

/**
 * Capture the clip a stroke on `target` should be confined to, or null when the
 * document has no selection to confine it to.
 *
 * Painting used to be gated by a point test on each dab's centre, so a brush
 * whose centre was just inside a marquee still spilled its whole radius over the
 * edge — and dabs centred just outside painted nothing at all, even where they
 * overlapped it. Masking the painted result instead cuts exactly on the
 * selection boundary, feathered edges included, for every tool that paints.
 */
export function captureSelectionClip(
  document: PsDocument,
  target: HTMLCanvasElement | null,
): SelectionClip | null {
  // Quick Mask paints the selection itself, so it must not be clipped by it.
  if (!target || document.quickMask || !document.selection.bounds) return null
  const mask = selectionToMaskCanvas(document.width, document.height, document.selection)
  if (!mask) return null
  const outside = makeCanvas(target.width, target.height)
  const context = outside.getContext("2d")
  if (!context) return null
  context.drawImage(target, 0, 0)
  context.globalCompositeOperation = "destination-out"
  context.drawImage(mask, 0, 0)
  return { mask, outside }
}

/**
 * Cut the just-painted pixels back to the selection.
 *
 * A `buffered` target holds only the stroke, so masking it is the whole job.
 * Painting straight onto a layer also wipes the pixels outside the selection,
 * which is why the untouched remainder is composited back underneath — the two
 * halves are disjoint, so nothing double-composites and an eraser stroke still
 * erases rather than restoring what it just removed.
 */
export function applySelectionClip(
  context: CanvasRenderingContext2D,
  clip: SelectionClip | null,
  options: { buffered: boolean },
) {
  if (!clip) return
  context.save()
  context.globalCompositeOperation = "destination-in"
  context.drawImage(clip.mask, 0, 0)
  if (!options.buffered) {
    context.globalCompositeOperation = "destination-over"
    context.drawImage(clip.outside, 0, 0)
  }
  context.restore()
}

/**
 * Cheap reject for a dab that cannot reach the selection at all.
 *
 * The exact cut is `applySelectionClip`'s job; this only spares the per-pixel
 * stamps the work when a dab's box misses the selection's box outright. It
 * replaces a test on the dab *centre*, which discarded the half of every
 * edge-straddling dab that should have painted.
 */
export function dabTouchesSelection(
  document: PsDocument | null | undefined,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (!document || document.quickMask) return true
  const bounds = document.selection.bounds
  if (!bounds) return true
  return (
    x + radius >= bounds.x &&
    x - radius <= bounds.x + bounds.w &&
    y + radius >= bounds.y &&
    y - radius <= bounds.y + bounds.h
  )
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

/**
 * A selection's pixels lifted out of their layer and parked at (x, y).
 *
 * Photoshop floats a selection once and keeps moving that float. Re-lifting on
 * every drag would cut a *second* hole — through whatever the previous drag had
 * parked the pixels on top of — so dragging back and forth over existing artwork
 * ate it. `base` is the layer without the float; `base` plus `float` drawn at
 * (x, y) reproduces what the user sees.
 */
export interface MoveFloat {
  layerId: string
  /** Identity of the selection this float belongs to; anything else re-lifts. */
  selection: Selection
  base: HTMLCanvasElement
  float: HTMLCanvasElement
  x: number
  y: number
}

/**
 * The carried float if this press should keep moving it, else null.
 *
 * ponytail: keyed on selection identity, layer and tool. A menu edit that
 * repaints the layer while the move tool and selection both stay put would leave
 * a stale base — stamp a layer edit counter if that ever shows up.
 */
export function reusableMoveFloat(
  carried: MoveFloat | null,
  layerId: string,
  selection: Selection,
  copy: boolean,
): MoveFloat | null {
  if (!carried || copy) return null
  return carried.layerId === layerId && carried.selection === selection ? carried : null
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
