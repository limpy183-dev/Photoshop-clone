import type { ColorManagementSettings } from "./types"

export type IccProfileName =
  | ColorManagementSettings["assignedProfile"]
  | ColorManagementSettings["workingSpace"]
  | Exclude<ColorManagementSettings["proofProfile"], "None">

export type IccRenderingIntent = ColorManagementSettings["renderingIntent"]

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface IccTransformOptions {
  sourceProfile?: IccProfileName | string
  targetProfile?: IccProfileName | string
  sourceProfileData?: Uint8Array | ArrayBuffer
  targetProfileData?: Uint8Array | ArrayBuffer
  renderingIntent?: IccRenderingIntent
  blackPointCompensation?: boolean
}

export interface IccTransformResult {
  rgb: RgbColor
  clipped: boolean
  sourceProfile: IccProfileName | string
  targetProfile: IccProfileName | string
  deltaE?: number
}

export interface GamutWarningResult {
  outOfGamut: boolean
  clipped: boolean
  deltaE: number
  proofRgb: RgbColor
}

type TransferCurve =
  | { kind: "srgb" }
  | { kind: "gamma"; gamma: number }
  | { kind: "table"; values: number[] }

type RgbTransferCurve =
  | TransferCurve
  | { kind: "rgb"; r: TransferCurve; g: TransferCurve; b: TransferCurve }

type DeviceKind = "rgb" | "gray" | "cmyk"
type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

interface RgbProfileDefinition {
  kind: "rgb"
  name: IccProfileName | string
  primaries: {
    r: [number, number]
    g: [number, number]
    b: [number, number]
  }
  white: [number, number]
  transfer: RgbTransferCurve
}

interface GrayProfileDefinition {
  kind: "gray"
  name: IccProfileName | string
  gamma: number
  dotGain?: number
}

interface CmykProfileDefinition {
  kind: "cmyk"
  name: IccProfileName | string
  totalInkLimit: number
  blackGeneration: number
  dotGain: number
  grayComponentReplacement: number
}

type ProfileDefinition = RgbProfileDefinition | GrayProfileDefinition | CmykProfileDefinition

interface IccLutData {
  inputChannels: number
  outputChannels: number
  gridPoints: number[]
  inputCurves: number[][] | null
  outputCurves: number[][] | null
  matrix: number[] | null
  clut: Float32Array
  pcs: "XYZ" | "Lab"
}

interface CompiledRgbProfile extends RgbProfileDefinition {
  rgbToXyzD50: Mat3
  xyzD50ToRgb: Mat3
}

interface CompiledClutProfile {
  kind: "clut"
  name: IccProfileName | string
  deviceKind: DeviceKind
  aToB: IccLutData | null
  bToA: IccLutData | null
}

/**
 * ICC device-link profile: a single LUT chain mapping source device values
 * directly to destination device values with no PCS crossing. The link
 * defines the entire conversion, so when one is active the regular
 * source/target PCS pipeline is bypassed.
 */
interface CompiledLinkProfile {
  kind: "link"
  name: IccProfileName | string
  lut: IccLutData
  inputKind: DeviceKind
  outputKind: DeviceKind
}

type CompiledGrayProfile = GrayProfileDefinition
type CompiledCmykProfile = CmykProfileDefinition
type CompiledProfile = CompiledRgbProfile | CompiledGrayProfile | CompiledCmykProfile | CompiledClutProfile | CompiledLinkProfile

export interface IccLutDiagnostic {
  tag: string
  type: string
  inputChannels: number
  outputChannels: number
  gridPoints: number[]
  clutEntries: number
  connectionSpace: "XYZ" | "Lab"
}

export interface ParsedIccProfile {
  name: string
  kind: DeviceKind
  colorSpace: string
  connectionSpace: string
  profileClass: string
  version: string
  byteLength: number
  tags: string[]
  hasClut: boolean
  deviceLink: boolean
  lutTags: IccLutDiagnostic[]
  diagnostics: string[]
}

interface ParsedIccProfileInternal extends ParsedIccProfile {
  rgbToXyzD50?: Mat3
  transfer?: RgbTransferCurve
  gamma?: number
  aToB?: IccLutData
  bToA?: IccLutData
}

const D50: Vec3 = [0.96422, 1, 0.82521]
const D65_XY: [number, number] = [0.3127, 0.3290]
const D50_XY: [number, number] = [0.34567, 0.35850]

const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
]

const BRADFORD_INV: Mat3 = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
]

const PROFILE_DEFINITIONS: Record<IccProfileName, ProfileDefinition> = {
  "sRGB IEC61966-2.1": {
    kind: "rgb",
    name: "sRGB IEC61966-2.1",
    primaries: { r: [0.64, 0.33], g: [0.30, 0.60], b: [0.15, 0.06] },
    white: D65_XY,
    transfer: { kind: "srgb" },
  },
  "Display P3": {
    kind: "rgb",
    name: "Display P3",
    primaries: { r: [0.68, 0.32], g: [0.265, 0.690], b: [0.15, 0.06] },
    white: D65_XY,
    transfer: { kind: "srgb" },
  },
  "Adobe RGB (1998)": {
    kind: "rgb",
    name: "Adobe RGB (1998)",
    primaries: { r: [0.64, 0.33], g: [0.21, 0.71], b: [0.15, 0.06] },
    white: D65_XY,
    transfer: { kind: "gamma", gamma: 2.19921875 },
  },
  "ProPhoto RGB": {
    kind: "rgb",
    name: "ProPhoto RGB",
    primaries: { r: [0.7347, 0.2653], g: [0.1596, 0.8404], b: [0.0366, 0.0001] },
    white: D50_XY,
    transfer: { kind: "gamma", gamma: 1.8 },
  },
  "Working CMYK": {
    kind: "cmyk",
    name: "Working CMYK",
    totalInkLimit: 3.2,
    blackGeneration: 0.88,
    dotGain: 0.08,
    grayComponentReplacement: 0.76,
  },
  "U.S. Web Coated SWOP v2": {
    kind: "cmyk",
    name: "U.S. Web Coated SWOP v2",
    totalInkLimit: 3.0,
    blackGeneration: 0.95,
    dotGain: 0.13,
    grayComponentReplacement: 0.82,
  },
  "Japan Color 2001 Coated": {
    kind: "cmyk",
    name: "Japan Color 2001 Coated",
    totalInkLimit: 3.1,
    blackGeneration: 0.9,
    dotGain: 0.1,
    grayComponentReplacement: 0.78,
  },
  "Dot Gain 20%": {
    kind: "gray",
    name: "Dot Gain 20%",
    gamma: 1.82,
    dotGain: 0.2,
  },
  "Gray Gamma 2.2": {
    kind: "gray",
    name: "Gray Gamma 2.2",
    gamma: 2.2,
  },
}

