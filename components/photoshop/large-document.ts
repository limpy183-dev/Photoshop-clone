import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  canvasLimitLabel,
  canvasSizeError,
} from "./canvas-limits"
import { planMemoryBudget } from "./memory-budget"
import { planTiledBackingStore } from "./tile-store"
import { uid } from "./uid"
import type { Layer, PsDocument, PsdParsedStructureMetadata } from "./types"

const MIB = 1024 * 1024
const INSPECTION_MAX_DIMENSION = 1024
const INSPECTION_MAX_PIXELS = 1024 * 1024
const MIN_EDITABLE_REDUCED_SCALE = 0.05

export type LargeDocumentKind = "raster" | "psd" | "psb" | "project" | "advanced"
export type LargeDocumentOpenMode = "full" | "reduced-scale" | "tile-only" | "inspection"

export interface LargeDocumentOpenInput {
  fileName: string
  kind: LargeDocumentKind
  width: number
  height: number
  layerCount?: number
  memoryBudgetMB?: number
  tileSize?: number
  tileable?: boolean
  parsedStructure?: PsdParsedStructureMetadata
}

export interface LargeDocumentReducedScalePlan {
  mode: "reduced-scale"
  scale: number
  width: number
  height: number
  editable: boolean
  reason: string
}

export interface LargeDocumentTileOnlyPlan {
  mode: "tile-only"
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  editable: boolean
  recommendation: ReturnType<typeof planTiledBackingStore>["recommendation"]
  reason: string
}

export interface LargeDocumentInspectionPlan {
  mode: "inspection"
  width: number
  height: number
  editable: false
  reason: string
}

export interface LargeDocumentOpenPlan {
  fileName: string
  kind: LargeDocumentKind
  width: number
  height: number
  layerCount: number
  fitsBrowserCanvas: boolean
  defaultMode: LargeDocumentOpenMode
  browserLimit: string
  fullError: string | null
  reducedScale: LargeDocumentReducedScalePlan
  tileOnly: LargeDocumentTileOnlyPlan | null
  inspection: LargeDocumentInspectionPlan
  warnings: string[]
  parsedStructure?: PsdParsedStructureMetadata
}

export interface LargeDocumentInspectionDocumentInput {
  fileName: string
  kind: LargeDocumentKind
  width: number
  height: number
  reason: string
  warnings?: string[]
  parsedStructure?: PsdParsedStructureMetadata
}

export interface TileEditDocumentInput {
  parentDocId: string
  sourceName: string
  col: number
  row: number
  sourceX: number
  sourceY: number
  originalWidth: number
  originalHeight: number
  tileSize: number
  canvas: HTMLCanvasElement
}

export interface BrowserDiagnosticsEnvironment {
  userAgent?: string
  canvas?: {
    maxDimension?: number
    maxPixels?: number
  }
  gpu?: {
    webglSupported?: boolean
    webgl2Supported?: boolean
    maxTextureSize?: number | null
    renderer?: string | null
  }
  memory?: {
    heapSupported?: boolean
    usedJSHeapSize?: number | null
    totalJSHeapSize?: number | null
    jsHeapSizeLimit?: number | null
  }
  offscreen?: {
    offscreenCanvasSupported?: boolean
    workerOffscreenSupported?: boolean
  }
}

export interface BrowserLargeDocumentDiagnostics {
  summary: string
  canvas: { status: "ok" | "limited"; detail: string }
  gpu: { status: "ok" | "limited" | "unavailable"; detail: string }
  memory: { status: "ok" | "limited" | "unknown"; detail: string }
  offscreen: { status: "ok" | "limited" | "unavailable"; detail: string }
  fallbacks: string[]
}

function positiveInt(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(1, Math.round(next))
}

function nonNegativeInt(value: unknown, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(0, Math.round(next))
}

function fitDimensions(
  widthInput: number,
  heightInput: number,
  maxDimension = MAX_CANVAS_DIMENSION,
  maxPixels = MAX_CANVAS_PIXELS,
) {
  const width = positiveInt(widthInput, 1)
  const height = positiveInt(heightInput, 1)
  const scale = Math.min(
    1,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / Math.max(1, width * height)),
  )
  const fittedWidth = Math.max(1, Math.floor(width * scale))
  const fittedHeight = Math.max(1, Math.floor(height * scale))
  return { scale, width: fittedWidth, height: fittedHeight }
}

function makeDocumentCanvas(width: number, height: number, fill = "#202020") {
  const canvas = document.createElement("canvas")
  canvas.width = positiveInt(width, 1)
  canvas.height = positiveInt(height, 1)
  const ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#3a3a3a"
    ctx.fillRect(1, 1, Math.max(1, canvas.width - 2), Math.max(1, canvas.height - 2))
  }
  return canvas
}

