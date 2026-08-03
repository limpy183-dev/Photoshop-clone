/* ===================================================================
 * Phase 5 — Selection Workflows (Gap Report Item 20)
 *
 * Grow/shrink/similar/transform/border/smooth/feather selection,
 * named selection save/load, and enhanced Color Range helpers.
 * =================================================================== */

// ── Grow Selection (morphological dilation) ─────────────────────────

/**
 * Expand a binary selection mask outward by N pixels using circular dilation.
 */
export function growSelection(mask: Uint8Array, width: number, height: number, pixels: number): Uint8Array {
  const radius = Math.max(0, Math.round(pixels))
  if (radius === 0) return new Uint8Array(mask)
  const out = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const val = mask[ny * width + nx]
          if (val > maxVal) maxVal = val
        }
      }
      out[y * width + x] = maxVal
    }
  }
  return out
}

// ── Shrink Selection (morphological erosion) ────────────────────────

/**
 * Contract a binary selection mask inward by N pixels using circular erosion.
 */
export function shrinkSelection(mask: Uint8Array, width: number, height: number, pixels: number): Uint8Array {
  const radius = Math.max(0, Math.round(pixels))
  if (radius === 0) return new Uint8Array(mask)
  const out = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) { minVal = 0; continue }
          const val = mask[ny * width + nx]
          if (val < minVal) minVal = val
        }
      }
      out[y * width + x] = minVal
    }
  }
  return out
}

// ── Select Similar ──────────────────────────────────────────────────

/**
 * Find all pixels in the image that are similar in color to currently
 * selected pixels. Returns a soft mask.
 */
export function selectSimilarPixels(
  imageData: ImageData,
  currentMask: Uint8Array,
  tolerance: number,
  contiguous: boolean,
  _sampleAllLayers: boolean = false,
): Uint8Array {
  const w = imageData.width
  const h = imageData.height
  const d = imageData.data
  const tol = Math.max(0, Math.min(255, tolerance))

  // Collect sample colors from currently selected pixels
  const sampleColors: Array<[number, number, number]> = []
  const maxSamples = 256
  for (let i = 0; i < w * h && sampleColors.length < maxSamples; i++) {
    if (currentMask[i] > 128) {
      const pi = i * 4
      sampleColors.push([d[pi], d[pi + 1], d[pi + 2]])
    }
  }

  if (!sampleColors.length) return new Uint8Array(w * h)

  const result = new Uint8Array(w * h)

  function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
  }

  // Mark all pixels that match any sample within tolerance
  for (let i = 0; i < w * h; i++) {
    const pi = i * 4
    const r = d[pi], g = d[pi + 1], b = d[pi + 2]
    let matched = false
    for (const [sr, sg, sb] of sampleColors) {
      if (colorDistance(r, g, b, sr, sg, sb) <= tol * 1.732) {
        matched = true
        break
      }
    }
    if (matched) result[i] = 255
  }

  if (contiguous) {
    // Flood fill from existing selection to limit to contiguous regions
    const visited = new Uint8Array(w * h)
    const queue: number[] = []

    for (let i = 0; i < w * h; i++) {
      if (currentMask[i] > 128 && result[i] > 0) {
        queue.push(i)
        visited[i] = 1
      }
    }

    const contiguousResult = new Uint8Array(w * h)
    while (queue.length > 0) {
      const idx = queue.pop()!
      contiguousResult[idx] = 255
      const x = idx % w
      const y = Math.floor(idx / w)
      const neighbors = [
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
      ]
      for (const ni of neighbors) {
        if (ni >= 0 && !visited[ni] && result[ni] > 0) {
          visited[ni] = 1
          queue.push(ni)
        }
      }
    }
    return contiguousResult
  }

  return result
}

// ── Transform Selection ─────────────────────────────────────────────

/**
 * Apply geometric transformation to a selection mask using bilinear interpolation.
 */