const compiledProfiles = new Map<IccProfileName, CompiledProfile>()

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function clamp8(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function profileName(value: unknown, fallback: IccProfileName = "sRGB IEC61966-2.1"): IccProfileName {
  if (typeof value !== "string") return fallback
  const lower = value.toLowerCase()
  if (lower.includes("display p3") || lower.includes("displayp3")) return "Display P3"
  if (lower.includes("prophoto") || lower.includes("pro photo")) return "ProPhoto RGB"
  if (lower.includes("adobe rgb") || lower.includes("adobergb")) return "Adobe RGB (1998)"
  if (lower.includes("swop")) return "U.S. Web Coated SWOP v2"
  if (lower.includes("japan color")) return "Japan Color 2001 Coated"
  if (lower.includes("dot gain") || lower.includes("dotgain")) return "Dot Gain 20%"
  if (lower.includes("gray gamma") || lower.includes("graygamma")) return "Gray Gamma 2.2"
  if (lower.includes("cmyk") || lower.includes("coated")) return "Working CMYK"
  if (lower.includes("srgb")) return "sRGB IEC61966-2.1"
  return fallback
}

function iccBytes(value: Uint8Array | ArrayBuffer | undefined): Uint8Array | null {
  if (!value) return null
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function iccSig(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) return ""
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function cleanIccSig(value: string) {
  return value.trim() || value
}

function readS15Fixed16(view: DataView, offset: number) {
  return view.getInt32(offset, false) / 65536
}

function readU8Fixed8(view: DataView, offset: number) {
  return view.getUint16(offset, false) / 256
}

function iccVersionString(raw: number) {
  const major = (raw >>> 24) & 0xff
  const minor = (raw >>> 20) & 0x0f
  const bugfix = (raw >>> 16) & 0x0f
  return `${major}.${minor}.${bugfix}`
}

function kindForIccColorSpace(colorSpace: string): DeviceKind {
  const clean = cleanIccSig(colorSpace)
  if (clean === "CMYK") return "cmyk"
  if (clean === "GRAY") return "gray"
  return "rgb"
}

function readIccTagDirectory(bytes: Uint8Array) {
  if (bytes.length < 132 || iccSig(bytes, 36) !== "acsp") return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(128, false)
  if (count > 512 || 132 + count * 12 > bytes.length) return null
  const tags: Array<{ sig: string; offset: number; size: number }> = []
  for (let i = 0; i < count; i++) {
    const entry = 132 + i * 12
    const sig = iccSig(bytes, entry)
    const offset = view.getUint32(entry + 4, false)
    const size = view.getUint32(entry + 8, false)
    if (offset >= bytes.length || size > bytes.length || offset + size > bytes.length) continue
    tags.push({ sig, offset, size })
  }
  return tags
}

function findIccTag(tags: ReturnType<typeof readIccTagDirectory>, sig: string) {
  return tags?.find((tag) => tag.sig === sig) ?? null
}

function readIccDescription(bytes: Uint8Array, tags: ReturnType<typeof readIccTagDirectory>) {
  const desc = findIccTag(tags, "desc")
  if (desc && desc.size >= 12 && iccSig(bytes, desc.offset) === "desc") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const length = Math.max(0, view.getUint32(desc.offset + 8, false) - 1)
    const start = desc.offset + 12
    const end = Math.min(bytes.length, start + length)
    const text = new TextDecoder("latin1").decode(bytes.subarray(start, end)).replace(/\0+$/g, "").trim()
    if (text) return text
  }
  const mluc = findIccTag(tags, "mluc")
  if (mluc && mluc.size >= 28 && iccSig(bytes, mluc.offset) === "mluc") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint32(mluc.offset + 8, false)
    if (count > 0) {
      const record = mluc.offset + 16
      const length = view.getUint32(record + 4, false)
      const offset = view.getUint32(record + 8, false)
      const start = mluc.offset + offset
      const end = Math.min(bytes.length, start + length)
      const text = new TextDecoder("utf-16be").decode(bytes.subarray(start, end)).replace(/\0+$/g, "").trim()
      if (text) return text
    }
  }
  return undefined
}

function readIccXyzTag(bytes: Uint8Array, tags: ReturnType<typeof readIccTagDirectory>, sig: string): Vec3 | null {
  const tag = findIccTag(tags, sig)
  if (!tag || tag.size < 20 || iccSig(bytes, tag.offset) !== "XYZ ") return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [
    readS15Fixed16(view, tag.offset + 8),
    readS15Fixed16(view, tag.offset + 12),
    readS15Fixed16(view, tag.offset + 16),
  ]
}

