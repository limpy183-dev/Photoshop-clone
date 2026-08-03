// ── CLUT / Device-Link ICC Tag Parsing ──────────────────────────────

export interface IccClutTag {
  inputChannels: number
  outputChannels: number
  gridPoints: number[]
  tableData: Float32Array
  precisionBits: 8 | 16
}

export interface IccDeviceLinkProfile {
  sourceColorSpace: string
  destColorSpace: string
  renderingIntent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
  clutData: IccClutTag | null
  description: string
}

export interface IccClutCoverageDiagnostic {
  aToB0: boolean
  aToB1: boolean
  aToB2: boolean
  bToA0: boolean
  bToA1: boolean
  bToA2: boolean
  gamutTag: boolean
  coveragePercent: number
  missingTags: string[]
}

function readU32BE(data: Uint8Array, off: number): number {
  return ((data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0
}

function readU16BE(data: Uint8Array, off: number): number {
  return (data[off] << 8) | data[off + 1]
}

function tagSignature(data: Uint8Array, off: number): string {
  return String.fromCharCode(data[off], data[off + 1], data[off + 2], data[off + 3])
}

/**
 * Parse a multi-dimensional CLUT tag from raw ICC profile data.
 */
export function parseIccClutTag(data: Uint8Array, offset: number, size: number): IccClutTag | null {
  if (size < 20 || offset + size > data.length) return null
  const sig = tagSignature(data, offset)
  if (sig !== "mft1" && sig !== "mft2" && sig !== "mAB " && sig !== "mBA ") return null

  const inputChannels = data[offset + 8] ?? 3
  const outputChannels = data[offset + 9] ?? 3
  const gridPoints: number[] = []
  const precisionBits: 8 | 16 = sig === "mft2" ? 16 : 8

  // Read grid dimensions (up to 16 input channels)
  for (let i = 0; i < inputChannels; i++) {
    const gp = data[offset + 10 + i] ?? 2
    gridPoints.push(gp)
  }

  // Calculate table size
  let tableSize = outputChannels
  for (const gp of gridPoints) tableSize *= gp
  const bytesPerEntry = precisionBits === 16 ? 2 : 1
  const tableOffset = offset + 32 // approximate header skip
  const tableBytes = Math.min(tableSize * bytesPerEntry, size - 32)

  const tableData = new Float32Array(Math.floor(tableBytes / bytesPerEntry))
  for (let i = 0; i < tableData.length; i++) {
    if (precisionBits === 16) {
      tableData[i] = readU16BE(data, tableOffset + i * 2) / 65535
    } else {
      tableData[i] = data[tableOffset + i] / 255
    }
  }

  return { inputChannels, outputChannels, gridPoints, tableData, precisionBits }
}

/**
 * Parse a device-link ICC profile (profile class = 'link').
 */
export function parseIccDeviceLinkProfile(data: Uint8Array): IccDeviceLinkProfile | null {
  if (data.length < 128) return null
  const profileSize = readU32BE(data, 0)
  if (profileSize < 128 || profileSize > data.length) return null

  const profileClass = tagSignature(data, 12)
  if (profileClass !== "link") return null

  const sourceColorSpace = tagSignature(data, 16).trim()
  const destColorSpace = tagSignature(data, 20).trim()
  const intentByte = readU32BE(data, 64) & 0x3
  const intents = ["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"] as const
  const renderingIntent = intents[intentByte] ?? "perceptual"

  // Look for AToB0 tag
  const tagCount = readU32BE(data, 128)
  let clutData: IccClutTag | null = null

  for (let i = 0; i < Math.min(tagCount, 100); i++) {
    const tagOff = 132 + i * 12
    if (tagOff + 12 > data.length) break
    const sig = tagSignature(data, tagOff)
    const offset = readU32BE(data, tagOff + 4)
    const size = readU32BE(data, tagOff + 8)
    if (sig === "A2B0" || sig === "A2B1") {
      clutData = parseIccClutTag(data, offset, size)
      if (clutData) break
    }
  }

  return { sourceColorSpace, destColorSpace, renderingIntent, clutData, description: `Device-link: ${sourceColorSpace} → ${destColorSpace}` }
}

/**
 * Diagnose which CLUT tags are present in an ICC profile.
 */
export function diagnoseIccClutCoverage(profileData: Uint8Array): IccClutCoverageDiagnostic {
  const result: IccClutCoverageDiagnostic = {
    aToB0: false, aToB1: false, aToB2: false,
    bToA0: false, bToA1: false, bToA2: false,
    gamutTag: false, coveragePercent: 0, missingTags: [],
  }

  if (profileData.length < 132) {
    result.missingTags = ["A2B0", "A2B1", "A2B2", "B2A0", "B2A1", "B2A2", "gamt"]
    return result
  }

  const tagCount = readU32BE(profileData, 128)
  const foundTags = new Set<string>()
  for (let i = 0; i < Math.min(tagCount, 200); i++) {
    const tagOff = 132 + i * 12
    if (tagOff + 12 > profileData.length) break
    foundTags.add(tagSignature(profileData, tagOff))
  }

  const checks: Array<[keyof IccClutCoverageDiagnostic, string]> = [
    ["aToB0", "A2B0"], ["aToB1", "A2B1"], ["aToB2", "A2B2"],
    ["bToA0", "B2A0"], ["bToA1", "B2A1"], ["bToA2", "B2A2"],
    ["gamutTag", "gamt"],
  ]
  let found = 0
  for (const [key, sig] of checks) {
    if (foundTags.has(sig)) {
      ;(result as unknown as Record<string, boolean>)[key] = true
      found++
    } else {
      result.missingTags.push(sig)
    }
  }
  result.coveragePercent = Math.round((found / checks.length) * 100)
  return result
}