export function transformSelectionMask(
  mask: Uint8Array,
  width: number,
  height: number,
  transform: {
    scaleX: number
    scaleY: number
    rotation: number
    translateX: number
    translateY: number
    skewX?: number
    skewY?: number
  },
): Uint8Array {
  const out = new Uint8Array(width * height)
  const cx = width / 2
  const cy = height / 2
  const cosR = Math.cos(-transform.rotation)
  const sinR = Math.sin(-transform.rotation)
  const sx = transform.scaleX || 1
  const sy = transform.scaleY || 1
  const skewX = transform.skewX || 0
  const skewY = transform.skewY || 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Inverse transform to find source position
      let px = x - cx - transform.translateX
      let py = y - cy - transform.translateY

      // Inverse skew
      px = px - py * skewX
      py = py - px * skewY

      // Inverse rotation
      const rx = px * cosR - py * sinR
      const ry = px * sinR + py * cosR

      // Inverse scale
      const srcX = rx / sx + cx
      const srcY = ry / sy + cy

      // Bilinear interpolation
      const x0 = Math.floor(srcX)
      const y0 = Math.floor(srcY)
      const x1 = x0 + 1
      const y1 = y0 + 1
      const fx = srcX - x0
      const fy = srcY - y0

      function sample(sx: number, sy: number): number {
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) return 0
        return mask[sy * width + sx]
      }

      const v = sample(x0, y0) * (1 - fx) * (1 - fy)
        + sample(x1, y0) * fx * (1 - fy)
        + sample(x0, y1) * (1 - fx) * fy
        + sample(x1, y1) * fx * fy

      out[y * width + x] = Math.round(Math.max(0, Math.min(255, v)))
    }
  }

  return out
}

// ── Border Selection ────────────────────────────────────────────────

/**
 * Convert a selection to a border-only selection of the specified width.
 */
export function borderSelection(mask: Uint8Array, width: number, height: number, borderWidth: number): Uint8Array {
  const grown = growSelection(mask, width, height, borderWidth)
  const shrunk = shrinkSelection(mask, width, height, borderWidth)
  const out = new Uint8Array(width * height)

  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(0, grown[i] - shrunk[i])
  }
  return out
}

// ── Smooth Selection ────────────────────────────────────────────────

/**
 * Smooth selection edges using a majority-vote within the sample radius.
 */
export function smoothSelection(mask: Uint8Array, width: number, height: number, sampleRadius: number): Uint8Array {
  const radius = Math.max(1, Math.round(sampleRadius))
  const out = new Uint8Array(width * height)
  const threshold = Math.PI * radius * radius * 0.5 // ~half the circle area

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0
      let _total = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          _total++
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (mask[ny * width + nx] > 128) count++
          }
        }
      }
      out[y * width + x] = count >= threshold ? 255 : 0
    }
  }
  return out
}

// ── Feather Selection ───────────────────────────────────────────────

/**
 * Apply Gaussian feathering to selection edges.
 */
export function featherSelection(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(0.5, radius)
  const kernelSize = Math.ceil(r * 3) * 2 + 1
  const halfKernel = Math.floor(kernelSize / 2)

  // Build 1D Gaussian kernel
  const kernel = new Float32Array(kernelSize)
  let sum = 0
  for (let i = 0; i < kernelSize; i++) {
    const x = i - halfKernel
    kernel[i] = Math.exp(-(x * x) / (2 * r * r))
    sum += kernel[i]
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum

  // Horizontal pass
  const temp = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0
      for (let k = -halfKernel; k <= halfKernel; k++) {
        const nx = Math.max(0, Math.min(width - 1, x + k))
        val += mask[y * width + nx] * kernel[k + halfKernel]
      }
      temp[y * width + x] = val
    }
  }

  // Vertical pass
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0
      for (let k = -halfKernel; k <= halfKernel; k++) {
        const ny = Math.max(0, Math.min(height - 1, y + k))
        val += temp[ny * width + x] * kernel[k + halfKernel]
      }
      out[y * width + x] = Math.round(Math.max(0, Math.min(255, val)))
    }
  }
  return out
}

// ── Named Selection Save/Load ───────────────────────────────────────

export interface NamedSelection {
  id: string
  name: string
  mask: Uint8Array
  width: number
  height: number
  createdAt: number
  channelIndex?: number
}

/**
 * Serialize a named selection to a base64 JSON string for storage.
 */
export function serializeNamedSelection(selection: NamedSelection): string {
  const maskBase64 = btoa(String.fromCharCode(...selection.mask))
  return JSON.stringify({
    id: selection.id,
    name: selection.name,
    width: selection.width,
    height: selection.height,
    createdAt: selection.createdAt,
    channelIndex: selection.channelIndex,
    maskBase64,
  })
}

/**
 * Deserialize a named selection from a stored string.
 */
