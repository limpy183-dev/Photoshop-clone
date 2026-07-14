import { assertCanvasSize } from "./canvas-limits"
import {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  clamp,
  concatBytes,
  createSubsystemCanvas,
  readAscii,
} from "./advanced-subsystems-shared"

export async function decodeDicomPreview(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "DICOM file")
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength < 132 || readAscii(buffer, 128, 4) !== "DICM") return null
  try {
    const dicomParser = await import("dicom-parser")
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer))
    const pixel = dataSet.elements.x7fe00010
    if (!pixel || pixel.encapsulatedPixelData) return null
    return dicomPixelsToCanvas({
      buffer,
      pixelOffset: pixel.dataOffset,
      pixelLength: pixel.length,
      rows: dataSet.uint16("x00280010") ?? 0,
      cols: dataSet.uint16("x00280011") ?? 0,
      bits: dataSet.uint16("x00280100") ?? 8,
      samples: dataSet.uint16("x00280002") ?? 1,
      signed: (dataSet.uint16("x00280103") ?? 0) === 1,
      photometric: dataSet.string("x00280004") ?? "MONOCHROME2",
      windowCenter: dataSet.floatString("x00281050"),
      windowWidth: dataSet.floatString("x00281051"),
    })
  } catch {
    return decodeDicomPreviewExplicitVr(buffer)
  }
}

