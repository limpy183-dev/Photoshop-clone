import {
  convolve,
} from "./basic-algorithms"
import {
  clamp8,
  cloneImageData as clone,
  luma,
} from "./pixel-helpers"
import {
  pixelBlend,
  resampleImageData,
  selectChannelValue,
  type ApplyChannel,
} from "./helpers-shared"

export function parseKernelMatrix(value: unknown): number[] | null {
  if (typeof value !== "string" || !value.trim()) return null
  const numbers = value
    .trim()
    .split(/[\s,;]+/)
    .map(Number)
    .filter(Number.isFinite)
  const side = Math.sqrt(numbers.length)
  if (!Number.isInteger(side) || side < 3 || side > 7 || side % 2 === 0) return null
  return numbers
}

export function customConvolution(src: ImageData, preset: string, strength: number, bias: number, matrix = "", divisor = 0): ImageData {
  const kernels: Record<string, number[]> = {
    "sharpen-more": [0, -1, 0, -1, 5, -1, 0, -1, 0],
    "edge-enhance": [0, 0, 0, -1, 1, 0, 0, 0, 0],
    outline: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    laplacian: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    "sobel-x": [-1, 0, 1, -2, 0, 2, -1, 0, 1],
    "sobel-y": [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  }
  const kernel = parseKernelMatrix(matrix) ?? kernels[preset] ?? kernels["sharpen-more"]
  const kernelSum = kernel.reduce((sum, value) => sum + value, 0)
  const raw = convolve(src, kernel, divisor ? divisor : kernelSum > 0 ? kernelSum : 1)
  const mix = Math.max(0, Math.min(200, strength)) / 100
  const offset = Math.max(-255, Math.min(255, bias))
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(src.data[i] * (1 - mix) + (raw.data[i] + offset) * mix)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + (raw.data[i + 1] + offset) * mix)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + (raw.data[i + 2] + offset) * mix)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

/* --------- APPLY IMAGE / CALCULATIONS --------- */

export function applyImageFilter(
  src: ImageData,
  source: ImageData | null,
  channel: ApplyChannel,
  blendMode: string,
  opacity: number,
  invert: boolean,
  preserveTransparency: boolean,
): ImageData {
  if (!source) return clone(src)
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const sample = resampleImageData(source, w, h)
  const op = Math.max(0, Math.min(1, opacity))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let [sr, sg, sb] = selectChannelValue(sample.data, i, channel)
      if (invert) { sr = 255 - sr; sg = 255 - sg; sb = 255 - sb }
      const dr = src.data[i], dg = src.data[i + 1], db = src.data[i + 2]
      const [br, bg, bb] = pixelBlend(dr, dg, db, sr, sg, sb, blendMode)
      out[i] = clamp8(dr * (1 - op) + br * op)
      out[i + 1] = clamp8(dg * (1 - op) + bg * op)
      out[i + 2] = clamp8(db * (1 - op) + bb * op)
      out[i + 3] = preserveTransparency ? src.data[i + 3] : Math.max(src.data[i + 3], sample.data[i + 3])
    }
  }
  return new ImageData(out, w, h)
}

export function calculationsFilter(
  src: ImageData,
  sourceA: ImageData | null,
  sourceB: ImageData | null,
  channelA: ApplyChannel,
  channelB: ApplyChannel,
  blendMode: string,
  opacity: number,
  invertA: boolean,
  invertB: boolean,
  resultChannel: "gray" | "red" | "green" | "blue" | "alpha",
): ImageData {
  const w = src.width, h = src.height
  const out = new Uint8ClampedArray(src.data)
  const a = sourceA ? resampleImageData(sourceA, w, h) : src
  const b = sourceB ? resampleImageData(sourceB, w, h) : src
  const op = Math.max(0, Math.min(1, opacity))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let [ar, ag, ab] = selectChannelValue(a.data, i, channelA)
      let [br, bg, bb] = selectChannelValue(b.data, i, channelB)
      if (invertA) { ar = 255 - ar; ag = 255 - ag; ab = 255 - ab }
      if (invertB) { br = 255 - br; bg = 255 - bg; bb = 255 - bb }
      const [r, g, bl] = pixelBlend(ar, ag, ab, br, bg, bb, blendMode)
      const mixed = clamp8(luma(r, g, bl)) * op + clamp8(luma(ar, ag, ab)) * (1 - op)
      const v = clamp8(mixed)
      switch (resultChannel) {
        case "red":   out[i] = v; break
        case "green": out[i + 1] = v; break
        case "blue":  out[i + 2] = v; break
        case "alpha": out[i + 3] = v; break
        default:      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = src.data[i + 3] || 255
      }
    }
  }
  return new ImageData(out, w, h)
}

/* --------- REDUCE NOISE (Bilateral Filter) --------- */

