import { capabilityWarningsForDocument, type CapabilityDocumentSnapshot } from "./capabilities"
import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
} from "./canvas-limits"
import { createHeapMemoryMonitor, getGlobalMemoryBudget } from "./memory-budget"
import { detectOffscreenCanvasCapabilities, diagnoseOffscreenCanvasTransfer, type OffscreenCanvasCapabilities } from "./offscreen-canvas"
import { estimateScratchQuota, isOPFSSupported, type ScratchQuotaSnapshot } from "./opfs-scratch"
import { createTileOnlyCapabilityDashboard, type TileOnlyCapabilityStatus, type TileOnlyExportLayerDescriptor } from "./tile-only-pipeline"
import type { LayerKind } from "./types"

const MIB = 1024 * 1024

export type BrowserDiagnosticStatus = "ok" | "info" | "warn" | "unavailable"

export interface BrowserDiagnosticRow {
  label: string
  value: string
  status: BrowserDiagnosticStatus
  detail?: string
}

export interface BrowserDiagnosticSection {
  id: "scale" | "canvas" | "webgl" | "offscreen" | "encoders" | "opfs" | "heap" | "tile-only" | "fallbacks"
  title: string
  rows: BrowserDiagnosticRow[]
}

export interface BrowserDiagnosticsDocumentSnapshot extends CapabilityDocumentSnapshot {
  width?: number
  height?: number
}

export interface BrowserDiagnosticsCanvasSnapshot {
  safeMaxDimension: number
  safeMaxPixels: number
  runtimeMaxDimension: number | null
  runtimeMaxPixels: number | null
}

export interface BrowserDiagnosticsWebGLSnapshot {
  webglSupported: boolean
  webgl2Supported: boolean
  maxTextureSize: number | null
  maxRenderbufferSize: number | null
  maxViewportDims: [number, number] | null
  maxCubeMapTextureSize: number | null
  maxVertexAttribs: number | null
  maxVaryingVectors: number | null
  maxFragmentUniformVectors: number | null
  maxVertexUniformVectors: number | null
  renderer: string | null
  vendor: string | null
  extensions: string[]
}

export interface BrowserDiagnosticsMediaCodec {
  label: string
  mimeType: string
  supported: boolean
}

export interface BrowserDiagnosticsMediaRecorderSnapshot {
  available: boolean
  supportsTypeProbe: boolean
  codecs: BrowserDiagnosticsMediaCodec[]
}

export interface BrowserDiagnosticsImageEncoderSnapshot {
  label: string
  mimeType: string
  canvasToBlob: boolean
  offscreenConvertToBlob: boolean
  imageEncoder: boolean
}

export interface BrowserDiagnosticsOpfsSnapshot {
  supported: boolean
  quota: ScratchQuotaSnapshot | null
}

export interface BrowserDiagnosticsHeapSnapshot {
  supported: boolean
  usedJSHeapSize: number | null
  totalJSHeapSize: number | null
  jsHeapSizeLimit: number | null
  declaredBytes: number
}

export interface BrowserDiagnosticsSnapshot {
  generatedAt: string
  userAgent: string
  document?: BrowserDiagnosticsDocumentSnapshot | null
  canvas: BrowserDiagnosticsCanvasSnapshot
  webgl: BrowserDiagnosticsWebGLSnapshot
  offscreen: OffscreenCanvasCapabilities
  mediaRecorder: BrowserDiagnosticsMediaRecorderSnapshot
  imageEncoders: BrowserDiagnosticsImageEncoderSnapshot[]
  opfs: BrowserDiagnosticsOpfsSnapshot
  heap: BrowserDiagnosticsHeapSnapshot
}

export interface BrowserDiagnosticsReport {
  generatedAt: string
  userAgent: string
  summary: string
  sections: BrowserDiagnosticSection[]
  fallbacks: string[]
}

