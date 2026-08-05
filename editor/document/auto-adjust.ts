/**
 * In-place auto tone and auto contrast over raw ImageData.
 *
 * Both stretch the histogram to the full 0-255 range; auto tone does it per
 * channel (which shifts colour balance), auto contrast does it once against
 * luminance (which preserves it). Mutating the passed ImageData is deliberate —
 * callers already own a scratch buffer they are about to put back.
 */

export function autoTone(img: ImageData) {
  for (let ch = 0; ch < 3; ch++) {
    let min = 255, max = 0
    for (let i = ch; i < img.data.length; i += 4) {
      if (img.data[i] < min) min = img.data[i]
      if (img.data[i] > max) max = img.data[i]
    }
    const range = max - min || 1
    for (let i = ch; i < img.data.length; i += 4) {
      img.data[i] = Math.round(((img.data[i] - min) / range) * 255)
    }
  }
}

export function autoContrast(img: ImageData) {
  let min = 255, max = 0
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
    if (lum < min) min = lum
    if (lum > max) max = lum
  }
  const range = max - min || 1
  for (let i = 0; i < img.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      img.data[i + ch] = Math.round(Math.max(0, Math.min(255, ((img.data[i + ch] - min) / range) * 255)))
    }
  }
}
