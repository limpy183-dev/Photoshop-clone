import type { PathProps, Selection } from "../types"

import { makeCanvas } from "../canvas-utils"
import {
  borderMaskData as borderMaskDataPure,
  contractMaskData as contractMaskDataPure,
  expandMaskData as expandMaskDataPure,
  extractMaskContourPaths,
  featherMaskData as featherMaskDataPure,
  selectionMaskToPathCandidates,
  smoothMaskData as smoothMaskDataPure,
  transformSelectionMaskData as transformSelectionMaskDataPure,
  type MaskContourOptions,
  type MaskContourPath,
} from "../selection-algorithms"
import { tracePath } from "../tool-helpers-shape"
import { MASK_THRESHOLD } from "../tool-helpers-shared"

/* ---------------------------------------------------------------- */
/*  POLYGON RASTERIZATION (lasso)                                     */
/* ---------------------------------------------------------------- */

export function polygonToMask(
  width: number,
  height: number,
  points: { x: number; y: number }[],
): HTMLCanvasElement {
  const c = makeCanvas(width, height)
  if (points.length < 3) return c
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
  ctx.fill()
  return c
}

export function polygonBounds(points: { x: number; y: number }[]) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function maskBounds(mask: HTMLCanvasElement, threshold = MASK_THRESHOLD) {
  const ctx = mask.getContext("2d")
  if (!ctx) return null
  const w = mask.width
  const h = mask.height
  const img = ctx.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > threshold) {
        any = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export function selectionToMaskCanvas(
  width: number,
  height: number,
  selection: Selection,
): HTMLCanvasElement | null {
  if (selection.mask) {
    const copy = makeCanvas(width, height)
    copy.getContext("2d")!.drawImage(selection.mask, 0, 0)
    return copy
  }
  if (!selection.bounds) return null
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  const b = selection.bounds
  ctx.fillStyle = "#fff"
  if (selection.shape === "ellipse") {
    ctx.beginPath()
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }
  return mask
}

export function selectionFromMask(
  mask: HTMLCanvasElement,
  shape: Selection["shape"] = "freehand",
  feather?: number,
): Selection {
  const bounds = maskBounds(mask)
  return bounds ? { bounds, shape, mask, feather } : { bounds: null, shape: "rect" }
}

export function maskToBinary(mask: HTMLCanvasElement, threshold = MASK_THRESHOLD) {
  const ctx = mask.getContext("2d")!
  const img = ctx.getImageData(0, 0, mask.width, mask.height)
  const out = new Uint8Array(mask.width * mask.height)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + 3] > threshold ? 1 : 0
  return out
}

export function binaryToMask(binary: Uint8Array, width: number, height: number) {
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  const out = ctx.createImageData(width, height)
  for (let i = 0; i < binary.length; i++) {
    const a = binary[i] ? 255 : 0
    out.data[i * 4] = 255
    out.data[i * 4 + 1] = 255
    out.data[i * 4 + 2] = 255
    out.data[i * 4 + 3] = a
  }
  ctx.putImageData(out, 0, 0)
  return mask
}

export function imageDataToMask(img: ImageData) {
  const mask = makeCanvas(img.width, img.height)
  mask.getContext("2d")!.putImageData(img, 0, 0)
  return mask
}

export function maskToAlphaData(mask: HTMLCanvasElement) {
  const ctx = mask.getContext("2d")!
  const img = ctx.getImageData(0, 0, mask.width, mask.height)
  const out = new Uint8ClampedArray(mask.width * mask.height)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + 3]
  return out
}

export function alphaDataToMask(alpha: Uint8ClampedArray, width: number, height: number) {
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  const img = ctx.createImageData(width, height)
  for (let i = 0; i < alpha.length; i++) {
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = 255
    img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = alpha[i]
  }
  ctx.putImageData(img, 0, 0)
  return mask
}

