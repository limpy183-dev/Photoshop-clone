"use client"

/* File System Access API type augmentation — not yet in TS standard lib */
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: Array<{ description?: string; accept: Record<string, string[]> }>
    }) => Promise<FileSystemFileHandle>
  }
}

import { compositeLayer } from "./blend-modes"
import { getFilter } from "./filters"
import { applyLayerStyle } from "./layer-styles"
import { applyModeAndColorManagement } from "./advanced-subsystems"
import { isAdjustmentNoop } from "./adjustment-layers"
import { capabilityWarningsForDocument } from "./capabilities"
import {
  MAX_PROJECT_CHANNELS,
  MAX_PROJECT_DATA_URL_CHARS,
  MAX_PROJECT_LAYERS,
  MAX_PSD_FILE_BYTES,
  MAX_RASTER_FILE_BYTES,
  assertCanvasSize,
  assertFileSize,
} from "./canvas-limits"
import type {
  AlphaChannel,
  BlendMode,
  DocumentReport,
  Layer,
  PsDocument,
  Selection,
  SmartFilter,
} from "./types"
import type {
  BlendMode as PsdBlendMode,
  Layer as PsdLayer,
  LayerEffectsInfo,
  LayerColor,
  Psd,
} from "ag-psd"

function loadPsdCodec() {
  return import("ag-psd")
}

export type ExportFormat = "png" | "jpeg" | "webp" | "avif" | "gif" | "svg"

export interface RasterExportOptions {
  format: Exclude<ExportFormat, "svg">
  scale: number
  quality: number
  transparent: boolean
  matte: string
  dither?: boolean
}

export interface SvgExportOptions {
  scale: number
  transparent: boolean
  matte: string
  includeMetadata: boolean
  precision: number
}

type ReportStatus = DocumentReport["items"][number]["status"]

export type CompatibilityTarget = "project" | "psd" | "browser-raster"

export interface CompatibilityManifestEntry {
  label: string
  status: ReportStatus
  detail: string
}

export interface CompatibilityManifest {
  target: CompatibilityTarget
  entries: CompatibilityManifestEntry[]
  totals: Record<ReportStatus, number>
  summary: string
}

export interface ExportLimitationOptions {
  format: ExportFormat
  includeMetadata?: boolean
  interlaced?: boolean
  progressive?: boolean
  transparent?: boolean
  quality?: number
}

export interface ExportLimitationReport {
  format: ExportFormat
  items: CompatibilityManifestEntry[]
  summary: string
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

const APP_BLEND_MODES = new Set<BlendMode>([
  "normal",
  "dissolve",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
])

const APP_LAYER_KINDS = new Set<Layer["kind"]>([
  "raster",
  "text",
  "shape",
  "group",
  "smart-object",
  "adjustment",
  "frame",
  "artboard",
  "3d",
  "video",
])

const SAFE_CANVAS_DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|avif);base64,/i
const PSD_HEADER_BYTES = 26
const RASTER_HEADER_BYTES = 1024 * 1024

interface ImageHeaderDimensions {
  width: number
  height: number
  format: string
}

function hasAscii(bytes: Uint8Array, offset: number, text: string) {
  if (offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

function readUint16BE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, false)
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16)
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false)
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function readInt32LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true)
}

function validatePsdHeaderDimensions(buffer: ArrayBuffer) {
  if (buffer.byteLength < PSD_HEADER_BYTES) return
  const bytes = new Uint8Array(buffer, 0, PSD_HEADER_BYTES)
  if (!hasAscii(bytes, 0, "8BPS")) return
  const version = readUint16BE(bytes, 4)
  if (version !== 1 && version !== 2) return
  const height = readUint32BE(bytes, 14)
  const width = readUint32BE(bytes, 18)
  assertCanvasSize(width || 1, height || 1, "PSD canvas")
}

function sniffPngDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    !hasAscii(bytes, 1, "PNG\r\n\u001a\n") ||
    !hasAscii(bytes, 12, "IHDR")
  ) {
    return null
  }
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20), format: "PNG" }
}

function sniffGifDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 10 || (!hasAscii(bytes, 0, "GIF87a") && !hasAscii(bytes, 0, "GIF89a"))) return null
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8), format: "GIF" }
}

function isJpegStartOfFrame(marker: number) {
  return (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  )
}

function sniffJpegDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (offset + 2 > bytes.length) return null
    const length = readUint16BE(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (isJpegStartOfFrame(marker) && length >= 7) {
      return { width: readUint16BE(bytes, offset + 5), height: readUint16BE(bytes, offset + 3), format: "JPEG" }
    }
    if (marker === 0xda) return null
    offset += length
  }
  return null
}

function sniffWebpDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 30 || !hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP")) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkTypeOffset = offset
    const chunkSize = readUint32LE(bytes, offset + 4)
    const payload = offset + 8
    if (payload + chunkSize > bytes.length) return null
    if (hasAscii(bytes, chunkTypeOffset, "VP8X") && chunkSize >= 10) {
      return {
        width: readUint24LE(bytes, payload + 4) + 1,
        height: readUint24LE(bytes, payload + 7) + 1,
        format: "WEBP",
      }
    }
    if (hasAscii(bytes, chunkTypeOffset, "VP8 ") && chunkSize >= 10 && hasAscii(bytes, payload + 3, "\u009d\u0001*")) {
      return {
        width: readUint16LE(bytes, payload + 6) & 0x3fff,
        height: readUint16LE(bytes, payload + 8) & 0x3fff,
        format: "WEBP",
      }
    }
    if (hasAscii(bytes, chunkTypeOffset, "VP8L") && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const bits =
        bytes[payload + 1] |
        (bytes[payload + 2] << 8) |
        (bytes[payload + 3] << 16) |
        (bytes[payload + 4] << 24)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        format: "WEBP",
      }
    }
    offset = payload + chunkSize + (chunkSize % 2)
  }
  return null
}

function sniffBmpDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 26 || !hasAscii(bytes, 0, "BM")) return null
  const dibSize = readUint32LE(bytes, 14)
  if (dibSize === 12) {
    return { width: readUint16LE(bytes, 18), height: readUint16LE(bytes, 20), format: "BMP" }
  }
  if (dibSize >= 40 && bytes.length >= 26) {
    return {
      width: Math.abs(readInt32LE(bytes, 18)),
      height: Math.abs(readInt32LE(bytes, 22)),
      format: "BMP",
    }
  }
  return null
}

function isIsoBaseMediaFile(bytes: Uint8Array) {
  if (bytes.length < 16 || !hasAscii(bytes, 4, "ftyp")) return false
  const majorBrand = String.fromCharCode(...bytes.slice(8, 12))
  if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(majorBrand)) return true
  const brandsEnd = Math.min(bytes.length, readUint32BE(bytes, 0))
  for (let offset = 16; offset + 4 <= brandsEnd; offset += 4) {
    const brand = String.fromCharCode(...bytes.slice(offset, offset + 4))
    if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return true
  }
  return false
}

function sniffIsoImageDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (!isIsoBaseMediaFile(bytes)) return null
  for (let offset = 4; offset + 16 <= bytes.length; offset++) {
    if (!hasAscii(bytes, offset, "ispe")) continue
    const boxStart = offset - 4
    const boxSize = readUint32BE(bytes, boxStart)
    if (boxSize >= 20 && offset + 16 <= bytes.length) {
      return { width: readUint32BE(bytes, offset + 8), height: readUint32BE(bytes, offset + 12), format: "ISO-BMFF" }
    }
  }
  return null
}

function sniffRasterDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  return (
    sniffPngDimensions(bytes) ??
    sniffGifDimensions(bytes) ??
    sniffJpegDimensions(bytes) ??
    sniffWebpDimensions(bytes) ??
    sniffBmpDimensions(bytes) ??
    sniffIsoImageDimensions(bytes)
  )
}

async function assertRasterHeaderCanvasSize(file: File) {
  const headerBytes = await file.slice(0, Math.min(file.size, RASTER_HEADER_BYTES)).arrayBuffer()
  const dimensions = sniffRasterDimensions(new Uint8Array(headerBytes))
  if (dimensions) assertCanvasSize(dimensions.width, dimensions.height, "Image canvas")
}

function cleanText(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") return fallback
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength)
  return text || fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(min, Math.min(max, next))
}

function cleanBlendMode(value: unknown): BlendMode {
  return typeof value === "string" && APP_BLEND_MODES.has(value as BlendMode) ? (value as BlendMode) : "normal"
}

function cleanLayerKind(value: unknown): Layer["kind"] {
  return typeof value === "string" && APP_LAYER_KINDS.has(value as Layer["kind"]) ? (value as Layer["kind"]) : "raster"
}

function psdBlendToApp(mode: PsdBlendMode | undefined): BlendMode {
  const normalized = (mode ?? "normal").replace(/\s+/g, "-") as BlendMode
  return APP_BLEND_MODES.has(normalized) ? normalized : "normal"
}

function appBlendToPsd(mode: BlendMode): PsdBlendMode {
  return mode.replace(/-/g, " ") as PsdBlendMode
}

function canvasAtDocumentSize(
  source: HTMLCanvasElement | undefined,
  docW: number,
  docH: number,
  left = 0,
  top = 0,
) {
  const canvas = makeIoCanvas(docW, docH)
  if (source && typeof source.getContext === "function") {
    const ctx = canvas.getContext("2d")!
    // Negative offsets indicate the source extends beyond the canvas's
    // top/left edge (common for PSD layer masks anchored above 0,0).
    // Plain `drawImage(source, left, top)` would silently clip those
    // pixels because Canvas 2D treats negative dx/dy as off-canvas;
    // explicitly clip the source region instead so we draw the
    // correct intersected rectangle into [0, docW) × [0, docH).
    if (left < 0 || top < 0) {
      const srcX = left < 0 ? -left : 0
      const srcY = top < 0 ? -top : 0
      const dstX = left < 0 ? 0 : left
      const dstY = top < 0 ? 0 : top
      const w = Math.max(0, Math.min(source.width - srcX, docW - dstX))
      const h = Math.max(0, Math.min(source.height - srcY, docH - dstY))
      if (w > 0 && h > 0) ctx.drawImage(source, srcX, srcY, w, h, dstX, dstY, w, h)
    } else {
      ctx.drawImage(source, left, top)
    }
  }
  return canvas
}

function cloneIoCanvas(source: HTMLCanvasElement | null | undefined) {
  if (!source || typeof source.getContext !== "function") return null
  const canvas = makeIoCanvas(source.width, source.height)
  canvas.getContext("2d")!.drawImage(source, 0, 0)
  return canvas
}

