import { assertCanvasSize } from "./canvas-limits"
import type { HighBitImage } from "./color-pipeline"
import {
  asciiBytes,
  cleanMetadataText,
  concatUint8,
  deflateRaw,
  highBitSampleUnit,
} from "./raster-codec-utils"
import { c2paManifestStoreFromRasterMetadata, xmpPacketFromRasterMetadata } from "./raster-metadata-embeds"
import type {
  BigTiffDirectorySpec,
  BigTiffEncodeOptions,
  RasterExportMetadata,
  TiffCustomField,
  TiffEncodeOptions,
} from "./raster-codec-types"

function rgbaPixelBytes(imageData: ImageData): Uint8Array {
  return new Uint8Array(imageData.data)
}

function encodeTiffLzw(data: Uint8Array): Uint8Array {
  const clear = 256
  const eoi = 257
  const maxCode = 4095
  let codeSize = 9
  let nextCode = 258
  const dict = new Map<string, number>()
  const out: number[] = []
  let bitBuffer = 0
  let bitCount = 0

  const reset = () => {
    dict.clear()
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i)
    codeSize = 9
    nextCode = 258
  }
  const emit = (code: number) => {
    bitBuffer = (bitBuffer << codeSize) | code
    bitCount += codeSize
    while (bitCount >= 8) {
      out.push((bitBuffer >>> (bitCount - 8)) & 255)
      bitCount -= 8
      bitBuffer &= (1 << bitCount) - 1
    }
  }
  const add = (key: string) => {
    if (nextCode > maxCode) {
      emit(clear)
      reset()
      return
    }
    dict.set(key, nextCode++)
    if (nextCode + 1 === 1 << codeSize && codeSize < 12) codeSize++
  }

  reset()
  emit(clear)
  if (data.length) {
    let w = String.fromCharCode(data[0])
    for (let i = 1; i < data.length; i++) {
      const k = String.fromCharCode(data[i])
      const wk = w + k
      if (dict.has(wk)) {
        w = wk
      } else {
        emit(dict.get(w) ?? data[i - 1])
        add(wk)
        w = k
      }
    }
    emit(dict.get(w) ?? 0)
  }
  emit(eoi)
  if (bitCount > 0) out.push((bitBuffer << (8 - bitCount)) & 255)
  return new Uint8Array(out)
}

function tiffAsciiBytes(value: string): Uint8Array {
  const clean = value.replace(/\0/g, " ").slice(0, 2048)
  return concatUint8([asciiBytes(clean), new Uint8Array([0])])
}

function tiffDateTime(value: string | undefined) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function tiffU16LE(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255])
}

function tiffU32LE(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255])
}

function tiffWriteField(
  bytes: Uint8Array,
  view: DataView,
  entry: number,
  field: { tag: number; type: number; count: number; value?: number; data?: Uint8Array },
  valueOffset: number,
  copyOffset = valueOffset,
  little = true,
) {
  view.setUint16(entry, field.tag, little)
  view.setUint16(entry + 2, field.type, little)
  view.setUint32(entry + 4, field.count, little)
  if (field.data) {
    if (field.data.byteLength <= 4) {
      bytes.set(field.data, entry + 8)
    } else {
      view.setUint32(entry + 8, valueOffset, little)
      bytes.set(field.data, copyOffset)
    }
  } else if (field.type === 3 && field.count === 1) {
    view.setUint16(entry + 8, field.value ?? 0, little)
  } else {
    view.setUint32(entry + 8, field.value ?? 0, little)
  }
}

function rationalBytes64(numerator: number, denominator: number): Uint8Array {
  const num = Math.max(0, Math.round(numerator))
  const den = Math.max(1, Math.round(denominator))
  return concatUint8([tiffU32LE(num), tiffU32LE(den)])
}

function decimalDegreesToRational(decimal: number): Uint8Array {
  // Convert to deg/min/sec rationals.
  const abs = Math.abs(decimal)
  const degrees = Math.floor(abs)
  const minutesFloat = (abs - degrees) * 60
  const minutes = Math.floor(minutesFloat)
  const seconds = (minutesFloat - minutes) * 60
  // Encode seconds at millisecond precision (×1000).
  return concatUint8([
    rationalBytes64(degrees, 1),
    rationalBytes64(minutes, 1),
    rationalBytes64(Math.round(seconds * 1000), 1000),
  ])
}

