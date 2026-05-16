export const MAX_CANVAS_DIMENSION = 8192
export const MAX_CANVAS_PIXELS = 33_177_600
export const MAX_PROJECT_LAYERS = 128
export const MAX_PROJECT_CHANNELS = 32
export const MAX_PROJECT_DATA_URL_CHARS = 45_000_000
export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_RASTER_FILE_BYTES = 80 * 1024 * 1024
export const MAX_PSD_FILE_BYTES = 160 * 1024 * 1024

export function normalizeDimension(value: unknown, fallback = 1) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(1, Math.round(next))
}

export function canvasLimitLabel() {
  return `${MAX_CANVAS_DIMENSION}px per side and ${(MAX_CANVAS_PIXELS / 1_000_000).toFixed(1)} MP total`
}

export function canvasSizeError(width: unknown, height: unknown, label = "Canvas") {
  const w = normalizeDimension(width)
  const h = normalizeDimension(height)
  if (w > MAX_CANVAS_DIMENSION || h > MAX_CANVAS_DIMENSION) {
    return `${label} is too large. Maximum size is ${canvasLimitLabel()}.`
  }
  if (w * h > MAX_CANVAS_PIXELS) {
    return `${label} is too large. Maximum size is ${canvasLimitLabel()}.`
  }
  return null
}

export function assertCanvasSize(width: unknown, height: unknown, label = "Canvas") {
  const w = normalizeDimension(width)
  const h = normalizeDimension(height)
  const error = canvasSizeError(w, h, label)
  if (error) throw new Error(error)
  return { width: w, height: h }
}

export function clampCanvasSize(width: unknown, height: unknown) {
  let w = Math.min(MAX_CANVAS_DIMENSION, normalizeDimension(width))
  let h = Math.min(MAX_CANVAS_DIMENSION, normalizeDimension(height))
  const pixels = w * h
  if (pixels > MAX_CANVAS_PIXELS) {
    const scale = Math.sqrt(MAX_CANVAS_PIXELS / pixels)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  return { width: w, height: h }
}

export function assertFileSize(file: File, maxBytes: number, label: string) {
  if (file.size > maxBytes) {
    throw new Error(`${label} is too large. Maximum file size is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`)
  }
}