function parseHexColor(hex: string) {
  const clean = hex.replace("#", "").trim()
  const value =
    clean.length === 3
      ? clean.split("").map((ch) => ch + ch).join("")
      : clean.padEnd(6, "0").slice(0, 6)
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  }
}

function colorToHex(color: Record<string, unknown> | undefined, fallback = "#000000") {
  if (!color || typeof color !== "object") return fallback
  const r = "r" in color ? Number(color.r) || 0 : 0
  const g = "g" in color ? Number(color.g) || 0 : 0
  const b = "b" in color ? Number(color.b) || 0 : 0
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function px(value: number | undefined) {
  return { units: "Pixels" as const, value: Math.max(0, Number(value) || 0) }
}

function offsetToDistance(x: number | undefined, y: number | undefined) {
  return Math.hypot(Number(x) || 0, Number(y) || 0)
}

function offsetToAngle(x: number | undefined, y: number | undefined) {
  const angle = (Math.atan2(-(Number(y) || 0), Number(x) || 0) * 180) / Math.PI
  return Number.isFinite(angle) ? (angle + 360) % 360 : 120
}

function psdGradientFromStops(gradient: NonNullable<NonNullable<Layer["style"]>["gradientOverlay"]>["gradient"]) {
  return {
    name: "Gradient Overlay",
    type: "solid" as const,
    smoothness: 100,
    colorStops: gradient.stops.map((stop) => ({
      location: Math.round(stop.offset * 4096),
      midpoint: 50,
      color: parseHexColor(stop.color),
    })),
    opacityStops: gradient.stops.map((stop) => ({
      location: Math.round(stop.offset * 4096),
      midpoint: 50,
      opacity: Math.max(0, Math.min(1, stop.opacity)),
    })),
  }
}

function layerStyleToPsdEffects(style: Layer["style"] | undefined): LayerEffectsInfo | undefined {
  if (!style) return undefined
  const effects: LayerEffectsInfo = { scale: 1 }
  if (style.dropShadow?.enabled) {
    effects.dropShadow = [{
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(style.dropShadow.size),
      distance: px(style.dropShadow.distance ?? offsetToDistance(style.dropShadow.offsetX, style.dropShadow.offsetY)),
      angle: style.dropShadow.angle ?? offsetToAngle(style.dropShadow.offsetX, style.dropShadow.offsetY),
      color: parseHexColor(style.dropShadow.color),
      blendMode: appBlendToPsd(style.dropShadow.blendMode ?? "multiply"),
      opacity: style.dropShadow.opacity,
      choke: px(style.dropShadow.spread),
      useGlobalLight: style.dropShadow.useGlobalLight ?? false,
    }]
  }
  if (style.innerShadow?.enabled) {
    effects.innerShadow = [{
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(style.innerShadow.size),
      distance: px(style.innerShadow.distance ?? offsetToDistance(style.innerShadow.offsetX, style.innerShadow.offsetY)),
      angle: style.innerShadow.angle ?? offsetToAngle(style.innerShadow.offsetX, style.innerShadow.offsetY),
      color: parseHexColor(style.innerShadow.color),
      blendMode: appBlendToPsd(style.innerShadow.blendMode ?? "multiply"),
      opacity: style.innerShadow.opacity,
      choke: px(style.innerShadow.choke),
      useGlobalLight: style.innerShadow.useGlobalLight ?? false,
    }]
  }
  if (style.outerGlow?.enabled) {
    effects.outerGlow = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(style.outerGlow.size),
      color: parseHexColor(style.outerGlow.color),
      blendMode: appBlendToPsd(style.outerGlow.blendMode ?? "screen"),
      opacity: style.outerGlow.opacity,
      choke: px(style.outerGlow.spread),
      range: style.outerGlow.range,
      noise: style.outerGlow.noise,
    }
  }
  if (style.innerGlow?.enabled) {
    effects.innerGlow = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(style.innerGlow.size),
      color: parseHexColor(style.innerGlow.color),
      blendMode: appBlendToPsd(style.innerGlow.blendMode ?? "screen"),
      opacity: style.innerGlow.opacity,
      source: style.innerGlow.source ?? "edge",
      choke: px(style.innerGlow.choke),
      range: style.innerGlow.range,
      noise: style.innerGlow.noise,
    }
  }
  if (style.stroke?.enabled) {
    effects.stroke = [{
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(style.stroke.size),
      position: style.stroke.position,
      fillType: style.stroke.fillType ?? "color",
      color: parseHexColor(style.stroke.color),
      blendMode: appBlendToPsd(style.stroke.blendMode ?? "normal"),
      opacity: style.stroke.opacity ?? 1,
      gradient: style.stroke.gradient ? psdGradientFromStops(style.stroke.gradient) : undefined,
    }]
  }
  if (style.colorOverlay?.enabled) {
    effects.solidFill = [{
      enabled: true,
      present: true,
      showInDialog: true,
      color: parseHexColor(style.colorOverlay.color),
      blendMode: appBlendToPsd(style.colorOverlay.blendMode ?? "normal"),
      opacity: style.colorOverlay.opacity,
    }]
  }
  if (style.gradientOverlay?.enabled) {
    effects.gradientOverlay = [{
      enabled: true,
      present: true,
      showInDialog: true,
      blendMode: appBlendToPsd(style.gradientOverlay.blendMode ?? "normal"),
      opacity: style.gradientOverlay.opacity,
      type: style.gradientOverlay.gradient.type === "angular" ? "angle" : style.gradientOverlay.gradient.type,
      angle: style.gradientOverlay.gradient.angle,
      gradient: psdGradientFromStops(style.gradientOverlay.gradient),
    }]
  }
  if (style.bevel?.enabled) {
    effects.bevel = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: px(style.bevel.size),
      soften: px(style.bevel.soften),
      strength: style.bevel.depth,
      angle: style.bevel.angle,
      altitude: style.bevel.altitude,
      direction: style.bevel.direction ?? "up",
      style:
        style.bevel.style === "outer"
          ? "outer bevel"
          : style.bevel.style === "emboss"
            ? "emboss"
            : style.bevel.style === "pillow"
              ? "pillow emboss"
              : "inner bevel",
      highlightColor: parseHexColor(style.bevel.highlight),
      shadowColor: parseHexColor(style.bevel.shadow),
      highlightOpacity: style.bevel.highlightOpacity ?? style.bevel.opacity,
      shadowOpacity: style.bevel.shadowOpacity ?? style.bevel.opacity,
      highlightBlendMode: appBlendToPsd(style.bevel.highlightBlendMode ?? "screen"),
      shadowBlendMode: appBlendToPsd(style.bevel.shadowBlendMode ?? "multiply"),
      useGlobalLight: style.bevel.useGlobalLight ?? false,
    }
  }
  return Object.keys(effects).length > 1 ? effects : undefined
}

function psdEffectsToLayerStyle(effects: LayerEffectsInfo | undefined): Layer["style"] | undefined {
  if (!effects) return undefined
  const dropShadow = effects.dropShadow?.find((effect) => effect.enabled)
  const innerShadow = effects.innerShadow?.find((effect) => effect.enabled)
  const stroke = effects.stroke?.find((effect) => effect.enabled)
  const solidFill = effects.solidFill?.find((effect) => effect.enabled)
  const gradientOverlay = effects.gradientOverlay?.find((effect) => effect.enabled)
  const style: NonNullable<Layer["style"]> = {}
  if (dropShadow) {
    const distance = dropShadow.distance?.value ?? 0
    const angle = dropShadow.angle ?? 120
    style.dropShadow = {
      enabled: true,
      color: colorToHex(dropShadow.color, "#000000"),
      size: dropShadow.size?.value ?? 0,
      offsetX: Math.cos((angle * Math.PI) / 180) * distance,
      offsetY: -Math.sin((angle * Math.PI) / 180) * distance,
      opacity: dropShadow.opacity ?? 0.75,
      blendMode: psdBlendToApp(dropShadow.blendMode),
      angle,
      distance,
      spread: dropShadow.choke?.value,
      useGlobalLight: dropShadow.useGlobalLight,
    }
  }
  if (innerShadow) {
    const distance = innerShadow.distance?.value ?? 0
    const angle = innerShadow.angle ?? 120
    style.innerShadow = {
      enabled: true,
      color: colorToHex(innerShadow.color, "#000000"),
      size: innerShadow.size?.value ?? 0,
      offsetX: Math.cos((angle * Math.PI) / 180) * distance,
      offsetY: -Math.sin((angle * Math.PI) / 180) * distance,
      opacity: innerShadow.opacity ?? 0.75,
      blendMode: psdBlendToApp(innerShadow.blendMode),
      angle,
      distance,
      choke: innerShadow.choke?.value,
      useGlobalLight: innerShadow.useGlobalLight,
    }
  }
  if (effects.outerGlow?.enabled) {
    style.outerGlow = {
      enabled: true,
      color: colorToHex(effects.outerGlow.color, "#ffffff"),
      size: effects.outerGlow.size?.value ?? 0,
      opacity: effects.outerGlow.opacity ?? 0.75,
      blendMode: psdBlendToApp(effects.outerGlow.blendMode),
      spread: effects.outerGlow.choke?.value,
      range: effects.outerGlow.range,
      noise: effects.outerGlow.noise,
    }
  }
  if (effects.innerGlow?.enabled) {
    style.innerGlow = {
      enabled: true,
      color: colorToHex(effects.innerGlow.color, "#ffffff"),
      size: effects.innerGlow.size?.value ?? 0,
      opacity: effects.innerGlow.opacity ?? 0.75,
      blendMode: psdBlendToApp(effects.innerGlow.blendMode),
      source: effects.innerGlow.source,
      choke: effects.innerGlow.choke?.value,
      range: effects.innerGlow.range,
      noise: effects.innerGlow.noise,
    }
  }
  if (stroke) {
    style.stroke = {
      enabled: true,
      color: colorToHex(stroke.color, "#000000"),
      size: stroke.size?.value ?? 1,
      position: stroke.position ?? "outside",
      opacity: stroke.opacity,
      blendMode: psdBlendToApp(stroke.blendMode),
      fillType: stroke.fillType === "gradient" ? "gradient" : "color",
    }
  }
  if (solidFill) {
    style.colorOverlay = {
      enabled: true,
      color: colorToHex(solidFill.color, "#000000"),
      opacity: solidFill.opacity ?? 1,
      blendMode: psdBlendToApp(solidFill.blendMode),
    }
  }
  if (gradientOverlay?.gradient?.type === "solid") {
    style.gradientOverlay = {
      enabled: true,
      opacity: gradientOverlay.opacity ?? 1,
      blendMode: psdBlendToApp(gradientOverlay.blendMode as PsdBlendMode),
      gradient: {
        type: gradientOverlay.type === "angle" ? "angular" : gradientOverlay.type ?? "linear",
        angle: gradientOverlay.angle ?? 0,
        stops: gradientOverlay.gradient.colorStops.map((stop, index) => ({
          offset: Math.max(0, Math.min(1, stop.location / 4096)),
          color: colorToHex(stop.color, "#000000"),
          opacity: gradientOverlay.gradient?.type === "solid"
            ? gradientOverlay.gradient.opacityStops[index]?.opacity ?? 1
            : 1,
        })),
      },
    }
  }
  if (effects.bevel?.enabled) {
    style.bevel = {
      enabled: true,
      style:
        effects.bevel.style === "outer bevel"
          ? "outer"
          : effects.bevel.style === "emboss"
            ? "emboss"
            : effects.bevel.style === "pillow emboss"
              ? "pillow"
              : "inner",
      direction: effects.bevel.direction,
      depth: effects.bevel.strength ?? 100,
      size: effects.bevel.size?.value ?? 0,
      soften: effects.bevel.soften?.value ?? 0,
      angle: effects.bevel.angle ?? 120,
      altitude: effects.bevel.altitude ?? 30,
      highlight: colorToHex(effects.bevel.highlightColor, "#ffffff"),
      shadow: colorToHex(effects.bevel.shadowColor, "#000000"),
      opacity: Math.max(effects.bevel.highlightOpacity ?? 0, effects.bevel.shadowOpacity ?? 0, 0.75),
      highlightOpacity: effects.bevel.highlightOpacity,
      shadowOpacity: effects.bevel.shadowOpacity,
      highlightBlendMode: psdBlendToApp(effects.bevel.highlightBlendMode),
      shadowBlendMode: psdBlendToApp(effects.bevel.shadowBlendMode),
      useGlobalLight: effects.bevel.useGlobalLight,
    }
  }
  return Object.keys(style).length ? style : undefined
}