export function deserializeNamedSelection(data: string): NamedSelection | null {
  try {
    const parsed = JSON.parse(data)
    if (!parsed.maskBase64 || !parsed.width || !parsed.height) return null
    const binary = atob(parsed.maskBase64)
    const mask = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) mask[i] = binary.charCodeAt(i)
    return {
      id: parsed.id ?? `sel-${Date.now()}`,
      name: parsed.name ?? "Untitled",
      mask,
      width: parsed.width,
      height: parsed.height,
      createdAt: parsed.createdAt ?? Date.now(),
      channelIndex: parsed.channelIndex,
    }
  } catch {
    return null
  }
}

/** AND two selection masks. */
export function intersectSelections(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.min(a[i] ?? 0, b[i] ?? 0)
  return out
}

/** Subtract B from A. */
export function subtractSelections(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, (a[i] ?? 0) - (b[i] ?? 0))
  return out
}

/** OR two selection masks. */
export function addSelections(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length))
  for (let i = 0; i < out.length; i++) out[i] = Math.max(a[i] ?? 0, b[i] ?? 0)
  return out
}

// ── Enhanced Color Range ────────────────────────────────────────────

/**
 * Select pixels within a color range with Photoshop-style fuzziness
 * control. Returns a soft mask (0–255 per pixel).
 */
export function colorRangeSelectWithFuzziness(
  imageData: ImageData,
  targetColors: Array<{ r: number; g: number; b: number }>,
  fuzziness: number,
  range: number = 100,
): Uint8Array {
  const w = imageData.width
  const h = imageData.height
  const d = imageData.data
  const fuzz = Math.max(0, Math.min(200, fuzziness))
  const mask = new Uint8Array(w * h)

  for (let i = 0; i < w * h; i++) {
    const pi = i * 4
    const r = d[pi], g = d[pi + 1], b = d[pi + 2]

    let bestDist = Infinity
    for (const target of targetColors) {
      const dist = Math.sqrt(
        (r - target.r) ** 2 +
        (g - target.g) ** 2 +
        (b - target.b) ** 2,
      )
      if (dist < bestDist) bestDist = dist
    }

    // Fuzziness maps distance to selection strength
    const maxDist = fuzz * 1.732 * (range / 100) // scale by range
    if (bestDist <= maxDist * 0.5) {
      mask[i] = 255 // fully selected
    } else if (bestDist <= maxDist) {
      // Feathered edge
      const t = (bestDist - maxDist * 0.5) / (maxDist * 0.5)
      mask[i] = Math.round((1 - t) * 255)
    }
  }

  return mask
}

/**
 * Generate a preview ImageData showing the color range selection in
 * different preview modes.
 */
export function colorRangePreview(
  imageData: ImageData,
  mask: Uint8Array,
  previewMode: "grayscale" | "black-matte" | "white-matte" | "quick-mask",
): ImageData {
  const w = imageData.width
  const h = imageData.height
  const out = new ImageData(w, h)
  const d = imageData.data

  for (let i = 0; i < w * h; i++) {
    const pi = i * 4
    const alpha = mask[i] / 255

    switch (previewMode) {
      case "grayscale":
        out.data[pi] = mask[i]
        out.data[pi + 1] = mask[i]
        out.data[pi + 2] = mask[i]
        out.data[pi + 3] = 255
        break
      case "black-matte":
        out.data[pi] = Math.round(d[pi] * alpha)
        out.data[pi + 1] = Math.round(d[pi + 1] * alpha)
        out.data[pi + 2] = Math.round(d[pi + 2] * alpha)
        out.data[pi + 3] = 255
        break
      case "white-matte":
        out.data[pi] = Math.round(d[pi] * alpha + 255 * (1 - alpha))
        out.data[pi + 1] = Math.round(d[pi + 1] * alpha + 255 * (1 - alpha))
        out.data[pi + 2] = Math.round(d[pi + 2] * alpha + 255 * (1 - alpha))
        out.data[pi + 3] = 255
        break
      case "quick-mask":
        if (alpha < 0.5) {
          // Unselected — red overlay
          out.data[pi] = Math.round(d[pi] * 0.5 + 255 * 0.5)
          out.data[pi + 1] = Math.round(d[pi + 1] * 0.5)
          out.data[pi + 2] = Math.round(d[pi + 2] * 0.5)
        } else {
          out.data[pi] = d[pi]
          out.data[pi + 1] = d[pi + 1]
          out.data[pi + 2] = d[pi + 2]
        }
        out.data[pi + 3] = 255
        break
    }
  }

  return out
}