function readIccCurveTag(bytes: Uint8Array, tags: ReturnType<typeof readIccTagDirectory>, sig: string): TransferCurve | null {
  const tag = findIccTag(tags, sig)
  if (!tag || tag.size < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = iccSig(bytes, tag.offset)
  if (type === "curv") {
    const count = view.getUint32(tag.offset + 8, false)
    if (count === 0) return { kind: "gamma", gamma: 1 }
    if (count === 1 && tag.size >= 14) return { kind: "gamma", gamma: Math.max(0.01, readU8Fixed8(view, tag.offset + 12)) }
    const values: number[] = []
    const total = Math.min(count, Math.floor((tag.size - 12) / 2))
    for (let i = 0; i < total; i++) values.push(view.getUint16(tag.offset + 12 + i * 2, false) / 65535)
    return values.length >= 2 ? { kind: "table", values } : { kind: "gamma", gamma: 1 }
  }
  if (type === "para" && tag.size >= 16) {
    const functionType = view.getUint16(tag.offset + 8, false)
    if (functionType === 0) return { kind: "gamma", gamma: Math.max(0.01, readS15Fixed16(view, tag.offset + 12)) }
  }
  return null
}

function readLut8Or16Tag(
  bytes: Uint8Array,
  view: DataView,
  tagOffset: number,
  tagSize: number,
  pcs: "XYZ" | "Lab",
): IccLutData | null {
  const type = iccSig(bytes, tagOffset)
  if (type !== "mft1" && type !== "mft2") return null
  if (tagSize < 48) return null
  const inputChannels = bytes[tagOffset + 8]
  const outputChannels = bytes[tagOffset + 9]
  const gridPointsPerDim = bytes[tagOffset + 10]
  if (!inputChannels || !outputChannels || !gridPointsPerDim) return null
  if (inputChannels > 4 || outputChannels > 4) return null
  const matrix: number[] = []
  for (let i = 0; i < 9; i++) matrix.push(readS15Fixed16(view, tagOffset + 12 + i * 4))
  const isIdentity = Math.abs(matrix[0] - 1) < 1e-6 && Math.abs(matrix[4] - 1) < 1e-6 && Math.abs(matrix[8] - 1) < 1e-6
    && Math.abs(matrix[1]) < 1e-6 && Math.abs(matrix[2]) < 1e-6 && Math.abs(matrix[3]) < 1e-6
    && Math.abs(matrix[5]) < 1e-6 && Math.abs(matrix[6]) < 1e-6 && Math.abs(matrix[7]) < 1e-6
  const is16 = type === "mft2"
  let inputEntries: number
  let outputEntries: number
  let cursor: number
  if (is16) {
    if (tagSize < 52) return null
    inputEntries = view.getUint16(tagOffset + 48, false)
    outputEntries = view.getUint16(tagOffset + 50, false)
    cursor = tagOffset + 52
  } else {
    inputEntries = 256
    outputEntries = 256
    cursor = tagOffset + 48
  }
  const readEntry = is16 ? (off: number) => view.getUint16(off, false) / 65535 : (off: number) => bytes[off] / 255
  const entryBytes = is16 ? 2 : 1
  const inputCurves: number[][] = []
  for (let c = 0; c < inputChannels; c++) {
    const curve: number[] = []
    for (let i = 0; i < inputEntries; i++) {
      if (cursor + entryBytes > bytes.length) return null
      curve.push(readEntry(cursor))
      cursor += entryBytes
    }
    inputCurves.push(curve)
  }
  let clutSize = outputChannels
  for (let i = 0; i < inputChannels; i++) clutSize *= gridPointsPerDim
  if (cursor + clutSize * entryBytes > bytes.length) return null
  const clut = new Float32Array(clutSize)
  for (let i = 0; i < clutSize; i++) {
    clut[i] = readEntry(cursor)
    cursor += entryBytes
  }
  const outputCurves: number[][] = []
  for (let c = 0; c < outputChannels; c++) {
    const curve: number[] = []
    for (let i = 0; i < outputEntries; i++) {
      if (cursor + entryBytes > bytes.length) return null
      curve.push(readEntry(cursor))
      cursor += entryBytes
    }
    outputCurves.push(curve)
  }
  const gridPoints: number[] = []
  for (let i = 0; i < inputChannels; i++) gridPoints.push(gridPointsPerDim)
  return {
    inputChannels,
    outputChannels,
    gridPoints,
    inputCurves,
    outputCurves,
    matrix: isIdentity ? null : matrix,
    clut,
    pcs,
  }
}

function readParametricOrCurveAt(bytes: Uint8Array, view: DataView, offset: number, maxEnd: number): { curve: number[]; bytesRead: number } | null {
  if (offset + 12 > bytes.length || offset + 12 > maxEnd) return null
  const sig = iccSig(bytes, offset)
  if (sig === "curv") {
    const count = view.getUint32(offset + 8, false)
    if (count === 0) {
      return { curve: [0, 1], bytesRead: align4(12) }
    }
    if (count === 1) {
      const gamma = Math.max(0.01, readU8Fixed8(view, offset + 12))
      const table: number[] = []
      const steps = 256
      for (let i = 0; i < steps; i++) table.push(Math.pow(i / (steps - 1), gamma))
      return { curve: table, bytesRead: align4(14) }
    }
    const total = Math.min(count, Math.floor((maxEnd - offset - 12) / 2))
    const curve: number[] = []
    for (let i = 0; i < total; i++) curve.push(view.getUint16(offset + 12 + i * 2, false) / 65535)
    return { curve, bytesRead: align4(12 + total * 2) }
  }
  if (sig === "para" && offset + 16 <= bytes.length) {
    const functionType = view.getUint16(offset + 8, false)
    const gamma = Math.max(0.01, readS15Fixed16(view, offset + 12))
    const table: number[] = []
    const steps = 256
    for (let i = 0; i < steps; i++) table.push(Math.pow(i / (steps - 1), gamma))
    const bytesRead = align4(12 + paramBytesForType(functionType))
    return { curve: table, bytesRead }
  }
  return null
}

function paramBytesForType(functionType: number) {
  switch (functionType) {
    case 0: return 4
    case 1: return 12
    case 2: return 16
    case 3: return 20
    case 4: return 28
    default: return 4
  }
}

function align4(value: number) {
  return value + ((4 - (value % 4)) % 4)
}

function readMabOrMbaTag(
  bytes: Uint8Array,
  view: DataView,
  tagOffset: number,
  tagSize: number,
  pcs: "XYZ" | "Lab",
): IccLutData | null {
  const type = iccSig(bytes, tagOffset)
  if (type !== "mAB " && type !== "mBA ") return null
  if (tagSize < 32) return null
  const inputChannels = bytes[tagOffset + 8]
  const outputChannels = bytes[tagOffset + 9]
  if (!inputChannels || !outputChannels || inputChannels > 15 || outputChannels > 15) return null
  const offsetBCurves = view.getUint32(tagOffset + 12, false)
  const offsetMatrix = view.getUint32(tagOffset + 16, false)
  const offsetMCurves = view.getUint32(tagOffset + 20, false)
  const offsetClut = view.getUint32(tagOffset + 24, false)
  const offsetACurves = view.getUint32(tagOffset + 28, false)
  const tagEnd = tagOffset + tagSize
  const maxEnd = Math.min(bytes.length, tagEnd)

  const aCurves: number[][] = []
  if (offsetACurves > 0) {
    let cursor = tagOffset + offsetACurves
    for (let i = 0; i < inputChannels; i++) {
      const parsed = readParametricOrCurveAt(bytes, view, cursor, maxEnd)
      if (!parsed) return null
      aCurves.push(parsed.curve)
      cursor += parsed.bytesRead
    }
  }

  const bCurves: number[][] = []
  if (offsetBCurves > 0) {
    let cursor = tagOffset + offsetBCurves
    const curveCount = type === "mAB " ? outputChannels : inputChannels
    for (let i = 0; i < curveCount; i++) {
      const parsed = readParametricOrCurveAt(bytes, view, cursor, maxEnd)
      if (!parsed) return null
      bCurves.push(parsed.curve)
      cursor += parsed.bytesRead
    }
  }

  const mCurves: number[][] = []
  if (offsetMCurves > 0) {
    let cursor = tagOffset + offsetMCurves
    const curveCount = type === "mAB " ? outputChannels : inputChannels
    for (let i = 0; i < curveCount; i++) {
      const parsed = readParametricOrCurveAt(bytes, view, cursor, maxEnd)
      if (!parsed) return null
      mCurves.push(parsed.curve)
      cursor += parsed.bytesRead
    }
  }

  let matrix: number[] | null = null
  if (offsetMatrix > 0 && tagOffset + offsetMatrix + 48 <= bytes.length) {
    const matrixOffset = tagOffset + offsetMatrix
    const values: number[] = []
    for (let i = 0; i < 12; i++) values.push(readS15Fixed16(view, matrixOffset + i * 4))
    matrix = values
  }

  let clut = new Float32Array(0)
  const gridPoints: number[] = []
  const clutOutputs = type === "mAB " ? outputChannels : inputChannels
  if (offsetClut > 0 && tagOffset + offsetClut + 20 < bytes.length) {
    const clutOffset = tagOffset + offsetClut
    const gridDims: number[] = []
    let totalEntries = 1
    for (let i = 0; i < 16; i++) {
      const point = bytes[clutOffset + i]
      if (i < inputChannels) {
        gridDims.push(point)
        totalEntries *= point || 1
      }
    }
    const precision = bytes[clutOffset + 16]
    const dataStart = clutOffset + 20
    const entryBytes = precision === 2 ? 2 : 1
    const totalValues = totalEntries * clutOutputs
    if (dataStart + totalValues * entryBytes <= bytes.length) {
      clut = new Float32Array(totalValues)
      for (let i = 0; i < totalValues; i++) {
        clut[i] = precision === 2
          ? view.getUint16(dataStart + i * 2, false) / 65535
          : bytes[dataStart + i] / 255
      }
      gridPoints.push(...gridDims)
    }
  }

  return {
    inputChannels,
    outputChannels,
    gridPoints,
    inputCurves: type === "mAB " ? (aCurves.length ? aCurves : null) : (bCurves.length ? bCurves : null),
    outputCurves: type === "mAB " ? (bCurves.length ? bCurves : null) : (aCurves.length ? aCurves : null),
    matrix,
    clut,
    pcs,
  }
}

function readLutTag(
  bytes: Uint8Array,
  tags: ReturnType<typeof readIccTagDirectory>,
  sig: string,
  pcs: "XYZ" | "Lab",
): IccLutData | null {
  const tag = findIccTag(tags, sig)
  if (!tag) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = iccSig(bytes, tag.offset)
  if (type === "mft1" || type === "mft2") return readLut8Or16Tag(bytes, view, tag.offset, tag.size, pcs)
  if (type === "mAB " || type === "mBA ") return readMabOrMbaTag(bytes, view, tag.offset, tag.size, pcs)
  return null
}

function readLutDiagnostics(
  bytes: Uint8Array,
  tags: ReturnType<typeof readIccTagDirectory>,
  pcs: "XYZ" | "Lab",
): IccLutDiagnostic[] {
  const signatures = ["A2B0", "A2B1", "A2B2", "B2A0", "B2A1", "B2A2", "D2B0", "D2B1", "D2B2", "B2D0", "B2D1", "B2D2"]
  const diagnostics: IccLutDiagnostic[] = []
  for (const sig of signatures) {
    const tag = findIccTag(tags, sig)
    if (!tag) continue
    const type = iccSig(bytes, tag.offset)
    if (type !== "mft1" && type !== "mft2" && type !== "mAB " && type !== "mBA ") continue
    const lut = readLutTag(bytes, tags, sig, pcs)
    if (!lut) {
      diagnostics.push({
        tag: sig,
        type,
        inputChannels: 0,
        outputChannels: 0,
        gridPoints: [],
        clutEntries: 0,
        connectionSpace: pcs,
      })
      continue
    }
    diagnostics.push({
      tag: sig,
      type,
      inputChannels: lut.inputChannels,
      outputChannels: lut.outputChannels,
      gridPoints: [...lut.gridPoints],
      clutEntries: lut.outputChannels ? Math.floor(lut.clut.length / lut.outputChannels) : lut.clut.length,
      connectionSpace: lut.pcs,
    })
  }
  return diagnostics
}

function parseIccProfileInternal(value: Uint8Array | ArrayBuffer): ParsedIccProfileInternal | null {
  const bytes = iccBytes(value)
  if (!bytes || bytes.length < 132 || iccSig(bytes, 36) !== "acsp") return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tags = readIccTagDirectory(bytes)
  if (!tags) return null
  const colorSpace = iccSig(bytes, 16)
  const connectionSpace = iccSig(bytes, 20)
  const kind = kindForIccColorSpace(colorSpace)
  const rXyz = readIccXyzTag(bytes, tags, "rXYZ")
  const gXyz = readIccXyzTag(bytes, tags, "gXYZ")
  const bXyz = readIccXyzTag(bytes, tags, "bXYZ")
  const rTrc = readIccCurveTag(bytes, tags, "rTRC")
  const gTrc = readIccCurveTag(bytes, tags, "gTRC")
  const bTrc = readIccCurveTag(bytes, tags, "bTRC")
  const grayTrc = readIccCurveTag(bytes, tags, "kTRC") ?? readIccCurveTag(bytes, tags, "rTRC")
  const name = readIccDescription(bytes, tags) ?? profileName(cleanIccSig(colorSpace))
  const transfer = rTrc && gTrc && bTrc
    ? (
        JSON.stringify(rTrc) === JSON.stringify(gTrc) && JSON.stringify(rTrc) === JSON.stringify(bTrc)
          ? rTrc
          : { kind: "rgb", r: rTrc, g: gTrc, b: bTrc } as RgbTransferCurve
      )
    : undefined
  const pcs: "XYZ" | "Lab" = cleanIccSig(connectionSpace) === "Lab" ? "Lab" : "XYZ"
  const aToB = readLutTag(bytes, tags, "A2B0", pcs)
    ?? readLutTag(bytes, tags, "A2B1", pcs)
    ?? readLutTag(bytes, tags, "A2B2", pcs)
    ?? undefined
  const bToA = readLutTag(bytes, tags, "B2A0", pcs)
    ?? readLutTag(bytes, tags, "B2A1", pcs)
    ?? readLutTag(bytes, tags, "B2A2", pcs)
    ?? undefined
  const profileClass = cleanIccSig(iccSig(bytes, 12))
  const lutTags = readLutDiagnostics(bytes, tags, pcs)
  const deviceLink = profileClass === "link"
  const diagnostics: string[] = []
  if (lutTags.length) {
    diagnostics.push(`CLUT/device table tags parsed for diagnostics: ${lutTags.map((tag) => `${tag.tag} ${tag.type.trim()} ${tag.inputChannels}->${tag.outputChannels}`).join(", ")}.`)
  }
  if (deviceLink) {
    diagnostics.push(aToB
      ? "ICC device-link profile executes browser-locally through its A2B table (uncertified; not a substitute for a vendor CMM)."
      : "ICC device-link profile has no readable A2B table; parsed for diagnostics only.")
  }
  return {
    name,
    kind,
    colorSpace: cleanIccSig(colorSpace),
    connectionSpace: cleanIccSig(connectionSpace),
    profileClass,
    version: iccVersionString(view.getUint32(8, false)),
    byteLength: bytes.byteLength,
    tags: tags.map((tag) => tag.sig),
    hasClut: lutTags.length > 0,
    deviceLink,
    lutTags,
    diagnostics,
    rgbToXyzD50: rXyz && gXyz && bXyz
      ? [
          [rXyz[0], gXyz[0], bXyz[0]],
          [rXyz[1], gXyz[1], bXyz[1]],
          [rXyz[2], gXyz[2], bXyz[2]],
        ]
      : undefined,
    transfer,
    gamma: grayTrc?.kind === "gamma" ? grayTrc.gamma : undefined,
    aToB,
    bToA,
  }
}

export function parseIccProfile(value: Uint8Array | ArrayBuffer): ParsedIccProfile | null {
  const parsed = parseIccProfileInternal(value)
  if (!parsed) return null
  return {
    name: parsed.name,
    kind: parsed.kind,
    colorSpace: parsed.colorSpace,
    connectionSpace: parsed.connectionSpace,
    profileClass: parsed.profileClass,
    version: parsed.version,
    byteLength: parsed.byteLength,
    tags: parsed.tags,
    hasClut: parsed.hasClut,
    deviceLink: parsed.deviceLink,
    lutTags: parsed.lutTags,
    diagnostics: parsed.diagnostics,
  }
}

export function describeIccProfile(value: Uint8Array | ArrayBuffer): ParsedIccProfile | null {
  return parseIccProfile(value)
}

function xyToXyz([x, y]: [number, number]): Vec3 {
  return [x / y, 1, (1 - x - y) / y]
}

function dotRow(row: Vec3, vector: Vec3) {
  return row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
}

function multiplyMatVec(m: Mat3, v: Vec3): Vec3 {
  return [dotRow(m[0], v), dotRow(m[1], v), dotRow(m[2], v)]
}

function multiplyMat(a: Mat3, b: Mat3): Mat3 {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ]
}

