export interface WorkflowPlacement {
  dx: number
  dy: number
  score: number
}

export interface AutoAlignOptions {
  searchRadius?: number
}

export interface SelectAndMaskPreviewOptions {
  viewMode: SelectAndMaskViewMode
  outputTo: SelectAndMaskOutputTarget
  opacity?: number
  decontaminateColors?: boolean
}

export type SelectAndMaskViewMode =
  | "onion"
  | "marching"
  | "overlay"
  | "on-black"
  | "on-white"
  | "bw"
  | "on-layers"
  | "on-transparent"
  | "on-blue"

export type SelectAndMaskOutputTarget =
  | "selection"
  | "layer-mask"
  | "new-layer"
  | "new-layer-mask"
  | "new-document"
  | "alpha-channel"

export const SELECT_AND_MASK_VIEW_MODES: Array<{ id: SelectAndMaskViewMode; label: string; background: string }> = [
  { id: "onion", label: "Onion Skin (O)", background: "checker" },
  { id: "marching", label: "Marching Ants (M)", background: "transparent" },
  { id: "overlay", label: "Overlay (V)", background: "red-overlay" },
  { id: "on-black", label: "On Black (A)", background: "black" },
  { id: "on-white", label: "On White (T)", background: "white" },
  { id: "bw", label: "Black & White (K)", background: "mask" },
  { id: "on-layers", label: "On Layers (Y)", background: "layers" },
  { id: "on-transparent", label: "On Transparent", background: "transparent-grid" },
  { id: "on-blue", label: "On Blue", background: "blue" },
]

export const SELECT_AND_MASK_OUTPUT_TARGETS: Array<{ id: SelectAndMaskOutputTarget; label: string }> = [
  { id: "selection", label: "Selection" },
  { id: "layer-mask", label: "Layer Mask" },
  { id: "new-layer", label: "New Layer" },
  { id: "new-layer-mask", label: "New Layer with Layer Mask" },
  { id: "new-document", label: "New Document" },
  { id: "alpha-channel", label: "Alpha Channel" },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const clamp8 = (value: number) => clamp(Math.round(value), 0, 255)

function makeImageData(width: number, height: number, data?: Uint8ClampedArray) {
  return new ImageData(data ?? new Uint8ClampedArray(width * height * 4), width, height)
}

function pixelIndex(img: ImageData, x: number, y: number) {
  return (y * img.width + x) * 4
}

function lumaAt(img: ImageData, x: number, y: number) {
  const sx = clamp(x, 0, img.width - 1)
  const sy = clamp(y, 0, img.height - 1)
  const i = pixelIndex(img, sx, sy)
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
}

function rgbAt(img: ImageData, x: number, y: number) {
  const sx = clamp(x, 0, img.width - 1)
  const sy = clamp(y, 0, img.height - 1)
  const i = pixelIndex(img, sx, sy)
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }
}

function localContrast(img: ImageData, x: number, y: number) {
  const center = rgbAt(img, x, y)
  const contrastTo = (sample: { r: number; g: number; b: number }) =>
    Math.abs(center.r - sample.r) + Math.abs(center.g - sample.g) + Math.abs(center.b - sample.b)
  return (
    contrastTo(rgbAt(img, x - 1, y)) +
    contrastTo(rgbAt(img, x + 1, y)) +
    contrastTo(rgbAt(img, x, y - 1)) +
    contrastTo(rgbAt(img, x, y + 1))
  )
}

