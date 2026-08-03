// ── Per-Channel Proof Toggles ───────────────────────────────────────

export interface PerChannelProofOptions {
  cyan: boolean
  magenta: boolean
  yellow: boolean
  black: boolean
  simulatePaperWhite: boolean
  simulateInkBlack: boolean
}

/**
 * Soft proof with per-channel CMYK toggles. Channels set to false are
 * zeroed in the CMYK separation before converting back to RGB.
 */
export function softProofWithChannelToggles(
  imageData: ImageData,
  _proofProfile: string,
  options: PerChannelProofOptions,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const d = out.data

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255

    // Simple RGB-to-CMYK
    const k = options.black ? 1 - Math.max(r, g, b) : 0
    let c = options.cyan ? (1 - r - k) / (1 - k || 1) : 0
    let m = options.magenta ? (1 - g - k) / (1 - k || 1) : 0
    let y = options.yellow ? (1 - b - k) / (1 - k || 1) : 0

    c = Math.max(0, Math.min(1, c))
    m = Math.max(0, Math.min(1, m))
    y = Math.max(0, Math.min(1, y))

    // CMYK back to RGB
    d[i] = Math.round((1 - c) * (1 - k) * 255)
    d[i + 1] = Math.round((1 - m) * (1 - k) * 255)
    d[i + 2] = Math.round((1 - y) * (1 - k) * 255)

    // Paper/ink simulation
    if (options.simulatePaperWhite) {
      d[i] = Math.min(d[i], 245)
      d[i + 1] = Math.min(d[i + 1], 240)
      d[i + 2] = Math.min(d[i + 2], 235)
    }
    if (options.simulateInkBlack && k > 0.9) {
      d[i] = Math.max(d[i], 15)
      d[i + 1] = Math.max(d[i + 1], 15)
      d[i + 2] = Math.max(d[i + 2], 15)
    }
  }

  return out
}

/**
 * Generate a single-plate grayscale view for one CMYK channel.
 */
export function generatePlateView(
  imageData: ImageData,
  channel: "cyan" | "magenta" | "yellow" | "black",
  _proofProfile?: string,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const d = out.data

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    const k = 1 - Math.max(r, g, b)
    let value = 0

    if (channel === "cyan") value = k < 1 ? (1 - r - k) / (1 - k) : 0
    else if (channel === "magenta") value = k < 1 ? (1 - g - k) / (1 - k) : 0
    else if (channel === "yellow") value = k < 1 ? (1 - b - k) / (1 - k) : 0
    else value = k

    const gray = Math.round((1 - Math.max(0, Math.min(1, value))) * 255)
    d[i] = gray
    d[i + 1] = gray
    d[i + 2] = gray
    d[i + 3] = 255
  }

  return out
}

// ── Gamut/Plate View Helpers ────────────────────────────────────────

export interface GamutViewOptions {
  warningColor: string
  opacity: number
  mode: "overlay" | "solid" | "border"
}

/**
 * Render a gamut warning overlay on the image data. Out-of-gamut pixels
 * are highlighted using the selected visualization mode.
 */
export function renderGamutWarningOverlay(
  imageData: ImageData,
  _targetProfile: string,
  options: GamutViewOptions,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const d = out.data
  const w = imageData.width

  // Parse warning color
  const wc = options.warningColor.replace("#", "")
  const wr = parseInt(wc.substring(0, 2), 16) || 128
  const wg = parseInt(wc.substring(2, 4), 16) || 128
  const wb = parseInt(wc.substring(4, 6), 16) || 128
  const alpha = options.opacity

  // Simple sRGB gamut boundary check (colors near 0/255 in any channel are likely in-gamut)
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]

    // Approximate: very saturated colors outside sRGB gamut boundary
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0
    const isOutOfGamut = saturation > 0.95 && maxC > 240

    if (isOutOfGamut) {
      if (options.mode === "solid") {
        d[i] = wr
        d[i + 1] = wg
        d[i + 2] = wb
      } else if (options.mode === "overlay") {
        d[i] = Math.round(d[i] * (1 - alpha) + wr * alpha)
        d[i + 1] = Math.round(d[i + 1] * (1 - alpha) + wg * alpha)
        d[i + 2] = Math.round(d[i + 2] * (1 - alpha) + wb * alpha)
      } else if (options.mode === "border") {
        // Only mark border pixels of out-of-gamut regions
        const px = (i / 4) % w
        const py = Math.floor(i / 4 / w)
        const isEdge = px === 0 || py === 0 || px === w - 1 || py === imageData.height - 1
        if (isEdge) {
          d[i] = wr; d[i + 1] = wg; d[i + 2] = wb
        }
      }
    }
  }

  return out
}

/**
 * Calculate ink coverage percentages per CMYK channel plus total ink.
 */
export function generateInkCoverageReport(
  imageData: ImageData,
  _proofProfile?: string,
): { cyan: number; magenta: number; yellow: number; black: number; totalInk: number; maxTotalInk: number } {
  const d = imageData.data
  let totalC = 0, totalM = 0, totalY = 0, totalK = 0
  let maxTotalInk = 0
  let pixels = 0

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    const k = 1 - Math.max(r, g, b)
    const c = k < 1 ? (1 - r - k) / (1 - k) : 0
    const m = k < 1 ? (1 - g - k) / (1 - k) : 0
    const y = k < 1 ? (1 - b - k) / (1 - k) : 0

    totalC += c
    totalM += m
    totalY += y
    totalK += k
    const pixelTotalInk = (c + m + y + k) * 100
    if (pixelTotalInk > maxTotalInk) maxTotalInk = pixelTotalInk
    pixels++
  }

  const factor = pixels > 0 ? 100 / pixels : 0
  return {
    cyan: totalC * factor,
    magenta: totalM * factor,
    yellow: totalY * factor,
    black: totalK * factor,
    totalInk: (totalC + totalM + totalY + totalK) * factor,
    maxTotalInk: Math.round(maxTotalInk * 10) / 10,
  }
}