function buildGpsIfdBytes(metadata: RasterExportMetadata, baseOffset: number): Uint8Array | null {
  const gps = metadata.gps
  if (!gps || (gps.latitude === undefined && gps.longitude === undefined)) return null
  const fields: TiffField[] = []
  // GPS Version ID (tag 0): 2.2.0.0
  fields.push({ tag: 0, type: 1, count: 4, data: new Uint8Array([2, 2, 0, 0]) })
  if (typeof gps.latitude === "number" && Number.isFinite(gps.latitude)) {
    fields.push({ tag: 1, type: 2, count: 2, data: tiffAsciiBytes(gps.latitude >= 0 ? "N" : "S") })
    fields.push({ tag: 2, type: 5, count: 3, data: decimalDegreesToRational(gps.latitude) })
  }
  if (typeof gps.longitude === "number" && Number.isFinite(gps.longitude)) {
    fields.push({ tag: 3, type: 2, count: 2, data: tiffAsciiBytes(gps.longitude >= 0 ? "E" : "W") })
    fields.push({ tag: 4, type: 5, count: 3, data: decimalDegreesToRational(gps.longitude) })
  }
  if (typeof gps.altitude === "number" && Number.isFinite(gps.altitude)) {
    fields.push({ tag: 5, type: 1, count: 1, data: new Uint8Array([gps.altitude < 0 ? 1 : 0]) })
    fields.push({ tag: 6, type: 5, count: 1, data: rationalBytes64(Math.round(Math.abs(gps.altitude) * 100), 100) })
  }
  if (gps.capturedAt) {
    const date = new Date(gps.capturedAt)
    if (!Number.isNaN(date.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0")
      const dateStamp = tiffAsciiBytes(`${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())}`)
      const timeStamp = concatUint8([
        rationalBytes64(date.getUTCHours(), 1),
        rationalBytes64(date.getUTCMinutes(), 1),
        rationalBytes64(date.getUTCSeconds(), 1),
      ])
      fields.push({ tag: 29, type: 2, count: dateStamp.byteLength, data: dateStamp })
      fields.push({ tag: 7, type: 5, count: 3, data: timeStamp })
    }
  }
  if (fields.length <= 1) return null
  fields.sort((a, b) => a.tag - b.tag)
  return packTiffSubIfd(fields, baseOffset)
}

function packTiffSubIfd(fields: TiffField[], baseOffset: number): Uint8Array {
  const tagCount = fields.length
  const ifdSize = 2 + tagCount * 12 + 4
  let extraLength = 0
  for (const field of fields) if (field.data && field.data.byteLength > 4) extraLength += field.data.byteLength
  const bytes = new Uint8Array(ifdSize + extraLength)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, tagCount, true)
  let entry = 2
  let extraOffset = ifdSize
  for (const field of fields) {
    const dataOffset = field.data && field.data.byteLength > 4 ? baseOffset + extraOffset : 0
    tiffWriteField(bytes, view, entry, field, dataOffset, extraOffset)
    if (field.data && field.data.byteLength > 4) extraOffset += field.data.byteLength
    entry += 12
  }
  view.setUint32(entry, 0, true)
  return bytes
}

function buildExifIfdBytes(metadata: RasterExportMetadata, baseOffset: number): Uint8Array {
  const fields: TiffField[] = []
  const dateTime = tiffDateTime(metadata.creationDate)
  if (dateTime) {
    const data = tiffAsciiBytes(dateTime)
    fields.push({ tag: 36867, type: 2, count: data.byteLength, data })
    fields.push({ tag: 36868, type: 2, count: data.byteLength, data })
  }
  if (metadata.creationDate) {
    const offsetMatch = /([+-]\d{2}:\d{2}|Z)$/.exec(metadata.creationDate)
    if (offsetMatch) {
      const value = offsetMatch[0] === "Z" ? "+00:00" : offsetMatch[0]
      const data = tiffAsciiBytes(value)
      // OffsetTimeOriginal (36881) and OffsetTimeDigitized (36882) — Exif 2.31
      fields.push({ tag: 36881, type: 2, count: data.byteLength, data })
      fields.push({ tag: 36882, type: 2, count: data.byteLength, data })
    }
  }
  const comment = cleanMetadataText(metadata.description, 512)
  if (comment) {
    const data = concatUint8([asciiBytes("ASCII"), new Uint8Array([0, 0, 0]), asciiBytes(comment)])
    fields.push({ tag: 37510, type: 7, count: data.byteLength, data })
  }
  fields.push({ tag: 40961, type: 3, count: 1, value: metadata.iccProfileName && !/srgb/i.test(metadata.iccProfileName) ? 0xffff : 1 })
  if (!fields.length) return new Uint8Array([0, 0, 0, 0, 0, 0])
  fields.sort((a, b) => a.tag - b.tag)
  return packTiffSubIfd(fields, baseOffset)
}

