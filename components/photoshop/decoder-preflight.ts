export interface DecoderDimensions { width: number; height: number; channels?: number; bitDepth?: number }

export interface DecoderLimits { maxWidth: number; maxHeight: number; maxPixels: number; maxBytes: number }

export interface DecoderPreflightResult { ok: boolean; estimatedBytes: number; reason?: string }

export function preflightDecoderDimensions(dimensions: DecoderDimensions, limits: DecoderLimits): DecoderPreflightResult {
  const { width, height } = dimensions
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return { ok: false, estimatedBytes: 0, reason: "Invalid image dimensions." }
  if (width > limits.maxWidth || height > limits.maxHeight) return { ok: false, estimatedBytes: 0, reason: `Image dimensions ${width}x${height} exceed the ${limits.maxWidth}x${limits.maxHeight} limit.` }
  const pixels = width * height
  if (pixels > limits.maxPixels) return { ok: false, estimatedBytes: 0, reason: `Image contains ${pixels.toLocaleString()} pixels, exceeding the ${limits.maxPixels.toLocaleString()} pixel limit.` }
  const bytesPerSample = dimensions.bitDepth && dimensions.bitDepth > 8 ? 2 : 1
  const estimatedBytes = pixels * Math.max(1, dimensions.channels ?? 4) * bytesPerSample
  if (estimatedBytes > limits.maxBytes) return { ok: false, estimatedBytes, reason: `Decoded image would require about ${Math.ceil(estimatedBytes / 1024 / 1024)} MB, exceeding the memory budget.` }
  return { ok: true, estimatedBytes }
}
