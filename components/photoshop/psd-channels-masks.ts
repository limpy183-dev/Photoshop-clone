"use client"

/**
 * Stream 4 of the PSD round-trip work: layer masks (raster + vector),
 * saved alpha/spot channels at the document level, and clipping-group
 * validation.
 *
 * The public exports here are designed to be integrated by document-io.ts
 * without modifying that file directly. No imports from document-io.ts on
 * purpose - this module only depends on ./types and ag-psd.
 */

import type {
  AlphaChannel,
  Layer,
  PathProps,
  PsDocument,
} from "./types"
import type {
  BezierKnot,
  BezierPath,
  Layer as PsdLayer,
  LayerMaskData,
  LayerVectorMask,
  Psd,
  RGB,
} from "ag-psd"
import { makeCanvas } from "./canvas-utils"

/* ---------- Capability metadata ---------- */

export const CHANNELS_MASKS_CAPABILITY = {
  rasterMasks: "round-trip",
  maskDefaultColor: "round-trip",
  maskDisabled: "round-trip",
  maskPosition: "round-trip",
  alphaChannels: "round-trip",
  spotChannels: "round-trip-via-naming",
  layerVectorMasks: "round-trip",
  clippingMasks: "round-trip",
} as const

/**
 * Marker layer name used to round-trip saved alpha channel pixel data
 * through a vanilla ag-psd write. The group is hidden so it never paints
 * in Photoshop. Its children are one raster layer per channel, each named
 * by the channel name (or `[spot:#rrggbb:opacity]name` for spot channels).
 *
 * ag-psd cannot author native saved-alpha-channel pixel records via its
 * public `Psd` type (only `imageResources.alphaChannelNames` is exposed),
 * so we ship the pixel data in this side-channel and combine it with the
 * names on import.
 */
const ALPHA_CHANNEL_MARKER_GROUP = "__app_saved_channels__"

/* ---------- Spot channel naming convention ---------- */

export interface ParsedSpotChannelName {
  baseName: string
  spotColor?: string
  spotOpacity?: number
}