export async function decodeRadianceHdrPreview(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "Radiance HDR file")
  const buffer = await file.arrayBuffer()
  const textHead = new TextDecoder("ascii").decode(buffer.slice(0, Math.min(buffer.byteLength, 4096)))
  if (!textHead.startsWith("#?RADIANCE") && !textHead.startsWith("#?RGBE")) return null
  const dimMatch = textHead.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/)
  if (!dimMatch) return null
  const height = Number(dimMatch[1])
  const width = Number(dimMatch[2])
  const size = assertCanvasSize(width, height, "Radiance HDR preview")
  let headerLength = textHead.indexOf(dimMatch[0]) + dimMatch[0].length
  const allBytes = new Uint8Array(buffer)
  while (headerLength < allBytes.length && (allBytes[headerLength] === 10 || allBytes[headerLength] === 13)) headerLength++
  const bytes = new Uint8Array(buffer, headerLength)
  const canvas = createSubsystemCanvas(size.width, size.height)
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, size.width, size.height)
  let p = 0
  if (size.width >= 8 && bytes.length >= size.height * 4 && bytes[0] === 2 && bytes[1] === 2) {
    for (let y = 0; y < size.height && p + 4 <= bytes.length; y++) {
      if (bytes[p] !== 2 || bytes[p + 1] !== 2) return null
      const scanlineWidth = (bytes[p + 2] << 8) | bytes[p + 3]
      p += 4
      if (scanlineWidth !== size.width) return null
      const scanline = new Uint8Array(size.width * 4)
      for (let channel = 0; channel < 4; channel++) {
        let x = 0
        while (x < size.width && p < bytes.length) {
          const code = bytes[p++]
          if (code > 128) {
            const count = code - 128
            const value = bytes[p++]
            for (let i = 0; i < count && x < size.width; i++, x++) scanline[x * 4 + channel] = value
          } else {
            for (let i = 0; i < code && x < size.width && p < bytes.length; i++, x++) scanline[x * 4 + channel] = bytes[p++]
          }
        }
      }
      for (let x = 0; x < size.width; x++) writeRgbePreviewPixel(image.data, y * size.width + x, scanline, x * 4)
    }
  } else {
    for (let i = 0; i < size.width * size.height && p + 3 < bytes.length; i++, p += 4) {
      writeRgbePreviewPixel(image.data, i, bytes, p)
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function writeRgbePreviewPixel(target: Uint8ClampedArray, pixel: number, source: Uint8Array, offset: number) {
  const e = source[offset + 3]
  const scale = e ? Math.pow(2, e - 136) : 0
  target[pixel * 4] = clamp(source[offset] * scale)
  target[pixel * 4 + 1] = clamp(source[offset + 1] * scale)
  target[pixel * 4 + 2] = clamp(source[offset + 2] * scale)
  target[pixel * 4 + 3] = 255
}

function dicomPixelsToCanvas(input: {
  buffer: ArrayBuffer
  pixelOffset: number
  pixelLength: number
  rows: number
  cols: number
  bits: number
  samples: number
  signed: boolean
  photometric: string
  windowCenter?: number
  windowWidth?: number
}) {
  if (!input.rows || !input.cols || input.pixelOffset < 0) return null
  const size = assertCanvasSize(input.cols, input.rows, "DICOM preview")
  const view = new DataView(input.buffer)
  const canvas = createSubsystemCanvas(size.width, size.height, "#000000")
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, size.width, size.height)
  const sampleBytes = input.bits > 8 ? 2 : 1
  const samples = Math.max(1, input.samples)
  const pixelCount = Math.min(size.width * size.height, Math.floor(input.pixelLength / Math.max(1, sampleBytes * samples)))
  const photometric = input.photometric.toUpperCase()
  const maxStored = input.bits > 8 ? (1 << Math.min(input.bits, 16)) - 1 : 255
  const windowWidth = input.windowWidth && input.windowWidth > 0 ? input.windowWidth : maxStored
  const windowCenter = input.windowCenter ?? windowWidth / 2
  const scaleMono = (value: number) => {
    const unsigned = input.signed ? value + Math.ceil(maxStored / 2) : value
    const windowed = ((unsigned - (windowCenter - windowWidth / 2)) / windowWidth) * 255
    const out = clamp(windowed)
    return photometric === "MONOCHROME1" ? 255 - out : out
  }
  const readSample = (offset: number) => {
    if (input.bits > 8) return input.signed ? view.getInt16(offset, true) : view.getUint16(offset, true)
    return input.signed ? view.getInt8(offset) : view.getUint8(offset)
  }
  for (let i = 0; i < pixelCount; i++) {
    const source = input.pixelOffset + i * samples * sampleBytes
    const target = i * 4
    if (samples >= 3 || photometric === "RGB") {
      image.data[target] = scaleSampleTo8(readSample(source), maxStored, input.signed)
      image.data[target + 1] = scaleSampleTo8(readSample(source + sampleBytes), maxStored, input.signed)
      image.data[target + 2] = scaleSampleTo8(readSample(source + sampleBytes * 2), maxStored, input.signed)
      image.data[target + 3] = samples >= 4 ? scaleSampleTo8(readSample(source + sampleBytes * 3), maxStored, input.signed) : 255
    } else {
      const gray = scaleMono(readSample(source))
      image.data[target] = gray
      image.data[target + 1] = gray
      image.data[target + 2] = gray
      image.data[target + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function scaleSampleTo8(value: number, max: number, signed = false) {
  const next = signed ? value + Math.ceil(max / 2) : value
  return clamp((next / Math.max(1, max)) * 255)
}

function decodeDicomPreviewExplicitVr(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  let offset = 132
  const parsed = {
    buffer,
    rows: 0,
    cols: 0,
    bits: 8,
    samples: 1,
    signed: false,
    photometric: "MONOCHROME2",
    pixelOffset: -1,
    pixelLength: 0,
  }
  while (offset + 8 < buffer.byteLength) {
    const group = view.getUint16(offset, true)
    const element = view.getUint16(offset + 2, true)
    const vr = readAscii(buffer, offset + 4, 2)
    let length = view.getUint16(offset + 6, true)
    let dataOffset = offset + 8
    if (["OB", "OW", "SQ", "UN", "UT"].includes(vr)) {
      if (offset + 12 > buffer.byteLength) break
      length = view.getUint32(offset + 8, true)
      dataOffset = offset + 12
    }
    if (dataOffset + length > buffer.byteLength) break
    if (group === 0x0028 && element === 0x0002) parsed.samples = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0004) parsed.photometric = readAscii(buffer, dataOffset, length).replace(/\0/g, "").trim()
    if (group === 0x0028 && element === 0x0010) parsed.rows = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0011) parsed.cols = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0100) parsed.bits = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0103) parsed.signed = view.getUint16(dataOffset, true) === 1
    if (group === 0x7fe0 && element === 0x0010) {
      parsed.pixelOffset = dataOffset
      parsed.pixelLength = length
      break
    }
    offset = dataOffset + length + (length % 2)
  }
  return dicomPixelsToCanvas(parsed)
}

export function encodeRadianceHdrImageData(imageData: ImageData): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "Radiance HDR export")
  const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const r = imageData.data[i * 4] / 255
    const g = imageData.data[i * 4 + 1] / 255
    const b = imageData.data[i * 4 + 2] / 255
    const max = Math.max(r, g, b)
    if (max < 1e-32) continue
    const exponent = Math.floor(Math.log2(max)) + 1
    const scale = 256 / Math.pow(2, exponent)
    pixels[i * 4] = clamp(r * scale)
    pixels[i * 4 + 1] = clamp(g * scale)
    pixels[i * 4 + 2] = clamp(b * scale)
    pixels[i * 4 + 3] = exponent + 128
  }
  const out = new Uint8Array(header.length + pixels.length)
  out.set(header, 0)
  out.set(pixels, header.length)
  return out.buffer
}