function iptcDataset(record: number, dataset: number, value: string): Uint8Array {
  const data = new TextEncoder().encode(cleanMetadataText(value, 32767))
  if (!data.byteLength) return new Uint8Array(0)
  return concatUint8([new Uint8Array([0x1c, record & 255, dataset & 255, (data.byteLength >>> 8) & 255, data.byteLength & 255]), data])
}

function buildIptcIimBytes(metadata: RasterExportMetadata): Uint8Array {
  const parts: Uint8Array[] = []
  if (metadata.title) parts.push(iptcDataset(2, 5, metadata.title))
  for (const keyword of metadata.keywords ?? []) parts.push(iptcDataset(2, 25, keyword))
  if (metadata.author) parts.push(iptcDataset(2, 80, metadata.author))
  if (metadata.credit) parts.push(iptcDataset(2, 110, metadata.credit))
  if (metadata.source) parts.push(iptcDataset(2, 115, metadata.source))
  if (metadata.copyright) parts.push(iptcDataset(2, 116, metadata.copyright))
  if (metadata.description) parts.push(iptcDataset(2, 120, metadata.description))
  return concatUint8(parts.filter((part) => part.byteLength > 0))
}

function normalizeTiffCustomFields(customFields: TiffCustomField[] | undefined): TiffField[] {
  return (customFields ?? [])
    .filter((field) => Number.isFinite(field.tag) && Number.isFinite(field.type))
    .map((field) => ({
      tag: Math.max(0, Math.min(65535, Math.round(field.tag))),
      type: Math.max(1, Math.round(field.type)),
      count: field.count ?? (field.data ? field.data.byteLength : 1),
      value: field.value,
      data: field.data,
    }))
}

function tiffMetadataFields(metadata: RasterExportMetadata | undefined, customFields?: TiffCustomField[]): TiffField[] {
  const custom = normalizeTiffCustomFields(customFields)
  if (!metadata) return custom
  const fields: TiffField[] = []
  const software = tiffAsciiBytes("Photoshop Web")
  fields.push({ tag: 305, type: 2, count: software.byteLength, data: software })
  if (metadata.description) {
    const data = tiffAsciiBytes(metadata.description)
    fields.push({ tag: 270, type: 2, count: data.byteLength, data })
  }
  const dateTime = tiffDateTime(metadata.creationDate)
  if (dateTime) {
    const data = tiffAsciiBytes(dateTime)
    fields.push({ tag: 306, type: 2, count: data.byteLength, data })
  }
  if (metadata.author) {
    const data = tiffAsciiBytes(metadata.author)
    fields.push({ tag: 315, type: 2, count: data.byteLength, data })
  }
  if (metadata.copyright) {
    const data = tiffAsciiBytes(metadata.copyright)
    fields.push({ tag: 33432, type: 2, count: data.byteLength, data })
  }
  const iptc = buildIptcIimBytes(metadata)
  if (iptc.byteLength) fields.push({ tag: 33723, type: 7, count: iptc.byteLength, data: iptc })
  if (metadata.iccProfile?.byteLength) {
    fields.push({ tag: 34675, type: 7, count: metadata.iccProfile.byteLength, data: metadata.iccProfile })
  }
  const c2pa = c2paManifestStoreFromRasterMetadata(metadata)
  if (c2pa?.byteLength) fields.push({ tag: 52545, type: 7, count: c2pa.byteLength, data: c2pa })
  const xmp = xmpPacketFromRasterMetadata(metadata)
  if (xmp) {
    const data = new TextEncoder().encode(xmp)
    fields.push({ tag: 700, type: 1, count: data.length, data })
  }
  if (dateTime || metadata.description || metadata.iccProfileName) {
    fields.push({ tag: 34665, type: 4, count: 1, dataFactory: (offset) => buildExifIfdBytes(metadata, offset) })
  }
  if (buildGpsIfdBytes(metadata, 0)?.byteLength) {
    fields.push({ tag: 34853, type: 4, count: 1, dataFactory: (offset) => buildGpsIfdBytes(metadata, offset) ?? new Uint8Array(0) })
  }
  return [...fields, ...custom]
}