const SPOT_NAME_PATTERN = /^\[spot:(#[0-9a-fA-F]{3,8})(?::([0-9]{1,3}(?:\.[0-9]+)?))?\](.*)$/

/**
 * The naming convention for spot channels is:
 *   `[spot:#rrggbb:opacity]base name`
 *
 * - `#rrggbb` (or `#rgb`, `#rrggbbaa`) is required when the prefix is used.
 * - `opacity` is an optional percentage (0-100) defaulting to 100.
 * - `base name` is the displayed channel name.
 *
 * Names without the prefix are treated as plain alpha channels.
 */
export function parseSpotChannelName(name: string): ParsedSpotChannelName {
  const match = SPOT_NAME_PATTERN.exec(name ?? "")
  if (!match) return { baseName: name ?? "" }
  const [, color, opacity, base] = match
  const parsedOpacity =
    typeof opacity === "string" && opacity.length > 0
      ? Math.max(0, Math.min(100, Number.parseFloat(opacity)))
      : 100
  return {
    baseName: base.trim() || "Spot",
    spotColor: color.toLowerCase(),
    spotOpacity: Number.isFinite(parsedOpacity) ? parsedOpacity : 100,
  }
}

export function formatSpotChannelName(baseName: string, spotColor: string, spotOpacity = 100): string {
  const safeBase = (baseName ?? "Spot").trim() || "Spot"
  const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(spotColor) ? spotColor.toLowerCase() : "#ff00ff"
  const safeOpacity = Math.max(0, Math.min(100, Math.round(spotOpacity)))
  return `[spot:${safeColor}:${safeOpacity}]${safeBase}`
}

function alphaChannelExportName(channel: AlphaChannel): string {
  const parsed = parseSpotChannelName(channel.name)
  const color = channel.spotColor ?? parsed.spotColor
  const isSpot = channel.kind === "spot" || !!color
  if (!isSpot) return channel.name
  return formatSpotChannelName(parsed.baseName || channel.name, color ?? "#ff00ff", channel.spotOpacity ?? parsed.spotOpacity ?? 100)
}

/* ---------- Spot channel descriptor (module-local) ---------- */

/**
 * Lightweight representation of a spot channel during export. ag-psd does
 * not expose a `SpotChannel` shape on `Psd`, so this is used internally
 * and surfaced to the integrator via {@link appAlphaChannelsToPsd}.
 */
export interface SpotChannel {
  name: string
  color: RGB
  opacity: number
  canvas: HTMLCanvasElement | null
}

/* ---------- Internal canvas helpers ---------- */

function readMaskImageData(canvas: HTMLCanvasElement): ImageData | null {
  if (!canvas || typeof canvas.getContext !== "function") return null
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Luminance of a pixel in 0..255, ignoring alpha. */
function luminanceAt(image: ImageData, x: number, y: number): number {
  const w = image.width
  const i = (y * w + x) * 4
  return (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3
}

/**
 * Sample the four corners of the mask to decide the PSD `defaultColor`
 * field (0 = black bordered, 255 = white bordered). Photoshop uses this
 * single byte to fill the area outside the stored mask rectangle.
 */
function sampleCornerLuminance(image: ImageData): number {
  if (image.width === 0 || image.height === 0) return 255
  const corners = [
    luminanceAt(image, 0, 0),
    luminanceAt(image, image.width - 1, 0),
    luminanceAt(image, 0, image.height - 1),
    luminanceAt(image, image.width - 1, image.height - 1),
  ]
  const avg = corners.reduce((sum, v) => sum + v, 0) / corners.length
  return avg >= 128 ? 255 : 0
}

/**
 * Tightest bounding box of pixels that differ from the `defaultColor` by
 * more than a small threshold. Returns null when the mask is essentially
 * uniform (in which case the caller can skip storing pixel data and rely
 * on `defaultColor` alone).
 */
function computeMaskBounds(image: ImageData, defaultColor: number) {
  const w = image.width
  const h = image.height
  if (w === 0 || h === 0) return null
  const threshold = 6
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.abs(luminanceAt(image, x, y) - defaultColor) > threshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 }
}

function cropCanvasToBounds(
  source: HTMLCanvasElement,
  bounds: { left: number; top: number; right: number; bottom: number },
) {
  const width = Math.max(1, bounds.right - bounds.left)
  const height = Math.max(1, bounds.bottom - bounds.top)
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(
    source,
    bounds.left,
    bounds.top,
    width,
    height,
    0,
    0,
    width,
    height,
  )
  return canvas
}

/* ---------- Raster layer mask: app -> native writer ---------- */

export interface NativeMaskPlaneInput {
  top: number
  left: number
  bottom: number
  right: number
  defaultColor: number
  disabled: boolean
  /** 8-bit luminance plane covering the rect, row-major. Empty for uniform masks. */
  data: Uint8Array
}

/**
 * Convert a layer's raster mask into the plane payload consumed by the
 * native (high-bit / non-RGB) PSD writer: absolute rect, default color,
 * and an 8-bit luminance plane trimmed to the non-uniform region.
 */
export function appLayerMaskToNativeMaskInput(layer: Layer): NativeMaskPlaneInput | undefined {
  const mask = layer.mask
  if (!mask || typeof mask.getContext !== "function") return undefined
  const image = readMaskImageData(mask)
  if (!image) return undefined

  const defaultColor = sampleCornerLuminance(image)
  const disabled = layer.maskEnabled === false
  const bounds = computeMaskBounds(image, defaultColor)
  if (!bounds) {
    // Uniform mask; the writer emits a zero-size rect and lets
    // `defaultColor` carry the meaning.
    return { top: 0, left: 0, bottom: 0, right: 0, defaultColor, disabled, data: new Uint8Array() }
  }

  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(luminanceAt(image, bounds.left + x, bounds.top + y))))
    }
  }
  return { top: bounds.top, left: bounds.left, bottom: bounds.bottom, right: bounds.right, defaultColor, disabled, data }
}

/* ---------- Raster layer mask: app -> PSD ---------- */

export function appLayerMaskToPsd(
  layer: Layer,
  _docW: number,
  _docH: number,
): NonNullable<PsdLayer["mask"]> | undefined {
  void _docW
  void _docH
  const mask = layer.mask
  if (!mask || typeof mask.getContext !== "function") return undefined
  const image = readMaskImageData(mask)
  if (!image) return undefined

  const defaultColor = sampleCornerLuminance(image)
  const bounds = computeMaskBounds(image, defaultColor)

  const data: LayerMaskData = {
    defaultColor,
    disabled: layer.maskEnabled === false,
    positionRelativeToLayer: false,
  }

  if (!bounds) {
    // Entire mask is uniform; let `defaultColor` carry the meaning.
    data.top = 0
    data.left = 0
    data.bottom = 0
    data.right = 0
    return data
  }

  const cropped = cropCanvasToBounds(mask, bounds)
  data.top = bounds.top
  data.left = bounds.left
  data.bottom = bounds.bottom
  data.right = bounds.right
  data.canvas = cropped
  return data
}