const MEDIA_RECORDER_CANDIDATES: BrowserDiagnosticsMediaCodec[] = [
  { label: "WebM VP9 + Opus", mimeType: "video/webm;codecs=vp9,opus", supported: false },
  { label: "WebM VP8 + Opus", mimeType: "video/webm;codecs=vp8,opus", supported: false },
  { label: "WebM H.264 + Opus", mimeType: "video/webm;codecs=h264,opus", supported: false },
  { label: "MP4 H.264 + AAC", mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", supported: false },
  { label: "MP4 H.264", mimeType: "video/mp4;codecs=h264", supported: false },
  { label: "WebM container", mimeType: "video/webm", supported: false },
]

const IMAGE_ENCODER_CANDIDATES = [
  { label: "PNG", mimeType: "image/png" },
  { label: "JPEG", mimeType: "image/jpeg" },
  { label: "WebP", mimeType: "image/webp" },
  { label: "AVIF", mimeType: "image/avif" },
  { label: "GIF", mimeType: "image/gif" },
]

function formatMP(pixels: number | null) {
  if (pixels === null || !Number.isFinite(pixels)) return "unavailable"
  return `${(pixels / 1_000_000).toFixed(1)} MP`
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unavailable"
  return `${(Math.max(0, value) / MIB).toFixed(1)} MB`
}

function formatSize(dimension: number | null, pixels: number | null) {
  if (!dimension && !pixels) return "unavailable"
  const dim = dimension ? `${dimension} px per side` : "dimension unavailable"
  return `${dim} / ${formatMP(pixels)}`
}

function status(ok: boolean): BrowserDiagnosticStatus {
  return ok ? "ok" : "unavailable"
}

function detectRuntimeCanvasLimit(): { runtimeMaxDimension: number | null; runtimeMaxPixels: number | null } {
  if (typeof document === "undefined") return { runtimeMaxDimension: null, runtimeMaxPixels: null }
  const candidates = [65_535, 32_768, 16_384, 12_288, 8_192, 4_096]
  for (const candidate of candidates) {
    try {
      const canvas = document.createElement("canvas")
      canvas.width = candidate
      canvas.height = 1
      if (canvas.width === candidate && !!canvas.getContext("2d")) {
        return {
          runtimeMaxDimension: candidate,
          runtimeMaxPixels: candidate >= MAX_CANVAS_DIMENSION ? MAX_CANVAS_PIXELS : candidate * candidate,
        }
      }
    } catch {}
  }
  return { runtimeMaxDimension: null, runtimeMaxPixels: null }
}

function probeWebGL(): BrowserDiagnosticsWebGLSnapshot {
  const fallback: BrowserDiagnosticsWebGLSnapshot = {
    webglSupported: false,
    webgl2Supported: false,
    maxTextureSize: null,
    maxRenderbufferSize: null,
    maxViewportDims: null,
    maxCubeMapTextureSize: null,
    maxVertexAttribs: null,
    maxVaryingVectors: null,
    maxFragmentUniformVectors: null,
    maxVertexUniformVectors: null,
    renderer: null,
    vendor: null,
    extensions: [],
  }
  if (typeof document === "undefined") return fallback
  try {
    const canvas = document.createElement("canvas")
    const gl2 = canvas.getContext("webgl2") as WebGL2RenderingContext | null
    const gl = gl2 ?? (canvas.getContext("webgl") as WebGLRenderingContext | null)
    if (!gl) return fallback
    let renderer: string | null = null
    let vendor: string | null = null
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info")
    if (debugInfo) {
      renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "") || null
      vendor = String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? "") || null
    }
    const readInt = (name: number): number | null => {
      try {
        const value = Number(gl.getParameter(name))
        return Number.isFinite(value) && value > 0 ? value : null
      } catch {
        return null
      }
    }
    let viewportDims: [number, number] | null = null
    try {
      const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | number[] | null
      if (dims && dims.length >= 2 && Number.isFinite(dims[0]) && Number.isFinite(dims[1])) {
        viewportDims = [Number(dims[0]), Number(dims[1])]
      }
    } catch {}
    return {
      webglSupported: true,
      webgl2Supported: !!gl2,
      maxTextureSize: readInt(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: readInt(gl.MAX_RENDERBUFFER_SIZE),
      maxViewportDims: viewportDims,
      maxCubeMapTextureSize: readInt(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      maxVertexAttribs: readInt(gl.MAX_VERTEX_ATTRIBS),
      maxVaryingVectors: readInt(gl.MAX_VARYING_VECTORS),
      maxFragmentUniformVectors: readInt(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      maxVertexUniformVectors: readInt(gl.MAX_VERTEX_UNIFORM_VECTORS),
      renderer,
      vendor,
      extensions: (gl.getSupportedExtensions() ?? []).sort(),
    }
  } catch {
    return fallback
  }
}

function probeMediaRecorder(): BrowserDiagnosticsMediaRecorderSnapshot {
  const Recorder = globalThis.MediaRecorder
  const available = typeof Recorder === "function"
  const supportsTypeProbe = available && typeof Recorder.isTypeSupported === "function"
  return {
    available,
    supportsTypeProbe,
    codecs: MEDIA_RECORDER_CANDIDATES.map((codec) => ({
      ...codec,
      supported: supportsTypeProbe ? Recorder.isTypeSupported(codec.mimeType) : available,
    })),
  }
}

function blobTypeMatches(blob: Blob | null, mimeType: string) {
  if (!blob) return false
  if (mimeType === "image/png") return blob.type === "image/png" || blob.type === ""
  return blob.type.toLowerCase() === mimeType.toLowerCase()
}

async function probeCanvasToBlob(mimeType: string): Promise<boolean> {
  if (typeof document === "undefined") return false
  const prototype = HTMLCanvasElement.prototype
  if (typeof prototype.toBlob !== "function") return false
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType))
    return blobTypeMatches(blob, mimeType)
  } catch {
    return false
  }
}