export function encodeDicomImageData(imageData: ImageData, name = "Photoshop Web"): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "DICOM export")
  const sopClass = "1.2.840.10008.5.1.4.1.1.7"
  const sopInstance = generateDicomUid()
  const implementation = "1.2.826.0.1.3680043.10.999.1"
  const transferSyntax = "1.2.840.10008.1.2.1"
  const metaWithoutLength = concatBytes(
    dicomElementBytes(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
    dicomElementBytes(0x0002, 0x0002, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0002, 0x0003, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0002, 0x0010, "UI", dicomTextBytes(transferSyntax, "UI")),
    dicomElementBytes(0x0002, 0x0012, "UI", dicomTextBytes(implementation, "UI")),
  )
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = imageData.data[i * 4]
    rgb[i * 3 + 1] = imageData.data[i * 4 + 1]
    rgb[i * 3 + 2] = imageData.data[i * 4 + 2]
  }
  const dataset = concatBytes(
    dicomElementBytes(0x0008, 0x0016, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0008, 0x0018, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0008, 0x0060, "CS", dicomTextBytes("OT", "CS")),
    dicomElementBytes(0x0010, 0x0010, "PN", dicomTextBytes(name, "PN")),
    dicomElementBytes(0x0028, 0x0002, "US", u16Bytes(3)),
    dicomElementBytes(0x0028, 0x0004, "CS", dicomTextBytes("RGB", "CS")),
    dicomElementBytes(0x0028, 0x0006, "US", u16Bytes(0)),
    dicomElementBytes(0x0028, 0x0010, "US", u16Bytes(height)),
    dicomElementBytes(0x0028, 0x0011, "US", u16Bytes(width)),
    dicomElementBytes(0x0028, 0x0100, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0101, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0102, "US", u16Bytes(7)),
    dicomElementBytes(0x0028, 0x0103, "US", u16Bytes(0)),
    dicomElementBytes(0x7fe0, 0x0010, "OB", rgb),
  )
  const preamble = new Uint8Array(132)
  preamble.set(new TextEncoder().encode("DICM"), 128)
  const meta = concatBytes(
    dicomElementBytes(0x0002, 0x0000, "UL", u32Bytes(metaWithoutLength.length)),
    metaWithoutLength,
  )
  return concatBytes(preamble, meta, dataset).buffer
}

export interface DicomOverlayAuthoring {
  group: number
  rows: number
  columns: number
  data: Uint8Array
  description?: string
}

