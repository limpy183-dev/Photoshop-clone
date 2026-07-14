import { readAscii } from "./raster-codec-utils"
import type { ExrInspection } from "./raster-codecs-types"

export function inspectExrHeader(buffer: ArrayBuffer): ExrInspection {
  const bytes = new Uint8Array(buffer)
  const magic = bytes.length >= 4 && bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01
  const channelInfo = magic ? readExrChannelInfo(buffer) : null
  let pixelDecoded = false
  if (magic) {
    try {
      // parse-exr is async-loaded for real import. Header inspection stays
      // synchronous, but the app's own uncompressed EXR writer marks its files
      // with scanline metadata that this quick pass can identify.
      pixelDecoded = readAscii(buffer, 8, Math.min(256, Math.max(0, buffer.byteLength - 8))).includes("channels")
    } catch {
      pixelDecoded = false
    }
  }
  return {
    magic,
    version: magic && bytes.length >= 5 ? bytes[4] : undefined,
    pixelDecoded,
    channels: channelInfo?.names,
    bitDepth: channelInfo?.bitDepth,
    warnings: magic
      ? [pixelDecoded
          ? `OpenEXR magic header detected${channelInfo?.names.length ? ` (${channelInfo.names.join(", ")} ${channelInfo.bitDepth}-bit channel${channelInfo.names.length === 1 ? "" : "s"})` : ""}; pixel import is routed through the bundled EXR decoder and tone-mapped into editable RGBA preview pixels.`
          : "OpenEXR magic header detected; unsupported EXR variants may still fail when they use codecs, multipart/deep data, or channels outside the bundled decoder path."]
      : ["OpenEXR magic header was not found."],
  }
}

function readCString(bytes: Uint8Array, offset: number) {
  let end = offset
  while (end < bytes.length && bytes[end] !== 0) end++
  return { value: new TextDecoder("ascii").decode(bytes.subarray(offset, end)), next: Math.min(bytes.length, end + 1) }
}

export function readExrChannelInfo(buffer: ArrayBuffer): { names: string[]; pixelTypes: number[]; bitDepth: number } | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 12) return null
  const view = new DataView(buffer)
  let offset = 8
  while (offset < bytes.length) {
    const name = readCString(bytes, offset)
    offset = name.next
    if (!name.value) break
    const type = readCString(bytes, offset)
    offset = type.next
    if (offset + 4 > bytes.length) return null
    const size = view.getUint32(offset, true)
    offset += 4
    if (offset + size > bytes.length) return null
    if (name.value === "channels" && type.value === "chlist") {
      const names: string[] = []
      const pixelTypes: number[] = []
      let cursor = offset
      const end = offset + size
      while (cursor < end && bytes[cursor] !== 0) {
        const channel = readCString(bytes, cursor)
        cursor = channel.next
        if (!channel.value || cursor + 16 > end) break
        names.push(channel.value)
        pixelTypes.push(view.getUint32(cursor, true))
        cursor += 16
      }
      const bitDepth = pixelTypes.every((value) => value === 1) ? 16 : 32
      return { names, pixelTypes, bitDepth }
    }
    offset += size
  }
  return null
}

export function readExrDataWindow(buffer: ArrayBuffer): { width: number; height: number } | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 12) return null
  const view = new DataView(buffer)
  let offset = 8
  while (offset < bytes.length) {
    const name = readCString(bytes, offset)
    offset = name.next
    if (!name.value) break
    const type = readCString(bytes, offset)
    offset = type.next
    if (offset + 4 > bytes.length) return null
    const size = view.getUint32(offset, true)
    offset += 4
    if (offset + size > bytes.length) return null
    if (name.value === "dataWindow" && type.value === "box2i" && size >= 16) {
      const xMin = view.getInt32(offset, true)
      const yMin = view.getInt32(offset + 4, true)
      const xMax = view.getInt32(offset + 8, true)
      const yMax = view.getInt32(offset + 12, true)
      return { width: xMax - xMin + 1, height: yMax - yMin + 1 }
    }
    offset += size
  }
  return null
}
