import { assertCanvasSize } from "./canvas-limits"
import { emitRuntimeEvent } from "./runtime-telemetry"
import { asciiBytes, concatUint8, exactArrayBuffer, imageDataFromRgba, readAscii, u32BE } from "./raster-codec-utils"
import { bytesFromInput, mp4Box } from "./raster-metadata-embeds"
import { scaleSample } from "./raster-codecs-internal"
import type { DecodedRaster, Jpeg2000EncodeCodec, Jpeg2000EncodeOptions } from "./raster-codecs-types"

type Jpeg2000FrameInfo = {
  bitsPerSample: number
  componentCount: number
  height: number
  width: number
  isSigned: boolean
}

function jpeg2000RasterFromDecoded(
  frameInfo: Jpeg2000FrameInfo,
  decodedBuffer: ArrayBufferLike | ArrayBufferView,
  isReversible: boolean | undefined,
  colorSpace: unknown,
  decoder: string,
): DecodedRaster {
  const { bitsPerSample, componentCount, height, width, isSigned } = frameInfo
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(bitsPerSample) ||
    !Number.isFinite(componentCount) ||
    width <= 0 ||
    height <= 0 ||
    bitsPerSample <= 0 ||
    componentCount <= 0
  ) {
    throw new Error("JPEG 2000 decoder did not return a complete image frame.")
  }
  assertCanvasSize(width, height, "JPEG 2000 image")
  const rgba = new Uint8ClampedArray(width * height * 4)
  const sourceBytes = bitsPerSample > 8
    ? new Uint16Array(decodedBuffer as ArrayBufferLike)
    : new Uint8Array(decodedBuffer as ArrayBufferLike)
  const max = bitsPerSample > 8 ? (1 << Math.min(bitsPerSample, 16)) - 1 : 255
  const offset = isSigned ? Math.ceil(max / 2) : 0
  for (let i = 0; i < width * height; i++) {
    const base = i * componentCount
    const target = i * 4
    const read = (channel: number, fallbackChannel = 0) => {
      const raw = Number(sourceBytes[base + Math.min(channel, componentCount - 1)] ?? sourceBytes[base + fallbackChannel] ?? 0) + offset
      return scaleSample(raw, max)
    }
    const gray = componentCount === 1
    rgba[target] = gray ? read(0) : read(0)
    rgba[target + 1] = gray ? read(0) : read(1)
    rgba[target + 2] = gray ? read(0) : read(2)
    rgba[target + 3] = componentCount >= 4 ? read(3) : 255
  }
  return {
    format: "JPEG 2000",
    width,
    height,
    bitDepth: bitsPerSample,
    channels: componentCount,
    colorModel: componentCount === 1 ? "Grayscale" : componentCount >= 4 ? "RGBA" : "RGB",
    compression: isReversible ? "jpeg2000-lossless" : "jpeg2000",
    imageData: imageDataFromRgba(width, height, rgba),
    warnings: ["JPEG 2000 codestream was decoded into editable RGBA pixels; export writes flattened RGB codestreams."],
    metadata: {
      decoder,
      colorSpace: String(colorSpace ?? ""),
    },
  }
}

// Cheap header scan so the WASM decoders can reject oversized dimensions
// before allocating output buffers; returns null when nothing plausible
// parses instead of throwing.
function readJpeg2000Dimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
  try {
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0x4f) {
      // Raw codestream: the SIZ segment (0xff51) follows the SOC marker.
      for (let i = 2; i + 22 <= bytes.length && i < 64; i++) {
        if (bytes[i] !== 0xff || bytes[i + 1] !== 0x51) continue
        return {
          width: view.getUint32(i + 6, false) - view.getUint32(i + 14, false),
          height: view.getUint32(i + 10, false) - view.getUint32(i + 18, false),
        }
      }
      return null
    }
    // JP2-family container: walk top-level boxes to jp2h, then ihdr inside it.
    let offset = 0
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset, false)
      if (readAscii(buffer, offset + 4, 4) === "jp2h") {
        const end = size === 0 ? bytes.length : Math.min(bytes.length, offset + size)
        let inner = offset + 8
        while (inner + 8 <= end) {
          const innerSize = view.getUint32(inner, false)
          if (readAscii(buffer, inner + 4, 4) === "ihdr" && inner + 16 <= end) {
            return { width: view.getUint32(inner + 12, false), height: view.getUint32(inner + 8, false) }
          }
          if (innerSize < 8) break
          inner += innerSize
        }
        return null
      }
      if (size < 8) break
      offset += size
    }
    return null
  } catch {
    return null
  }
}