function invertMat(m: Mat3): Mat3 {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = m
  const A = e * i - f * h
  const B = c * h - b * i
  const C = b * f - c * e
  const D = f * g - d * i
  const E = a * i - c * g
  const F = c * d - a * f
  const G = d * h - e * g
  const H = b * g - a * h
  const I = a * e - b * d
  const det = a * A + b * D + c * G
  if (Math.abs(det) < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const inv = 1 / det
  return [
    [A * inv, B * inv, C * inv],
    [D * inv, E * inv, F * inv],
    [G * inv, H * inv, I * inv],
  ]
}

function chromaticAdaptationMatrix(sourceWhite: Vec3, targetWhite = D50): Mat3 {
  const srcCone = multiplyMatVec(BRADFORD, sourceWhite)
  const dstCone = multiplyMatVec(BRADFORD, targetWhite)
  const scale: Mat3 = [
    [dstCone[0] / srcCone[0], 0, 0],
    [0, dstCone[1] / srcCone[1], 0],
    [0, 0, dstCone[2] / srcCone[2]],
  ]
  return multiplyMat(multiplyMat(BRADFORD_INV, scale), BRADFORD)
}

function buildRgbToXyzD50(profile: RgbProfileDefinition): Mat3 {
  const r = xyToXyz(profile.primaries.r)
  const g = xyToXyz(profile.primaries.g)
  const b = xyToXyz(profile.primaries.b)
  const white = xyToXyz(profile.white)
  const primaries: Mat3 = [
    [r[0], g[0], b[0]],
    [r[1], g[1], b[1]],
    [r[2], g[2], b[2]],
  ]
  const scales = multiplyMatVec(invertMat(primaries), white)
  const rgbToXyz: Mat3 = [
    [primaries[0][0] * scales[0], primaries[0][1] * scales[1], primaries[0][2] * scales[2]],
    [primaries[1][0] * scales[0], primaries[1][1] * scales[1], primaries[1][2] * scales[2]],
    [primaries[2][0] * scales[0], primaries[2][1] * scales[1], primaries[2][2] * scales[2]],
  ]
  const adapt = chromaticAdaptationMatrix(white, D50)
  return multiplyMat(adapt, rgbToXyz)
}

function compileProfile(name: IccProfileName): CompiledProfile {
  const cached = compiledProfiles.get(name)
  if (cached) return cached
  const profile = PROFILE_DEFINITIONS[name]
  let compiled: CompiledProfile
  if (profile.kind === "rgb") {
    const rgbToXyzD50 = buildRgbToXyzD50(profile)
    compiled = {
      ...profile,
      rgbToXyzD50,
      xyzD50ToRgb: invertMat(rgbToXyzD50),
    }
  } else {
    compiled = { ...profile }
  }
  compiledProfiles.set(name, compiled)
  return compiled
}

function deviceKindForConnectionSpace(space: string): DeviceKind {
  const cleaned = space.trim().toUpperCase()
  if (cleaned === "CMYK") return "cmyk"
  if (cleaned === "GRAY") return "gray"
  return "rgb"
}

function compileProfileData(value: Uint8Array | ArrayBuffer | undefined): CompiledProfile | null {
  if (!value) return null
  const parsed = parseIccProfileInternal(value)
  if (!parsed) return null
  if (parsed.deviceLink && parsed.aToB) {
    // Device-link: the A2B chain maps source device values straight to
    // destination device values; its "connection space" header field names
    // the OUTPUT device space, not a PCS.
    return {
      kind: "link",
      name: parsed.name,
      lut: parsed.aToB,
      inputKind: parsed.kind,
      outputKind: deviceKindForConnectionSpace(parsed.connectionSpace),
    }
  }
  if (parsed.kind === "rgb" && parsed.rgbToXyzD50 && parsed.transfer) {
    return {
      kind: "rgb",
      name: parsed.name,
      primaries: { r: [0.64, 0.33], g: [0.30, 0.60], b: [0.15, 0.06] },
      white: D50_XY,
      transfer: parsed.transfer,
      rgbToXyzD50: parsed.rgbToXyzD50,
      xyzD50ToRgb: invertMat(parsed.rgbToXyzD50),
    }
  }
  if (parsed.kind === "gray") {
    return {
      kind: "gray",
      name: parsed.name,
      gamma: parsed.gamma ?? 2.2,
    }
  }
  if (parsed.aToB || parsed.bToA) {
    return {
      kind: "clut",
      name: parsed.name,
      deviceKind: parsed.kind,
      aToB: parsed.aToB ?? null,
      bToA: parsed.bToA ?? null,
    }
  }
  const known = profileName(parsed.name, "sRGB IEC61966-2.1")
  return compileProfile(known)
}

function resolveCompiledProfile(profile: unknown, profileData: Uint8Array | ArrayBuffer | undefined, fallback?: IccProfileName): CompiledProfile {
  return compileProfileData(profileData) ?? compileProfile(profileName(profile, fallback))
}

function decodeTransfer(value: number, transfer: TransferCurve) {
  const v = clamp(value)
  if (transfer.kind === "srgb") {
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  if (transfer.kind === "table") {
    if (transfer.values.length < 2) return v
    const scaled = v * (transfer.values.length - 1)
    const lo = Math.floor(scaled)
    const hi = Math.min(transfer.values.length - 1, lo + 1)
    const t = scaled - lo
    return clamp((transfer.values[lo] ?? 0) * (1 - t) + (transfer.values[hi] ?? 1) * t)
  }
  return v ** transfer.gamma
}

function encodeTransfer(value: number, transfer: TransferCurve) {
  const v = clamp(value)
  if (transfer.kind === "srgb") {
    return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  }
  if (transfer.kind === "table") {
    if (transfer.values.length < 2) return v
    let lo = 0
    let hi = transfer.values.length - 1
    for (let step = 0; step < 16; step++) {
      const mid = (lo + hi) / 2
      const encoded = mid / (transfer.values.length - 1)
      const decoded = decodeTransfer(encoded, transfer)
      if (decoded < v) lo = mid
      else hi = mid
    }
    return clamp(((lo + hi) / 2) / (transfer.values.length - 1))
  }
  return v ** (1 / transfer.gamma)
}

function decodeRgbTransfer(value: number, transfer: RgbTransferCurve, channel: 0 | 1 | 2) {
  if (transfer.kind !== "rgb") return decodeTransfer(value, transfer)
  return decodeTransfer(value, channel === 0 ? transfer.r : channel === 1 ? transfer.g : transfer.b)
}

function encodeRgbTransfer(value: number, transfer: RgbTransferCurve, channel: 0 | 1 | 2) {
  if (transfer.kind !== "rgb") return encodeTransfer(value, transfer)
  return encodeTransfer(value, channel === 0 ? transfer.r : channel === 1 ? transfer.g : transfer.b)
}

function luma(rgb: RgbColor) {
  return 0.2126 * (rgb.r / 255) + 0.7152 * (rgb.g / 255) + 0.0722 * (rgb.b / 255)
}

function xyzToLab(xyz: Vec3): Vec3 {
  const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29
  const fx = f(xyz[0] / D50[0])
  const fy = f(xyz[1] / D50[1])
  const fz = f(xyz[2] / D50[2])
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function deltaE76(a: Vec3, b: Vec3) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

function sampleCurve(curve: number[] | undefined, value: number) {
  if (!curve || curve.length < 2) return clamp(value)
  const v = clamp(value)
  const scaled = v * (curve.length - 1)
  const lo = Math.floor(scaled)
  const hi = Math.min(curve.length - 1, lo + 1)
  const t = scaled - lo
  return clamp(curve[lo] * (1 - t) + curve[hi] * t)
}

function interpolateClut(lut: IccLutData, input: number[]): number[] | null {
  if (lut.clut.length === 0) return null
  const n = lut.inputChannels
  if (input.length < n) return null
  const grid = lut.gridPoints
  if (grid.length < n) return null
  const out = lut.outputChannels
  const coords: Array<{ lo: number; hi: number; t: number }> = []
  const totalCorners = 1 << n
  for (let i = 0; i < n; i++) {
    const dim = grid[i]
    if (!dim || dim < 2) return null
    const v = clamp(input[i]) * (dim - 1)
    const lo = Math.floor(v)
    const hi = Math.min(dim - 1, lo + 1)
    coords.push({ lo, hi, t: v - lo })
  }
  const result = new Array<number>(out).fill(0)
  for (let corner = 0; corner < totalCorners; corner++) {
    let weight = 1
    let index = 0
    let stride = 1
    for (let i = n - 1; i >= 0; i--) {
      const useHi = ((corner >> i) & 1) === 1
      const c = coords[i]
      const idx = useHi ? c.hi : c.lo
      const t = useHi ? c.t : 1 - c.t
      weight *= t
      index += idx * stride
      stride *= grid[i]
    }
    if (weight === 0) continue
    const base = index * out
    for (let o = 0; o < out; o++) {
      result[o] += weight * lut.clut[base + o]
    }
  }
  return result
}

/**
 * Apply a LUT chain in device order: input curves -> CLUT -> output curves.
 * This is the execution path for device-link A2B chains, where no PCS or
 * matrix stage applies.
 */
function applyLutDeviceChain(lut: IccLutData, deviceInput: number[]): number[] | null {
  let input = deviceInput.slice(0, lut.inputChannels)
  while (input.length < lut.inputChannels) input.push(0)
  if (lut.inputCurves) {
    input = input.map((v, i) => sampleCurve(lut.inputCurves![i], v))
  }
  const clutResult = interpolateClut(lut, input)
  if (!clutResult) return null
  if (lut.outputCurves) {
    return clutResult.map((v, i) => sampleCurve(lut.outputCurves![i], v))
  }
  return clutResult
}

/** Map an app RGB color onto device-link input channel values. */
function deviceInputFromRgb(rgb: RgbColor, kind: DeviceKind, channels: number): number[] {
  if (kind === "cmyk") {
    // Same naive-separation convention as the CLUT device path.
    return [1 - rgb.r / 255, 1 - rgb.g / 255, 1 - rgb.b / 255, 0].slice(0, Math.max(4, channels))
  }
  if (kind === "gray") {
    return [clamp(luma(rgb))]
  }
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255].slice(0, Math.max(3, channels))
}

/** Map device-link output channel values back onto a displayable RGB color. */
function rgbFromDeviceOutput(output: number[], kind: DeviceKind): RgbColor {
  if (kind === "cmyk" && output.length >= 4) {
    const c = clamp(output[0])
    const m = clamp(output[1])
    const y = clamp(output[2])
    const k = clamp(output[3])
    return {
      r: clamp8(255 * (1 - c) * (1 - k)),
      g: clamp8(255 * (1 - m) * (1 - k)),
      b: clamp8(255 * (1 - y) * (1 - k)),
    }
  }
  if (kind === "gray") {
    const value = clamp8((output[0] ?? 0) * 255)
    return { r: value, g: value, b: value }
  }
  return {
    r: clamp8((output[0] ?? 0) * 255),
    g: clamp8((output[1] ?? 0) * 255),
    b: clamp8((output[2] ?? 0) * 255),
  }
}

/** Execute a device-link conversion for one color. Returns null when the chain cannot run. */
function applyDeviceLink(link: CompiledLinkProfile, rgb: RgbColor): RgbColor | null {
  const input = deviceInputFromRgb(rgb, link.inputKind, link.lut.inputChannels)
  const output = applyLutDeviceChain(link.lut, input)
  if (!output) return null
  return rgbFromDeviceOutput(output, link.outputKind)
}

function applyClutAToB(profile: CompiledClutProfile, deviceInput: number[]): number[] | null {
  const lut = profile.aToB
  if (!lut) return null
  let input = deviceInput.slice(0, lut.inputChannels)
  if (lut.inputCurves) {
    input = input.map((v, i) => sampleCurve(lut.inputCurves![i], v))
  }
  const clutResult = interpolateClut(lut, input)
  if (!clutResult) return null
  let result = clutResult
  if (lut.matrix && result.length >= 3) {
    const m = lut.matrix
    const x = m[0] * result[0] + m[1] * result[1] + m[2] * result[2] + (m.length > 9 ? m[9] : 0)
    const y = m[3] * result[0] + m[4] * result[1] + m[5] * result[2] + (m.length > 10 ? m[10] : 0)
    const z = m[6] * result[0] + m[7] * result[1] + m[8] * result[2] + (m.length > 11 ? m[11] : 0)
    result = [x, y, z, ...result.slice(3)]
  }
  if (lut.outputCurves) {
    result = result.map((v, i) => sampleCurve(lut.outputCurves![i], v))
  }
  return result
}

function applyClutBToA(profile: CompiledClutProfile, pcsInput: number[]): number[] | null {
  const lut = profile.bToA
  if (!lut) return null
  let input = pcsInput.slice(0, lut.inputChannels)
  if (lut.inputCurves) {
    input = input.map((v, i) => sampleCurve(lut.inputCurves![i], v))
  }
  if (lut.matrix && input.length >= 3) {
    const m = lut.matrix
    const x = m[0] * input[0] + m[1] * input[1] + m[2] * input[2] + (m.length > 9 ? m[9] : 0)
    const y = m[3] * input[0] + m[4] * input[1] + m[5] * input[2] + (m.length > 10 ? m[10] : 0)
    const z = m[6] * input[0] + m[7] * input[1] + m[8] * input[2] + (m.length > 11 ? m[11] : 0)
    input = [x, y, z]
  }
  const clutResult = interpolateClut(lut, input)
  if (!clutResult) return null
  let result = clutResult
  if (lut.outputCurves) {
    result = result.map((v, i) => sampleCurve(lut.outputCurves![i], v))
  }
  return result
}

function pcsToXyzD50(pcs: number[], pcsKind: "XYZ" | "Lab"): Vec3 {
  if (pcsKind === "Lab") {
    const L = pcs[0] * 100
    const a = pcs[1] * 255 - 128
    const b = pcs[2] * 255 - 128
    const fy = (L + 16) / 116
    const fx = fy + a / 500
    const fz = fy - b / 200
    const ft = (f: number) => f * f * f > 216 / 24389 ? f * f * f : (116 * f - 16) / (24389 / 27)
    return [ft(fx) * D50[0], ft(fy) * D50[1], ft(fz) * D50[2]]
  }
  return [pcs[0] * 2, pcs[1] * 2, pcs[2] * 2]
}

function xyzD50ToPcs(xyz: Vec3, pcsKind: "XYZ" | "Lab"): number[] {
  if (pcsKind === "Lab") {
    const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29
    const fx = f(xyz[0] / D50[0])
    const fy = f(xyz[1] / D50[1])
    const fz = f(xyz[2] / D50[2])
    const L = 116 * fy - 16
    const a = 500 * (fx - fy)
    const b = 200 * (fy - fz)
    return [clamp(L / 100), clamp((a + 128) / 255), clamp((b + 128) / 255)]
  }
  return [clamp(xyz[0] / 2), clamp(xyz[1] / 2), clamp(xyz[2] / 2)]
}

function rgbToXyzD50(rgb: RgbColor, profile: CompiledProfile): Vec3 {
  if (profile.kind === "gray") {
    const gray = clamp(((rgb.r + rgb.g + rgb.b) / 3) / 255)
    const y = gray ** profile.gamma
    return [D50[0] * y, D50[1] * y, D50[2] * y]
  }
  if (profile.kind === "cmyk") {
    const proof = cmykProofRgbFromRgb(rgb, profile)
    return rgbToXyzD50(proof.rgb, compileProfile("sRGB IEC61966-2.1"))
  }
  if (profile.kind === "clut") {
    const input = profile.deviceKind === "cmyk"
      ? [1 - rgb.r / 255, 1 - rgb.g / 255, 1 - rgb.b / 255, 0]
      : [rgb.r / 255, rgb.g / 255, rgb.b / 255]
    const pcs = applyClutAToB(profile, input)
    if (pcs) return pcsToXyzD50(pcs, profile.aToB?.pcs ?? "XYZ")
    return rgbToXyzD50(rgb, compileProfile("sRGB IEC61966-2.1"))
  }
  if (profile.kind === "link") {
    // A device-link has no PCS; approximate by running the link and
    // interpreting its output as display RGB.
    const linked = applyDeviceLink(profile, rgb)
    return rgbToXyzD50(linked ?? rgb, compileProfile("sRGB IEC61966-2.1"))
  }
  const linear: Vec3 = [
    decodeRgbTransfer(rgb.r / 255, profile.transfer, 0),
    decodeRgbTransfer(rgb.g / 255, profile.transfer, 1),
    decodeRgbTransfer(rgb.b / 255, profile.transfer, 2),
  ]
  return multiplyMatVec(profile.rgbToXyzD50, linear)
}

function xyzD50ToRgb(xyz: Vec3, profile: CompiledProfile, clip = true): { rgb: RgbColor; clipped: boolean; linear?: Vec3 } {
  if (profile.kind === "gray") {
    const y = clamp(xyz[1] / D50[1])
    const dotGain = profile.dotGain ?? 0
    const encoded = clamp(y ** (1 / profile.gamma) * (1 - dotGain))
    const value = clamp8(encoded * 255)
    return { rgb: { r: value, g: value, b: value }, clipped: false, linear: [encoded, encoded, encoded] }
  }
  if (profile.kind === "cmyk") {
    const proof = cmykProofRgbFromXyz(xyz, profile)
    return { rgb: proof.rgb, clipped: proof.clipped, linear: [proof.c, proof.m, proof.y] }
  }
  if (profile.kind === "clut") {
    const pcs = xyzD50ToPcs(xyz, profile.bToA?.pcs ?? "XYZ")
    const output = profile.bToA ? applyClutBToA(profile, pcs) : null
    if (output) {
      if (profile.deviceKind === "cmyk" && output.length >= 4) {
        const c = clamp(output[0])
        const m = clamp(output[1])
        const yy = clamp(output[2])
        const k = clamp(output[3])
        const kg = clamp(k)
        return {
          rgb: {
            r: clamp8(255 * (1 - c) * (1 - kg)),
            g: clamp8(255 * (1 - m) * (1 - kg)),
            b: clamp8(255 * (1 - yy) * (1 - kg)),
          },
          clipped: false,
          linear: [c, m, yy],
        }
      }
      if (output.length >= 3) {
        return {
          rgb: { r: clamp8(output[0] * 255), g: clamp8(output[1] * 255), b: clamp8(output[2] * 255) },
          clipped: false,
          linear: [output[0], output[1], output[2]],
        }
      }
    }
    return xyzD50ToRgb(xyz, compileProfile("sRGB IEC61966-2.1"), clip)
  }
  if (profile.kind === "link") {
    // Convert to display RGB first, then run the link's device chain.
    const srgb = xyzD50ToRgb(xyz, compileProfile("sRGB IEC61966-2.1"), clip)
    const linked = applyDeviceLink(profile, srgb.rgb)
    return { rgb: linked ?? srgb.rgb, clipped: srgb.clipped }
  }
  const linear = multiplyMatVec(profile.xyzD50ToRgb, xyz)
  const clipped =
    linear[0] < -0.0001 || linear[1] < -0.0001 || linear[2] < -0.0001 ||
    linear[0] > 1.0001 || linear[1] > 1.0001 || linear[2] > 1.0001
  const encoded = linear.map((value, channel) => encodeRgbTransfer(
    clip ? clamp(value) : value,
    profile.transfer,
    channel as 0 | 1 | 2,
  )) as Vec3
  return {
    rgb: {
      r: clamp8(encoded[0] * 255),
      g: clamp8(encoded[1] * 255),
      b: clamp8(encoded[2] * 255),
    },
    clipped,
    linear,
  }
}

function cmykProofRgbFromRgb(rgb: RgbColor, profile: CompiledCmykProfile) {
  const r0 = clamp(rgb.r / 255)
  const g0 = clamp(rgb.g / 255)
  const b0 = clamp(rgb.b / 255)
  const c0 = 1 - r0
  const m0 = 1 - g0
  const y0 = 1 - b0
  const gray = Math.min(c0, m0, y0)
  const k = clamp(gray * profile.blackGeneration)
  let c = k >= 0.999 ? 0 : (c0 - k * profile.grayComponentReplacement) / Math.max(0.0001, 1 - k)
  let m = k >= 0.999 ? 0 : (m0 - k * profile.grayComponentReplacement) / Math.max(0.0001, 1 - k)
  let y = k >= 0.999 ? 0 : (y0 - k * profile.grayComponentReplacement) / Math.max(0.0001, 1 - k)
  c = clamp(c)
  m = clamp(m)
  y = clamp(y)
  const total = c + m + y + k
  const clipped = total > profile.totalInkLimit + 0.0001
  if (clipped) {
    const scale = (profile.totalInkLimit - k) / Math.max(0.0001, c + m + y)
    c *= clamp(scale)
    m *= clamp(scale)
    y *= clamp(scale)
  }
  const kg = clamp(k * (1 + profile.dotGain))
  const proof = {
    r: clamp8(255 * (1 - c) * (1 - kg)),
    g: clamp8(255 * (1 - m) * (1 - kg)),
    b: clamp8(255 * (1 - y) * (1 - kg)),
  }
  const grayMix = luma(proof) * 255
  return {
    rgb: {
      r: clamp8(proof.r * (1 - profile.dotGain) + grayMix * profile.dotGain),
      g: clamp8(proof.g * (1 - profile.dotGain) + grayMix * profile.dotGain),
      b: clamp8(proof.b * (1 - profile.dotGain) + grayMix * profile.dotGain),
    },
    c,
    m,
    y,
    k,
    clipped,
  }
}

function cmykProofRgbFromXyz(xyz: Vec3, profile: CompiledCmykProfile) {
  const srgb = xyzD50ToRgb(xyz, compileProfile("sRGB IEC61966-2.1"))
  return cmykProofRgbFromRgb(srgb.rgb, profile)
}

export function supportedIccProfileNames(): IccProfileName[] {
  return Object.keys(PROFILE_DEFINITIONS) as IccProfileName[]
}

export function normalizeIccProfileName(value: unknown, fallback: IccProfileName = "sRGB IEC61966-2.1"): IccProfileName {
  return profileName(value, fallback)
}

export function iccProfileDeviceKind(value: unknown): DeviceKind {
  const profile = compileProfile(profileName(value))
  if (profile.kind === "clut") return profile.deviceKind
  if (profile.kind === "link") return profile.outputKind
  return profile.kind
}

export function transformRgbColor(rgb: RgbColor, options: IccTransformOptions = {}): IccTransformResult {
  const source = resolveCompiledProfile(options.sourceProfile, options.sourceProfileData)
  const target = resolveCompiledProfile(options.targetProfile, options.targetProfileData)
  const sourceName = source.name
  const targetName = target.name
  // A device-link profile defines the complete source->destination
  // conversion by itself: run its device chain and bypass the PCS pipeline.
  const link = source.kind === "link" ? source : target.kind === "link" ? target : null
  if (link) {
    const linked = applyDeviceLink(link, rgb)
    if (linked) {
      return {
        rgb: linked,
        clipped: false,
        sourceProfile: source.kind === "link" ? link.name : sourceName,
        targetProfile: link.name,
      }
    }
  }
  const sourceXyz = rgbToXyzD50(rgb, source)
  const converted = xyzD50ToRgb(sourceXyz, target)
  let targetXyz = rgbToXyzD50(converted.rgb, target)
  if (target.kind === "cmyk" || target.kind === "clut") {
    targetXyz = rgbToXyzD50(converted.rgb, compileProfile("sRGB IEC61966-2.1"))
  }
  return {
    rgb: converted.rgb,
    clipped: converted.clipped,
    sourceProfile: sourceName,
    targetProfile: targetName,
    deltaE: deltaE76(xyzToLab(sourceXyz), xyzToLab(targetXyz)),
  }
}

export function applyIccTransformToImageData(source: ImageData, options: IccTransformOptions = {}): ImageData {
  const out = new Uint8ClampedArray(source.data)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const result = transformRgbColor({ r: out[i], g: out[i + 1], b: out[i + 2] }, options)
    out[i] = result.rgb.r
    out[i + 1] = result.rgb.g
    out[i + 2] = result.rgb.b
  }
  return new ImageData(out, source.width, source.height)
}

/** True when the bytes parse as an ICC device-link profile with an executable A2B chain. */
export function isExecutableDeviceLinkProfile(value: Uint8Array | ArrayBuffer): boolean {
  const parsed = parseIccProfileInternal(value)
  return !!parsed?.deviceLink && !!parsed.aToB
}

/**
 * Run an ICC device-link profile over image pixels. The link's own A2B
 * chain performs the entire conversion (no PCS crossing). Returns null when
 * the bytes are not an executable device-link profile.
 */
export function applyDeviceLinkToImageData(source: ImageData, profileData: Uint8Array | ArrayBuffer): ImageData | null {
  const compiled = compileProfileData(profileData)
  if (!compiled || compiled.kind !== "link") return null
  const out = new Uint8ClampedArray(source.data)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const linked = applyDeviceLink(compiled, { r: out[i], g: out[i + 1], b: out[i + 2] })
    if (!linked) continue
    out[i] = linked.r
    out[i + 1] = linked.g
    out[i + 2] = linked.b
  }
  return new ImageData(out, source.width, source.height)
}