export function makeIoCanvas(w: number, h: number, fill?: string) {
  const size = assertCanvasSize(w, h)
  const c = document.createElement("canvas")
  c.width = size.width
  c.height = size.height
  if (fill) {
    const ctx = c.getContext("2d")!
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, c.width, c.height)
  }
  return c
}

function withLayerMask(source: HTMLCanvasElement, mask?: HTMLCanvasElement | null) {
  if (!mask) return source
  const tmp = makeIoCanvas(source.width, source.height)
  const ctx = tmp.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  ctx.globalCompositeOperation = "destination-in"
  ctx.drawImage(mask, 0, 0)
  return tmp
}

function renderableLayer(layer: Layer) {
  const smartFiltered = applySmartFiltersForIo(layer.canvas, layer.smartFilters)
  const renderLayer = smartFiltered === layer.canvas ? layer : { ...layer, canvas: smartFiltered }
  const styled = layer.style ? applyLayerStyle(renderLayer, layer.fillOpacity ?? 1) : smartFiltered
  return withLayerMask(styled, layer.mask)
}

function paramsWithDefaults(filter: NonNullable<ReturnType<typeof getFilter>>, params: Record<string, number | string | boolean>) {
  const out: Record<string, number | string | boolean> = {}
  for (const param of filter.params) {
    const raw = params[param.key] ?? param.default
    if (param.type === "slider") {
      const numeric = typeof raw === "number" ? raw : Number(raw)
      out[param.key] = Math.max(param.min, Math.min(param.max, Number.isFinite(numeric) ? numeric : param.default))
    } else if (param.type === "checkbox") {
      out[param.key] = raw === true
    } else if (param.type === "select") {
      out[param.key] = param.options.some((option) => option.value === raw) ? raw : param.default
    }
  }
  return out
}

function imageDataToCanvas(data: ImageData) {
  const c = makeIoCanvas(data.width, data.height)
  c.getContext("2d")!.putImageData(data, 0, 0)
  return c
}

function maskAmountAt(mask: ImageData | null, x: number, y: number) {
  if (!mask || x >= mask.width || y >= mask.height) return 1
  const i = (y * mask.width + x) * 4
  const luminance = (mask.data[i] + mask.data[i + 1] + mask.data[i + 2]) / 765
  return luminance * (mask.data[i + 3] / 255)
}

function applySmartFiltersForIo(source: HTMLCanvasElement, smartFilters: Layer["smartFilters"]) {
  const enabled = smartFilters?.filter((sf) => sf.enabled) ?? []
  if (!enabled.length) return source
  const c = makeIoCanvas(source.width, source.height)
  const ctx = c.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  let current = ctx.getImageData(0, 0, c.width, c.height)
  for (const smartFilter of enabled) {
    const filter = getFilter(smartFilter.filterId)
    if (!filter) continue
    const before = current
    const after = filter.apply(before, paramsWithDefaults(filter, smartFilter.params))
    const opacity = Math.max(0, Math.min(1, smartFilter.opacity ?? 1))
    if (opacity <= 0) {
      current = before
      continue
    }
    const maskCtx = smartFilter.maskEnabled === false ? null : smartFilter.mask?.getContext("2d") ?? null
    const mask = maskCtx
      ? maskCtx.getImageData(0, 0, Math.min(smartFilter.mask!.width, c.width), Math.min(smartFilter.mask!.height, c.height))
      : null
    if (!mask && opacity >= 1 && (smartFilter.blendMode ?? "normal") === "normal") {
      current = after
      continue
    }
    const overlay = new ImageData(new Uint8ClampedArray(after.data), c.width, c.height)
    if (mask) {
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4
          overlay.data[i + 3] = Math.round(overlay.data[i + 3] * maskAmountAt(mask, x, y))
        }
      }
    }
    const baseCanvas = imageDataToCanvas(before)
    compositeLayer(baseCanvas.getContext("2d")!, imageDataToCanvas(overlay), smartFilter.blendMode ?? "normal", opacity)
    current = baseCanvas.getContext("2d")!.getImageData(0, 0, c.width, c.height)
  }
  ctx.putImageData(current, 0, 0)
  return c
}

function applyAdjustmentForIo(ctx: CanvasRenderingContext2D, layer: Layer, width: number, height: number, clipMask?: HTMLCanvasElement | null) {
  if (!layer.adjustment) return
  if (layer.opacity <= 0 || isAdjustmentNoop(layer.adjustment)) return
  const filter = getFilter(layer.adjustment.type)
  if (!filter) return
  const before = ctx.getImageData(0, 0, width, height)
  const after = filter.apply(before, paramsWithDefaults(filter, layer.adjustment.params))
  const opacity = Math.max(0, Math.min(1, layer.opacity))
  const maskCtx = layer.mask?.getContext("2d") ?? null
  const mask = maskCtx ? maskCtx.getImageData(0, 0, Math.min(layer.mask!.width, width), Math.min(layer.mask!.height, height)) : null
  const clipCtx = clipMask?.getContext("2d") ?? null
  const clip = clipCtx ? clipCtx.getImageData(0, 0, Math.min(clipMask!.width, width), Math.min(clipMask!.height, height)) : null
  if (!mask && !clip && opacity >= 1) {
    ctx.putImageData(after, 0, 0)
    return
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const amount = opacity * maskAmountAt(mask, x, y) * maskAmountAt(clip, x, y)
      for (let k = 0; k < 4; k++) {
        after.data[i + k] = before.data[i + k] * (1 - amount) + after.data[i + k] * amount
      }
    }
  }
  ctx.putImageData(after, 0, 0)
}

export function renderDocumentComposite(
  doc: PsDocument,
  options: { transparent?: boolean; matte?: string } = {},
) {
  const flat = makeIoCanvas(doc.width, doc.height)
  const ctx = flat.getContext("2d")!
  const transparent = options.transparent ?? false
  if (!transparent) {
    ctx.fillStyle = options.matte ?? doc.background ?? "#ffffff"
    ctx.fillRect(0, 0, doc.width, doc.height)
  }

  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group") continue
    if (typeof layer.canvas?.getContext !== "function") continue
    let clipMask: HTMLCanvasElement | null = null
    if (layer.clipped) {
      const idx = doc.layers.indexOf(layer)
      for (let j = idx - 1; j >= 0; j--) {
        if (!doc.layers[j].clipped) {
          clipMask = doc.layers[j].canvas
          break
        }
      }
    }
    if (layer.kind === "adjustment" && layer.adjustment) {
      applyAdjustmentForIo(ctx, layer, doc.width, doc.height, clipMask)
      continue
    }
    const toDraw = withLayerMask(renderableLayer(layer), clipMask)
    compositeLayer(ctx, toDraw, layer.blendMode, layer.opacity, layer.style ? 1 : layer.fillOpacity ?? 1)
  }
  return applyModeAndColorManagement(flat, doc)
}

/**
 * Generate a small thumbnail data URL for a document.
 * Used in the Open Recent list.  Returns a ~120px wide JPEG data URL.
 */
export function generateDocumentThumbnail(doc: PsDocument, maxWidth = 120): string {
  const composite = renderDocumentComposite(doc, { matte: doc.background ?? "#ffffff" })
  const aspect = doc.height / doc.width
  const thumbW = Math.min(maxWidth, doc.width)
  const thumbH = Math.max(1, Math.round(thumbW * aspect))
  const thumb = makeIoCanvas(thumbW, thumbH)
  const ctx = thumb.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "medium"
  ctx.drawImage(composite, 0, 0, thumbW, thumbH)
  return thumb.toDataURL("image/jpeg", 0.6)
}

function scaledCopy(src: HTMLCanvasElement, scale: number, matte?: string) {
  const out = makeIoCanvas(src.width * scale, src.height * scale, matte)
  const ctx = out.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(src, 0, 0, out.width, out.height)
  return out
}

export function buildRasterExportCanvas(doc: PsDocument, options: RasterExportOptions) {
  const needsMatte = options.format === "jpeg" || !options.transparent
  const base = renderDocumentComposite(doc, {
    transparent: !needsMatte,
    matte: options.matte,
  })
  const scaled = options.scale === 1 ? base : scaledCopy(base, options.scale, needsMatte ? options.matte : undefined)
  if (!options.dither || options.format === "jpeg") return scaled

  const ctx = scaled.getContext("2d")!
  const img = ctx.getImageData(0, 0, scaled.width, scaled.height)
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const n = (Math.random() - 0.5) * 1.6
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
  return scaled
}

export function rasterMime(format: Exclude<ExportFormat, "svg">) {
  if (format === "jpeg") return "image/jpeg"
  if (format === "webp") return "image/webp"
  if (format === "avif") return "image/avif"
  if (format === "gif") return "image/gif"
  return "image/png"
}

export function dataUrlBytes(dataUrl: string) {
  const body = dataUrl.split(",")[1] ?? ""
  return Math.round((body.length * 3) / 4)
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function u16(value: number) {
  return String.fromCharCode(value & 0xff, (value >> 8) & 0xff)
}

function bytesToBinary(bytes: number[]) {
  let out = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.slice(i, i + 8192))
  }
  return out
}