async function probeOffscreenConvertToBlob(mimeType: string): Promise<boolean> {
  if (typeof OffscreenCanvas !== "function") return false
  if (typeof OffscreenCanvas.prototype.convertToBlob !== "function") return false
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const blob = await canvas.convertToBlob({ type: mimeType })
    return blobTypeMatches(blob, mimeType)
  } catch {
    return false
  }
}

type ImageEncoderConstructor = {
  isConfigSupported?: (config: { type: string; width: number; height: number }) => Promise<{ supported?: boolean }>
}

async function probeImageEncoder(mimeType: string): Promise<boolean> {
  const Encoder = (globalThis as unknown as { ImageEncoder?: ImageEncoderConstructor }).ImageEncoder
  if (typeof Encoder !== "function" && typeof Encoder?.isConfigSupported !== "function") return false
  if (typeof Encoder.isConfigSupported !== "function") return true
  try {
    const result = await Encoder.isConfigSupported({ type: mimeType, width: 1, height: 1 })
    return result.supported === true
  } catch {
    return false
  }
}

async function probeImageEncoders(): Promise<BrowserDiagnosticsImageEncoderSnapshot[]> {
  return Promise.all(
    IMAGE_ENCODER_CANDIDATES.map(async (candidate) => ({
      ...candidate,
      canvasToBlob: await probeCanvasToBlob(candidate.mimeType),
      offscreenConvertToBlob: await probeOffscreenConvertToBlob(candidate.mimeType),
      imageEncoder: await probeImageEncoder(candidate.mimeType),
    })),
  )
}

function currentUserAgent() {
  return typeof navigator !== "undefined" ? navigator.userAgent : "Unknown browser"
}

export async function collectBrowserDiagnosticsSnapshot(
  documentSnapshot?: BrowserDiagnosticsDocumentSnapshot | null,
): Promise<BrowserDiagnosticsSnapshot> {
  const canvasProbe = detectRuntimeCanvasLimit()
  const heapSample = createHeapMemoryMonitor({ tracker: getGlobalMemoryBudget() }).sample()
  const quota = await estimateScratchQuota()
  return {
    generatedAt: new Date().toISOString(),
    userAgent: currentUserAgent(),
    document: documentSnapshot ?? null,
    canvas: {
      safeMaxDimension: MAX_CANVAS_DIMENSION,
      safeMaxPixels: MAX_CANVAS_PIXELS,
      ...canvasProbe,
    },
    webgl: probeWebGL(),
    offscreen: detectOffscreenCanvasCapabilities(),
    mediaRecorder: probeMediaRecorder(),
    imageEncoders: await probeImageEncoders(),
    opfs: {
      supported: isOPFSSupported(),
      quota,
    },
    heap: {
      supported: heapSample.supported,
      usedJSHeapSize: heapSample.usedJSHeapSize,
      totalJSHeapSize: heapSample.totalJSHeapSize,
      jsHeapSizeLimit: heapSample.jsHeapSizeLimit,
      declaredBytes: heapSample.declaredBytes,
    },
  }
}