function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = makeDocumentCanvas(source.width, source.height)
  const ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(source, 0, 0)
  }
  return canvas
}

function baseDocument(
  name: string,
  width: number,
  height: number,
  layer: Layer,
  metadata: PsDocument["metadata"],
): PsDocument {
  return {
    id: uid("doc"),
    name,
    width,
    height,
    zoom: 1,
    layers: [layer],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    metadata,
  }
}

export function planLargeDocumentOpen(input: LargeDocumentOpenInput): LargeDocumentOpenPlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const layerCount = positiveInt(input.layerCount, 1)
  const memoryBudgetMB = positiveInt(input.memoryBudgetMB, 1024)
  const fileName = input.fileName || "Document"
  const fullError = canvasSizeError(width, height, "Document canvas")
  const fitsBrowserCanvas = !fullError
  const reducedDims = fitDimensions(width, height)
  const reducedMemory = planMemoryBudget({
    width: reducedDims.width,
    height: reducedDims.height,
    layerCount: 1,
    historyStates: 12,
    memoryBudgetMB,
  })
  const reducedError = canvasSizeError(reducedDims.width, reducedDims.height, "Reduced document canvas")
  const reducedEditable =
    !reducedError &&
    reducedDims.scale >= MIN_EDITABLE_REDUCED_SCALE &&
    reducedMemory.estimatedWorkingSetBytes <= reducedMemory.memoryBudgetBytes * 2.5
  const reducedScale: LargeDocumentReducedScalePlan = {
    mode: "reduced-scale",
    scale: reducedDims.scale,
    width: reducedDims.width,
    height: reducedDims.height,
    editable: reducedEditable,
    reason: reducedEditable
      ? `Open reduced scale at ${(reducedDims.scale * 100).toFixed(1)}% for browser-safe editing.`
      : `Reduced scale would still exceed the safe memory budget or become too small for reliable editing.`,
  }

  const canTile = input.tileable ?? input.kind === "psb"
  const tilePlan = canTile
    ? planTiledBackingStore({
        width,
        height,
        tileSize: input.tileSize,
        layerCount,
        memoryBudgetMB,
      })
    : null
  const tileOnly: LargeDocumentTileOnlyPlan | null = tilePlan
    ? {
        mode: "tile-only",
        tileSize: tilePlan.tileSize,
        tileColumns: tilePlan.tileColumns,
        tileRows: tilePlan.tileRows,
        tileCount: tilePlan.tileCount,
        editable: true,
        recommendation: tilePlan.recommendation,
        reason: `Open a tile-only overview and edit full-resolution ${tilePlan.tileSize}px tiles without allocating one full canvas.`,
      }
    : null

  const inspectionDims = fitDimensions(width, height, INSPECTION_MAX_DIMENSION, INSPECTION_MAX_PIXELS)
  const inspection: LargeDocumentInspectionPlan = {
    mode: "inspection",
    width: inspectionDims.width,
    height: inspectionDims.height,
    editable: false,
    reason: `${fileName} can be inspected, but it is too large for safe full-document editing in this browser.`,
  }

  const defaultMode: LargeDocumentOpenMode = fitsBrowserCanvas
    ? "full"
    : reducedScale.editable
      ? "reduced-scale"
      : tileOnly?.editable
        ? "tile-only"
        : "inspection"

  const warnings: string[] = []
  if (!fitsBrowserCanvas) warnings.push(`${fileName} exceeds the browser canvas limit (${canvasLimitLabel()}).`)
  if (reducedMemory.status === "over-budget") warnings.push(...reducedMemory.warnings)
  if (tileOnly) warnings.push(`Tile-only mode uses ${tileOnly.tileColumns} x ${tileOnly.tileRows} tiles with ${tileOnly.recommendation}.`)
  if (defaultMode === "inspection") warnings.push("Pixels are not opened for editing; metadata and parsed dimensions remain available.")
  if (input.parsedStructure?.layerCount) {
    warnings.push(`${input.parsedStructure.layerCount} parsed layers are available for inspection and repair planning without allocating full pixel data.`)
  }
  if (input.parsedStructure?.repairableItems?.length) {
    warnings.push(`${input.parsedStructure.repairableItems.length} repairable PSD structure${input.parsedStructure.repairableItems.length === 1 ? "" : "s"} can be represented locally.`)
  }

  return {
    fileName,
    kind: input.kind,
    width,
    height,
    layerCount,
    fitsBrowserCanvas,
    defaultMode,
    browserLimit: canvasLimitLabel(),
    fullError,
    reducedScale,
    tileOnly,
    inspection,
    warnings,
    parsedStructure: input.parsedStructure,
  }
}