interface TiffField {
  tag: number
  type: number
  count: number
  value?: number
  data?: Uint8Array
  dataFactory?: (offset: number) => Uint8Array
  dataOffset?: number
}

function buildTiffImageData(
  imageData: ImageData,
  compressionTag: number,
  pixelBytes: Uint8Array,
  metadata?: RasterExportMetadata,
  customFields?: TiffCustomField[],
): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "TIFF export")
  const fields: TiffField[] = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: 4, data: new Uint8Array([8, 0, 8, 0, 8, 0, 8, 0]) },
    { tag: 259, type: 3, count: 1, value: compressionTag },
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 273, type: 4, count: 1, value: 0 },
    { tag: 277, type: 3, count: 1, value: 4 },
    { tag: 278, type: 4, count: 1, value: height },
    { tag: 279, type: 4, count: 1, value: pixelBytes.byteLength },
    { tag: 284, type: 3, count: 1, value: 1 },
    { tag: 338, type: 3, count: 1, value: 2 },
    ...tiffMetadataFields(metadata, customFields),
  ].sort((a, b) => a.tag - b.tag)
  const tagCount = fields.length
  const ifdOffset = 8
  const dataOffset = ifdOffset + 2 + tagCount * 12 + 4
  let extraLength = 0
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(0)
    if (data && data.byteLength > 4) extraLength += data.byteLength
  }
  const pixelOffset = dataOffset + extraLength
  for (const field of fields) {
    if (field.tag === 273) field.value = pixelOffset
  }
  let plannedExtraOffset = dataOffset
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(plannedExtraOffset)
    if (!data) continue
    field.data = data
    if (data.byteLength > 4) {
      field.dataOffset = plannedExtraOffset
      plannedExtraOffset += data.byteLength
    }
  }
  const bytes = new Uint8Array(pixelOffset + pixelBytes.byteLength)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, tagCount, true)
  let entry = ifdOffset + 2
  let extraOffset = dataOffset
  const writeField = (field: TiffField) => {
    view.setUint16(entry, field.tag, true)
    view.setUint16(entry + 2, field.type, true)
    view.setUint32(entry + 4, field.count, true)
    if (field.data) {
      if (field.data.byteLength <= 4) {
        bytes.set(field.data, entry + 8)
      } else {
        const offset = field.dataOffset ?? extraOffset
        view.setUint32(entry + 8, offset, true)
        bytes.set(field.data, offset)
        extraOffset = offset + field.data.byteLength
      }
    } else if (field.type === 3 && field.count === 1) {
      view.setUint16(entry + 8, field.value ?? 0, true)
    } else {
      view.setUint32(entry + 8, field.value ?? 0, true)
    }
    entry += 12
  }
  for (const field of fields) writeField(field)
  view.setUint32(entry, 0, true)
  bytes.set(pixelBytes, pixelOffset)
  return bytes.buffer
}

function highBitRgbaPixelBytes(image: HighBitImage) {
  const bytesPerSample = image.storage === "float32" ? 4 : image.bitDepth === 16 || image.storage === "uint16" ? 2 : 1
  const bytes = new Uint8Array(image.width * image.height * 4 * bytesPerSample)
  const view = new DataView(bytes.buffer)
  let out = 0
  for (let i = 0; i < image.width * image.height * 4; i++) {
    if (bytesPerSample === 4) {
      const value = image.storage === "float32"
        ? Number((image.data as Float32Array)[i])
        : highBitSampleUnit(image, i)
      view.setFloat32(out, Number.isFinite(value) ? value : 0, true)
      out += 4
    } else if (bytesPerSample === 2) {
      const value = image.storage === "uint16"
        ? (image.data as Uint16Array)[i]
        : Math.round(highBitSampleUnit(image, i) * 65535)
      view.setUint16(out, Math.max(0, Math.min(65535, value)), true)
      out += 2
    } else {
      bytes[out++] = Math.max(0, Math.min(255, Math.round(highBitSampleUnit(image, i) * 255)))
    }
  }
  return bytes
}

