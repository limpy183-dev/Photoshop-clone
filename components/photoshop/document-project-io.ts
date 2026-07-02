"use client"

import {
MAX_PROJECT_CHANNELS,
MAX_PROJECT_DATA_URL_CHARS,
MAX_PROJECT_LAYERS,
MAX_PROJECT_SMART_FILTERS_PER_LAYER,
assertCanvasSize
} from "./canvas-limits"
import {
sniffRasterDimensions
} from "./document-import-sniffers"
import { makeIoCanvas } from "./document-rendering"
import {
deserializeHighBitImagePayload,
serializeHighBitImagePayload,
type HighBitDocument,
type HighBitLayer
} from "./high-bit-document"
import {
PROJECT_PAYLOAD_LIMITS,
SAFE_JSON_DEFAULT_LIMITS,
createProjectSanitizationReport,
safeJsonArray,
safeJsonObject,
type ProjectSanitizationDiagnostics,
} from "./project-json-sanitizer"
import type {
AlphaChannel,
DocumentMetadata,
DocumentModeSettings,
Guide,
Layer,
PsDocument,
Selection,
SmartFilter
} from "./types"
import { uid } from "./uid"

import { SAFE_CANVAS_DATA_URL,clampNumber,cleanBlendMode,cleanLayerKind,cleanText } from "./document-io-shared"
import {
cleanCssColor,
cleanOptionalCssColor,
dataUrlToBytes,
isAllowedEnum,
} from "./document-raster-export"
const ALLOWED_COLOR_MODES = new Set<DocumentModeSettings["mode"]>([
  "RGB", "CMYK", "Grayscale", "Indexed", "Bitmap", "Multichannel", "Duotone",
])
const ALLOWED_RULER_UNITS = new Set<NonNullable<PsDocument["rulerUnits"]>>([
  "px", "in", "cm", "mm", "pt", "pc",
])


function cleanGlobalLight(value: unknown): { angle: number; altitude: number } {
  const fallback = { angle: 120, altitude: 30 }
  if (!value || typeof value !== "object") return fallback
  const v = value as Record<string, unknown>
  const angle = typeof v.angle === "number" && Number.isFinite(v.angle) ? v.angle : fallback.angle
  const altitude =
    typeof v.altitude === "number" && Number.isFinite(v.altitude) ? v.altitude : fallback.altitude
  return {
    angle: Math.max(-360, Math.min(360, angle)),
    altitude: Math.max(-90, Math.min(90, altitude)),
  }
}

function cleanMeasurement(value: unknown): PsDocument["measurement"] {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const num = (k: string) =>
    typeof v[k] === "number" && Number.isFinite(v[k] as number) ? (v[k] as number) : null
  const x1 = num("x1"); const y1 = num("y1")
  const x2 = num("x2"); const y2 = num("y2")
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null
  return { x1, y1, x2, y2 }
}

function cleanRulerOrigin(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.x !== "number" || !Number.isFinite(v.x)) return undefined
  if (typeof v.y !== "number" || !Number.isFinite(v.y)) return undefined
  return { x: v.x, y: v.y }
}

function cleanGuides(value: unknown): Guide[] {
  if (!Array.isArray(value)) return []
  const out: Guide[] = []
  for (const item of value.slice(0, 1024)) {
    if (!item || typeof item !== "object") continue
    const g = item as Record<string, unknown>
    const orientation = g.orientation === "vertical" ? "vertical" : "horizontal"
    if (typeof g.position !== "number" || !Number.isFinite(g.position)) continue
    out.push({
      id: cleanText(g.id, uid("guide"), 80),
      orientation,
      position: g.position,
      color: cleanOptionalCssColor(g.color),
    })
  }
  return out
}

function cleanSmartObjectParent(value: unknown): PsDocument["smartObjectParent"] {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  const docId = cleanText(v.docId, "", 120)
  const layerId = cleanText(v.layerId, "", 120)
  if (!docId || !layerId) return undefined
  return { docId, layerId }
}

function canvasDataUrl(canvas?: HTMLCanvasElement | null) {
  if (!canvas || typeof canvas.toDataURL !== "function") return null
  return canvas.toDataURL("image/png")
}