export interface DicomCompressedEncodeOptions {
  patientName?: string
  studyDescription?: string
  seriesDescription?: string
  transferSyntax: string
  compressedPixelData: Uint8Array
  overlays?: DicomOverlayAuthoring[]
  validationLabel?: string
}

export interface DicomMetadataInspection {
  transferSyntax: string
  compressed: boolean
  patientName?: string
  studyDescription?: string
  seriesDescription?: string
  validationLabel: string
  overlays: Array<{ group: number; rows: number; columns: number; description?: string }>
}

export function encodeDicomCompressedImageData(imageData: ImageData, options: DicomCompressedEncodeOptions): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "DICOM compressed export")
  const sopClass = "1.2.840.10008.5.1.4.1.1.7"
  const sopInstance = generateDicomUid()
  const implementation = "1.2.826.0.1.3680043.10.999.1"
  const metaWithoutLength = concatBytes(
    dicomElementBytes(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
    dicomElementBytes(0x0002, 0x0002, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0002, 0x0003, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0002, 0x0010, "UI", dicomTextBytes(options.transferSyntax, "UI")),
    dicomElementBytes(0x0002, 0x0012, "UI", dicomTextBytes(implementation, "UI")),
  )
  const overlayElements = (options.overlays ?? []).flatMap((overlay) => {
    const group = overlay.group & 0xfffe
    return [
      dicomElementBytes(group, 0x0010, "US", u16Bytes(overlay.rows)),
      dicomElementBytes(group, 0x0011, "US", u16Bytes(overlay.columns)),
      dicomElementBytes(group, 0x0022, "LO", dicomTextBytes(overlay.description ?? "Overlay", "LO")),
      dicomElementBytes(group, 0x0040, "CS", dicomTextBytes("G", "CS")),
      dicomElementBytes(group, 0x0050, "SS", u16Bytes(1)),
      dicomElementBytes(group, 0x0100, "US", u16Bytes(1)),
      dicomElementBytes(group, 0x0102, "US", u16Bytes(0)),
      dicomElementBytes(group, 0x3000, "OB", overlay.data),
    ]
  })
  const dataset = concatBytes(
    dicomElementBytes(0x0008, 0x0016, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0008, 0x0018, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0008, 0x0060, "CS", dicomTextBytes("OT", "CS")),
    dicomElementBytes(0x0008, 0x1030, "LO", dicomTextBytes(options.studyDescription ?? "Photoshop Web secondary capture", "LO")),
    dicomElementBytes(0x0008, 0x103e, "LO", dicomTextBytes(options.seriesDescription ?? "Browser export", "LO")),
    dicomElementBytes(0x0010, 0x0010, "PN", dicomTextBytes(options.patientName ?? "Anonymous", "PN")),
    dicomElementBytes(0x0012, 0x0063, "LO", dicomTextBytes(options.validationLabel ?? "NON_CLINICAL_RESEARCH_ONLY", "LO")),
    dicomElementBytes(0x0028, 0x0002, "US", u16Bytes(3)),
    dicomElementBytes(0x0028, 0x0004, "CS", dicomTextBytes("RGB", "CS")),
    dicomElementBytes(0x0028, 0x0006, "US", u16Bytes(0)),
    dicomElementBytes(0x0028, 0x0010, "US", u16Bytes(height)),
    dicomElementBytes(0x0028, 0x0011, "US", u16Bytes(width)),
    dicomElementBytes(0x0028, 0x0100, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0101, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0102, "US", u16Bytes(7)),
    dicomElementBytes(0x0028, 0x0103, "US", u16Bytes(0)),
    ...overlayElements,
    dicomElementBytes(0x7fe0, 0x0010, "OB", options.compressedPixelData),
  )
  const preamble = new Uint8Array(132)
  preamble.set(new TextEncoder().encode("DICM"), 128)
  const meta = concatBytes(
    dicomElementBytes(0x0002, 0x0000, "UL", u32Bytes(metaWithoutLength.length)),
    metaWithoutLength,
  )
  return concatBytes(preamble, meta, dataset).buffer
}