function buildTiffHighBitImageData(image: HighBitImage, compressionTag: number, pixelBytes: Uint8Array, metadata?: RasterExportMetadata, customFields?: TiffCustomField[]): ArrayBuffer {
  const width = image.width
  const height = image.height
  assertCanvasSize(width, height, "TIFF export")
  const bits = image.storage === "float32" ? 32 : image.bitDepth === 16 || image.storage === "uint16" ? 16 : 8
  const includeSampleFormat = bits === 32
  const fields: TiffField[] = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: 4, data: concatUint8([tiffU16LE(bits), tiffU16LE(bits), tiffU16LE(bits), tiffU16LE(bits)]) },
    { tag: 259, type: 3, count: 1, value: compressionTag },
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 273, type: 4, count: 1, value: 0 },
    { tag: 277, type: 3, count: 1, value: 4 },
    { tag: 278, type: 4, count: 1, value: height },
    { tag: 279, type: 4, count: 1, value: pixelBytes.byteLength },
    { tag: 284, type: 3, count: 1, value: 1 },
    { tag: 338, type: 3, count: 1, value: 2 },
    ...(includeSampleFormat
      ? [{ tag: 339, type: 3, count: 4, data: concatUint8([tiffU16LE(3), tiffU16LE(3), tiffU16LE(3), tiffU16LE(3)]) } as TiffField]
      : []),
    ...tiffMetadataFields(metadata, customFields),
  ].sort((a, b) => a.tag - b.tag)
  const tagCount = fields.length
  const ifdOffset = 8
  const dataOffset = ifdOffset + 2 + tagCount * 12 + 4
  let extraLength = 0
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(0)
    if (data && data.byteLength > 4) extraLength += data.byteLength
  }
  const pixelOffset = dataOffset + extraLength
  for (const field of fields) {
    if (field.tag === 273) field.value = pixelOffset
  }
  let plannedExtraOffset = dataOffset
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(plannedExtraOffset)
    if (!data) continue
    field.data = data
    if (data.byteLength > 4) {
      field.dataOffset = plannedExtraOffset
      plannedExtraOffset += data.byteLength
    }
  }
  const bytes = new Uint8Array(pixelOffset + pixelBytes.byteLength)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, tagCount, true)
  let entry = ifdOffset + 2
  let extraOffset = dataOffset
  for (const field of fields) {
    if (field.data && field.data.byteLength > 4) {
      const offset = field.dataOffset ?? extraOffset
      tiffWriteField(bytes, view, entry, field, offset)
      extraOffset = offset + field.data.byteLength
    } else {
      tiffWriteField(bytes, view, entry, field, extraOffset)
    }
    entry += 12
  }
  view.setUint32(entry, 0, true)
  bytes.set(pixelBytes, pixelOffset)
  return bytes.buffer
}

export function encodeTiffHighBitImageData(image: HighBitImage, options: TiffEncodeOptions = {}): ArrayBuffer {
  const compression = options.compression ?? "none"
  if (compression === "deflate") throw new Error("Deflate TIFF export is asynchronous. Use encodeTiffHighBitImageDataAsync().")
  const pixels = highBitRgbaPixelBytes(image)
  if (compression === "lzw") return buildTiffHighBitImageData(image, 5, encodeTiffLzw(pixels), options.metadata, options.customFields)
  return buildTiffHighBitImageData(image, 1, pixels, options.metadata, options.customFields)
}

export async function encodeTiffHighBitImageDataAsync(image: HighBitImage, options: TiffEncodeOptions = {}): Promise<ArrayBuffer> {
  const compression = options.compression ?? "none"
  if (compression === "deflate") return buildTiffHighBitImageData(image, 8, await deflateRaw(highBitRgbaPixelBytes(image)), options.metadata, options.customFields)
  return encodeTiffHighBitImageData(image, options)
}

