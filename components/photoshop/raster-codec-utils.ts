import type { HighBitImage } from "./color-pipeline"

const textDecoder = new TextDecoder("ascii")

export function concatUint8(arrays: Uint8Array[]): Uint8Array {
  let total = 0
  for (const array of arrays) total += array.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const array of arrays) {
    out.set(array, offset)
    offset += array.length
  }
  return out
}

export function asciiBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
  return out
}

export function latin1Bytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
  return out
}

export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function u32BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])
}

export function u64BE(value: number): Uint8Array {
  const high = Math.floor(value / 0x100000000)
  const low = value >>> 0
  return new Uint8Array([
    (high >>> 24) & 255,
    (high >>> 16) & 255,
    (high >>> 8) & 255,
    high & 255,
    (low >>> 24) & 255,
    (low >>> 16) & 255,
    (low >>> 8) & 255,
    low & 255,
  ])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type)
  const crcInput = concatUint8([typeBytes, data])
  return concatUint8([u32BE(data.length), typeBytes, data, u32BE(crc32(crcInput))])
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  const mod = 65521
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % mod
    b = (b + a) % mod
  }
  return ((b << 16) | a) >>> 0
}

function deflateRawStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = []
  const maxBlock = 0xffff
  let offset = 0
  do {
    const end = Math.min(offset + maxBlock, data.length)
    const len = end - offset
    const nlen = 0xffff - len
    const block = new Uint8Array(5 + len)
    block[0] = end === data.length ? 1 : 0
    block[1] = len & 255
    block[2] = (len >>> 8) & 255
    block[3] = nlen & 255
    block[4] = (nlen >>> 8) & 255
    block.set(data.subarray(offset, end), 5)
    blocks.push(block)
    offset = end
  } while (offset < data.length)
  return concatUint8(blocks)
}

function zlibStore(data: Uint8Array): Uint8Array {
  const checksum = adler32(data)
  return concatUint8([
    new Uint8Array([0x78, 0x01]),
    deflateRawStore(data),
    new Uint8Array([(checksum >>> 24) & 255, (checksum >>> 16) & 255, (checksum >>> 8) & 255, checksum & 255]),
  ])
}

async function compressWithStream(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== "function") return null
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream(format))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return (await compressWithStream(data, "deflate-raw")) ?? deflateRawStore(data)
}

export async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  return (await compressWithStream(data, "deflate")) ?? zlibStore(data)
}

class FallbackImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  colorSpace: PredefinedColorSpace = "srgb"

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

export function readAscii(buffer: ArrayBufferLike, start: number, length: number) {
  return textDecoder.decode(new Uint8Array(buffer, start, length))
}

export function imageDataFromRgba(width: number, height: number, rgba: Uint8ClampedArray) {
  const ImageDataCtor = globalThis.ImageData ?? (FallbackImageData as unknown as typeof ImageData)
  return new ImageDataCtor(rgba, width, height)
}

export function highBitSampleUnit(image: HighBitImage, index: number) {
  if (image.storage === "uint16") return (image.data as Uint16Array)[index] / 65535
  if (image.storage === "float32") return Math.max(0, Math.min(1, (image.data as Float32Array)[index]))
  return (image.data as Uint8ClampedArray)[index] / 255
}

export function cleanMetadataText(value: string | undefined, maxLength = 2048) {
  return value?.replace(/\0/g, " ").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength) || ""
}