function gifPaletteColor(index: number) {
  const r = Math.round((((index >> 5) & 7) / 7) * 255)
  const g = Math.round((((index >> 2) & 7) / 7) * 255)
  const b = Math.round(((index & 3) / 3) * 255)
  return [r, g, b]
}

function encodeGifLzw(indexes: Uint8Array) {
  const minCodeSize = 8
  const clear = 1 << minCodeSize
  const end = clear + 1
  let codeSize = minCodeSize + 1
  let nextCode = end + 1
  let prev: number | null = null
  let bitBuffer = 0
  let bitCount = 0
  const bytes: number[] = []

  const emit = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }
  const reset = () => {
    codeSize = minCodeSize + 1
    nextCode = end + 1
    prev = null
  }

  emit(clear)
  for (const index of indexes) {
    emit(index)
    if (prev !== null) {
      nextCode++
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++
      if (nextCode >= 4095) {
        emit(clear)
        reset()
        continue
      }
    }
    prev = index
  }
  emit(end)
  if (bitCount > 0) bytes.push(bitBuffer & 0xff)
  return bytes
}

export function canvasToGifDataUrl(canvas: HTMLCanvasElement, transparent: boolean) {
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const indexes = new Uint8Array(canvas.width * canvas.height)
  for (let p = 0, i = 0; p < indexes.length; p++, i += 4) {
    if (transparent && img.data[i + 3] < 128) {
      indexes[p] = 0
      continue
    }
    let index = ((img.data[i] >> 5) << 5) | ((img.data[i + 1] >> 5) << 2) | (img.data[i + 2] >> 6)
    if (transparent && index === 0) index = 1
    indexes[p] = index
  }

  const palette: number[] = []
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = i === 0 && transparent ? [0, 0, 0] : gifPaletteColor(i)
    palette.push(r, g, b)
  }
  const lzw = encodeGifLzw(indexes)
  let data = "GIF89a"
  data += u16(canvas.width) + u16(canvas.height)
  data += String.fromCharCode(0xf7, 0, 0)
  data += bytesToBinary(palette)
  data += "!\xf9\x04" + String.fromCharCode(transparent ? 0x01 : 0x00, 0, 0, 0) + "\x00"
  data += "," + u16(0) + u16(0) + u16(canvas.width) + u16(canvas.height) + "\x00"
  data += String.fromCharCode(8)
  for (let i = 0; i < lzw.length; i += 255) {
    const block = lzw.slice(i, i + 255)
    data += String.fromCharCode(block.length) + bytesToBinary(block)
  }
  data += "\x00;"
  return `data:image/gif;base64,${btoa(data)}`
}

export function exportRasterDataUrl(doc: PsDocument, options: RasterExportOptions) {
  const canvas = buildRasterExportCanvas(doc, options)
  if (options.format === "gif") return canvasToGifDataUrl(canvas, options.transparent)
  const dataUrl = canvas.toDataURL(rasterMime(options.format), options.quality)
  // Inject EXIF metadata into JPEG exports
  if (options.format === "jpeg" && doc.metadata) {
    return injectJpegExif(dataUrl, doc)
  }
  return dataUrl
}

/* ---- EXIF metadata injection for JPEG ---- */

function encodeUtf8(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
    else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
  }
  bytes.push(0) // null terminator
  return bytes
}

function writeU16BE(arr: number[], offset: number, value: number) {
  arr[offset] = (value >> 8) & 0xff
  arr[offset + 1] = value & 0xff
}

function writeU32BE(arr: number[], offset: number, value: number) {
  arr[offset] = (value >> 24) & 0xff
  arr[offset + 1] = (value >> 16) & 0xff
  arr[offset + 2] = (value >> 8) & 0xff
  arr[offset + 3] = value & 0xff
}

function buildExifSegment(doc: PsDocument): Uint8Array | null {
  const meta = doc.metadata
  if (!meta) return null
  const entries: Array<{ tag: number; value: string }> = []
  // 0x010E = ImageDescription, 0x013B = Artist, 0x0131 = Software, 0x8298 = Copyright, 0x010D = DocumentName
  if (meta.description) entries.push({ tag: 0x010e, value: meta.description.slice(0, 200) })
  if (meta.author) entries.push({ tag: 0x013b, value: meta.author.slice(0, 100) })
  if (meta.copyright) entries.push({ tag: 0x8298, value: meta.copyright.slice(0, 200) })
  entries.push({ tag: 0x0131, value: "Photoshop Web" })
  if (doc.name) entries.push({ tag: 0x010d, value: doc.name.slice(0, 120) })
  if (!entries.length) return null

  // Build IFD with ASCII string entries
  const ifdEntryCount = entries.length
  const ifdSize = 2 + ifdEntryCount * 12 + 4 // count + entries + next IFD offset
  // Encode all string values
  const encodedValues = entries.map((e) => encodeUtf8(e.value))
  // Calculate total data area size for strings > 4 bytes
  let dataAreaSize = 0
  for (const v of encodedValues) {
    if (v.length > 4) dataAreaSize += v.length
  }

  const _tiffHeaderOffset = 0
  const ifdOffset = 8 // IFD starts right after TIFF header
  const dataAreaOffset = ifdOffset + ifdSize
  const totalTiffSize = dataAreaOffset + dataAreaSize

  // TIFF header + IFD + data
  const tiff = new Array(totalTiffSize).fill(0)
  // TIFF header: "II" (little-endian), 42, offset to IFD (8)
  tiff[0] = 0x4d; tiff[1] = 0x4d // "MM" big-endian
  writeU16BE(tiff, 2, 42)
  writeU32BE(tiff, 4, ifdOffset)

  // IFD
  writeU16BE(tiff, ifdOffset, ifdEntryCount)
  let currentDataOffset = dataAreaOffset
  for (let i = 0; i < entries.length; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    const val = encodedValues[i]
    writeU16BE(tiff, entryOffset, entries[i].tag) // tag
    writeU16BE(tiff, entryOffset + 2, 2) // type = ASCII
    writeU32BE(tiff, entryOffset + 4, val.length) // count
    if (val.length <= 4) {
      // Store inline
      for (let j = 0; j < val.length; j++) tiff[entryOffset + 8 + j] = val[j]
    } else {
      // Store offset
      writeU32BE(tiff, entryOffset + 8, currentDataOffset)
      for (let j = 0; j < val.length; j++) tiff[currentDataOffset + j] = val[j]
      currentDataOffset += val.length
    }
  }
  // Next IFD offset = 0 (no more IFDs)
  writeU32BE(tiff, ifdOffset + 2 + ifdEntryCount * 12, 0)

  // Build APP1 segment: FF E1 [length] "Exif\0\0" [TIFF data]
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
  const app1DataLength = 2 + exifHeader.length + totalTiffSize // length field includes itself
  const segment = new Uint8Array(2 + app1DataLength)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment[2] = (app1DataLength >> 8) & 0xff
  segment[3] = app1DataLength & 0xff
  segment.set(exifHeader, 4)
  segment.set(tiff, 4 + exifHeader.length)

  return segment
}

function injectJpegExif(dataUrl: string, doc: PsDocument): string {
  const exifSegment = buildExifSegment(doc)
  if (!exifSegment) return dataUrl

  // Decode base64 JPEG data
  const base64 = dataUrl.split(",")[1]
  if (!base64) return dataUrl
  const binary = atob(base64)
  const jpegBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) jpegBytes[i] = binary.charCodeAt(i)

  // Verify SOI marker (FF D8)
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) return dataUrl

  // Insert EXIF APP1 right after SOI (before byte 2)
  const result = new Uint8Array(2 + exifSegment.length + jpegBytes.length - 2)
  result[0] = 0xff
  result[1] = 0xd8
  result.set(exifSegment, 2)
  result.set(jpegBytes.subarray(2), 2 + exifSegment.length)

  // Re-encode as base64 data URL
  let encoded = ""
  for (let i = 0; i < result.length; i += 8192) {
    encoded += String.fromCharCode(...result.subarray(i, Math.min(i + 8192, result.length)))
  }
  return `data:image/jpeg;base64,${btoa(encoded)}`
}