export function encodeTiffImageData(imageData: ImageData, options: TiffEncodeOptions = {}): ArrayBuffer {
  const compression = options.compression ?? "none"
  if (compression === "deflate") {
    throw new Error("Deflate TIFF export is asynchronous. Use encodeTiffImageDataAsync().")
  }
  const pixels = rgbaPixelBytes(imageData)
  if (compression === "lzw") return buildTiffImageData(imageData, 5, encodeTiffLzw(pixels), options.metadata, options.customFields)
  return buildTiffImageData(imageData, 1, pixels, options.metadata, options.customFields)
}

export async function encodeTiffImageDataAsync(imageData: ImageData, options: TiffEncodeOptions = {}): Promise<ArrayBuffer> {
  const compression = options.compression ?? "none"
  if (compression === "deflate") return buildTiffImageData(imageData, 8, await deflateRaw(rgbaPixelBytes(imageData)), options.metadata, options.customFields)
  return encodeTiffImageData(imageData, options)
}

function bigTiffTypeBytes(type: number) {
  if ([3, 8].includes(type)) return 2
  if ([4, 9, 11].includes(type)) return 4
  if ([5, 10, 12, 16, 17, 18].includes(type)) return 8
  return 1
}

function resolveBigTiffFieldData(field: TiffField, plannedOffset: number) {
  if (field.dataFactory) return field.dataFactory(plannedOffset)
  return field.data
}

function writeBigTiffIfd(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  fields: TiffField[],
  nextIfdOffset: number,
) {
  view.setBigUint64(offset, BigInt(fields.length), true)
  let entry = offset + 8
  for (const field of fields) {
    view.setUint16(entry, field.tag, true)
    view.setUint16(entry + 2, field.type, true)
    view.setBigUint64(entry + 4, BigInt(field.count), true)
    if (field.data) {
      if (field.data.byteLength <= 8) {
        bytes.set(field.data, entry + 12)
      } else {
        view.setBigUint64(entry + 12, BigInt(field.dataOffset ?? 0), true)
        bytes.set(field.data, field.dataOffset ?? 0)
      }
    } else if (field.type === 3 && field.count === 1) {
      view.setUint16(entry + 12, field.value ?? 0, true)
    } else {
      view.setBigUint64(entry + 12, BigInt(field.value ?? 0), true)
    }
    entry += 20
  }
  view.setBigUint64(entry, BigInt(nextIfdOffset), true)
}

function planBigTiffFields(fields: TiffField[], dataOffset: number) {
  let extraOffset = dataOffset
  for (const field of fields) {
    const data = resolveBigTiffFieldData(field, extraOffset)
    if (!data) continue
    field.data = data
    field.count = field.count || Math.max(1, Math.floor(data.byteLength / bigTiffTypeBytes(field.type)))
    if (data.byteLength > 8) {
      field.dataOffset = extraOffset
      extraOffset += data.byteLength
    }
  }
  return extraOffset
}

function bigTiffDirectoryFields(directory: BigTiffDirectorySpec): TiffField[] {
  const fields: TiffField[] = [
    ...(directory.width ? [{ tag: 256, type: 4, count: 1, value: directory.width } as TiffField] : []),
    ...(directory.height ? [{ tag: 257, type: 4, count: 1, value: directory.height } as TiffField] : []),
    ...(directory.name ? [{ tag: 270, type: 2, count: directory.name.length + 1, data: tiffAsciiBytes(directory.name) } as TiffField] : []),
    ...normalizeTiffCustomFields(directory.fields),
  ]
  return fields.sort((a, b) => a.tag - b.tag)
}

