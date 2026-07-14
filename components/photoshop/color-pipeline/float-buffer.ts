import type { HighBitImageOptions, PipelineColorMode } from "../color-pipeline-conversions"

import { applyHighBitAdjustment, toneMapHighBitImageToImageData } from "./high-bit-image"

export interface FloatPixelBuffer {
  width: number
  height: number
  channels: 4
  bitDepth: 32
  colorMode: PipelineColorMode
  profile?: string
  storage: "float32"
  data: Float32Array
  warnings: string[]
}

export type FloatFilterKind = "brightness-contrast" | "levels" | "curves" | "exposure" | "box-blur" | "sharpen"

export function createFloatBufferFromImageData(source: ImageData, options: HighBitImageOptions = {}): FloatPixelBuffer {
  const data = new Float32Array(source.data.length)
  for (let i = 0; i < source.data.length; i++) data[i] = source.data[i] / 255
  return {
    width: source.width,
    height: source.height,
    channels: 4,
    bitDepth: 32,
    colorMode: options.colorMode ?? "RGB",
    profile: options.profile,
    storage: "float32",
    data,
    warnings: [
      "Float filter buffers are local processing surfaces; browser canvas display remains tone-mapped 8-bit RGBA.",
    ],
  }
}

export function toneMapFloatBufferToImageData(source: FloatPixelBuffer): ImageData {
  return toneMapHighBitImageToImageData(source)
}

function cloneFloatBuffer(source: FloatPixelBuffer, data = new Float32Array(source.data)): FloatPixelBuffer {
  return {
    ...source,
    data,
    warnings: [...source.warnings],
  }
}

function floatParam(params: Record<string, number | string | boolean>, key: string, fallback: number) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

function applyFloatBoxBlur(source: FloatPixelBuffer, radius: number): FloatPixelBuffer {
  const r = Math.max(0, Math.floor(radius))
  if (r <= 0) return cloneFloatBuffer(source)
  const { width, height } = source
  const tmp = new Float32Array(source.data.length)
  const out = new Float32Array(source.data.length)
  const span = 2 * r + 1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0]
      for (let ox = -r; ox <= r; ox++) {
        const sx = Math.max(0, Math.min(width - 1, x + ox))
        const i = (y * width + sx) * 4
        for (let c = 0; c < 4; c++) sums[c] += source.data[i + c]
      }
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) tmp[o + c] = sums[c] / span
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0]
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(height - 1, y + oy))
        const i = (sy * width + x) * 4
        for (let c = 0; c < 4; c++) sums[c] += tmp[i + c]
      }
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = sums[c] / span
    }
  }
  return cloneFloatBuffer(source, out)
}

function applyFloatSharpen(source: FloatPixelBuffer, amount: number): FloatPixelBuffer {
  const { width, height } = source
  const a = amount / 100
  const kernel = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]
  const out = new Float32Array(source.data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        let value = 0
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const sx = Math.max(0, Math.min(width - 1, x + kx - 1))
            const sy = Math.max(0, Math.min(height - 1, y + ky - 1))
            value += source.data[(sy * width + sx) * 4 + c] * kernel[ky * 3 + kx]
          }
        }
        out[o + c] = value
      }
      out[o + 3] = source.data[o + 3]
    }
  }
  return cloneFloatBuffer(source, out)
}

export function applyFloatBufferFilter(
  source: FloatPixelBuffer,
  filter: FloatFilterKind,
  params: Record<string, number | string | boolean> = {},
): FloatPixelBuffer {
  if (filter === "box-blur") return applyFloatBoxBlur(source, floatParam(params, "radius", 1))
  if (filter === "sharpen") return applyFloatSharpen(source, floatParam(params, "amount", 50))
  if (filter === "brightness-contrast" || filter === "levels" || filter === "curves" || filter === "exposure") {
    return applyHighBitAdjustment(source, { type: filter, params }) as FloatPixelBuffer
  }
  const factor = 2 ** floatParam(params, "ev", 0)
  const out = new Float32Array(source.data)
  for (let i = 0; i < out.length; i += 4) {
    out[i] *= factor
    out[i + 1] *= factor
    out[i + 2] *= factor
  }
  return cloneFloatBuffer(source, out)
}