export function exportSvgDataUrl(doc: PsDocument, options: SvgExportOptions) {
  const raster = buildRasterExportCanvas(doc, {
    format: "png",
    scale: options.scale,
    quality: 1,
    transparent: options.transparent,
    matte: options.matte,
  })
  const href = raster.toDataURL("image/png")
  const w = Number((doc.width * options.scale).toFixed(options.precision))
  const h = Number((doc.height * options.scale).toFixed(options.precision))
  // Validate matte is a real CSS color before injecting into markup.
  // Without this an attacker-controlled matte string like
  // `red"><script>...</script><rect fill="` would break out of the
  // attribute and inject arbitrary nodes once the SVG is rendered.
  const safeMatte = isSafeSvgColor(options.matte) ? options.matte : "#ffffff"
  const background = options.transparent
    ? ""
    : `<rect width="100%" height="100%" fill="${safeMatte}"/>`
  // Escape XML-significant characters in the document name; the JSON
  // payload itself is safe inside a CDATA section.
  const metadata = options.includeMetadata
    ? `<metadata><![CDATA[{"name":${JSON.stringify(escapeForCData(doc.name))},"width":${doc.width},"height":${doc.height}}]]></metadata>`
    : ""
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${metadata}${background}<image width="${w}" height="${h}" href="${href}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Accept only obviously-safe CSS color tokens that cannot break out of an
 * SVG attribute context. Hex, rgb()/rgba()/hsl()/hsla() with numeric args,
 * and a small allowlist of named colors.
 */
function isSafeSvgColor(value: string | undefined): value is string {
  if (typeof value !== "string") return false
  const v = value.trim()
  if (!v) return false
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true
  if (/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/i.test(v)) return true
  if (/^[a-zA-Z]{3,32}$/.test(v)) return true // named colors like "red", "transparent"
  return false
}

/** Escape characters that could prematurely close a CDATA section. */
function escapeForCData(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>")
}

function canvasDataUrl(canvas?: HTMLCanvasElement | null) {
  if (!canvas || typeof canvas.toDataURL !== "function") return null
  return canvas.toDataURL("image/png")
}

function serializeSelection(selection: Selection) {
  const { mask, ...rest } = selection
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

function serializeChannel(channel: AlphaChannel) {
  return {
    id: channel.id,
    name: channel.name,
    canvasDataUrl: canvasDataUrl(channel.canvas),
  }
}

function serializeSmartFilter(filter: SmartFilter) {
  const { mask, ...rest } = filter
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

function serializeLayer(layer: Layer) {
  const { canvas, mask, frame, smartFilters, smartSource, ...rest } = layer
  return {
    ...rest,
    canvasDataUrl: canvasDataUrl(canvas),
    maskDataUrl: canvasDataUrl(mask),
    frame: frame
      ? {
          ...frame,
          imageDataUrl: canvasDataUrl(frame.imageCanvas),
          imageCanvas: undefined,
        }
      : undefined,
    smartFilters: smartFilters?.map(serializeSmartFilter),
    smartSource: smartSource
      ? {
          ...smartSource,
          canvasDataUrl: canvasDataUrl(smartSource.canvas),
          canvas: undefined,
        }
      : undefined,
  }
}

export function serializeProject(doc: PsDocument) {
  const { layers, channels, selection, quickMaskCanvas, ...rest } = doc
  return JSON.stringify(
    {
      app: "Photoshop Web",
      format: "psprojson",
      version: 2,
      savedAt: new Date().toISOString(),
      savedWith: {
        supports: ["adjustment-layers", "smart-filters", "asset-library", "export-presets", "layer-comps", "timeline", "video-layers", "3d-scenes", "plugins", "variable-data", "advanced-formats", "annotations", "guides", "slices", "round-trip-reports", "metadata", "color-management", "print-settings"],
      },
      document: {
        ...rest,
        selection: serializeSelection(selection),
        quickMaskCanvasDataUrl: canvasDataUrl(quickMaskCanvas),
        layers: layers.map(serializeLayer),
        channels: (channels ?? []).map(serializeChannel),
      },
    },
    null,
    2,
  )
}

const REPORT_STATUSES: ReportStatus[] = ["preserved", "approximated", "flattened", "unsupported", "info"]

function reportTotals(entries: CompatibilityManifestEntry[]): Record<ReportStatus, number> {
  const totals = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>
  for (const entry of entries) totals[entry.status] += 1
  return totals
}

function reportPlural(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function compatibilityStatus(
  target: CompatibilityTarget,
  project: ReportStatus,
  psd: ReportStatus,
  raster: ReportStatus,
) {
  return target === "project" ? project : target === "psd" ? psd : raster
}

function manifestTargetLabel(target: CompatibilityTarget) {
  if (target === "project") return "project format"
  if (target === "psd") return "PSD round trip"
  return "browser raster export"
}

function compatibilityTargetForSource(source: DocumentReport["source"]): CompatibilityTarget {
  if (source.includes("Project")) return "project"
  if (source.includes("PSD")) return "psd"
  return "browser-raster"
}

export function createCompatibilityManifest(
  doc: PsDocument,
  target: CompatibilityTarget,
): CompatibilityManifest {
  const entries: CompatibilityManifestEntry[] = []
  const layers = doc.layers
  const textLayers = layers.filter((layer) => layer.kind === "text").length
  const shapeLayers = layers.filter((layer) => layer.kind === "shape").length
  const smartObjectLayers = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const smartObjectSources = smartObjectLayers.filter((layer) => layer.smartSource).length
  const linkedSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.linkType === "linked").length
  const adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment").length
  const smartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const maskedLayers = layers.filter((layer) => layer.mask || layer.vectorMask).length
  const styledLayers = layers.filter((layer) => layer.style).length
  const groupLayers = layers.filter((layer) => layer.kind === "group").length
  const blendModes = [...new Set(layers.map((layer) => layer.blendMode).filter((mode) => mode && mode !== "normal"))]
  const threeDLayers = layers.filter((layer) => layer.kind === "3d").length
  const videoLayers = layers.filter((layer) => layer.kind === "video").length
  const exportPresets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "export").length
  const pluginAssets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "plugin" || asset.kind === "cloud-library").length
  const profile = doc.colorManagement?.assignedProfile
  const specialMode = doc.colorMode !== "RGB" || doc.bitDepth > 8

  const add = (
    label: string,
    project: ReportStatus,
    psd: ReportStatus,
    raster: ReportStatus,
    details: Record<CompatibilityTarget, string>,
  ) => {
    entries.push({
      label,
      status: compatibilityStatus(target, project, psd, raster),
      detail: details[target],
    })
  }

  add("Canvas", "preserved", "preserved", "preserved", {
    project: `${doc.width} x ${doc.height}px canvas, background, resolution, mode, and bit-depth metadata are serialized.`,
    psd: `${doc.width} x ${doc.height}px rendered layer pixels are written with PSD-compatible canvas metadata.`,
    "browser-raster": `${doc.width} x ${doc.height}px composite pixels are exported through the browser encoder.`,
  })
  add("Layer structure", "preserved", "approximated", "flattened", {
    project: `${reportPlural(layers.length, "layer")} retain app layer kind, visibility, opacity, locks, blend mode, and selection state.`,
    psd: `${reportPlural(layers.length, "layer")} are mapped to PSD layers where possible; app-only descriptors stay in the preservation report.`,
    "browser-raster": `${reportPlural(layers.length, "layer")} are composited into one pixel surface for browser export.`,
  })
  if (textLayers) add("Text layers", "preserved", "approximated", "flattened", {
    project: `${reportPlural(textLayers, "editable text layer")} retain typography, OpenType, path, shape, and extrusion metadata.`,
    psd: "Editable text intent is reported, but PSD export keeps the rendered/text approximation supported by ag-psd.",
    "browser-raster": "Text is rasterized into the flattened export surface.",
  })
  if (shapeLayers) add("Shape layers", "preserved", "approximated", "flattened", {
    project: `${reportPlural(shapeLayers, "shape layer")} retain geometry, stroke, fill, radius, and custom-shape metadata.`,
    psd: "Shape intent and rendered pixels are retained where possible; advanced app geometry is approximated.",
    "browser-raster": "Vector shape geometry is rasterized into the flattened export surface.",
  })
  if (groupLayers) add("Groups", "preserved", "approximated", "flattened", {
    project: `${reportPlural(groupLayers, "group")} retain child relationship metadata, visibility, expanded state, and group opacity.`,
    psd: "Group child relationship metadata is mapped to PSD layer folders where possible; app-only group state is approximated.",
    "browser-raster": "Groups are flattened into the composite pixel result.",
  })
  if (blendModes.length) add("Blend modes", "preserved", "approximated", "flattened", {
    project: `Non-normal blend modes retained: ${blendModes.join(", ")}.`,
    psd: `PSD blend modes are mapped by name where possible; unsupported renderer differences are approximated for: ${blendModes.join(", ")}.`,
    "browser-raster": `Blend modes (${blendModes.join(", ")}) affect the flattened composite only.`,
  })
  if (maskedLayers) add("Masks", "preserved", "approximated", "flattened", {
    project: `${reportPlural(maskedLayers, "mask")} retain raster/vector mask metadata and pixels.`,
    psd: "Layer mask pixels are exported where compatible; vector/app mask metadata is approximated.",
    "browser-raster": "Masks affect the composite only; editable masks are not exported.",
  })
  if (styledLayers) add("Layer styles", "preserved", "approximated", "flattened", {
    project: `${reportPlural(styledLayers, "styled layer")} retain editable effect settings.`,
    psd: "Supported effects are mapped; unsupported effect controls are reported as approximations.",
    "browser-raster": "Layer styles are baked into the exported pixels.",
  })
  if (adjustmentLayers) add("Adjustment layers", "preserved", "approximated", "flattened", {
    project: `${reportPlural(adjustmentLayers, "adjustment layer")} retain non-destructive settings.`,
    psd: "Adjustment metadata is approximated and the current visual result is preserved.",
    "browser-raster": "Adjustments are baked into the flattened export pixels.",
  })
  if (smartFilters) add("Smart filters", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartFilters, "smart filter")} retain filter id, parameters, masks, opacity, and blend mode.`,
    psd: "Smart-filter stacks are represented by rendered pixels and a report entry.",
    "browser-raster": "Smart filters are baked into the flattened export pixels.",
  })
  if (smartObjectLayers.length) add("Smart objects", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartObjectLayers.length, "smart object")} retain object layer records and transform state.`,
    psd: "Smart object layers export as compatible rendered layers with source limitations reported.",
    "browser-raster": "Smart objects are flattened to their current rendered pixels.",
  })
  if (smartObjectSources) add("Smart object sources", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartObjectSources, "embedded smart source")} retain source canvas, link status, file name, and relink metadata.`,
    psd: "Source documents are not written as native Photoshop smart-object resources; rendered layers are preserved.",
    "browser-raster": "Source documents are not included in browser raster exports.",
  })
  if (linkedSmartObjects) add("Linked smart object references", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(linkedSmartObjects, "linked smart object reference")} retain local path/status metadata.`,
    psd: "Native Photoshop linked smart-object resource records are not authored by the browser exporter.",
    "browser-raster": "Linked source references are omitted from the exported image.",
  })
  if (doc.channels?.length) add("Alpha and saved channels", "preserved", "approximated", "unsupported", {
    project: `${reportPlural(doc.channels.length, "saved channel")} retain editable channel pixels.`,
    psd: "Saved channels are represented in the report and compatible data where possible.",
    "browser-raster": "Extra channels, spot channels, and saved alpha channels are not emitted by browser raster encoders.",
  })
  if (doc.comps?.length) add("Layer comps", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.comps.length, "layer comp")} retain appearance snapshots.`,
    psd: "Layer comp records are app-only metadata and are not authored as native PSD layer comps.",
    "browser-raster": "Layer comps are not included in flattened image exports.",
  })
  if (doc.guides?.length) add("Guides", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.guides.length, "guide")} retain orientation, position, and color.`,
    psd: "Guide metadata is kept in the app report but is not written as native PSD guide resources.",
    "browser-raster": "Guides are non-printing editor metadata and are omitted.",
  })
  if (doc.slices?.length) add("Slices", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.slices.length, "slice")} retain web export regions and selected slice state.`,
    psd: "Slice metadata is app-only and is not written as native PSD slice resources.",
    "browser-raster": "Slices are not included in single-image browser exports.",
  })
  if (exportPresets) add("Export presets", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(exportPresets, "export preset")} retain reusable settings in the asset library.`,
    psd: "Export preset metadata is not a native PSD export payload.",
    "browser-raster": "Export presets are editor metadata and are omitted from the exported image.",
  })
  if (doc.timelineFrames?.length || videoLayers) add("Timeline and video", "preserved", "approximated", "flattened", {
    project: `${reportPlural(doc.timelineFrames?.length ?? videoLayers, "timeline entry", "timeline entries")} retain frame, video, transition, keyframe, and audio metadata.`,
    psd: "Timeline/video records are reported and represented by poster/current-frame pixels where possible.",
    "browser-raster": "Video and animation state is flattened to the current composite frame unless a dedicated animation exporter is used.",
  })
  if (threeDLayers) add("3D scenes", "preserved", "approximated", "flattened", {
    project: `${reportPlural(threeDLayers, "3D layer")} retain browser-native scene, mesh, material, camera, and print-check metadata.`,
    psd: "3D scene metadata is reported and represented by rendered layer pixels.",
    "browser-raster": "3D layers are flattened to their current rendered preview.",
  })
  if (doc.plugins?.length || pluginAssets) add("Plugin and cloud descriptors", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural((doc.plugins?.length ?? 0) + pluginAssets, "plugin/library descriptor")} retain local integration metadata.`,
    psd: "Plugin, cloud-library, and extension descriptors are not authored as native PSD resources.",
    "browser-raster": "Plugin and library metadata is omitted from exported images.",
  })
  if (doc.variableDataSets?.length) add("Variable data", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.variableDataSets.length, "variable data set")} retain rows, bindings, and active row state.`,
    psd: "Variable data sets are app-only metadata in this implementation.",
    "browser-raster": "Variable data is omitted from flattened image exports.",
  })
  if (doc.metadata) add("File metadata", "preserved", "approximated", "unsupported", {
    project: "IPTC-style metadata and local content credentials are serialized.",
    psd: "Basic document metadata is retained where supported; app credentials remain in the report/project format.",
    "browser-raster": "Browser encoders generally do not embed IPTC/XMP/content-credential metadata.",
  })
  if (doc.colorManagement || specialMode) add("Color and bit depth", "preserved", "approximated", "approximated", {
    project: `${doc.colorMode}/${doc.bitDepth}-bit intent${profile ? ` with ${profile}` : ""} is retained as document metadata.`,
    psd: `${doc.colorMode}/${doc.bitDepth}-bit metadata is tracked, but browser preview and many operations run through 8-bit RGBA surfaces.`,
    "browser-raster": `${doc.colorMode}/${doc.bitDepth}-bit intent is converted through browser 8-bit RGBA export; ICC transforms are not embedded.`,
  })

  const totals = reportTotals(entries)
  const summary = `${manifestTargetLabel(target)}: ${totals.preserved} preserved, ${totals.approximated} approximated, ${totals.flattened} flattened, ${totals.unsupported} unsupported.`
  return { target, entries, totals, summary }
}