export function encodeBigTiffImageData(imageData: ImageData, options: BigTiffEncodeOptions = {}): ArrayBuffer {
  assertCanvasSize(imageData.width, imageData.height, "BigTIFF export")
  const pixelBytes = rgbaPixelBytes(imageData)
  const directorySpecs = options.directories ?? []
  const firstIfdOffset = 16
  const baseRootFields: TiffField[] = [
    { tag: 256, type: 4, count: 1, value: imageData.width },
    { tag: 257, type: 4, count: 1, value: imageData.height },
    { tag: 258, type: 3, count: 4, data: new Uint8Array([8, 0, 8, 0, 8, 0, 8, 0]) },
    { tag: 259, type: 3, count: 1, value: 1 },
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 273, type: 16, count: 1, value: 0 },
    { tag: 277, type: 3, count: 1, value: 4 },
    { tag: 278, type: 4, count: 1, value: imageData.height },
    { tag: 279, type: 16, count: 1, value: pixelBytes.byteLength },
    { tag: 284, type: 3, count: 1, value: 1 },
    { tag: 338, type: 3, count: 1, value: 2 },
    ...tiffMetadataFields(options.metadata, options.customFields),
  ]
  if (directorySpecs.length) baseRootFields.push({ tag: 330, type: 16, count: 1, value: 0 })
  const rootFields = baseRootFields.sort((a, b) => a.tag - b.tag)
  const rootIfdSize = 8 + rootFields.length * 20 + 8
  let extraOffset = firstIfdOffset + rootIfdSize
  extraOffset = planBigTiffFields(rootFields, extraOffset)
  const pixelOffset = extraOffset
  for (const field of rootFields) {
    if (field.tag === 273) field.value = pixelOffset
  }
  let nextIfdOffset = pixelOffset + pixelBytes.byteLength
  const extraDirectories = directorySpecs.map(bigTiffDirectoryFields)
  if (!extraDirectories.length) nextIfdOffset = 0
  else {
    for (const field of rootFields) if (field.tag === 330) field.value = nextIfdOffset
  }
  let totalLength = pixelOffset + pixelBytes.byteLength
  for (const fields of extraDirectories) {
    const ifdOffset = totalLength
    const ifdSize = 8 + fields.length * 20 + 8
    totalLength += ifdSize
    totalLength = planBigTiffFields(fields, totalLength)
    for (const field of fields) if (field.tag === 273) field.value = totalLength
    void ifdOffset
  }
  const bytes = new Uint8Array(totalLength)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 43, true)
  view.setUint16(4, 8, true)
  view.setUint16(6, 0, true)
  view.setBigUint64(8, BigInt(firstIfdOffset), true)
  writeBigTiffIfd(bytes, view, firstIfdOffset, rootFields, extraDirectories.length ? nextIfdOffset : 0)
  bytes.set(pixelBytes, pixelOffset)
  let ifdOffset = pixelOffset + pixelBytes.byteLength
  for (let i = 0; i < extraDirectories.length; i++) {
    const fields = extraDirectories[i]
    const next = i + 1 < extraDirectories.length ? ifdOffset + 8 + fields.length * 20 + 8 : 0
    writeBigTiffIfd(bytes, view, ifdOffset, fields, next)
    ifdOffset = next || ifdOffset
  }
  return bytes.buffer
}

export interface DngEncodeOptions extends TiffEncodeOptions {
  cameraModel?: string
  uniqueCameraModel?: string
  sidecar?: string
}

export function encodeDngImageData(imageData: ImageData, options: DngEncodeOptions = {}): ArrayBuffer {
  const uniqueModel = options.uniqueCameraModel || options.cameraModel || "Photoshop Web DNG"
  const dngFields: TiffCustomField[] = [
    { tag: 50706, type: 1, count: 4, data: new Uint8Array([1, 4, 0, 0]) },
    { tag: 50707, type: 1, count: 4, data: new Uint8Array([1, 1, 0, 0]) },
    { tag: 50708, type: 2, count: uniqueModel.length + 1, data: tiffAsciiBytes(uniqueModel) },
    { tag: 50717, type: 3, count: 1, value: 2 },
    { tag: 50721, type: 5, count: 9, data: concatUint8([
      tiffU32LE(1), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1),
      tiffU32LE(0), tiffU32LE(1), tiffU32LE(1), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1),
      tiffU32LE(0), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1), tiffU32LE(1), tiffU32LE(1),
    ]) },
  ]
  const metadata = {
    ...options.metadata,
    source: options.metadata?.source ?? "DNG",
    xmp: options.sidecar ?? options.metadata?.xmp,
  }
  return encodeTiffImageData(imageData, {
    ...options,
    metadata,
    customFields: [...dngFields, ...(options.customFields ?? [])],
  })
}