function documentExceedsCanvas(snapshot: BrowserDiagnosticsSnapshot) {
  const width = Number(snapshot.document?.width ?? 0)
  const height = Number(snapshot.document?.height ?? 0)
  if (!width || !height) return false
  return (
    width > snapshot.canvas.safeMaxDimension ||
    height > snapshot.canvas.safeMaxDimension ||
    width * height > snapshot.canvas.safeMaxPixels
  )
}

function documentExceedsTexture(snapshot: BrowserDiagnosticsSnapshot) {
  const width = Number(snapshot.document?.width ?? 0)
  const height = Number(snapshot.document?.height ?? 0)
  const maxTexture = snapshot.webgl.maxTextureSize
  return !!maxTexture && !!width && !!height && Math.max(width, height) > maxTexture
}

function pathsForImageEncoder(encoder: BrowserDiagnosticsImageEncoderSnapshot) {
  return [
    encoder.canvasToBlob ? "Canvas.toBlob" : null,
    encoder.offscreenConvertToBlob ? "OffscreenCanvas.convertToBlob" : null,
    encoder.imageEncoder ? "ImageEncoder" : null,
  ].filter(Boolean) as string[]
}

function statusForTileCapability(statusValue: TileOnlyCapabilityStatus): BrowserDiagnosticStatus {
  if (statusValue === "safe") return "ok"
  if (statusValue === "approximate") return "warn"
  return "unavailable"
}

function tileLayerDescriptors(snapshot: BrowserDiagnosticsSnapshot): TileOnlyExportLayerDescriptor[] {
  const layers = snapshot.document?.layers ?? []
  return layers.length
    ? layers.map((layer, index) => ({
        id: `layer-${index + 1}`,
        kind: layer.kind as LayerKind | undefined,
      }))
    : [{ id: "background", kind: "raster" }]
}

function buildFallbacks(snapshot: BrowserDiagnosticsSnapshot): string[] {
  const fallbacks: string[] = []
  if (documentExceedsCanvas(snapshot)) {
    fallbacks.push("Document exceeds the safe browser canvas budget; reduced-scale, tile-only, or inspection mode is required.")
  }
  if (!snapshot.webgl.webglSupported) {
    fallbacks.push("WebGL is unavailable; compositing and previews use Canvas 2D fallback paths.")
  } else if (documentExceedsTexture(snapshot)) {
    fallbacks.push("WebGL texture limit is below the current document size; tiled WebGL or Canvas 2D fallback is active.")
  }

  const offscreenDiagnostic = diagnoseOffscreenCanvasTransfer({
    requestedWorker: true,
    offscreenCanvasSupported: snapshot.offscreen.offscreenCanvasSupported,
    workerTransferSupported: snapshot.offscreen.workerOffscreenSupported,
    transferToImageBitmapSupported: snapshot.offscreen.transferToImageBitmapSupported,
  })
  if (!offscreenDiagnostic.active) {
    fallbacks.push("OffscreenCanvas worker transfer is unavailable; worker previews fall back to main-thread canvas surfaces.")
  }

  const h264 = snapshot.mediaRecorder.codecs.find((codec) => codec.label === "MP4 H.264 + AAC")
  if (h264 && !h264.supported) {
    fallbacks.push("MP4 H.264 + AAC MediaRecorder is unavailable; timeline export falls back to the frame/audio package when this preset is selected.")
  }
  if (!snapshot.opfs.supported) {
    fallbacks.push("OPFS scratch is unavailable; scratch data falls back to in-memory storage.")
  } else if (!snapshot.opfs.quota) {
    fallbacks.push("OPFS quota is unavailable; scratch planning keeps conservative in-memory headroom.")
  }
  if (!snapshot.heap.supported) {
    fallbacks.push("Browser heap estimates are unavailable; memory pressure uses declared editor allocations only.")
  }

  const colorMode = String(snapshot.document?.colorMode ?? "RGB")
  const bitDepth = Number(snapshot.document?.bitDepth ?? 8)
  if (!["RGB", "Grayscale"].includes(colorMode)) {
    fallbacks.push(`${colorMode} document intent is displayed through the browser RGB canvas preview.`)
  }
  if (bitDepth > 8) {
    fallbacks.push(`${bitDepth}-bit document sources are preserved where supported, but display uses an 8-bit canvas preview.`)
  }
  for (const warning of capabilityWarningsForDocument(snapshot.document)) {
    if (warning.status === "unsupported" || warning.status === "stub") {
      fallbacks.push(`${warning.label}: ${warning.detail}`)
    }
  }

  return [...new Set(fallbacks)]
}