export function createExportLimitationReport(
  doc: PsDocument,
  options: ExportLimitationOptions,
): ExportLimitationReport {
  const items: CompatibilityManifestEntry[] = []
  const format = options.format
  const layers = doc.layers.length
  const hasEditableVectors = doc.layers.some((layer) => layer.kind === "shape" || layer.vectorMask)
  const hasEditableText = doc.layers.some((layer) => layer.kind === "text")
  const hasExtraChannels = (doc.channels?.length ?? 0) > 0 || doc.colorMode === "Multichannel"
  const highBitOrNonRgb = doc.bitDepth > 8 || doc.colorMode !== "RGB"
  const metadataRequested = !!options.includeMetadata
  const profile = doc.colorManagement?.assignedProfile

  const add = (label: string, status: ReportStatus, detail: string) => {
    items.push({ label, status, detail })
  }

  add("Layer structure", "flattened", `${reportPlural(layers, "layer")} are composited into the exported ${format.toUpperCase()} result.`)
  if (hasEditableText) add("Editable text", "flattened", "Text remains editable in the project format, but browser image exports contain rasterized glyph pixels.")
  if (hasEditableVectors || format === "svg") {
    add("Editable vector structure", "flattened", format === "svg"
      ? "SVG export wraps the rendered document as an image; it does not emit editable Photoshop shape/text vectors."
      : "Shape and vector-mask geometry is baked into browser raster pixels.")
  }
  if (highBitOrNonRgb) {
    add("8-bit RGBA export path", "approximated", `${doc.colorMode}/${doc.bitDepth}-bit document intent is flattened through browser 8-bit RGBA canvas data.`)
  }
  if (hasExtraChannels) {
    add("Spot and extra channels", "unsupported", "Spot, alpha, and multichannel data are not embedded by browser raster encoders.")
  }
  if (profile || doc.colorManagement) {
    add("ICC profile embedding", "unsupported", `${profile ?? "Document"} profile metadata is tracked by the app but browser encoders do not embed native ICC payloads here.`)
  }
  if (metadataRequested) {
    add("Metadata embedding", format === "svg" ? "approximated" : "unsupported", format === "svg"
      ? "SVG export includes a compact app metadata block, not full IPTC/XMP/content-credential payloads."
      : "Browser raster exports do not reliably embed IPTC/XMP/content-credential metadata.")
  }

  if (format === "png") {
    if (options.interlaced) add("Interlaced PNG", "unsupported", "Canvas PNG encoding does not expose Adam7 interlacing controls.")
    add("PNG color chunks", "unsupported", "Browser PNG output does not expose gAMA/cHRM/iCCP authoring controls for this app.")
  } else if (format === "jpeg") {
    if (options.progressive) add("Progressive JPEG", "unsupported", "Canvas JPEG encoding does not expose progressive scan controls.")
    if (options.transparent !== false) add("Alpha transparency", "flattened", "JPEG has no alpha channel; transparent pixels are composited against the selected matte.")
    add("JPEG quality", "approximated", `Requested quality ${Math.round(Number(options.quality ?? 92))}% is passed to the browser encoder, whose quantization tables are implementation-defined.`)
  } else if (format === "webp") {
    add("WebP encoder controls", "approximated", "Browser WebP exposes quality but not full lossless/near-lossless, metadata, or chunk-level controls.")
  } else if (format === "avif") {
    add("AVIF encoder controls", "approximated", "Browser AVIF exposes limited quality intent and no native color/metadata authoring controls here.")
  } else if (format === "gif") {
    add("GIF palette", "approximated", "GIF export quantizes to a 256-color indexed palette with limited transparency.")
    if (doc.timelineFrames?.length) add("Frame animation", "approximated", "Timeline frames can be converted to GIF frames, but advanced video/audio metadata is not retained.")
  } else if (format === "svg") {
    add("SVG image wrapper", "info", "The SVG stores the current rendered document as an embedded raster image for visual round-trip reliability.")
  }

  const totals = reportTotals(items)
  return {
    format,
    items,
    summary: `${format.toUpperCase()} export limitations: ${totals.flattened} flattened, ${totals.approximated} approximated, ${totals.unsupported} unsupported.`,
  }
}

function parseProjectEnvelope(text: string) {
  try {
    return JSON.parse(text)
  } catch (firstError) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {}
    }
    throw firstError
  }
}

