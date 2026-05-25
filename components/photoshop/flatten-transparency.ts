import type { Layer } from "./types"

export type FlattenTransparencyAlphaMode = "clear" | "preserve"

export interface FlattenTransparencyOptions {
  matte: string
  alphaMode: FlattenTransparencyAlphaMode
}

export interface FlattenTransparencyStats {
  changedPixels: number
  transparentPixels: number
  semiTransparentPixels: number
}

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHexColor(color: string, fallback: Rgb = { r: 255, g: 255, b: 255 }): Rgb {
  const value = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    }
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!long) return fallback
  return {
    r: parseInt(long[1], 16),
    g: parseInt(long[2], 16),
    b: parseInt(long[3], 16),
  }
}

export function flattenTransparencyCanvas(
  canvas: HTMLCanvasElement,
  options: FlattenTransparencyOptions,
): FlattenTransparencyStats {
  const ctx = canvas.getContext?.("2d")
  const stats: FlattenTransparencyStats = { changedPixels: 0, transparentPixels: 0, semiTransparentPixels: 0 }
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return stats

  const matte = parseHexColor(options.matte)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < image.data.length; i += 4) {
    const alphaByte = image.data[i + 3]
    if (alphaByte === 255) continue

    const alpha = alphaByte / 255
    image.data[i] = Math.round(image.data[i] * alpha + matte.r * (1 - alpha))
    image.data[i + 1] = Math.round(image.data[i + 1] * alpha + matte.g * (1 - alpha))
    image.data[i + 2] = Math.round(image.data[i + 2] * alpha + matte.b * (1 - alpha))
    if (options.alphaMode === "clear") image.data[i + 3] = 255

    stats.changedPixels += 1
    if (alphaByte === 0) stats.transparentPixels += 1
    else stats.semiTransparentPixels += 1
  }

  if (stats.changedPixels > 0) ctx.putImageData(image, 0, 0)
  return stats
}

export function layerHasPartialAlpha(layer: Layer): boolean {
  const canvas = layer.canvas
  const ctx = canvas?.getContext?.("2d")
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return false

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < image.data.length; i += 4) {
    const alpha = image.data[i]
    if (alpha > 0 && alpha < 255) return true
  }
  return false
}
