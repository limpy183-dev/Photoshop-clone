import { assertFileSize, MAX_RASTER_FILE_BYTES } from "./canvas-limits"

const MB = 1024 * 1024

export const ADVANCED_FILE_LIMITS = {
  rasterBytes: MAX_RASTER_FILE_BYTES,
  modelTextBytes: 16 * MB,
  modelBinaryBytes: 32 * MB,
  jsonBytes: 2 * MB,
  csvBytes: 5 * MB,
  fontBytes: 20 * MB,
} as const

export function assertAdvancedFileSize(file: File, maxBytes = ADVANCED_FILE_LIMITS.rasterBytes, label = "Advanced file") {
  assertFileSize(file, maxBytes, label)
}

export function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value))
}

export function createSubsystemCanvas(width: number, height: number, fill?: string) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  if (fill) {
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  return canvas
}

export function readAscii(buffer: ArrayBuffer, start: number, length: number) {
  return new TextDecoder("ascii").decode(buffer.slice(start, start + length))
}

export function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