export function createDocumentReport(
  doc: PsDocument,
  source: DocumentReport["source"],
): DocumentReport {
  const items: DocumentReport["items"] = []
  const layers = doc.layers
  const smartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment").length
  const styledLayers = layers.filter((layer) => layer.style).length
  const maskedLayers = layers.filter((layer) => layer.mask || layer.vectorMask).length
  const textLayers = layers.filter((layer) => layer.kind === "text").length
  const shapeLayers = layers.filter((layer) => layer.kind === "shape").length
  const groupLayers = layers.filter((layer) => layer.kind === "group").length
  const blendModes = [...new Set(layers.map((layer) => layer.blendMode).filter((mode) => mode && mode !== "normal"))]
  const smartObjectLayers = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const smartObjectSources = smartObjectLayers.filter((layer) => layer.smartSource).length
  const linkedSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.linkType === "linked").length
  const missingSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.status === "missing").length
  const exportPresets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "export").length
  items.push({ label: "Canvas", status: "preserved", detail: `${doc.width} x ${doc.height}px, ${doc.colorMode}, ${doc.bitDepth}-bit metadata retained.` })
  for (const capabilityWarning of capabilityWarningsForDocument(doc)) {
    const status =
      capabilityWarning.status === "unsupported"
        ? "unsupported"
        : capabilityWarning.status === "stub" || capabilityWarning.status === "approximation"
          ? "approximated"
          : "info"
    items.push({
      label: capabilityWarning.label,
      status,
      detail: capabilityWarning.recommendedAction
        ? `${capabilityWarning.detail} ${capabilityWarning.recommendedAction}`
        : capabilityWarning.detail,
    })
  }
  const manifest = createCompatibilityManifest(doc, compatibilityTargetForSource(source))
  items.push({
    label: "Compatibility manifest",
    status: manifest.totals.unsupported > 0 || manifest.totals.flattened > 0 ? "info" : "preserved",
    detail: manifest.summary,
  })
  if (doc.metadata) items.push({ label: "File info", status: "preserved", detail: "IPTC-style title, author, copyright, description, and keyword metadata retained in project format." })
  if (doc.colorManagement) items.push({ label: "Color management", status: "preserved", detail: `${doc.colorManagement.assignedProfile} profile and proofing settings retained in project format.` })
  if (doc.printSettings) items.push({ label: "Print settings", status: "preserved", detail: `${doc.printSettings.paperSize} print setup, marks, bleed, and color-handling metadata retained.` })
  items.push({ label: "Project schema", status: "info", detail: "Project saves use schema version 2 with migration-aware loading and recovery from wrapped JSON text." })
  items.push({ label: "Layers", status: "preserved", detail: `${layers.length} layer records retained with visibility, opacity, blend mode, and lock state.` })
  if (textLayers) items.push({ label: "Text layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${textLayers} editable text layer${textLayers === 1 ? "" : "s"} with app text properties.` })
  if (shapeLayers) items.push({ label: "Shape layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${shapeLayers} shape layer${shapeLayers === 1 ? "" : "s"} retained with available geometry metadata.` })
  if (groupLayers) items.push({ label: "Groups", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${groupLayers} group layer${groupLayers === 1 ? "" : "s"} retain child relationship metadata; PSD export maps folders where possible and approximates app-only state.` })
  if (blendModes.length) items.push({ label: "Blend modes", status: source.includes("PSD") ? "approximated" : "preserved", detail: `Non-normal blend modes modeled for round trip: ${blendModes.join(", ")}.` })
  const threeDLayers = layers.filter((layer) => layer.kind === "3d").length
  const videoLayers = layers.filter((layer) => layer.kind === "video").length
  if (threeDLayers) items.push({ label: "3D layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${threeDLayers} browser-native 3D scene layer${threeDLayers === 1 ? "" : "s"} retained with mesh, material, light, and camera metadata.` })
  if (videoLayers) items.push({ label: "Video layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${videoLayers} video layer${videoLayers === 1 ? "" : "s"} retained with poster frame, timing, keyframe, and audio metadata.` })
  if (maskedLayers) items.push({ label: "Masks", status: "preserved", detail: `${maskedLayers} raster/vector mask entry${maskedLayers === 1 ? "" : "ies"} serialized.` })
  if (styledLayers) items.push({ label: "Layer styles", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${styledLayers} styled layer${styledLayers === 1 ? "" : "s"} mapped to supported effects.` })
  if (adjustmentLayers) items.push({
    label: "Adjustment layers",
    status: source.includes("PSD") ? "approximated" : "preserved",
    detail: source.includes("PSD")
      ? `${adjustmentLayers} non-destructive adjustment layer${adjustmentLayers === 1 ? "" : "s"} reported with settings while the current visual result is preserved for PSD interoperability.`
      : `${adjustmentLayers} non-destructive adjustment layer${adjustmentLayers === 1 ? "" : "s"} retained in project format.`,
  })
  if (smartFilters) items.push({ label: "Smart filters", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${smartFilters} smart filter${smartFilters === 1 ? "" : "s"} retained in project format; PSD export rasterizes their visual result.` })
  if (smartObjectSources) items.push({ label: "Smart object sources", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${smartObjectSources} embedded smart source${smartObjectSources === 1 ? "" : "s"} preserved in project format; PSD export stores the rendered layer approximation.` })
  if (linkedSmartObjects) items.push({ label: "Linked smart objects", status: source.includes("PSD") ? "unsupported" : "info", detail: `${linkedSmartObjects} linked smart object reference${linkedSmartObjects === 1 ? "" : "s"} tracked locally with file name, path, and status metadata; native Photoshop relink resources are not written.` })
  if (missingSmartObjects) items.push({ label: "Missing smart object links", status: "unsupported", detail: `${missingSmartObjects} smart object link${missingSmartObjects === 1 ? " is" : "s are"} marked missing and require relink before source edits are reliable.` })
  if (doc.channels?.length) items.push({ label: "Alpha channels", status: "preserved", detail: `${doc.channels.length} saved channel${doc.channels.length === 1 ? "" : "s"} retained.` })
  if (doc.timelineFrames?.length) items.push({ label: "Timeline", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${doc.timelineFrames.length} frame/video timeline entries retained in project format.` })
  if (doc.plugins?.length) items.push({ label: "Plugin descriptors", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.plugins.length} CEP/UX/8BF-style local plugin descriptor${doc.plugins.length === 1 ? "" : "s"} retained.` })
  if (doc.variableDataSets?.length) items.push({ label: "Variable data", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.variableDataSets.length} variable data set${doc.variableDataSets.length === 1 ? "" : "s"} retained for data-driven graphics.` })
  if (doc.comps?.length) items.push({ label: "Layer comps", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.comps.length} layer comp${doc.comps.length === 1 ? "" : "s"} retained with appearance state snapshots.` })
  if (exportPresets) items.push({ label: "Export presets", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${exportPresets} reusable export preset${exportPresets === 1 ? "" : "s"} retained in the asset library.` })
  if (doc.guides?.length) items.push({ label: "Guides", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.guides.length} guide${doc.guides.length === 1 ? "" : "s"} retained for layout alignment.` })
  if (doc.slices?.length) items.push({ label: "Slices", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.slices.length} web export slice${doc.slices.length === 1 ? "" : "s"} retained in project format.` })
  if (source.includes("PSD")) {
    items.push({ label: "PSD interoperability boundary", status: "approximated", detail: "3D, video, plugin, cloud library, and vendor metadata are preserved in the app project format; PSD import/export keeps a raster-compatible approximation." })
  }
  return {
    id: `report_${Math.random().toString(36).slice(2, 9)}`,
    title: `${source}: ${doc.name}`,
    createdAt: Date.now(),
    source,
    items,
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename
  a.click()
}

export function downloadText(text: string, filename: string, type = "application/json") {
  const blob = new Blob([text], { type })
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    downloadDataUrl(url, filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function canvasFromDataUrl(dataUrl: string | null | undefined, w: number, h: number) {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const canvas = makeIoCanvas(w, h)
    if (!dataUrl) {
      resolve(canvas)
      return
    }
    if (typeof dataUrl !== "string" || dataUrl.length > MAX_PROJECT_DATA_URL_CHARS || !SAFE_CANVAS_DATA_URL.test(dataUrl)) {
      reject(new Error("Project contains unsupported or oversized canvas image data"))
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        const size = assertCanvasSize(img.naturalWidth || w, img.naturalHeight || h, "Project image")
        canvas.width = size.width
        canvas.height = size.height
        canvas.getContext("2d")!.drawImage(img, 0, 0)
        resolve(canvas)
      } catch (error) {
        reject(error)
      }
    }
    img.onerror = () => reject(new Error("Could not load canvas image data"))
    img.src = dataUrl
  })
}

async function deserializeLayer(serialized: Record<string, unknown>, docW: number, docH: number): Promise<Layer> {
  const { canvasDataUrl, maskDataUrl, frame, smartFilters, smartSource, ...rest } = serialized
  const canvas = await canvasFromDataUrl(canvasDataUrl as string | undefined, docW, docH)
  const mask = maskDataUrl ? await canvasFromDataUrl(maskDataUrl as string, docW, docH) : null
  const restoredFrame = frame
    ? {
        ...(frame as Record<string, unknown>),
        imageCanvas: (frame as Record<string, unknown>).imageDataUrl ? await canvasFromDataUrl((frame as Record<string, unknown>).imageDataUrl as string, docW, docH) : null,
        imageDataUrl: undefined,
      }
    : undefined
  const restoredSmartFilters = smartFilters
    ? await Promise.all(
        (smartFilters as unknown[]).map(async (sf) => {
          const { maskDataUrl: smartMaskDataUrl, ...filterRest } = sf as Record<string, unknown>
          return {
            ...filterRest,
            mask: smartMaskDataUrl ? await canvasFromDataUrl(smartMaskDataUrl as string, docW, docH) : undefined,
          }
        }),
      )
    : undefined
  const restoredSmartSource = smartSource
    ? {
        ...(smartSource as Record<string, unknown>),
        width: (smartSource as Record<string, unknown>).width as number ?? docW,
        height: (smartSource as Record<string, unknown>).height as number ?? docH,
        canvas: (smartSource as Record<string, unknown>).canvasDataUrl
          ? await canvasFromDataUrl((smartSource as Record<string, unknown>).canvasDataUrl as string, (smartSource as Record<string, unknown>).width as number ?? docW, (smartSource as Record<string, unknown>).height as number ?? docH)
          : null,
        canvasDataUrl: undefined,
      }
    : undefined
  return {
    ...rest,
    id: cleanText(rest.id, uid("layer"), 80),
    name: cleanText(rest.name, "Layer"),
    kind: cleanLayerKind(rest.kind),
    visible: rest.visible !== false,
    locked: rest.locked === true,
    opacity: clampNumber(rest.opacity, 0, 1, 1),
    fillOpacity: rest.fillOpacity === undefined ? undefined : clampNumber(rest.fillOpacity, 0, 1, 1),
    blendMode: cleanBlendMode(rest.blendMode),
    canvas,
    mask,
    frame: restoredFrame,
    smartFilters: restoredSmartFilters,
    smartSource: restoredSmartSource,
  } as Layer
}

export async function deserializeProject(text: string): Promise<PsDocument> {
  const parsed = parseProjectEnvelope(text)
  const source = parsed.document ?? parsed
  const { width, height } = assertCanvasSize(Number(source.width) || 1200, Number(source.height) || 800, "Project canvas")
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    throw new Error("Project does not contain any layers")
  }
  if (source.layers.length > MAX_PROJECT_LAYERS) {
    throw new Error(`Project contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`)
  }

  const layers = await Promise.all(source.layers.map((l: Record<string, unknown>) => deserializeLayer(l, width, height)))
  const channelEntries = Array.isArray(source.channels) ? source.channels : []
  if (channelEntries.length > MAX_PROJECT_CHANNELS) {
    throw new Error(`Project contains too many alpha channels. Maximum supported channels: ${MAX_PROJECT_CHANNELS}.`)
  }
  const channels = await Promise.all(
    channelEntries.map(async (ch: Record<string, unknown>) => ({
      id: cleanText(ch.id, uid("channel"), 80),
      name: cleanText(ch.name, "Alpha"),
      canvas: await canvasFromDataUrl(ch.canvasDataUrl as string | undefined, width, height),
    })),
  )
  const rawSelection = source.selection ?? { bounds: null, shape: "rect" }
  const { maskDataUrl, ...selectionRest } = rawSelection
  const selectionMask = maskDataUrl ? await canvasFromDataUrl(maskDataUrl, width, height) : null
  const quickMaskCanvas = source.quickMaskCanvasDataUrl
    ? await canvasFromDataUrl(source.quickMaskCanvasDataUrl, width, height)
    : null

  const {
    layers: _layers,
    channels: _channels,
    selection: _selection,
    quickMaskCanvasDataUrl: _quickMaskCanvasDataUrl,
    id: _id,
    ...docRest
  } = source
  const activeLayerId = layers.some((l) => l.id === source.activeLayerId)
    ? source.activeLayerId
    : layers[layers.length - 1].id
  const selectedLayerIds = Array.isArray(source.selectedLayerIds)
    ? source.selectedLayerIds.filter((id: string) => layers.some((l) => l.id === id))
    : [activeLayerId]

  return {
    ...docRest,
    id: uid("doc"),
    name: cleanText(source.name, "Loaded Project"),
    width,
    height,
    zoom: clampNumber(source.zoom, 0.05, 64, 1),
    layers,
    activeLayerId,
    selectedLayerIds: selectedLayerIds.length ? selectedLayerIds : [activeLayerId],
    background: typeof source.background === "string" ? source.background : "#ffffff",
    colorMode: source.colorMode ?? "RGB",
    bitDepth: source.bitDepth ?? 8,
    selection: {
      bounds: selectionRest.bounds ?? null,
      shape: selectionRest.shape ?? "rect",
      feather: selectionRest.feather,
      mask: selectionMask,
    },
    rotation: source.rotation ?? 0,
    guides: source.guides ?? [],
    showGrid: source.showGrid ?? false,
    showSmartGuides: source.showSmartGuides ?? true,
    gridSize: source.gridSize ?? 50,
    gridColor: source.gridColor ?? "#78b4ff",
    gridSubdivisions: source.gridSubdivisions ?? 1,
    gridOpacity: source.gridOpacity ?? 0.42,
    showPixelGrid: source.showPixelGrid ?? false,
    snap: source.snap ?? true,
    snapToGrid: source.snapToGrid ?? false,
    snapToGuides: source.snapToGuides ?? true,
    quickMask: source.quickMask ?? false,
    quickMaskCanvas,
    channels,
    slices: Array.isArray(source.slices) ? source.slices : [],
    globalLight: source.globalLight ?? { angle: 120, altitude: 30 },
  } as PsDocument
}

function flattenPsdChildren(children: PsdLayer[] | undefined, docW: number, docH: number, parentId?: string) {
  const layers: Layer[] = []
  const directIds: string[] = []
  for (const child of [...(children ?? [])].reverse()) {
    const isGroup = Array.isArray(child.children)
    if (isGroup) {
      const groupId = uid("group")
      const nested = flattenPsdChildren(child.children, docW, docH, groupId)
      layers.push(...nested.layers)
      const group: Layer = {
        id: groupId,
        name: child.name ?? "Group",
        kind: "group",
        visible: !child.hidden,
        locked: !!child.protected?.composite,
        lockTransparency: !!(child.transparencyProtected || child.protected?.transparency),
        lockDraw: !!child.protected?.composite,
        lockMove: !!child.protected?.position,
        lockAll: !!(child.protected?.composite && child.protected?.position && child.protected?.transparency),
        opacity: child.opacity ?? 1,
        blendMode: psdBlendToApp(child.blendMode),
        canvas: makeIoCanvas(docW, docH),
        childIds: nested.directIds,
        parentId,
        expanded: child.opened !== false,
        colorLabel: child.layerColor,
      }
      layers.push(group)
      directIds.push(groupId)
      continue
    }

    const layerId = uid("layer")
    const sourceCanvas = child.canvas
    const left = Math.round(child.left ?? 0)
    const top = Math.round(child.top ?? 0)
    const mask = child.mask?.canvas
      ? canvasAtDocumentSize(child.mask.canvas, docW, docH, child.mask.left ?? 0, child.mask.top ?? 0)
      : null
    const layer: Layer = {
      id: layerId,
      name: child.name ?? "Layer",
      kind: child.text ? "text" : child.vectorMask || child.vectorFill ? "shape" : "raster",
      visible: !child.hidden,
      locked: !!child.protected?.composite,
      lockTransparency: !!(child.transparencyProtected || child.protected?.transparency),
      lockDraw: !!child.protected?.composite,
      lockMove: !!child.protected?.position,
      lockAll: !!(child.protected?.composite && child.protected?.position && child.protected?.transparency),
      opacity: child.opacity ?? 1,
      blendMode: psdBlendToApp(child.blendMode),
      linkGroupId: child.linkGroup ? String(child.linkGroup) : undefined,
      canvas: canvasAtDocumentSize(sourceCanvas, docW, docH, left, top),
      mask,
      clipped: child.clipping,
      parentId,
      text: child.text
        ? {
            content: child.text.text ?? "",
            font: child.text.style?.font?.name ?? "Arial",
            size: child.text.style?.fontSize ?? 24,
            weight: child.text.style?.fauxBold ? "bold" : "normal",
            italic: !!child.text.style?.fauxItalic,
            color: colorToHex(child.text.style?.fillColor, "#000000"),
            align: child.text.paragraphStyle?.justification === "right" ? "right" : child.text.paragraphStyle?.justification === "center" ? "center" : "left",
            x: child.text.left ?? left,
            y: child.text.top ?? top,
          }
        : undefined,
      style: psdEffectsToLayerStyle(child.effects),
      colorLabel: child.layerColor,
    }
    layers.push(layer)
    directIds.push(layerId)
  }
  return { layers, directIds }
}

export async function deserializePsdFile(file: File): Promise<PsDocument> {
  assertFileSize(file, MAX_PSD_FILE_BYTES, "PSD file")
  const buffer = await file.arrayBuffer()
  validatePsdHeaderDimensions(buffer)
  const { readPsd } = await loadPsdCodec()
  const metadata = readPsd(buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: false,
  })
  const { width, height } = assertCanvasSize(Math.round(metadata.width || 1), Math.round(metadata.height || 1), "PSD canvas")
  if (countPsdLayers(metadata.children) > MAX_PROJECT_LAYERS) {
    throw new Error(`PSD contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`)
  }
  const psd = readPsd(buffer, {
    skipLayerImageData: false,
    skipCompositeImageData: false,
    skipThumbnail: true,
    useImageData: false,
  })
  const flattened = flattenPsdChildren(psd.children, width, height)
  const layers = flattened.layers.length
    ? flattened.layers
    : [{
        id: uid("layer"),
        name: "Background",
        kind: "raster" as const,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal" as const,
        canvas: canvasAtDocumentSize(psd.canvas, width, height),
      }]
  const activeLayerId = [...layers].reverse().find((layer) => layer.kind !== "group")?.id ?? layers[layers.length - 1].id
  return {
    id: uid("doc"),
    name: file.name.replace(/\.psd$/i, ""),
    width,
    height,
    zoom: 1,
    layers,
    activeLayerId,
    selectedLayerIds: [activeLayerId],
    background: "#ffffff",
    colorMode: psd.colorMode === 4 ? "CMYK" : psd.colorMode === 1 ? "Grayscale" : "RGB",
    bitDepth: (psd.bitsPerChannel === 16 || psd.bitsPerChannel === 32 ? psd.bitsPerChannel : 8) as 8 | 16 | 32,
    selection: { bounds: null, shape: "rect" },
    rotation: 0,
    guides: [],
    showGrid: false,
    showSmartGuides: true,
    gridSize: 50,
    snap: true,
    snapToGrid: false,
    snapToGuides: true,
    quickMask: false,
    quickMaskCanvas: null,
    rulerUnits: "px",
    rulerOrigin: { x: 0, y: 0 },
    gridColor: "#78b4ff",
    gridSubdivisions: 1,
    gridOpacity: 0.42,
    showPixelGrid: false,
    slices: [],
    globalLight: { angle: 120, altitude: 30 },
  }
}