/* ---------- Raster layer mask: PSD -> app ---------- */

export function psdLayerMaskToApp(
  psdMask: NonNullable<PsdLayer["mask"]>,
  docW: number,
  docH: number,
): { mask: HTMLCanvasElement; maskEnabled: boolean } | null {
  const fill = `rgb(${psdMask.defaultColor ?? 255},${psdMask.defaultColor ?? 255},${psdMask.defaultColor ?? 255})`
  const canvas = makeCanvas(docW, docH, fill)
  if (psdMask.canvas) {
    const ctx = canvas.getContext("2d")!
    const left = psdMask.left ?? 0
    const top = psdMask.top ?? 0
    if (left < 0 || top < 0) {
      const srcX = left < 0 ? -left : 0
      const srcY = top < 0 ? -top : 0
      const dstX = left < 0 ? 0 : left
      const dstY = top < 0 ? 0 : top
      const w = Math.max(0, Math.min(psdMask.canvas.width - srcX, docW - dstX))
      const h = Math.max(0, Math.min(psdMask.canvas.height - srcY, docH - dstY))
      if (w > 0 && h > 0) {
        ctx.drawImage(psdMask.canvas, srcX, srcY, w, h, dstX, dstY, w, h)
      }
    } else {
      ctx.drawImage(psdMask.canvas, left, top)
    }
  }
  return {
    mask: canvas,
    maskEnabled: psdMask.disabled !== true,
  }
}

/* ---------- Hex / RGB conversions ---------- */

function parseHexToRgb(hex: string): RGB {
  const clean = (hex ?? "").replace("#", "").trim()
  const expanded =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6)
  const num = parseInt(expanded, 16)
  if (!Number.isFinite(num)) return { r: 255, g: 0, b: 255 }
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  }
}

/* ---------- Saved alpha channels at document level ---------- */

/**
 * Per-channel display metadata. ag-psd's public `ImageResources` type
 * does not expose `displayInfo`, so this is a module-local shape used
 * to surface spot-color metadata to integrators and tests.
 */
export interface ChannelDisplayInfo {
  name: string
  color: RGB
  opacity: number
  /** Photoshop's "Color Indicates" - "spot" or "alpha". */
  kind: "alpha" | "spot"
}

/**
 * Convert the document's `channels` array into the structures ag-psd
 * understands:
 *
 * - `channels`: kept as `undefined` (ag-psd's `Psd.channels` is a count,
 *   not a data array; saved-alpha pixel data is not directly writable
 *   through the public API).
 * - `channelNames`: written to `imageResources.alphaChannelNames` so
 *   Photoshop knows the names of the saved channels.
 * - `displayInfo`: returned as a module-local array since ag-psd's
 *   public `ImageResources` type does not surface a `displayInfo` field.
 *   Integrators can use this to populate a side-channel image resource
 *   entry or document report.
 *
 * The integrator should additionally call {@link appAlphaChannelsToMarkerLayers}
 * to obtain a hidden marker group preserving the channel pixels through
 * round-trip.
 */
export function appAlphaChannelsToPsd(doc: PsDocument): {
  channels: NonNullable<Psd["channels"]> | undefined
  channelNames: string[]
  displayInfo: ChannelDisplayInfo[] | undefined
} {
  const channels = doc.channels ?? []
  if (!channels.length) {
    return { channels: undefined, channelNames: [], displayInfo: undefined }
  }
  const displayInfo: ChannelDisplayInfo[] = channels.map((channel) => {
    const parsed = parseSpotChannelName(channel.name)
    const color = channel.spotColor ?? parsed.spotColor
    if (channel.kind === "spot" || color) {
      return {
        name: parsed.baseName,
        color: parseHexToRgb(color ?? "#ff00ff"),
        opacity: channel.spotOpacity ?? parsed.spotOpacity ?? 100,
        kind: "spot",
      }
    }
    return {
      name: channel.name,
      color: { r: 255, g: 0, b: 0 },
      opacity: 50,
      kind: "alpha",
    }
  })
  return {
    // ag-psd `Psd.channels` is the *channel count* (RGB+A = 4 etc), not
    // pixel records. We don't override the document channel count here.
    channels: undefined,
    channelNames: channels.map(alphaChannelExportName),
    displayInfo,
  }
}