export function describeLargeDocumentRecovery(plan: LargeDocumentOpenPlan) {
  const options = [
    plan.reducedScale.editable
      ? `Open reduced scale (${plan.reducedScale.width} x ${plan.reducedScale.height}px)`
      : null,
    plan.tileOnly?.editable
      ? `Open tile-only (${plan.tileOnly.tileColumns} x ${plan.tileOnly.tileRows} tiles)`
      : null,
    `Inspect only (${plan.inspection.width} x ${plan.inspection.height}px placeholder)`,
  ].filter(Boolean)
  return `${plan.fileName}: ${options.join(" / ")}.`
}

export function createLargeDocumentInspectionDocument(input: LargeDocumentInspectionDocumentInput): PsDocument {
  const dims = fitDimensions(input.width, input.height, INSPECTION_MAX_DIMENSION, INSPECTION_MAX_PIXELS)
  const canvas = makeDocumentCanvas(dims.width, dims.height, "#1f1f1f")
  const layer: Layer = {
    id: uid("layer"),
    name: "Inspection placeholder",
    kind: "raster",
    visible: true,
    locked: true,
    lockDraw: true,
    lockMove: true,
    lockAll: true,
    opacity: 1,
    blendMode: "normal",
    canvas,
    metadata: {
      description: input.reason,
      tags: ["large-document", "inspection", input.kind],
      custom: {
        originalWidth: input.width,
        originalHeight: input.height,
        parsedLayerCount: input.parsedStructure?.layerCount ?? 0,
        repairableItems: input.parsedStructure?.repairableItems?.length ?? 0,
      },
    },
  }
  return baseDocument(`${input.fileName} (Inspection)`, dims.width, dims.height, layer, {
    title: input.fileName,
    source: input.fileName,
    description: input.reason,
    createdAt: new Date().toISOString(),
    largeDocumentInspection: {
      mode: "inspection",
      sourceName: input.fileName,
      kind: input.kind,
      originalWidth: positiveInt(input.width, 1),
      originalHeight: positiveInt(input.height, 1),
      previewWidth: dims.width,
      previewHeight: dims.height,
      editable: false,
      reason: input.reason,
      warnings: input.warnings ?? [],
      parsedStructure: input.parsedStructure,
    },
  })
}

export function createTileEditDocument(input: TileEditDocumentInput): PsDocument {
  const canvas = cloneCanvas(input.canvas)
  const col = Math.max(0, Math.round(input.col))
  const row = Math.max(0, Math.round(input.row))
  const layer: Layer = {
    id: uid("layer"),
    name: `Tile ${col},${row}`,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    metadata: {
      description: `${input.sourceName} tile ${col},${row}`,
      tags: ["large-document", "tile-edit"],
      custom: {
        parentDocId: input.parentDocId,
        sourceX: input.sourceX,
        sourceY: input.sourceY,
        originalWidth: input.originalWidth,
        originalHeight: input.originalHeight,
      },
    },
  }
  return baseDocument(`${input.sourceName} tile ${col},${row}`, canvas.width, canvas.height, layer, {
    title: `${input.sourceName} tile ${col},${row}`,
    source: input.sourceName,
    description: `Full-resolution tile opened for tile-only editing.`,
    createdAt: new Date().toISOString(),
    largeDocumentTileEdit: {
      mode: "tile-edit",
      parentDocId: input.parentDocId,
      sourceName: input.sourceName,
      originalWidth: positiveInt(input.originalWidth, 1),
      originalHeight: positiveInt(input.originalHeight, 1),
      tileSize: positiveInt(input.tileSize, 512),
      tile: {
        col,
        row,
        x: nonNegativeInt(input.sourceX, 0),
        y: nonNegativeInt(input.sourceY, 0),
        width: canvas.width,
        height: canvas.height,
      },
      editable: true,
    },
  })
}

function formatMB(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unavailable"
  return `${(Math.max(0, value) / MIB).toFixed(1)} MB`
}

function probeGpu(): Required<NonNullable<BrowserDiagnosticsEnvironment["gpu"]>> {
  const fallback = {
    webglSupported: false,
    webgl2Supported: false,
    maxTextureSize: null,
    renderer: null,
  }
  if (typeof document === "undefined") return fallback
  try {
    const canvas = document.createElement("canvas")
    const gl2 = canvas.getContext("webgl2") as WebGLRenderingContext | null
    const gl = gl2 ?? (canvas.getContext("webgl") as WebGLRenderingContext | null)
    if (!gl) return fallback
    let renderer: string | null = null
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info")
    if (debugInfo) {
      renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string
    }
    return {
      webglSupported: true,
      webgl2Supported: !!gl2,
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null,
      renderer,
    }
  } catch {
    return fallback
  }
}

