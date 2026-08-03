const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function sampledSeedColor(src: ImageData, x: number, y: number, radius: number, minAlpha: number) {
  const samples: Array<{ r: number; g: number; b: number }> = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = clamp(x + dx, 0, src.width - 1)
      const sy = clamp(y + dy, 0, src.height - 1)
      const i = (sy * src.width + sx) * 4
      if (src.data[i + 3] <= minAlpha) continue
      samples.push({ r: src.data[i], g: src.data[i + 1], b: src.data[i + 2] })
    }
  }
  if (!samples.length) return { r: 0, g: 0, b: 0, spread: 0 }
  const seed = {
    r: samples.reduce((sum, value) => sum + value.r, 0) / samples.length,
    g: samples.reduce((sum, value) => sum + value.g, 0) / samples.length,
    b: samples.reduce((sum, value) => sum + value.b, 0) / samples.length,
  }
  const distances = samples.map((value) => Math.hypot(value.r - seed.r, value.g - seed.g, value.b - seed.b))
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length
  const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length
  return { ...seed, spread: mean + Math.sqrt(variance) }
}

export function localColorGradient(data: Uint8ClampedArray, width: number, height: number, p: number) {
  const x = p % width
  const y = (p - x) / width
  const i = p * 4
  let max = 0
  const neighbors = [
    x > 0 ? p - 1 : -1,
    x < width - 1 ? p + 1 : -1,
    y > 0 ? p - width : -1,
    y < height - 1 ? p + width : -1,
  ]
  for (const next of neighbors) {
    if (next < 0) continue
    const ni = next * 4
    max = Math.max(max, Math.hypot(data[i] - data[ni], data[i + 1] - data[ni + 1], data[i + 2] - data[ni + 2]))
  }
  return max
}

export function sampleSizeRadius(size: string | undefined) {
  if (!size || size === "point") return 0
  const parsed = Number(size.split("x")[0])
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed / 2)) : 0
}