/**
 * Generate a hidden marker group of PSD layers that carries saved alpha
 * channel pixel data through a vanilla ag-psd round-trip. Each child
 * raster layer's name encodes the channel name (and, for spot channels,
 * the color/opacity via {@link formatSpotChannelName}).
 *
 * The integrator should prepend the returned group to `psd.children`.
 */
export function appAlphaChannelsToMarkerLayers(
  doc: PsDocument,
): PsdLayer | null {
  const channels = doc.channels ?? []
  if (!channels.length) return null
  const children: PsdLayer[] = []
  for (const channel of channels) {
    if (!channel.canvas || typeof channel.canvas.getContext !== "function") continue
    const clone = makeCanvas(channel.canvas.width, channel.canvas.height)
    clone.getContext("2d")!.drawImage(channel.canvas, 0, 0)
    const layer: PsdLayer = {
      name: alphaChannelExportName(channel),
      hidden: true,
      opacity: 0,
      blendMode: "normal",
      top: 0,
      left: 0,
      bottom: channel.canvas.height,
      right: channel.canvas.width,
      canvas: clone,
    }
    children.push(layer)
  }
  if (!children.length) return null
  return {
    name: ALPHA_CHANNEL_MARKER_GROUP,
    hidden: true,
    opened: false,
    opacity: 0,
    blendMode: "normal" as const,
    children,
  }
}

/**
 * True for top-level children that look like the marker group emitted by
 * {@link appAlphaChannelsToMarkerLayers}. Integrators use this to filter
 * out the marker group when building the app layer tree.
 */
export function isAlphaChannelMarkerLayer(layer: PsdLayer): boolean {
  return layer?.name === ALPHA_CHANNEL_MARKER_GROUP && Array.isArray(layer.children)
}

export async function psdAlphaChannelsToApp(
  psd: Psd,
  docW: number,
  docH: number,
): Promise<AlphaChannel[]> {
  const names = psd.imageResources?.alphaChannelNames ?? []
  const markerGroup = (psd.children ?? []).find((layer) => isAlphaChannelMarkerLayer(layer))

  const channels: AlphaChannel[] = []
  const usedNames = new Set<string>()

  if (markerGroup?.children) {
    for (let i = 0; i < markerGroup.children.length; i++) {
      const child = markerGroup.children[i]
      const name = child.name ?? names[i] ?? `Alpha ${i + 1}`
      const parsed = parseSpotChannelName(name)
      const canvas = await markerChildToCanvas(child, docW, docH)
      channels.push({
        id: `channel_${Math.random().toString(36).slice(2, 9)}`,
        name,
        canvas,
        kind: parsed.spotColor ? "spot" : "alpha",
        spotColor: parsed.spotColor,
        spotOpacity: parsed.spotOpacity,
      })
      usedNames.add(name)
    }
  }

  // Add any name from `alphaChannelNames` not already covered by the
  // marker group as an empty (all-black) placeholder canvas.
  for (const name of names) {
    if (usedNames.has(name)) continue
    const parsed = parseSpotChannelName(name)
    channels.push({
      id: `channel_${Math.random().toString(36).slice(2, 9)}`,
      name,
      canvas: makeCanvas(docW, docH, "#000000"),
      kind: parsed.spotColor ? "spot" : "alpha",
      spotColor: parsed.spotColor,
      spotOpacity: parsed.spotOpacity,
    })
  }

  return channels
}

async function markerChildToCanvas(
  child: PsdLayer,
  docW: number,
  docH: number,
): Promise<HTMLCanvasElement> {
  const canvas = makeCanvas(docW, docH, "#000000")
  if (child.canvas && typeof child.canvas.getContext === "function") {
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(child.canvas, 0, 0)
    return canvas
  }
  if (child.imageData && typeof ImageData !== "undefined") {
    try {
      const pixels = new ImageData(
        new Uint8ClampedArray(child.imageData.data as unknown as ArrayLike<number>),
        child.imageData.width,
        child.imageData.height,
      )
      const temp = makeCanvas(pixels.width, pixels.height)
      temp.getContext("2d")!.putImageData(pixels, 0, 0)
      canvas.getContext("2d")!.drawImage(temp, 0, 0)
      return canvas
    } catch {
      /* fall through to empty canvas */
    }
  }
  return canvas
}

/* ---------- Spot channels (via naming convention) ---------- */