async function decodeJpeg2000WithOpenJpeg(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const headerDims = readJpeg2000Dimensions(buffer)
    if (headerDims && headerDims.width > 0 && headerDims.height > 0) assertCanvasSize(headerDims.width, headerDims.height, "JPEG 2000 image")
    const { J2KDecoder } = await loadOpenJpegCodec()
    const decoder = new J2KDecoder()
    const bytes = new Uint8Array(buffer)
    const encoded = decoder.getEncodedBuffer(bytes.byteLength)
    encoded.set(bytes)
    decoder.decode()
    return jpeg2000RasterFromDecoded(
      decoder.getFrameInfo(),
      decoder.getDecodedBuffer(),
      decoder.getIsReversible(),
      decoder.getColorSpace(),
      "@cornerstonejs/codec-openjpeg",
    )
  } catch {
    return null
  }
}

export async function decodeJpeg2000Buffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const headerDims = readJpeg2000Dimensions(buffer)
    if (headerDims && headerDims.width > 0 && headerDims.height > 0) assertCanvasSize(headerDims.width, headerDims.height, "JPEG 2000 image")
    const { decode } = await import("@abasb75/jpeg2000-decoder")
    const originalLog = console.log
    let decoded: Awaited<ReturnType<typeof decode>>
    try {
      console.log = (...args: unknown[]) => {
        if (args.length === 1 && String(args[0]).includes("openjpegjs")) return
        originalLog(...args)
      }
      decoded = await decode(buffer)
    } finally {
      console.log = originalLog
    }
    return jpeg2000RasterFromDecoded(
      decoded.frameInfo,
      decoded.decodedBuffer as ArrayBufferLike | ArrayBufferView,
      decoded.isReversible,
      decoded.colorSpace,
      "@abasb75/jpeg2000-decoder",
    )
  } catch {
    return decodeJpeg2000WithOpenJpeg(buffer)
  }
}

type OpenJpegCodec = Jpeg2000EncodeCodec & {
  J2KDecoder: new () => {
    getEncodedBuffer: (encodedBitStreamLength: number) => Uint8Array
    getDecodedBuffer: () => Uint8Array
    decode: () => void
    getFrameInfo: () => Jpeg2000FrameInfo
    getIsReversible: () => boolean
    getColorSpace: () => number
  }
}

let openJpegCodecReady: Promise<unknown> | null = null
let openJpegCodecWarmupError: unknown = null

function isValidJpeg2000Codestream(encoded: Uint8Array) {
  return encoded.length >= 32 && encoded[0] === 0xff && encoded[1] === 0x4f
}

function runJpeg2000WarmupEncode(codec: Jpeg2000EncodeCodec) {
  const warm = new codec.J2KEncoder()
  try {
    warm.setDecompositions(1)
    warm.setQuality(true, 1)
    warm.getDecodedBuffer({ bitsPerSample: 8, componentCount: 3, width: 16, height: 16, isSigned: false }).fill(0)
    warm.encode()
    const encoded = bytesFromInput(warm.getEncodedBuffer())
    if (!isValidJpeg2000Codestream(encoded)) throw new Error("JPEG 2000 warm-up produced an invalid codestream")
  } finally {
    warm.delete?.()
  }
}

function warmOpenJpegCodec(codec: Jpeg2000EncodeCodec) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      runJpeg2000WarmupEncode(codec)
      openJpegCodecWarmupError = null
      return
    } catch (error) {
      lastError = error
    }
  }
  openJpegCodecWarmupError = lastError
}

async function loadOpenJpegCodec(): Promise<OpenJpegCodec> {
  if (!openJpegCodecReady) {
    openJpegCodecReady = (async () => {
      const mod = await import("@cornerstonejs/codec-openjpeg")
      const factory = (mod.default ?? mod) as unknown as (options?: Record<string, unknown>) => Promise<unknown>
      const codec = (await factory({ print: () => undefined, printErr: () => undefined })) as OpenJpegCodec
      // This emscripten build fails its very first opj_start_compress for
      // some frame configurations (and crashes inside its own error-callback
      // binding while reporting it). Prime the module and remember repeated
      // warm-up failures so a later encode error can include that context.
      warmOpenJpegCodec(codec)
      return codec
    })()
  }
  return openJpegCodecReady as Promise<OpenJpegCodec>
}

async function jpeg2000EncodeCodec(options: Jpeg2000EncodeOptions): Promise<Jpeg2000EncodeCodec> {
  return options.openJpegCodec ? await options.openJpegCodec : loadOpenJpegCodec()
}