function alignmentScore(reference: ImageData, moving: ImageData, dx: number, dy: number) {
  let score = 0
  let count = 0
  for (let y = 0; y < reference.height; y++) {
    const my = y - dy
    if (my < 0 || my >= moving.height) continue
    for (let x = 0; x < reference.width; x++) {
      const mx = x - dx
      if (mx < 0 || mx >= moving.width) continue
      const ri = pixelIndex(reference, x, y)
      const mi = pixelIndex(moving, mx, my)
      if (reference.data[ri + 3] === 0 && moving.data[mi + 3] === 0) continue
      const rd = localContrast(reference, x, y)
      const md = localContrast(moving, mx, my)
      const dr = reference.data[ri] - moving.data[mi]
      const dg = reference.data[ri + 1] - moving.data[mi + 1]
      const db = reference.data[ri + 2] - moving.data[mi + 2]
      score += dr * dr + dg * dg + db * db + Math.abs(rd - md) * 6
      count++
    }
  }
  if (!count) return Number.POSITIVE_INFINITY
  const overlapPenalty = (reference.width * reference.height - count) * 8
  return score / count + overlapPenalty
}

export function estimateImageTranslation(reference: ImageData, moving: ImageData, options: AutoAlignOptions = {}): WorkflowPlacement {
  const radius = Math.max(0, Math.round(options.searchRadius ?? 12))
  let best: WorkflowPlacement = { dx: 0, dy: 0, score: alignmentScore(reference, moving, 0, 0) }
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const score = alignmentScore(reference, moving, dx, dy)
      if (score < best.score) best = { dx, dy, score }
    }
  }
  return best
}

export function autoAlignImageStack(images: ImageData[], options: AutoAlignOptions = {}) {
  if (!images.length) return { placements: [] as WorkflowPlacement[] }
  const reference = images[0]
  return {
    placements: images.map((image, index) =>
      index === 0 ? { dx: 0, dy: 0, score: 0 } : estimateImageTranslation(reference, image, options),
    ),
  }
}

export function autoBlendImageStack(images: ImageData[], placements: WorkflowPlacement[] = autoAlignImageStack(images).placements) {
  const width = images[0]?.width ?? 1
  const height = images[0]?.height ?? 1
  const sums = new Float64Array(width * height * 4)
  const weights = new Float64Array(width * height)
  const coverage = new Uint8Array(width * height)

  for (let s = 0; s < images.length; s++) {
    const image = images[s]
    const placement = placements[s] ?? { dx: 0, dy: 0, score: 0 }
    for (let y = 0; y < height; y++) {
      const sy = y - placement.dy
      if (sy < 0 || sy >= image.height) continue
      for (let x = 0; x < width; x++) {
        const sx = x - placement.dx
        if (sx < 0 || sx >= image.width) continue
        const si = pixelIndex(image, sx, sy)
        const alpha = image.data[si + 3] / 255
        if (alpha <= 0) continue
        const edgeDistance = Math.min(sx, sy, image.width - 1 - sx, image.height - 1 - sy)
        const feather = clamp(edgeDistance / 2, 0.35, 1)
        const weight = alpha * feather
        const p = y * width + x
        const oi = p * 4
        sums[oi] += image.data[si] * weight
        sums[oi + 1] += image.data[si + 1] * weight
        sums[oi + 2] += image.data[si + 2] * weight
        sums[oi + 3] += image.data[si + 3] * weight
        weights[p] += weight
        coverage[p]++
      }
    }
  }

  const out = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const oi = p * 4
    const weight = weights[p]
    if (weight <= 0) continue
    out[oi] = clamp8(sums[oi] / weight)
    out[oi + 1] = clamp8(sums[oi + 1] / weight)
    out[oi + 2] = clamp8(sums[oi + 2] / weight)
    out[oi + 3] = clamp8(sums[oi + 3] / weight)
  }

  return { image: makeImageData(width, height, out), coverage }
}

export function photomergeImageStack(images: ImageData[], options: AutoAlignOptions = {}) {
  const aligned = autoAlignImageStack(images, options)
  const blended = autoBlendImageStack(images, aligned.placements)
  const seamColumns: number[] = []
  for (let x = 0; x < blended.image.width; x++) {
    let overlap = 0
    for (let y = 0; y < blended.image.height; y++) {
      if (blended.coverage[y * blended.image.width + x] > 1) overlap++
    }
    if (overlap > 0) seamColumns.push(x)
  }
  return { ...blended, placements: aligned.placements, seamColumns }
}