export function softProofRgbColor(rgb: RgbColor, settings?: ColorManagementSettings): IccTransformResult {
  const proofProfile = settings?.proofProfile && settings.proofProfile !== "None"
    ? settings.proofProfile
    : settings?.workingSpace ?? "sRGB IEC61966-2.1"
  const sourceName = profileName(settings?.assignedProfile)
  const proofName = profileName(proofProfile)
  const sourceXyz = rgbToXyzD50(rgb, compileProfile(sourceName))
  const proofed = xyzD50ToRgb(sourceXyz, compileProfile(proofName))
  const displayXyz = proofName === "sRGB IEC61966-2.1"
    ? sourceXyz
    : rgbToXyzD50(proofed.rgb, compileProfile(proofName === "Working CMYK" || proofName.includes("Coated") ? "sRGB IEC61966-2.1" : proofName))
  const display = xyzD50ToRgb(displayXyz, compileProfile("sRGB IEC61966-2.1"))
  return {
    rgb: display.rgb,
    clipped: proofed.clipped || display.clipped,
    sourceProfile: sourceName,
    targetProfile: proofName,
    deltaE: deltaE76(xyzToLab(sourceXyz), xyzToLab(displayXyz)),
  }
}

export function softProofImageData(source: ImageData, settings?: ColorManagementSettings): ImageData {
  const proofProfile = settings?.proofProfile ?? "None"
  const proofColors = !!settings?.proofColors && proofProfile !== "None"
  if (!proofColors) {
    return applyIccTransformToImageData(source, {
      sourceProfile: settings?.assignedProfile ?? "sRGB IEC61966-2.1",
      targetProfile: "sRGB IEC61966-2.1",
      renderingIntent: settings?.renderingIntent,
      blackPointCompensation: settings?.blackPointCompensation,
    })
  }
  const out = new Uint8ClampedArray(source.data)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const result = softProofRgbColor({ r: out[i], g: out[i + 1], b: out[i + 2] }, settings)
    out[i] = result.rgb.r
    out[i + 1] = result.rgb.g
    out[i + 2] = result.rgb.b
  }
  return new ImageData(out, source.width, source.height)
}