function encodeJpeg2000CodestreamAttempt(
  J2KEncoder: Jpeg2000EncodeCodec["J2KEncoder"],
  imageData: ImageData,
  options: Jpeg2000EncodeOptions,
): Uint8Array {
  const encoder = new J2KEncoder()
  const componentCount = options.includeAlpha ? 4 : 3
  const frameInfo = {
    bitsPerSample: 8,
    componentCount,
    width: imageData.width,
    height: imageData.height,
    isSigned: false,
  }
  try {
    encoder.setDecompositions(Math.max(0, Math.min(8, Math.round(options.decompositions ?? 0))))
    encoder.setQuality(!!options.reversible, Math.max(1, Math.min(100, Math.round((options.quality ?? 1) <= 1 ? (options.quality ?? 1) * 100 : options.quality ?? 100))))
    const decoded = encoder.getDecodedBuffer(frameInfo)
    for (let p = 0, source = 0, target = 0; p < imageData.width * imageData.height; p++, source += 4, target += componentCount) {
      decoded[target] = imageData.data[source]
      decoded[target + 1] = imageData.data[source + 1]
      decoded[target + 2] = imageData.data[source + 2]
      if (componentCount === 4) decoded[target + 3] = imageData.data[source + 3]
    }
    encoder.encode()
    const encoded = bytesFromInput(encoder.getEncodedBuffer())
    // The WASM encoder can fail without throwing, leaving a stale or empty
    // buffer behind. A real codestream always opens with the SOC marker.
    if (!isValidJpeg2000Codestream(encoded)) {
      throw new Error("JPEG 2000 encoder produced an invalid codestream")
    }
    return encoded
  } finally {
    encoder.delete?.()
  }
}

function jpeg2000EncodeFailureMessage(lastError: unknown) {
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ""
  const warmupDetail = openJpegCodecWarmupError instanceof Error
    ? ` Warm-up also failed: ${openJpegCodecWarmupError.message}`
    : ""
  return `JPEG 2000 encoder failed after 2 attempts${detail}${warmupDetail}`
}

async function encodeJpeg2000Codestream(imageData: ImageData, options: Jpeg2000EncodeOptions = {}): Promise<Uint8Array> {
  assertCanvasSize(imageData.width, imageData.height, "JPEG 2000 export")
  const { J2KEncoder } = await jpeg2000EncodeCodec(options)
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return encodeJpeg2000CodestreamAttempt(J2KEncoder, imageData, options)
    } catch (error) {
      lastError = error
    }
  }
  emitRuntimeEvent("codec-failure", {
    component: "jpeg2000",
    operation: "encode",
    reason: "codec-failed",
    attempts: 2,
    recoverable: false,
  })
  throw new Error(jpeg2000EncodeFailureMessage(lastError))
}

function jpeg2000Box(type: string, data: Uint8Array): Uint8Array {
  return mp4Box(type, data)
}

function jpeg2000Container(imageData: ImageData, codestream: Uint8Array, options: Jpeg2000EncodeOptions): Uint8Array {
  const container = options.container === "jpm" ? "jpm " : options.container === "jpx" ? "jpx " : "jp2 "
  const signature = jpeg2000Box("jP  ", new Uint8Array([0x0d, 0x0a, 0x87, 0x0a]))
  const ftyp = jpeg2000Box("ftyp", concatUint8([
    asciiBytes(container),
    new Uint8Array([0, 0, 0, 0]),
    asciiBytes(container),
    asciiBytes("jp2 "),
  ]))
  const components = options.includeAlpha ? 4 : 3
  const ihdr = jpeg2000Box("ihdr", concatUint8([
    u32BE(imageData.height),
    u32BE(imageData.width),
    new Uint8Array([0, components, 7, 7, 0, 0, 0, 0]),
  ]))
  const color = options.color
  const colr = color?.iccProfile?.byteLength
    ? jpeg2000Box("colr", concatUint8([new Uint8Array([2, 0, 0]), color.iccProfile]))
    : jpeg2000Box("colr", concatUint8([new Uint8Array([1, 0, 0]), u32BE(color?.enumColorSpace ?? 16)]))
  const cdef = options.includeAlpha
    ? jpeg2000Box("cdef", new Uint8Array([0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0, 0]))
    : new Uint8Array(0)
  const profilePayload = new TextEncoder().encode(JSON.stringify({
    profileName: color?.iccProfileName,
    profileControls: color?.profileControls,
    layers: options.layers ?? [],
    alpha: !!options.includeAlpha,
  }))
  const jp2h = jpeg2000Box("jp2h", concatUint8([ihdr, colr, cdef]))
  const pswp = jpeg2000Box("pswp", profilePayload)
  const layerBoxes = (options.layers ?? []).map((layer) => jpeg2000Box("lbl ", new TextEncoder().encode(`${layer.label}\0${layer.opacity ?? 1}`)))
  const jp2c = jpeg2000Box("jp2c", codestream)
  return concatUint8([signature, ftyp, jp2h, pswp, ...layerBoxes, jp2c])
}

export async function encodeJpeg2000ImageData(imageData: ImageData, options: Jpeg2000EncodeOptions = {}): Promise<ArrayBuffer> {
  const container = options.container ?? "codestream"
  const codestream = await encodeJpeg2000Codestream(imageData, options)
  if (container === "codestream") return exactArrayBuffer(codestream)
  return exactArrayBuffer(jpeg2000Container(imageData, codestream, options))
}