export function createBrowserDiagnosticsReport(snapshot: BrowserDiagnosticsSnapshot): BrowserDiagnosticsReport {
  const width = Number(snapshot.document?.width ?? 0)
  const height = Number(snapshot.document?.height ?? 0)
  const fallbacks = buildFallbacks(snapshot)
  const offscreenDiagnostic = diagnoseOffscreenCanvasTransfer({
    requestedWorker: true,
    offscreenCanvasSupported: snapshot.offscreen.offscreenCanvasSupported,
    workerTransferSupported: snapshot.offscreen.workerOffscreenSupported,
    transferToImageBitmapSupported: snapshot.offscreen.transferToImageBitmapSupported,
  })
  const tileDashboard = width && height
    ? createTileOnlyCapabilityDashboard({
        documentWidth: width,
        documentHeight: height,
        tileSize: 512,
        explicitTileOnly: documentExceedsCanvas(snapshot),
        format: "png",
        layers: tileLayerDescriptors(snapshot),
        colorMode: snapshot.document?.colorMode,
        bitDepth: snapshot.document?.bitDepth,
      })
    : null
  const extensionValue = snapshot.webgl.extensions.length
    ? snapshot.webgl.extensions.join(", ")
    : "none reported"
  const mediaRows: BrowserDiagnosticRow[] = [
    {
      label: "MediaRecorder API",
      value: snapshot.mediaRecorder.available
        ? snapshot.mediaRecorder.supportsTypeProbe
          ? "available with MIME probing"
          : "available without MIME probing"
        : "unavailable",
      status: status(snapshot.mediaRecorder.available),
    },
    ...snapshot.mediaRecorder.codecs.map((codec): BrowserDiagnosticRow => ({
      label: codec.label,
      value: codec.supported ? "available" : "unavailable",
      status: codec.supported ? "ok" : "warn",
      detail: codec.mimeType,
    })),
    ...snapshot.imageEncoders.map((encoder): BrowserDiagnosticRow => {
      const paths = pathsForImageEncoder(encoder)
      return {
        label: `${encoder.label} image`,
        value: paths.length ? paths.join(" / ") : "unavailable",
        status: paths.length ? "ok" : "warn",
        detail: encoder.mimeType,
      }
    }),
  ]

  const sections: BrowserDiagnosticSection[] = [
    {
      id: "scale",
      title: "Scale Confidence",
      rows: [
        {
          label: "Large-document strategy",
          value: width && height
            ? documentExceedsCanvas(snapshot)
              ? "Tile-only or reduced-scale required"
              : "Full-canvas editing is within guardrails"
            : "No document open",
          status: width && height ? (documentExceedsCanvas(snapshot) ? "warn" : "ok") : "info",
          detail: width && height
            ? documentExceedsCanvas(snapshot)
              ? "The current document exceeds browser canvas guardrails; use tile-only, reduced-scale, or inspection mode before full-frame allocation."
              : "The current document fits the editor's browser canvas guardrails."
            : "Open a document to evaluate large-document strategy.",
        },
        {
          label: "Worker preview path",
          value: offscreenDiagnostic.active ? "worker offscreen active" : "main-thread fallback",
          status: offscreenDiagnostic.active ? "ok" : "warn",
          detail: offscreenDiagnostic.warning ?? offscreenDiagnostic.reason,
        },
        {
          label: "WebGL/canvas path",
          value: snapshot.webgl.webglSupported
            ? snapshot.webgl.webgl2Supported
              ? "WebGL2 available"
              : "WebGL1 available"
            : "Canvas 2D fallback",
          status: snapshot.webgl.webglSupported ? "ok" : "warn",
          detail: snapshot.webgl.maxTextureSize ? `${snapshot.webgl.maxTextureSize}px max texture` : "Texture limit unavailable.",
        },
      ],
    },
    {
      id: "canvas",
      title: "Canvas",
      rows: [
        {
          label: "Safe max size",
          value: formatSize(snapshot.canvas.safeMaxDimension, snapshot.canvas.safeMaxPixels),
          status: "info",
          detail: "Editor guardrail used before allocating full-frame browser canvases.",
        },
        {
          label: "Runtime probe",
          value: formatSize(snapshot.canvas.runtimeMaxDimension, snapshot.canvas.runtimeMaxPixels),
          status: snapshot.canvas.runtimeMaxDimension ? "ok" : "unavailable",
        },
        {
          label: "Current document",
          value: width && height ? `${width.toLocaleString()} x ${height.toLocaleString()} px / ${formatMP(width * height)}` : "no document open",
          status: documentExceedsCanvas(snapshot) ? "warn" : "ok",
        },
      ],
    },
    {
      id: "webgl",
      title: "WebGL",
      rows: [
        {
          label: "API",
          value: snapshot.webgl.webglSupported ? (snapshot.webgl.webgl2Supported ? "WebGL2" : "WebGL1") : "unavailable",
          status: status(snapshot.webgl.webglSupported),
        },
        { label: "Renderer", value: snapshot.webgl.renderer ?? "masked or unavailable", status: snapshot.webgl.renderer ? "ok" : "info" },
        { label: "Vendor", value: snapshot.webgl.vendor ?? "masked or unavailable", status: snapshot.webgl.vendor ? "ok" : "info" },
        {
          label: "Max texture",
          value: snapshot.webgl.maxTextureSize ? `${snapshot.webgl.maxTextureSize} px` : "unavailable",
          status: documentExceedsTexture(snapshot) ? "warn" : status(!!snapshot.webgl.maxTextureSize),
        },
        {
          label: "Max renderbuffer",
          value: snapshot.webgl.maxRenderbufferSize ? `${snapshot.webgl.maxRenderbufferSize} px` : "unavailable",
          status: status(!!snapshot.webgl.maxRenderbufferSize),
        },
        {
          label: "Max viewport",
          value: snapshot.webgl.maxViewportDims
            ? `${snapshot.webgl.maxViewportDims[0]} x ${snapshot.webgl.maxViewportDims[1]} px`
            : "unavailable",
          status: status(!!snapshot.webgl.maxViewportDims),
        },
        {
          label: "Max cube map",
          value: snapshot.webgl.maxCubeMapTextureSize ? `${snapshot.webgl.maxCubeMapTextureSize} px` : "unavailable",
          status: status(!!snapshot.webgl.maxCubeMapTextureSize),
        },
        {
          label: "Max vertex attribs",
          value: snapshot.webgl.maxVertexAttribs ? `${snapshot.webgl.maxVertexAttribs}` : "unavailable",
          status: status(!!snapshot.webgl.maxVertexAttribs),
        },
        {
          label: "Varying vectors",
          value: snapshot.webgl.maxVaryingVectors ? `${snapshot.webgl.maxVaryingVectors}` : "unavailable",
          status: status(!!snapshot.webgl.maxVaryingVectors),
        },
        {
          label: "Frag uniform vectors",
          value: snapshot.webgl.maxFragmentUniformVectors ? `${snapshot.webgl.maxFragmentUniformVectors}` : "unavailable",
          status: status(!!snapshot.webgl.maxFragmentUniformVectors),
        },
        {
          label: "Vert uniform vectors",
          value: snapshot.webgl.maxVertexUniformVectors ? `${snapshot.webgl.maxVertexUniformVectors}` : "unavailable",
          status: status(!!snapshot.webgl.maxVertexUniformVectors),
        },
        { label: "Extensions", value: extensionValue, status: snapshot.webgl.extensions.length ? "ok" : "info" },
      ],
    },
    {
      id: "offscreen",
      title: "OffscreenCanvas",
      rows: [
        {
          label: "OffscreenCanvas",
          value: snapshot.offscreen.offscreenCanvasSupported ? "available" : "unavailable",
          status: status(snapshot.offscreen.offscreenCanvasSupported),
        },
        {
          label: "Worker transfer",
          value: snapshot.offscreen.workerOffscreenSupported ? "available" : "unavailable",
          status: snapshot.offscreen.workerOffscreenSupported ? "ok" : "warn",
        },
        {
          label: "ImageBitmap transfer",
          value: snapshot.offscreen.transferToImageBitmapSupported ? "available" : "unavailable",
          status: snapshot.offscreen.transferToImageBitmapSupported ? "ok" : "warn",
        },
        {
          label: "WebGL offscreen",
          value: snapshot.offscreen.webglOffscreenSupported ? "available" : "unavailable",
          status: snapshot.offscreen.webglOffscreenSupported ? "ok" : "warn",
        },
      ],
    },
    {
      id: "encoders",
      title: "MediaRecorder and Image Encoders",
      rows: mediaRows,
    },
    {
      id: "opfs",
      title: "OPFS",
      rows: [
        { label: "Origin private file system", value: snapshot.opfs.supported ? "available" : "unavailable", status: status(snapshot.opfs.supported) },
        { label: "Quota", value: formatBytes(snapshot.opfs.quota?.quota), status: snapshot.opfs.quota ? "ok" : "warn" },
        { label: "Usage", value: formatBytes(snapshot.opfs.quota?.usage), status: snapshot.opfs.quota ? "ok" : "info" },
        { label: "Available after reserve", value: formatBytes(snapshot.opfs.quota?.available), status: snapshot.opfs.quota ? "ok" : "info" },
      ],
    },
    {
      id: "heap",
      title: "Browser Heap",
      rows: [
        { label: "Heap estimate", value: snapshot.heap.supported ? "available" : "unavailable", status: snapshot.heap.supported ? "ok" : "warn" },
        { label: "Used JS heap", value: formatBytes(snapshot.heap.usedJSHeapSize), status: snapshot.heap.supported ? "ok" : "info" },
        { label: "Total JS heap", value: formatBytes(snapshot.heap.totalJSHeapSize), status: snapshot.heap.supported ? "ok" : "info" },
        { label: "Heap limit", value: formatBytes(snapshot.heap.jsHeapSizeLimit), status: snapshot.heap.supported ? "ok" : "info" },
        { label: "Declared editor allocations", value: formatBytes(snapshot.heap.declaredBytes), status: "info" },
      ],
    },
    {
      id: "tile-only",
      title: "Tile-Only Dashboard",
      rows: tileDashboard
        ? [
            {
              label: "Tile grid",
              value: `${tileDashboard.tileColumns} x ${tileDashboard.tileRows} / ${tileDashboard.tileCount} tiles`,
              status: "info",
              detail: `${tileDashboard.documentMegapixels} MP document with ${tileDashboard.tileSize}px tiles.`,
            },
            ...tileDashboard.rows.map((row): BrowserDiagnosticRow => ({
              label: row.label,
              value: row.status,
              status: statusForTileCapability(row.status),
              detail: [row.detail, row.mitigation ? `Mitigation: ${row.mitigation}` : null]
                .filter(Boolean)
                .join(" "),
            })),
          ]
        : [{ label: "Tile grid", value: "No document open", status: "info" }],
    },
    {
      id: "fallbacks",
      title: "Fallbacks",
      rows: fallbacks.length
        ? fallbacks.map((fallback) => ({ label: "Active fallback", value: fallback, status: "warn" as const }))
        : [{ label: "Active fallback", value: "No active degraded-mode fallbacks detected.", status: "ok" }],
    },
  ]

  return {
    generatedAt: snapshot.generatedAt,
    userAgent: snapshot.userAgent,
    summary: fallbacks.length
      ? `${fallbacks.length} active degraded-mode or fallback condition${fallbacks.length === 1 ? "" : "s"} detected.`
      : "No active degraded-mode fallbacks detected.",
    sections,
    fallbacks,
  }
}

export function formatBrowserDiagnosticsReport(report: BrowserDiagnosticsReport): string {
  const lines = [
    "Browser Diagnostics Report",
    `Generated: ${report.generatedAt}`,
    `User agent: ${report.userAgent}`,
    `Summary: ${report.summary}`,
    "",
  ]
  for (const section of report.sections) {
    lines.push(section.title)
    for (const row of section.rows) {
      lines.push(`- ${row.label}: ${row.value}`)
      if (row.detail) lines.push(`  ${row.detail}`)
    }
    lines.push("")
  }
  return lines.join("\n").trimEnd() + "\n"
}