export interface ProjectSerializationOptions {
  pretty?: boolean
}

export interface ProjectSerializationManifest {
  format: "psprojson"
  version: 2
  documentId: string
  documentName: string
  width: number
  height: number
  layerCount: number
  channelCount: number
  inlineCanvasDataUrls: number
  inlineCanvasBytesEstimate: number
  highBitPayloads: number
  jsonBytes: number
  blockingRisk: "low" | "medium" | "high"
  recommendations: string[]
}

function serializeSelection(selection: Selection) {
  const { mask, ...rest } = selection
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

function serializeChannel(channel: AlphaChannel) {
  return {
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    spotColor: channel.spotColor,
    spotOpacity: channel.spotOpacity,
    canvasDataUrl: canvasDataUrl(channel.canvas),
  }
}

function serializeSmartFilter(filter: SmartFilter) {
  const { mask, ...rest } = filter
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

function serializeLayer(layer: Layer) {
  const { canvas, mask, frame, smartFilters, smartSource, ...rest } = layer
  const serializedSmartSource = smartSource
    ? (() => {
        const { canvas: sourceCanvas, fileHandle: _fileHandle, ...sourceRest } = smartSource
        return {
          ...sourceRest,
          canvasDataUrl: canvasDataUrl(sourceCanvas),
          canvas: undefined,
        }
      })()
    : undefined
  return {
    ...rest,
    highBitImageData: serializeHighBitImagePayload((layer as HighBitLayer).__highBitImageData),
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
    smartSource: serializedSmartSource,
  }
}

function projectEnvelope(doc: PsDocument) {
  const { layers, channels, selection, quickMaskCanvas, ...rest } = doc
  return {
    app: "Photoshop Web",
    format: "psprojson",
    version: 2,
    savedAt: new Date().toISOString(),
    savedWith: {
      supports: ["adjustment-layers", "smart-filters", "asset-library", "export-presets", "layer-comps", "timeline", "video-layers", "3d-scenes", "plugins", "variable-data", "advanced-formats", "annotations", "guides", "slices", "round-trip-reports", "metadata", "color-management", "print-settings"],
    },
    document: {
      ...rest,
      highBitImageData: serializeHighBitImagePayload((doc as HighBitDocument).__highBitImageData),
      selection: serializeSelection(selection),
      quickMaskCanvasDataUrl: canvasDataUrl(quickMaskCanvas),
      layers: layers.map(serializeLayer),
      channels: (channels ?? []).map(serializeChannel),
    },
  }
}

export function serializeProject(doc: PsDocument, options: ProjectSerializationOptions = {}) {
  return JSON.stringify(projectEnvelope(doc), null, options.pretty === false ? 0 : 2)
}

export function serializeProjectCompact(doc: PsDocument) {
  return serializeProject(doc, { pretty: false })
}

function encodedByteEstimate(dataUrl: string) {
  const comma = dataUrl.indexOf(",")
  const encoded = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  return Math.floor((encoded.length * 3) / 4)
}

export function createProjectSerializationManifest(doc: PsDocument, serialized = serializeProjectCompact(doc)): ProjectSerializationManifest {
  const canvasDataUrls = serialized.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/g) ?? []
  const highBitPayloads = (serialized.match(/"highBitImageData"\s*:/g) ?? []).length
  const jsonBytes = new TextEncoder().encode(serialized).byteLength
  const inlineCanvasBytesEstimate = canvasDataUrls.reduce((sum, dataUrl) => sum + encodedByteEstimate(dataUrl), 0)
  const recommendations: string[] = []
  if (canvasDataUrls.length) {
    recommendations.push("Canvas payloads are embedded as PNG data URLs; prefer ZIP/package storage or worker serialization for large documents.")
  }
  if (inlineCanvasBytesEstimate > 10 * 1024 * 1024) {
    recommendations.push("Inline canvas payloads exceed 10 MB; save and autosave should run outside the interactive path.")
  }
  if (highBitPayloads) {
    recommendations.push("High-bit typed-array payloads are preserved separately from 8-bit preview canvases.")
  }
  const blockingRisk: ProjectSerializationManifest["blockingRisk"] =
    jsonBytes > 25 * 1024 * 1024 || inlineCanvasBytesEstimate > 20 * 1024 * 1024
      ? "high"
      : jsonBytes > 5 * 1024 * 1024 || inlineCanvasBytesEstimate > 4 * 1024 * 1024
        ? "medium"
        : "low"
  return {
    format: "psprojson",
    version: 2,
    documentId: doc.id,
    documentName: doc.name,
    width: doc.width,
    height: doc.height,
    layerCount: doc.layers.length,
    channelCount: doc.channels?.length ?? 0,
    inlineCanvasDataUrls: canvasDataUrls.length,
    inlineCanvasBytesEstimate,
    highBitPayloads,
    jsonBytes,
    blockingRisk,
    recommendations,
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

function bytesFromProjectDataUrl(dataUrl: string) {
  try {
    return dataUrlToBytes(dataUrl)
  } catch {
    throw new Error("Project contains malformed canvas image data")
  }
}

function preflightProjectCanvasDataUrl(dataUrl: string) {
  const bytes = bytesFromProjectDataUrl(dataUrl)
  const dimensions = sniffRasterDimensions(bytes)
  if (!dimensions) {
    throw new Error("Project contains unsupported or malformed canvas image data")
  }
  return assertCanvasSize(dimensions.width, dimensions.height, "Project image")
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
    let preflightSize: { width: number; height: number }
    try {
      preflightSize = preflightProjectCanvasDataUrl(dataUrl)
    } catch (error) {
      reject(error)
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        const size = assertCanvasSize(
          img.naturalWidth || preflightSize.width || w,
          img.naturalHeight || preflightSize.height || h,
          "Project image",
        )
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
  const { canvasDataUrl, maskDataUrl, frame, smartFilters, smartSource, highBitImageData, ...rest } = serialized
  const canvas = await canvasFromDataUrl(canvasDataUrl as string | undefined, docW, docH)
  const mask = maskDataUrl ? await canvasFromDataUrl(maskDataUrl as string, docW, docH) : null
  const restoredFrame = frame
    ? {
        ...(frame as Record<string, unknown>),
        imageCanvas: (frame as Record<string, unknown>).imageDataUrl ? await canvasFromDataUrl((frame as Record<string, unknown>).imageDataUrl as string, docW, docH) : null,
        imageDataUrl: undefined,
      }
    : undefined
  if (Array.isArray(smartFilters) && smartFilters.length > MAX_PROJECT_SMART_FILTERS_PER_LAYER) {
    throw new Error(`Project layer contains too many smart filters. Maximum supported: ${MAX_PROJECT_SMART_FILTERS_PER_LAYER}.`)
  }
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
  const layer = {
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
  const highBit = deserializeHighBitImagePayload(highBitImageData)
  if (highBit && highBit.width === layer.canvas.width && highBit.height === layer.canvas.height) {
    ;(layer as HighBitLayer).__highBitImageData = highBit
  }
  return layer
}

/**
 * Map `items` through an async `mapper` in sequential batches of
 * `batchSize`, preserving input order. Bounds the number of concurrent
 * image decodes a hostile project file can trigger at once.
 */
async function mapInBatches<T, R>(items: T[], batchSize: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    out.push(...(await Promise.all(items.slice(i, i + batchSize).map(mapper))))
  }
  return out
}

export async function deserializeProject(text: string): Promise<PsDocument> {
  const parsed = parseProjectEnvelope(text)
  const sourceCandidate = (parsed && typeof parsed === "object" && parsed.document) ?? parsed
  if (!sourceCandidate || typeof sourceCandidate !== "object" || Array.isArray(sourceCandidate)) {
    throw new Error("Project payload is not an object")
  }
  const source = sourceCandidate as Record<string, unknown>
  const { width, height } = assertCanvasSize(
    Number(source.width) || 1200,
    Number(source.height) || 800,
    "Project canvas",
  )
  const sanitizationDiagnostics: ProjectSanitizationDiagnostics = { truncatedFields: [] }
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    throw new Error("Project does not contain any layers")
  }
  if (source.layers.length > MAX_PROJECT_LAYERS) {
    throw new Error(`Project contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`)
  }

  const layers = await mapInBatches(
    source.layers as Record<string, unknown>[],
    4,
    (l) => deserializeLayer(l, width, height),
  )
  const channelEntries = Array.isArray(source.channels) ? (source.channels as Record<string, unknown>[]) : []
  if (channelEntries.length > MAX_PROJECT_CHANNELS) {
    throw new Error(`Project contains too many alpha channels. Maximum supported channels: ${MAX_PROJECT_CHANNELS}.`)
  }
  const channels = await mapInBatches(channelEntries, 4, async (ch) => ({
    id: cleanText(ch.id, uid("channel"), 80),
    name: cleanText(ch.name, "Alpha"),
    kind: ch.kind === "spot" ? "spot" as const : "alpha" as const,
    spotColor: typeof ch.spotColor === "string" ? cleanText(ch.spotColor, "#ff00ff", 20) : undefined,
    spotOpacity: typeof ch.spotOpacity === "number" ? Math.max(0, Math.min(100, ch.spotOpacity)) : undefined,
    canvas: await canvasFromDataUrl(ch.canvasDataUrl as string | undefined, width, height),
  }))

  const rawSelection =
    source.selection && typeof source.selection === "object" && !Array.isArray(source.selection)
      ? (source.selection as Record<string, unknown>)
      : { bounds: null, shape: "rect" }
  const selectionMaskRaw = (rawSelection as Record<string, unknown>).maskDataUrl
  const selectionMask =
    typeof selectionMaskRaw === "string"
      ? await canvasFromDataUrl(selectionMaskRaw, width, height)
      : null
  const quickMaskCanvas =
    typeof source.quickMaskCanvasDataUrl === "string"
      ? await canvasFromDataUrl(source.quickMaskCanvasDataUrl as string, width, height)
      : null

  const activeLayerId =
    typeof source.activeLayerId === "string" && layers.some((l) => l.id === source.activeLayerId)
      ? (source.activeLayerId as string)
      : layers[layers.length - 1].id
  const selectedLayerIds = Array.isArray(source.selectedLayerIds)
    ? (source.selectedLayerIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && layers.some((l) => l.id === id),
      )
    : [activeLayerId]

  // The selection bounds shape is constrained to a small rect literal; we
  // reject anything else so a malicious project file cannot ship selection
  // coordinates with non-numeric keys that other code paths would later
  // multiply / add into Math.NaN cascades.
  const selectionBoundsRaw = (rawSelection as Record<string, unknown>).bounds
  let selectionBounds: PsDocument["selection"]["bounds"] = null
  if (selectionBoundsRaw && typeof selectionBoundsRaw === "object" && !Array.isArray(selectionBoundsRaw)) {
    const b = selectionBoundsRaw as Record<string, unknown>
    if (
      typeof b.x === "number" && Number.isFinite(b.x) &&
      typeof b.y === "number" && Number.isFinite(b.y) &&
      typeof b.w === "number" && Number.isFinite(b.w) &&
      typeof b.h === "number" && Number.isFinite(b.h)
    ) {
      selectionBounds = { x: b.x, y: b.y, w: b.w, h: b.h }
    }
  }
  const ALLOWED_SELECTION_SHAPES = new Set<Selection["shape"]>([
    "rect", "ellipse", "polygon", "freehand", "wand", "color",
  ])
  const selectionShape: Selection["shape"] = isAllowedEnum(
    (rawSelection as Record<string, unknown>).shape,
    ALLOWED_SELECTION_SHAPES,
  )
    ? ((rawSelection as Record<string, unknown>).shape as Selection["shape"])
    : "rect"
  const selectionFeatherRaw = (rawSelection as Record<string, unknown>).feather
  const selectionFeather =
    typeof selectionFeatherRaw === "number" && Number.isFinite(selectionFeatherRaw)
      ? Math.max(0, Math.min(250, selectionFeatherRaw))
      : undefined

  // Resolve the bit-depth as an 8/16/32 union, accepting both numeric and
  // string inputs because older project files serialised the depth as a
  // string. Anything else falls back to 8.
  const rawBitDepth = source.bitDepth
  let bitDepth: PsDocument["bitDepth"] = 8
  if (rawBitDepth === 16 || rawBitDepth === "16") bitDepth = 16
  else if (rawBitDepth === 32 || rawBitDepth === "32") bitDepth = 32
  const documentHighBit = deserializeHighBitImagePayload(source.highBitImageData)
  const validatedDocumentHighBit = documentHighBit && documentHighBit.width === width && documentHighBit.height === height
    ? documentHighBit
    : undefined
  const documentName = cleanText(source.name, "Loaded Project")

  // Construct the result via an explicit allow-list. Every field is either
  // typed-and-validated (the dangerous ones — colors, anything that can
  // hit a CSS sink) or shape-bounded via safeJsonValue (non-DOM metadata
  // like notes, slices, asset libraries, etc.).
  const doc = {
    id: uid("doc"),
    name: documentName,
    width,
    height,
    zoom: clampNumber(source.zoom, 0.05, 64, 1),
    layers,
    activeLayerId,
    selectedLayerIds: selectedLayerIds.length ? selectedLayerIds : [activeLayerId],
    background: cleanCssColor(source.background, "#ffffff"),
    colorMode: isAllowedEnum(source.colorMode, ALLOWED_COLOR_MODES)
      ? source.colorMode
      : "RGB",
    bitDepth,
    ...(validatedDocumentHighBit ? { __highBitImageData: validatedDocumentHighBit } : {}),
    selection: {
      bounds: selectionBounds,
      shape: selectionShape,
      feather: selectionFeather,
      mask: selectionMask,
    },
    rotation: (() => {
      const r = source.rotation
      return r === 0 || r === 90 || r === 180 || r === 270 ? r : 0
    })(),
    guides: cleanGuides(source.guides),
    showGrid: source.showGrid === true,
    showSmartGuides: source.showSmartGuides !== false,
    gridSize: clampNumber(source.gridSize, 1, 10000, 50),
    gridColor: cleanCssColor(source.gridColor, "#78b4ff"),
    gridSubdivisions: clampNumber(source.gridSubdivisions, 1, 64, 1),
    gridOpacity: clampNumber(source.gridOpacity, 0, 1, 0.42),
    showPixelGrid: source.showPixelGrid === true,
    snap: source.snap !== false,
    snapToGrid: source.snapToGrid === true,
    snapToGuides: source.snapToGuides !== false,
    quickMask: source.quickMask === true,
    quickMaskCanvas,
    channels,

    // Pure-data passthroughs: these fields never reach a CSS sink directly
    // (notes/comps/counts render text content via React, which escapes;
    // asset libraries/timeline frames are normalised again at use sites).
    // safeJsonValue drops __proto__/constructor/prototype keys, bounds
    // string/array/object size, and rejects non-finite numbers.
    notes: safeJsonArray<NonNullable<PsDocument["notes"]>[number]>(source.notes, SAFE_JSON_DEFAULT_LIMITS, "notes", sanitizationDiagnostics),
    slices: safeJsonArray<NonNullable<PsDocument["slices"]>[number]>(source.slices, SAFE_JSON_DEFAULT_LIMITS, "slices", sanitizationDiagnostics) ?? [],
    selectedSliceId: typeof source.selectedSliceId === "string"
      ? cleanText(source.selectedSliceId, "", 120) || undefined
      : undefined,
    counts: safeJsonArray<NonNullable<PsDocument["counts"]>[number]>(source.counts, SAFE_JSON_DEFAULT_LIMITS, "counts", sanitizationDiagnostics),
    countGroup: typeof source.countGroup === "string"
      ? cleanText(source.countGroup, "", 80) || undefined
      : undefined,
    colorSamplers: safeJsonArray<NonNullable<PsDocument["colorSamplers"]>[number]>(source.colorSamplers, SAFE_JSON_DEFAULT_LIMITS, "colorSamplers", sanitizationDiagnostics),
    comps: safeJsonArray<NonNullable<PsDocument["comps"]>[number]>(source.comps, PROJECT_PAYLOAD_LIMITS, "comps", sanitizationDiagnostics),
    measurement: cleanMeasurement(source.measurement),
    rulerUnits: isAllowedEnum(source.rulerUnits, ALLOWED_RULER_UNITS)
      ? source.rulerUnits
      : undefined,
    rulerOrigin: cleanRulerOrigin(source.rulerOrigin),
    globalLight: cleanGlobalLight(source.globalLight),
    patternLibrary: safeJsonArray<NonNullable<PsDocument["patternLibrary"]>[number]>(source.patternLibrary, SAFE_JSON_DEFAULT_LIMITS, "patternLibrary", sanitizationDiagnostics),
    stylePresets: safeJsonArray<NonNullable<PsDocument["stylePresets"]>[number]>(source.stylePresets, SAFE_JSON_DEFAULT_LIMITS, "stylePresets", sanitizationDiagnostics),
    gradientPresets: safeJsonArray<NonNullable<PsDocument["gradientPresets"]>[number]>(source.gradientPresets, SAFE_JSON_DEFAULT_LIMITS, "gradientPresets", sanitizationDiagnostics),
    characterStyles: safeJsonObject<NonNullable<PsDocument["characterStyles"]>>(source.characterStyles, SAFE_JSON_DEFAULT_LIMITS, "characterStyles", sanitizationDiagnostics),
    paragraphStyles: safeJsonObject<NonNullable<PsDocument["paragraphStyles"]>>(source.paragraphStyles, SAFE_JSON_DEFAULT_LIMITS, "paragraphStyles", sanitizationDiagnostics),
    assetLibrary: safeJsonArray<NonNullable<PsDocument["assetLibrary"]>[number]>(source.assetLibrary, PROJECT_PAYLOAD_LIMITS, "assetLibrary", sanitizationDiagnostics),
    timelineFrames: safeJsonArray<NonNullable<PsDocument["timelineFrames"]>[number]>(source.timelineFrames, PROJECT_PAYLOAD_LIMITS, "timelineFrames", sanitizationDiagnostics),
    plugins: safeJsonArray<NonNullable<PsDocument["plugins"]>[number]>(source.plugins, PROJECT_PAYLOAD_LIMITS, "plugins", sanitizationDiagnostics),
    pluginStorage: safeJsonObject<NonNullable<PsDocument["pluginStorage"]>>(source.pluginStorage, PROJECT_PAYLOAD_LIMITS, "pluginStorage", sanitizationDiagnostics),
    variableDataSets: safeJsonArray<NonNullable<PsDocument["variableDataSets"]>[number]>(source.variableDataSets, SAFE_JSON_DEFAULT_LIMITS, "variableDataSets", sanitizationDiagnostics),
    modeSettings: safeJsonObject<DocumentModeSettings>(source.modeSettings, SAFE_JSON_DEFAULT_LIMITS, "modeSettings", sanitizationDiagnostics),
    // reports are generated at runtime (createDocumentReport); we never
    // restore them from a project file, since they reference the freshly
    // loaded layer canvases and the source-of-truth lives in editor state.
    reports: undefined,
    metadata: safeJsonObject<DocumentMetadata>(source.metadata, PROJECT_PAYLOAD_LIMITS, "metadata", sanitizationDiagnostics),
    colorManagement: safeJsonObject<NonNullable<PsDocument["colorManagement"]>>(source.colorManagement, SAFE_JSON_DEFAULT_LIMITS, "colorManagement", sanitizationDiagnostics),
    printSettings: safeJsonObject<NonNullable<PsDocument["printSettings"]>>(source.printSettings, SAFE_JSON_DEFAULT_LIMITS, "printSettings", sanitizationDiagnostics),
    smartObjectParent: cleanSmartObjectParent(source.smartObjectParent),
    dpi: typeof source.dpi === "number" && Number.isFinite(source.dpi)
      ? Math.max(1, Math.min(9999, source.dpi))
      : undefined,
  } satisfies PsDocument
  const sanitizationReport = createProjectSanitizationReport(documentName, sanitizationDiagnostics)
  return sanitizationReport ? { ...doc, reports: [sanitizationReport] } : doc
}