function readRuntimeEnvironment(): BrowserDiagnosticsEnvironment {
  const perf = typeof performance !== "undefined"
    ? performance as Performance & {
        memory?: {
          usedJSHeapSize?: number
          totalJSHeapSize?: number
          jsHeapSizeLimit?: number
        }
      }
    : undefined
  return {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "Unknown browser",
    canvas: {
      maxDimension: MAX_CANVAS_DIMENSION,
      maxPixels: MAX_CANVAS_PIXELS,
    },
    gpu: probeGpu(),
    memory: {
      heapSupported: typeof perf?.memory?.usedJSHeapSize === "number",
      usedJSHeapSize: perf?.memory?.usedJSHeapSize ?? null,
      totalJSHeapSize: perf?.memory?.totalJSHeapSize ?? null,
      jsHeapSizeLimit: perf?.memory?.jsHeapSizeLimit ?? null,
    },
    offscreen: {
      offscreenCanvasSupported: typeof OffscreenCanvas !== "undefined",
      workerOffscreenSupported: typeof HTMLCanvasElement !== "undefined" && "transferControlToOffscreen" in HTMLCanvasElement.prototype,
    },
  }
}

export function diagnoseBrowserLargeDocumentLimits(env: BrowserDiagnosticsEnvironment = readRuntimeEnvironment()): BrowserLargeDocumentDiagnostics {
  const userAgent = env.userAgent || "Unknown browser"
  const canvasMaxDimension = positiveInt(env.canvas?.maxDimension, MAX_CANVAS_DIMENSION)
  const canvasMaxPixels = positiveInt(env.canvas?.maxPixels, MAX_CANVAS_PIXELS)
  const canvasStatus = canvasMaxDimension <= MAX_CANVAS_DIMENSION || canvasMaxPixels <= MAX_CANVAS_PIXELS ? "limited" : "ok"
  const gpu = env.gpu ?? probeGpu()
  const maxTexture = typeof gpu.maxTextureSize === "number" && Number.isFinite(gpu.maxTextureSize) ? gpu.maxTextureSize : null
  const gpuStatus = !gpu.webglSupported ? "unavailable" : maxTexture && maxTexture < canvasMaxDimension ? "limited" : "ok"
  const memory = env.memory ?? {}
  const heapSupported = memory.heapSupported ?? typeof memory.usedJSHeapSize === "number"
  const heapLimit = typeof memory.jsHeapSizeLimit === "number" ? memory.jsHeapSizeLimit : null
  const memoryStatus = !heapSupported ? "unknown" : heapLimit && heapLimit < 1024 * MIB ? "limited" : "ok"
  const offscreen = env.offscreen ?? {}
  const offscreenStatus = !offscreen.offscreenCanvasSupported
    ? "unavailable"
    : offscreen.workerOffscreenSupported
      ? "ok"
      : "limited"

  return {
    summary: `${userAgent}: canvas ${canvasMaxDimension}px / ${(canvasMaxPixels / 1_000_000).toFixed(1)} MP, GPU ${maxTexture ? `${maxTexture}px texture` : "unavailable"}, memory ${heapLimit ? `${formatMB(heapLimit)} heap limit` : "heap limit unavailable"}.`,
    canvas: {
      status: canvasStatus,
      detail: `${canvasMaxDimension}px per side and ${(canvasMaxPixels / 1_000_000).toFixed(1)} MP canvas budget.`,
    },
    gpu: {
      status: gpuStatus,
      detail: gpu.webglSupported
        ? `${gpu.webgl2Supported ? "WebGL2" : "WebGL1"} available${maxTexture ? `, ${maxTexture}px texture limit` : ""}${gpu.renderer ? `, ${gpu.renderer}` : ""}.`
        : "WebGL is unavailable; Canvas 2D fallback is active.",
    },
    memory: {
      status: memoryStatus,
      detail: heapSupported
        ? `${formatMB(memory.usedJSHeapSize ?? null)} used, ${formatMB(heapLimit)} heap limit.`
        : "JS heap diagnostics are not exposed by this browser.",
    },
    offscreen: {
      status: offscreenStatus,
      detail: offscreen.offscreenCanvasSupported
        ? offscreen.workerOffscreenSupported
          ? "OffscreenCanvas worker transfer is available."
          : "OffscreenCanvas exists, but worker transfer is unavailable."
        : "OffscreenCanvas is unavailable.",
    },
    fallbacks: [
      "Use reduced-scale import when a full browser canvas would exceed limits.",
      "Use tile-only mode for full-resolution inspection and tile editing.",
      "Use inspection mode when metadata parses but pixels are unsafe to allocate.",
    ],
  }
}