export function expandSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    expandMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function contractSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    contractMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function borderSelectionMask(mask: HTMLCanvasElement, width: number): HTMLCanvasElement {
  return alphaDataToMask(
    borderMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, width, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function smoothSelectionMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    smoothMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function transformSelectionMask(
  mask: HTMLCanvasElement,
  bounds: { x: number; y: number; w: number; h: number },
  scale: number,
  rotationDeg: number,
  smoothing = true,
  extras?: { scaleX?: number; scaleY?: number; translateX?: number; translateY?: number },
): HTMLCanvasElement {
  return alphaDataToMask(
    transformSelectionMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, bounds, {
      scale,
      scaleX: extras?.scaleX,
      scaleY: extras?.scaleY,
      translateX: extras?.translateX,
      translateY: extras?.translateY,
      rotationDeg,
      smoothing,
    }),
    mask.width,
    mask.height,
  )
}

export function colorRangeMask(
  src: ImageData,
  target: { r: number; g: number; b: number },
  tolerance: number,
): ImageData {
  const out = new ImageData(src.width, src.height)
  const fuzziness = Math.max(0, tolerance)
  const falloff = Math.max(8, fuzziness * 0.35)
  for (let i = 0; i < src.data.length; i += 4) {
    if (src.data[i + 3] === 0) continue
    const dr = src.data[i] - target.r
    const dg = src.data[i + 1] - target.g
    const db = src.data[i + 2] - target.b
    const d = Math.sqrt(dr * dr + dg * dg + db * db)
    let alpha = 0
    if (d <= fuzziness) alpha = 255
    else if (d <= fuzziness + falloff) alpha = Math.round(255 * (1 - (d - fuzziness) / falloff))
    out.data[i] = 255
    out.data[i + 1] = 255
    out.data[i + 2] = 255
    out.data[i + 3] = alpha
  }
  return out
}

/* ---------------------------------------------------------------- */
/*  SELECTION FEATHER                                                 */
/* ---------------------------------------------------------------- */

export function featherMask(mask: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return alphaDataToMask(
    featherMaskDataPure(maskToAlphaData(mask), mask.width, mask.height, radius, MASK_THRESHOLD),
    mask.width,
    mask.height,
  )
}

export function extractMarchingAntsPaths(
  mask: HTMLCanvasElement,
  options: MaskContourOptions = {},
): MaskContourPath[] {
  return extractMaskContourPaths(maskToAlphaData(mask), mask.width, mask.height, {
    threshold: options.threshold ?? MASK_THRESHOLD,
    simplifyTolerance: options.simplifyTolerance ?? 0.35,
    minPoints: options.minPoints ?? 4,
  })
}

function contourPathToPath(contour: MaskContourPath): PathProps {
  const points = contour.points.map((point) => ({
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
  }))
  if (contour.closed && points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first.x === last.x && first.y === last.y) points.pop()
  }
  return { points, closed: contour.closed }
}

export function selectionToPathCandidatesFromMask(mask: HTMLCanvasElement, tolerance = 1.25): PathProps[] {
  return selectionMaskToPathCandidates(maskToAlphaData(mask), mask.width, mask.height, {
    threshold: MASK_THRESHOLD,
    simplifyTolerance: tolerance,
    minPoints: 4,
  })
    .map(contourPathToPath)
    .filter((path) => path.points.length >= (path.closed ? 3 : 2))
}

export function selectionToPath(
  selection: Selection,
  width: number,
  height: number,
  tolerance = 1.25,
): PathProps | null {
  const mask = selectionToMaskCanvas(width, height, selection)
  if (!mask) return null
  return selectionToPathCandidatesFromMask(mask, tolerance)[0] ?? null
}

export function cleanBinaryMask(binary: Uint8Array, width: number, height: number, closeRadius = 2, openRadius = 0) {
  let mask = binaryToMask(binary, width, height)
  if (closeRadius > 0) mask = contractSelectionMask(expandSelectionMask(mask, closeRadius), closeRadius)
  if (openRadius > 0) mask = expandSelectionMask(contractSelectionMask(mask, openRadius), openRadius)
  return maskToBinary(mask)
}

export function keepScoredComponents(
  binary: Uint8Array,
  width: number,
  height: number,
  scoreComponent: (pixels: number[], touchesEdge: boolean) => number,
  minScoreRatio = 0.34,
  minPixels = 8,
) {
  const visited = new Uint8Array(width * height)
  const components: { pixels: number[]; score: number }[] = []
  for (let i = 0; i < binary.length; i++) {
    if (!binary[i] || visited[i]) continue
    const stack = [i]
    const pixels: number[] = []
    let touchesEdge = false
    while (stack.length) {
      const p = stack.pop()!
      if (visited[p] || !binary[p]) continue
      visited[p] = 1
      pixels.push(p)
      const x = p % width
      const y = (p - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
      if (x > 0) stack.push(p - 1)
      if (x < width - 1) stack.push(p + 1)
      if (y > 0) stack.push(p - width)
      if (y < height - 1) stack.push(p + width)
    }
    if (pixels.length >= minPixels) components.push({ pixels, score: scoreComponent(pixels, touchesEdge) })
  }
  let best = 0
  for (const c of components) if (c.score > best) best = c.score
  const out = new Uint8Array(width * height)
  if (best <= 0) return out
  for (const c of components) {
    if (c.score >= best * minScoreRatio) {
      for (const p of c.pixels) out[p] = 1
    }
  }
  return out
}

/* ---------------------------------------------------------------- */
/*  Vector path -> mask (used for vector layer masks)                  */
/* ---------------------------------------------------------------- */

export function pathToMask(
  width: number,
  height: number,
  path: PathProps,
): HTMLCanvasElement {
  const c = makeCanvas(width, height)
  if (!path.closed || path.points.length < 3) return c
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#fff"
  if (tracePath(ctx, path)) ctx.fill("evenodd")
  return c
}

export function pathToSelectionMask(
  path: PathProps,
  width: number,
  height: number,
  options: { feather?: number; strokeWidth?: number } = {},
): HTMLCanvasElement {
  const mask = makeCanvas(width, height)
  const ctx = mask.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.strokeStyle = "#fff"
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.lineWidth = Math.max(1, options.strokeWidth ?? 2)
  if (tracePath(ctx, path)) {
    if (path.closed && path.points.length >= 3) ctx.fill("evenodd")
    else ctx.stroke()
  }
  return options.feather && options.feather > 0 ? featherMask(mask, options.feather) : mask
}