function psdChildrenFromLayers(doc: PsDocument, parentId?: string): PsdLayer[] {
  const direct = doc.layers.filter((layer) => layer.parentId === parentId)
  return [...direct].reverse().map((layer): PsdLayer => {
    const protectedState = {
      transparency: !!layer.lockTransparency,
      composite: !!(layer.lockDraw || layer.lockAll || layer.locked),
      position: !!(layer.lockMove || layer.lockAll),
    }
    const base: PsdLayer = {
      name: layer.name,
      hidden: !layer.visible,
      opacity: layer.opacity,
      blendMode: appBlendToPsd(layer.kind === "group" ? "normal" : layer.blendMode),
      layerColor: (layer.colorLabel ?? "none") as LayerColor,
      transparencyProtected: !!layer.lockTransparency,
      protected: protectedState,
      clipping: !!layer.clipped,
      linkGroup: layer.linkGroupId ? Number.parseInt(layer.linkGroupId, 10) || undefined : undefined,
      effects: layerStyleToPsdEffects(layer.style),
    }
    if (layer.kind === "group") {
      return {
        ...base,
        opened: layer.expanded !== false,
        children: psdChildrenFromLayers(doc, layer.id),
      }
    }
    return {
      ...base,
      top: 0,
      left: 0,
      bottom: doc.height,
      right: doc.width,
      canvas: cloneIoCanvas(layer.canvas) ?? makeIoCanvas(doc.width, doc.height),
      mask: layer.mask
        ? {
            top: 0,
            left: 0,
            bottom: doc.height,
            right: doc.width,
            defaultColor: 0,
            canvas: cloneIoCanvas(layer.mask) ?? undefined,
          }
        : undefined,
      text: layer.text
        ? {
            text: layer.text.content,
            top: layer.text.y,
            left: layer.text.x,
            bottom: layer.text.y + layer.text.size * 1.4,
            right: layer.text.x + layer.text.content.length * layer.text.size * 0.6,
            style: {
              font: { name: layer.text.font },
              fontSize: layer.text.size,
              fillColor: parseHexColor(layer.text.color),
              fauxBold: layer.text.weight === "bold",
              fauxItalic: layer.text.italic,
            },
            paragraphStyle: { justification: layer.text.align },
          }
        : undefined,
    }
  })
}

export async function serializePsd(doc: PsDocument): Promise<Blob> {
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    channels: 4,
    bitsPerChannel: 8,
    colorMode: doc.colorMode === "CMYK" ? 4 : doc.colorMode === "Grayscale" ? 1 : 3,
    canvas: renderDocumentComposite(doc, { transparent: true }),
    children: psdChildrenFromLayers(doc),
  }
  const { writePsd } = await loadPsdCodec()
  const buffer = writePsd(psd, {
    generateThumbnail: false,
    noBackground: true,
    trimImageData: true,
  })
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  assertFileSize(file, MAX_RASTER_FILE_BYTES, "Image file")
  await assertRasterHeaderCanvasSize(file)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        assertCanvasSize(img.naturalWidth, img.naturalHeight, "Image canvas")
        resolve(img)
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not load ${file.name}`))
    }
    img.src = url
  })
}

function countPsdLayers(children: PsdLayer[] | undefined): number {
  return (children ?? []).reduce((count, child) => count + 1 + countPsdLayers(child.children), 0)
}

/* =================== File System Access API helpers =================== */

/**
 * Check if the File System Access API is available (Chrome/Edge 86+).
 * Returns false in Firefox, Safari, and non-secure contexts.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function"
}

/**
 * Show a "Save As" file picker and return a FileSystemFileHandle.
 * Returns null if the user cancels or the API is unsupported.
 */
export async function showSaveProjectPicker(suggestedName = "project.psproj"): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: "Photoshop Web Project",
          accept: { "application/json": [".psproj"] },
        },
        {
          description: "PSD File",
          accept: { "image/vnd.adobe.photoshop": [".psd"] },
        },
      ],
    })
    return handle
  } catch {
    // User cancelled or permission denied
    return null
  }
}

/**
 * Write serialized project data to an existing FileSystemFileHandle.
 * Returns true on success, false on failure.
 */
export async function saveToFileHandle(
  handle: FileSystemFileHandle,
  data: string | Blob,
): Promise<boolean> {
  try {
    const writable = await handle.createWritable()
    await writable.write(typeof data === "string" ? new Blob([data], { type: "application/json" }) : data)
    await writable.close()
    return true
  } catch {
    return false
  }
}

/**
 * Show a "Save As" picker for raster image export.
 * Returns the handle or null if cancelled.
 */
export async function showExportImagePicker(
  suggestedName: string,
  format: "png" | "jpeg" | "webp" | "avif" | "gif" = "png",
): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    gif: "image/gif",
  }
  const extMap: Record<string, string> = {
    png: ".png",
    jpeg: ".jpg",
    webp: ".webp",
    avif: ".avif",
    gif: ".gif",
  }
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: `${format.toUpperCase()} Image`,
          accept: { [mimeMap[format] ?? "image/png"]: [extMap[format] ?? ".png"] },
        },
      ],
    })
    return handle
  } catch {
    return null
  }
}
