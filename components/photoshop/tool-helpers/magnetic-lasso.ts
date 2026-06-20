import {
  traceMagneticLassoEdgePathData,
  type MagneticLassoTraceOptions,
  type MagneticLassoTraceResult,
  type SelectionImageSource,
} from "../selection-algorithms"

export interface MagneticLassoSnapOptions {
  searchWidth?: number
  contrastThreshold?: number
  hysteresisRatio?: number
}

/**
 * Given cursor position and a canvas, compute edge strength in a search region
 * and return the position snapped to the strongest hysteresis-linked edge pixel.
 */
export function magneticLassoSnap(
  canvas: HTMLCanvasElement,
  cx: number,
  cy: number,
  options: number | MagneticLassoSnapOptions = 10,
): { x: number; y: number } {
  const ctx = canvas.getContext("2d")
  if (!ctx) return { x: Math.round(cx), y: Math.round(cy) }

  const w = canvas.width
  const h = canvas.height
  const searchWidth = typeof options === "number" ? options : options.searchWidth ?? 10
  const highThreshold = typeof options === "number" ? 8 : Math.max(1, options.contrastThreshold ?? 8)
  const lowThreshold = highThreshold * (typeof options === "number" ? 0.45 : Math.max(0.1, Math.min(0.95, options.hysteresisRatio ?? 0.45)))

  // Clamp the search region
  const x0 = Math.max(1, Math.floor(cx - searchWidth))
  const y0 = Math.max(1, Math.floor(cy - searchWidth))
  const x1 = Math.min(w - 2, Math.floor(cx + searchWidth))
  const y1 = Math.min(h - 2, Math.floor(cy + searchWidth))

  if (x0 >= x1 || y0 >= y1) return { x: Math.round(cx), y: Math.round(cy) }

  // Read the search region plus 1px border for the Sobel kernel
  const rw = x1 - x0 + 3
  const rh = y1 - y0 + 3
  const img = ctx.getImageData(x0 - 1, y0 - 1, rw, rh)
  const data = img.data

  // Convert to grayscale luminance
  const gray = new Float32Array(rw * rh)
  for (let i = 0; i < rw * rh; i++) {
    const j = i * 4
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  }

  // Scharr kernels provide better rotational precision than the basic Sobel
  // weights while keeping this pure 3x3 pixel math.
  const gradients = new Float32Array(rw * rh)
  const directions = new Float32Array(rw * rh)
  const thinned = new Float32Array(rw * rh)
  const strong = new Uint8Array(rw * rh)
  const linked = new Uint8Array(rw * rh)
  const queue: number[] = []

  for (let ry = 1; ry < rh - 1; ry++) {
    for (let rx = 1; rx < rw - 1; rx++) {
      const tl = gray[(ry - 1) * rw + (rx - 1)]
      const t = gray[(ry - 1) * rw + rx]
      const tr = gray[(ry - 1) * rw + (rx + 1)]
      const l = gray[ry * rw + (rx - 1)]
      const r = gray[ry * rw + (rx + 1)]
      const bl = gray[(ry + 1) * rw + (rx - 1)]
      const b = gray[(ry + 1) * rw + rx]
      const br = gray[(ry + 1) * rw + (rx + 1)]

      const gx = -3 * tl + 3 * tr - 10 * l + 10 * r - 3 * bl + 3 * br
      const gy = -3 * tl - 10 * t - 3 * tr + 3 * bl + 10 * b + 3 * br
      const grad = Math.sqrt(gx * gx + gy * gy) / 16
      const idx = ry * rw + rx
      gradients[idx] = grad
      directions[idx] = Math.atan2(gy, gx)
    }
  }

  for (let ry = 1; ry < rh - 1; ry++) {
    for (let rx = 1; rx < rw - 1; rx++) {
      const idx = ry * rw + rx
      const grad = gradients[idx]
      if (grad <= 0) continue
      const angle = ((directions[idx] * 180) / Math.PI + 180) % 180
      let before = idx - 1
      let after = idx + 1
      if (angle >= 22.5 && angle < 67.5) {
        before = idx - rw + 1
        after = idx + rw - 1
      } else if (angle >= 67.5 && angle < 112.5) {
        before = idx - rw
        after = idx + rw
      } else if (angle >= 112.5 && angle < 157.5) {
        before = idx - rw - 1
        after = idx + rw + 1
      }
      if (grad < gradients[before] || grad < gradients[after]) continue
      thinned[idx] = grad
      if (grad >= highThreshold) {
        strong[idx] = 1
        linked[idx] = 1
        queue.push(idx)
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]
    const px = p % rw
    const py = (p - px) / rw
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = px + dx
        const ny = py + dy
        if (nx <= 0 || ny <= 0 || nx >= rw - 1 || ny >= rh - 1) continue
        const ni = ny * rw + nx
        if (linked[ni] || thinned[ni] < lowThreshold) continue
        linked[ni] = 1
        queue.push(ni)
      }
    }
  }

  let bestScore = -Infinity
  let bestX = Math.round(cx)
  let bestY = Math.round(cy)
  for (let ry = 1; ry < rh - 1; ry++) {
    for (let rx = 1; rx < rw - 1; rx++) {
      const idx = ry * rw + rx
      if (!linked[idx]) continue
      const docX = x0 + rx - 1
      const docY = y0 + ry - 1
      const distancePenalty = Math.hypot(docX - cx, docY - cy) * highThreshold * 0.08
      const score = thinned[idx] - distancePenalty
      if (score > bestScore) {
        bestScore = score
        bestX = docX
        bestY = docY
      }
    }
  }

  if (bestScore === -Infinity) return { x: Math.round(cx), y: Math.round(cy) }
  return { x: bestX, y: bestY }
}

export function magneticLassoTrace(
  canvas: HTMLCanvasElement | SelectionImageSource,
  anchors: { x: number; y: number }[],
  options: MagneticLassoTraceOptions = {},
): MagneticLassoTraceResult {
  if (!("getContext" in canvas)) {
    if (anchors.length <= 1) {
      return {
        points: anchors.map((point) => ({ ...point })),
        diagnostics: {
          strongEdgePixels: 0,
          weakLinkedPixels: 0,
          thinnedEdgePixels: 0,
          fallbackSegments: 0,
          totalPoints: anchors.length,
        },
      }
    }
    return traceMagneticLassoEdgePathData(canvas, anchors, options)
  }
  const ctx = canvas.getContext("2d")
  if (!ctx || anchors.length <= 1) {
    return {
      points: anchors.map((point) => ({ ...point })),
      diagnostics: {
        strongEdgePixels: 0,
        weakLinkedPixels: 0,
        thinnedEdgePixels: 0,
        fallbackSegments: 0,
        totalPoints: anchors.length,
      },
    }
  }
  return traceMagneticLassoEdgePathData(ctx.getImageData(0, 0, canvas.width, canvas.height), anchors, options)
}