export function appSpotChannelToPsd(
  channel: AlphaChannel & { spotColor?: string; spotOpacity?: number },
): SpotChannel | null {
  const parsed = parseSpotChannelName(channel.name)
  const color =
    channel.spotColor ?? parsed.spotColor ?? null
  if (!color) return null
  const opacity = channel.spotOpacity ?? parsed.spotOpacity ?? 100
  const baseName = parsed.baseName || channel.name
  return {
    name: formatSpotChannelName(baseName, color, opacity),
    color: parseHexToRgb(color),
    opacity: Math.max(0, Math.min(100, opacity)),
    canvas: channel.canvas ?? null,
  }
}

/* ---------- Vector mask on a layer ---------- */

/**
 * Translate the app's per-layer {@link PathProps} into an ag-psd
 * {@link LayerVectorMask}. Coordinates in `PathProps` are absolute
 * document pixels; ag-psd stores them as document-pixel knot triples
 * `[x0,y0,x1,y1,x2,y2]` where `(x1,y1)` is the anchor and
 * `(x0,y0)`/`(x2,y2)` are the incoming/outgoing control points.
 */
export function appVectorMaskOnLayerToPsd(
  vectorMask: PathProps,
  _docW: number,
  _docH: number,
): NonNullable<PsdLayer["vectorMask"]> {
  void _docW
  void _docH
  const points = vectorMask.points ?? []
  const knots: BezierKnot[] = points.map((point) => {
    const cp1 = point.cp1 ?? { x: point.x, y: point.y }
    const cp2 = point.cp2 ?? { x: point.x, y: point.y }
    const linked =
      cp1.x === cp2.x && cp1.y === cp2.y
        ? true
        : Math.abs(cp1.x - point.x) === Math.abs(cp2.x - point.x) &&
          Math.abs(cp1.y - point.y) === Math.abs(cp2.y - point.y)
    return {
      linked,
      points: [cp1.x, cp1.y, point.x, point.y, cp2.x, cp2.y],
    }
  })
  const path: BezierPath = {
    open: !vectorMask.closed,
    knots,
    fillRule: "even-odd",
  }
  const mask: LayerVectorMask = {
    invert: false,
    notLink: false,
    disable: false,
    paths: [path],
  }
  return mask
}

export function psdVectorMaskOnLayerToApp(
  psdVectorMask: NonNullable<PsdLayer["vectorMask"]>,
): PathProps {
  const firstPath = psdVectorMask.paths?.[0]
  if (!firstPath) return { points: [], closed: true }
  const knots = firstPath.knots ?? []
  return {
    closed: !firstPath.open,
    points: knots.map((knot) => {
      const [cp1x, cp1y, ax, ay, cp2x, cp2y] = knot.points
      const anchor = { x: ax, y: ay }
      const cp1 = { x: cp1x, y: cp1y }
      const cp2 = { x: cp2x, y: cp2y }
      const hasCp1 = cp1.x !== anchor.x || cp1.y !== anchor.y
      const hasCp2 = cp2.x !== anchor.x || cp2.y !== anchor.y
      return {
        x: anchor.x,
        y: anchor.y,
        cp1: hasCp1 ? cp1 : undefined,
        cp2: hasCp2 ? cp2 : undefined,
      }
    }),
  }
}

/* ---------- Clipping masks ---------- */

export function appClippingToPsd(layer: Layer): { clipping: boolean } {
  return { clipping: !!layer.clipped }
}

export function validateClippingGroup(layers: Layer[]): { warnings: string[] } {
  const warnings: string[] = []
  // Index layers by parent to evaluate orphan clipping within each group.
  const byParent = new Map<string | undefined, Layer[]>()
  for (const layer of layers) {
    const key = layer.parentId
    const arr = byParent.get(key)
    if (arr) arr.push(layer)
    else byParent.set(key, [layer])
  }
  for (const siblings of byParent.values()) {
    for (let i = 0; i < siblings.length; i++) {
      const layer = siblings[i]
      if (!layer.clipped) continue
      // Walk previous siblings (in array order, which mirrors the doc
      // layers array) looking for a non-clipped base layer.
      let base: Layer | null = null
      for (let j = i - 1; j >= 0; j--) {
        if (!siblings[j].clipped) {
          base = siblings[j]
          break
        }
      }
      if (!base) {
        warnings.push(
          `Layer "${layer.name}" is clipped but has no base layer beneath it`,
        )
        continue
      }
      if (base.kind === "group") {
        warnings.push(
          `Layer "${layer.name}" is clipped to a group ("${base.name}"); Photoshop clips to raster bases only`,
        )
      }
    }
  }
  return { warnings }
}