function dicomValueText(buffer: ArrayBuffer, offset: number, length: number) {
  return new TextDecoder("latin1").decode(buffer.slice(offset, offset + length)).replace(/\0/g, "").trim()
}

export async function inspectDicomMetadata(file: File): Promise<DicomMetadataInspection> {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "DICOM file")
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const out: DicomMetadataInspection = {
    transferSyntax: "",
    compressed: false,
    validationLabel: "NON_CLINICAL_RESEARCH_ONLY",
    overlays: [],
  }
  if (buffer.byteLength < 132 || readAscii(buffer, 128, 4) !== "DICM") return out
  const overlayByGroup = new Map<number, { group: number; rows: number; columns: number; description?: string }>()
  let offset = 132
  while (offset + 8 <= buffer.byteLength) {
    const group = view.getUint16(offset, true)
    const element = view.getUint16(offset + 2, true)
    const vr = readAscii(buffer, offset + 4, 2)
    let length = view.getUint16(offset + 6, true)
    let dataOffset = offset + 8
    if (["OB", "OW", "SQ", "UN", "UT"].includes(vr)) {
      if (offset + 12 > buffer.byteLength) break
      length = view.getUint32(offset + 8, true)
      dataOffset = offset + 12
    }
    if (dataOffset + length > buffer.byteLength) break
    const text = () => dicomValueText(buffer, dataOffset, length)
    if (group === 0x0002 && element === 0x0010) out.transferSyntax = text()
    if (group === 0x0010 && element === 0x0010) out.patientName = text()
    if (group === 0x0008 && element === 0x1030) out.studyDescription = text()
    if (group === 0x0008 && element === 0x103e) out.seriesDescription = text()
    if (group === 0x0012 && element === 0x0063) out.validationLabel = text() || out.validationLabel
    if (group >= 0x6000 && group <= 0x60ff && (group & 1) === 0) {
      const overlay = overlayByGroup.get(group) ?? { group, rows: 0, columns: 0 }
      if (element === 0x0010) overlay.rows = view.getUint16(dataOffset, true)
      if (element === 0x0011) overlay.columns = view.getUint16(dataOffset, true)
      if (element === 0x0022) overlay.description = text()
      overlayByGroup.set(group, overlay)
    }
    offset = dataOffset + length + (length % 2)
  }
  out.compressed = !!out.transferSyntax && !["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.1.99"].includes(out.transferSyntax)
  out.overlays = Array.from(overlayByGroup.values()).filter((overlay) => overlay.rows && overlay.columns)
  return out
}

function dicomElementBytes(group: number, element: number, vr: string, value: Uint8Array) {
  const evenValue = value.length % 2 ? concatBytes(value, new Uint8Array([vr === "UI" ? 0 : 32])) : value
  const longVr = ["OB", "OW", "SQ", "UN", "UT"].includes(vr)
  const header = new Uint8Array(longVr ? 12 : 8)
  const view = new DataView(header.buffer)
  view.setUint16(0, group, true)
  view.setUint16(2, element, true)
  header[4] = vr.charCodeAt(0)
  header[5] = vr.charCodeAt(1)
  if (longVr) view.setUint32(8, evenValue.length, true)
  else view.setUint16(6, evenValue.length, true)
  return concatBytes(header, evenValue)
}

function dicomTextBytes(value: string, vr: string) {
  const clean = value.replace(/[^\x20-\x7e]/g, " ").trim()
  const bytes = new TextEncoder().encode(clean)
  if (bytes.length % 2 === 0) return bytes
  return concatBytes(bytes, new Uint8Array([vr === "UI" ? 0 : 32]))
}

function generateDicomUid() {
  const now = Date.now()
  const random = Math.floor(Math.random() * 1_000_000)
  return `1.2.826.0.1.3680043.10.999.${now}.${random}`
}

function u16Bytes(value: number) {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function u32Bytes(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}