export function mergeHdrImageStack(images: ImageData[], exposures: Array<{ ev: number }> = images.map(() => ({ ev: 0 }))) {
  const width = images[0]?.width ?? 1
  const height = images[0]?.height ?? 1
  const out = new Uint8ClampedArray(width * height * 4)
  const exposureWeights = images.map(() => new Float64Array(width * height))

  for (let p = 0; p < width * height; p++) {
    let wr = 0
    let wg = 0
    let wb = 0
    let wa = 0
    let total = 0
    for (let s = 0; s < images.length; s++) {
      const image = images[s]
      const i = p * 4
      const luma = (0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]) / 255
      const clipped = image.data[i] > 235 || image.data[i + 1] > 235 || image.data[i + 2] > 235
      const blocked = image.data[i] < 8 && image.data[i + 1] < 8 && image.data[i + 2] < 8
      const exposureScale = 2 ** -(exposures[s]?.ev ?? 0)
      const wellExposed = Math.max(0.02, 1 - Math.abs(luma - 0.42) * 1.8)
      const weight = wellExposed * (clipped || blocked ? 0.25 : 1)
      exposureWeights[s][p] = weight
      wr += image.data[i] * exposureScale * weight
      wg += image.data[i + 1] * exposureScale * weight
      wb += image.data[i + 2] * exposureScale * weight
      wa += image.data[i + 3] * weight
      total += weight
    }
    const oi = p * 4
    if (total <= 0) continue
    out[oi] = clamp8(wr / total)
    out[oi + 1] = clamp8(wg / total)
    out[oi + 2] = clamp8(wb / total)
    out[oi + 3] = clamp8(wa / total)
  }

  return { image: makeImageData(width, height, out), exposureWeights }
}

export function focusStackImageData(images: ImageData[]) {
  const width = images[0]?.width ?? 1
  const height = images[0]?.height ?? 1
  const out = new Uint8ClampedArray(width * height * 4)
  const sourceIndexByPixel = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0
      let bestScore = -1
      for (let s = 0; s < images.length; s++) {
        const score = localContrast(images[s], x, y)
        if (score > bestScore) {
          best = s
          bestScore = score
        }
      }
      const p = y * width + x
      const si = pixelIndex(images[best], x, y)
      const oi = p * 4
      out[oi] = images[best].data[si]
      out[oi + 1] = images[best].data[si + 1]
      out[oi + 2] = images[best].data[si + 2]
      out[oi + 3] = images[best].data[si + 3]
      sourceIndexByPixel[p] = best
    }
  }

  return { image: makeImageData(width, height, out), sourceIndexByPixel }
}

export function buildSelectAndMaskPreviewModel(options: SelectAndMaskPreviewOptions) {
  const view = SELECT_AND_MASK_VIEW_MODES.find((item) => item.id === options.viewMode) ?? SELECT_AND_MASK_VIEW_MODES[2]
  const outputTo = options.outputTo
  const overlayOpacity = clamp((options.opacity ?? 50) / 100, 0, 1)
  return {
    viewMode: view.id,
    background: view.background,
    overlayOpacity,
    showsComposite: view.id === "on-layers" || view.id === "marching" || view.id === "onion",
    showsMaskOnly: view.id === "bw",
    output: {
      target: outputTo,
      createsDocument: outputTo === "new-document",
      createsLayer: outputTo === "new-layer" || outputTo === "new-layer-mask",
      createsMask: outputTo === "layer-mask" || outputTo === "new-layer-mask",
      createsChannel: outputTo === "alpha-channel",
      preservesSource: outputTo !== "selection" && outputTo !== "layer-mask",
      supportsDecontamination: !!options.decontaminateColors && outputTo !== "selection" && outputTo !== "alpha-channel",
    },
  }
}