export function checkRgbOutOfGamut(rgb: RgbColor, settings?: ColorManagementSettings): GamutWarningResult {
  if (!settings?.gamutWarning || !settings.proofProfile || settings.proofProfile === "None") {
    return { outOfGamut: false, clipped: false, deltaE: 0, proofRgb: rgb }
  }
  const result = softProofRgbColor(rgb, settings)
  const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
  const rgbDelta = Math.sqrt(
    (rgb.r - result.rgb.r) ** 2 +
    (rgb.g - result.rgb.g) ** 2 +
    (rgb.b - result.rgb.b) ** 2,
  )
  const outOfGamut = result.clipped || ((result.deltaE ?? 0) > 8 || rgbDelta > 20) && chroma > 24
  return {
    outOfGamut,
    clipped: result.clipped,
    deltaE: result.deltaE ?? 0,
    proofRgb: result.rgb,
  }
}

export function buildGamutWarningMaskImageData(source: ImageData, settings?: ColorManagementSettings): ImageData {
  const out = new Uint8ClampedArray(source.width * source.height * 4)
  if (!settings?.gamutWarning) return new ImageData(out, source.width, source.height)
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] === 0) continue
    const warning = checkRgbOutOfGamut({ r: source.data[i], g: source.data[i + 1], b: source.data[i + 2] }, settings)
    if (!warning.outOfGamut) continue
    out[i] = 128
    out[i + 1] = 0
    out[i + 2] = 255
    out[i + 3] = 210
  }
  return new ImageData(out, source.width, source.height)
}

export function convertImageDataForExport(source: ImageData, settings?: ColorManagementSettings): { imageData: ImageData; outputProfile: IccProfileName } {
  const outputProfile = profileName(settings?.proofColors && settings.proofProfile !== "None" ? settings.proofProfile : settings?.workingSpace)
  if (settings?.proofColors && settings.proofProfile !== "None") {
    return { imageData: softProofImageData(source, settings), outputProfile }
  }
  return {
    imageData: applyIccTransformToImageData(source, {
      sourceProfile: settings?.assignedProfile ?? "sRGB IEC61966-2.1",
      targetProfile: outputProfile,
      renderingIntent: settings?.renderingIntent,
      blackPointCompensation: settings?.blackPointCompensation,
    }),
    outputProfile,
  }
}
