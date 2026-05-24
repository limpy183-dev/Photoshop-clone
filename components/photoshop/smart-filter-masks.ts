import type { SmartFilter } from "./types"

const MAX_SMART_FILTER_MASK_FEATHER = 250

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function normalizeSmartFilterMaskDensity(value: unknown): number {
  if (value === undefined || value === null) return 1
  const numeric = Number(value)
  return Number.isFinite(numeric) ? clamp01(numeric) : 1
}

export function normalizeSmartFilterMaskFeather(value: unknown): number {
  if (value === undefined || value === null) return 0
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(MAX_SMART_FILTER_MASK_FEATHER, numeric))
}

export function resolveSmartFilterMaskAmount(rawAmount: number, density: unknown): number {
  const amount = clamp01(rawAmount)
  const normalizedDensity = normalizeSmartFilterMaskDensity(density)
  return 1 - normalizedDensity + amount * normalizedDensity
}

export function normalizeSmartFilterMaskControls<T extends Pick<SmartFilter, "maskDensity" | "maskFeather">>(
  filter: T,
): T {
  return {
    ...filter,
    maskDensity: normalizeSmartFilterMaskDensity(filter.maskDensity),
    maskFeather: normalizeSmartFilterMaskFeather(filter.maskFeather),
  }
}

export function smartFilterMaskAmountAt(
  mask: ImageData | null,
  x: number,
  y: number,
  density: unknown,
) {
  if (!mask || x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 1
  const i = (y * mask.width + x) * 4
  const luminance = (mask.data[i] + mask.data[i + 1] + mask.data[i + 2]) / 765
  const raw = luminance * (mask.data[i + 3] / 255)
  return resolveSmartFilterMaskAmount(raw, density)
}

function boxBlurAlpha(alpha: Uint8ClampedArray, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.round(radius))
  if (r <= 0) return alpha

  const horizontal = new Uint8ClampedArray(alpha.length)
  const out = new Uint8ClampedArray(alpha.length)
  const windowSize = r * 2 + 1

  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = -r; x <= r; x++) {
      const sx = Math.max(0, Math.min(width - 1, x))
      sum += alpha[y * width + sx]
    }
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = Math.round(sum / windowSize)
      const removeX = Math.max(0, x - r)
      const addX = Math.min(width - 1, x + r + 1)
      sum += alpha[y * width + addX] - alpha[y * width + removeX]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) {
      const sy = Math.max(0, Math.min(height - 1, y))
      sum += horizontal[sy * width + x]
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / windowSize)
      const removeY = Math.max(0, y - r)
      const addY = Math.min(height - 1, y + r + 1)
      sum += horizontal[addY * width + x] - horizontal[removeY * width + x]
    }
  }

  return out
}

export function smartFilterMaskToImageData(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  feather: unknown = 0,
): ImageData | null {
  const w = Math.min(canvas.width, width)
  const h = Math.min(canvas.height, height)
  if (w <= 0 || h <= 0) return null
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  const source = ctx.getImageData(0, 0, w, h)
  const alpha = new Uint8ClampedArray(w * h)
  for (let i = 0; i < alpha.length; i++) {
    const si = i * 4
    alpha[i] = Math.round(((source.data[si] + source.data[si + 1] + source.data[si + 2]) / 765) * source.data[si + 3])
  }

  const blurred = boxBlurAlpha(alpha, w, h, normalizeSmartFilterMaskFeather(feather))
  const out = new ImageData(w, h)
  for (let i = 0; i < blurred.length; i++) {
    const oi = i * 4
    out.data[oi] = 255
    out.data[oi + 1] = 255
    out.data[oi + 2] = 255
    out.data[oi + 3] = blurred[i]
  }
  return out
}
