import { compositeLayer } from "@/editor/blend-modes"
import { getFilter, type FilterDef } from "@/editor/filters"
import {
  applyGpuLayerStyleToCanvas,
  applyGpuSmartFiltersToCanvas,
  cropWebGLSource,
  rasterizeVectorMaskForWebGL,
  type WebGLCompositeLayerContext,
} from "@/editor/webgl-compositor"
import { acquirePooledCanvas, makeCanvas, releasePooledCanvas } from "@/editor/canvas/utils"
import { isAdjustmentNoop } from "@/editor/adjustment-layers"
import { smartFilterMaskAmountAt, smartFilterMaskToImageData } from "@/editor/smart-filter-masks"
import { clipCanvasToAlpha, normalizeAdvancedBlending } from "@/editor/layer-workflows"
import {
  canvasIdFor,
  layerStyleCacheKey,
  maskAlphaEpoch,
  offsetPath,
  smartFilterCacheKey,
} from "@/editor/canvas/compositor-cache"
import type { BlendMode, Layer } from "@/editor/types"

function acquireCanvas(width: number, height: number): HTMLCanvasElement {
  return acquirePooledCanvas(width, height)
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  releasePooledCanvas(canvas)
}

interface SmartFilterCacheEntry {
  paramsKey: string
  result: HTMLCanvasElement
}

const smartFilterCache = new WeakMap<HTMLCanvasElement, SmartFilterCacheEntry>()

interface LayerStyleCacheEntry {
  styleKey: string
  fillOpacity: number
  result: HTMLCanvasElement
}

const layerStyleCache = new WeakMap<HTMLCanvasElement, LayerStyleCacheEntry>()

export function renderLayerSourceForCompositor(layer: Layer, filterPreviewCanvas?: HTMLCanvasElement): {
  canvas: HTMLCanvasElement
  fillOpacity: number
  styleRendered: boolean
  knockoutMask: HTMLCanvasElement
} {
  const baseCanvas = filterPreviewCanvas || layer.canvas
  const content = applyGpuSmartFiltersToCanvas(baseCanvas, layer.smartFilters) ?? applySmartFilters(baseCanvas, layer.smartFilters)
  const advanced = normalizeAdvancedBlending(layer.advancedBlending)
  const vectorMask = layer.vectorMask ? rasterizeVectorMaskForWebGL(layer, content.width, content.height) : null
  const layerMask = layer.mask && layer.maskEnabled !== false ? layer.mask : null
  const fillContent = applyMasksToCanvas(content, layerMask, vectorMask)

  const effectContent = applyMasksToCanvas(
    content,
    advanced.layerMaskHidesEffects ? layerMask : null,
    advanced.vectorMaskHidesEffects ? vectorMask : null,
  )

  const renderLayer = { ...layer, canvas: fillContent }
  let toDraw: HTMLCanvasElement = fillContent
  let styleRendered = false
  if (renderLayer.style) {
    const effectId = effectContent === content ? "" : canvasIdFor(effectContent)
    const styleKey =
      layerStyleCacheKey(renderLayer.style) +
      `|ab:${advanced.transparencyShapesLayer ? 1 : 0}:${advanced.layerMaskHidesEffects ? 1 : 0}:${advanced.vectorMaskHidesEffects ? 1 : 0}:${effectId}`
    const fillOpacity = renderLayer.fillOpacity ?? 1
    const cached = layerStyleCache.get(fillContent)
    if (cached && cached.styleKey === styleKey && cached.fillOpacity === fillOpacity) {
      toDraw = cached.result
    } else {
      const { applyLayerStyle } = require("@/editor/layer-styles") as typeof import("@/editor/layer-styles")
      const gpuEffectSource = advanced.transparencyShapesLayer ? effectContent : makeOpaqueMask(content.width, content.height)
      const gpuStyled = applyGpuLayerStyleToCanvas(renderLayer, fillOpacity, {
        effectSourceCanvas: gpuEffectSource,
        fillSourceCanvas: fillContent,
      })
      toDraw = gpuStyled ?? applyLayerStyle(renderLayer, fillOpacity, {
        effectSourceCanvas: effectContent,
        transparencyShapesLayer: advanced.transparencyShapesLayer,
      })
      layerStyleCache.set(fillContent, {
        styleKey,
        fillOpacity,
        result: toDraw,
      })
    }
    styleRendered = true
  }
  return {
    canvas: toDraw,
    fillOpacity: styleRendered ? 1 : layer.fillOpacity ?? 1,
    styleRendered,
    // A getter, not a value: only knockout layers ever read this, and the
    // WebGL path discards it outright. Building it eagerly cost one
    // document-sized canvas allocation plus a full fillRect per visible layer
    // per frame — the dominant cost once a document carried a dozen layers.
    get knockoutMask() {
      return advanced.transparencyShapesLayer ? effectContent : makeOpaqueMask(content.width, content.height)
    },
  }
}

export function makeOpaqueMask(width: number, height: number) {
  const mask = makeCanvas(width, height)
  const context = mask.getContext("2d")!
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  return mask
}

function restoreKnockoutBackdrop(
  context: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  backdrop: HTMLCanvasElement | null,
) {
  context.save()
  context.globalCompositeOperation = "destination-out"
  context.drawImage(mask, 0, 0)
  context.restore()
  if (!backdrop) return
  const temporary = makeCanvas(context.canvas.width, context.canvas.height)
  const temporaryContext = temporary.getContext("2d")!
  temporaryContext.drawImage(backdrop, 0, 0)
  temporaryContext.globalCompositeOperation = "destination-in"
  temporaryContext.drawImage(mask, 0, 0)
  context.drawImage(temporary, 0, 0)
}

export function drawLayer(
  context: CanvasRenderingContext2D,
  layer: Layer,
  clipMask: HTMLCanvasElement | null,
  filterPreviewCanvas?: HTMLCanvasElement,
  knockoutBackdrop?: HTMLCanvasElement | null,
) {
  const rendered = renderLayerSourceForCompositor(layer, filterPreviewCanvas)
  let toDraw: HTMLCanvasElement = rendered.canvas
  if (clipMask) {
    // Not applyMasksToCanvas: a clipping base contributes its alpha, not its
    // luminance, so clipping onto dark artwork must not dim what is clipped.
    toDraw = clipCanvasToAlpha(toDraw, clipMask)
  }
  const advanced = normalizeAdvancedBlending(layer.advancedBlending)
  if (advanced.knockout !== "none") {
    restoreKnockoutBackdrop(context, rendered.knockoutMask, knockoutBackdrop ?? null)
  }
  compositeLayer(context, toDraw, layer.blendMode, layer.opacity, rendered.fillOpacity, layer.advancedBlending)
}

export function drawLayerForCompositorContext(
  context: CanvasRenderingContext2D,
  layer: Layer,
  compositorContext: WebGLCompositeLayerContext,
) {
  if (!compositorContext.tileRect) {
    drawLayer(context, layer, compositorContext.clipMask, compositorContext.filterPreviewCanvas)
    return
  }
  const rect = compositorContext.tileRect
  const tileLayer: Layer = {
    ...layer,
    canvas: cropWebGLSource(layer.canvas, rect),
    mask: layer.mask && layer.maskEnabled !== false ? cropWebGLSource(layer.mask, rect) : layer.mask,
    vectorMask: offsetPath(layer.vectorMask, -rect.x, -rect.y) ?? null,
  }
  const clipMask = compositorContext.clipMask ? cropWebGLSource(compositorContext.clipMask, rect) : null
  const filterPreviewCanvas = compositorContext.filterPreviewCanvas
    ? cropWebGLSource(compositorContext.filterPreviewCanvas, rect)
    : undefined
  drawLayer(context, tileLayer, clipMask, filterPreviewCanvas)
}

export function applyAdjustmentForCompositorContext(
  context: CanvasRenderingContext2D,
  layer: Layer,
  compositorContext: WebGLCompositeLayerContext,
) {
  if (!compositorContext.tileRect) {
    applyAdjustmentLayer(
      context,
      layer,
      compositorContext.width,
      compositorContext.height,
      compositorContext.clipMask,
      undefined,
    )
    return
  }
  const rect = compositorContext.tileRect
  const tileLayer: Layer = {
    ...layer,
    canvas: cropWebGLSource(layer.canvas, rect),
    mask: layer.mask && layer.maskEnabled !== false ? cropWebGLSource(layer.mask, rect) : layer.mask,
    vectorMask: offsetPath(layer.vectorMask, -rect.x, -rect.y) ?? null,
  }
  const clipMask = compositorContext.clipMask ? cropWebGLSource(compositorContext.clipMask, rect) : null
  applyAdjustmentLayer(
    context,
    tileLayer,
    compositorContext.width,
    compositorContext.height,
    clipMask,
    undefined,
  )
}

export function paramsWithDefaults(
  filter: FilterDef,
  params: Record<string, number | string | boolean>,
) {
  const output: Record<string, number | string | boolean> = {}
  for (const param of filter.params) {
    const raw = params[param.key] ?? param.default
    if (param.type === "slider") {
      const numeric = typeof raw === "number" ? raw : Number(raw)
      output[param.key] = Math.max(
        param.min,
        Math.min(param.max, Number.isFinite(numeric) ? numeric : param.default),
      )
    } else if (param.type === "checkbox") {
      output[param.key] = raw === true
    } else if (param.type === "select") {
      output[param.key] = param.options.some((option) => option.value === raw) ? raw : param.default
    } else {
      output[param.key] = typeof raw === "string" ? raw : param.default
    }
  }
  return output
}

function imageDataToCanvas(data: ImageData) {
  const canvas = document.createElement("canvas")
  canvas.width = data.width
  canvas.height = data.height
  canvas.getContext("2d")!.putImageData(data, 0, 0)
  return canvas
}

interface SmartFilterMaskCacheEntry {
  epoch: number
  width: number
  height: number
  feather: number
  mask: ImageData
}

const smartFilterMaskCache = new WeakMap<HTMLCanvasElement, SmartFilterMaskCacheEntry>()

export function readSmartFilterMask(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  feather = 0,
): ImageData | null {
  const maskWidth = Math.min(canvas.width, width)
  const maskHeight = Math.min(canvas.height, height)
  if (maskWidth <= 0 || maskHeight <= 0) return null
  const cached = smartFilterMaskCache.get(canvas)
  if (
    cached &&
    cached.epoch === maskAlphaEpoch &&
    cached.width === maskWidth &&
    cached.height === maskHeight &&
    cached.feather === feather
  ) {
    return cached.mask
  }
  const mask = smartFilterMaskToImageData(canvas, width, height, feather)
  if (!mask) return null
  smartFilterMaskCache.set(canvas, {
    epoch: maskAlphaEpoch,
    width: maskWidth,
    height: maskHeight,
    feather,
    mask,
  })
  return mask
}

function smartFilterResult(
  before: ImageData,
  after: ImageData,
  smartFilter: NonNullable<Layer["smartFilters"]>[number],
  width: number,
  height: number,
) {
  const opacity = Math.max(0, Math.min(1, smartFilter.opacity ?? 1))
  if (opacity <= 0) return before
  const blendMode = (smartFilter.blendMode ?? "normal") as BlendMode
  const maskCanvas = smartFilter.maskEnabled === false ? null : smartFilter.mask ?? null
  const mask = maskCanvas
    ? readSmartFilterMask(maskCanvas, width, height, smartFilter.maskFeather ?? 0)
    : null

  if (!mask && opacity >= 1 && blendMode === "normal") return after

  const overlay = new ImageData(new Uint8ClampedArray(after.data), width, height)
  if (mask) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4
        overlay.data[index + 3] = Math.round(
          overlay.data[index + 3] *
            smartFilterMaskAmountAt(mask, x, y, smartFilter.maskDensity ?? 1),
        )
      }
    }
  }

  const baseCanvas = imageDataToCanvas(before)
  const overlayCanvas = imageDataToCanvas(overlay)
  const context = baseCanvas.getContext("2d")!
  compositeLayer(context, overlayCanvas, blendMode, opacity)
  return context.getImageData(0, 0, width, height)
}

export function applySmartFilters(
  source: HTMLCanvasElement,
  smartFilters: Layer["smartFilters"],
): HTMLCanvasElement {
  const enabled = smartFilters?.filter((smartFilter) => smartFilter.enabled) ?? []
  if (!enabled.length) return source
  const cacheKey = smartFilterCacheKey(enabled)
  const cached = smartFilterCache.get(source)
  if (cached && cached.paramsKey === cacheKey) return cached.result

  const output = document.createElement("canvas")
  output.width = source.width
  output.height = source.height
  const context = output.getContext("2d")!
  context.drawImage(source, 0, 0)
  let current = context.getImageData(0, 0, output.width, output.height)
  for (const smartFilter of enabled) {
    const filter = getFilter(smartFilter.filterId)
    if (!filter) continue
    const before = current
    const after = filter.apply(before, paramsWithDefaults(filter, smartFilter.params))
    current = smartFilterResult(before, after, smartFilter, output.width, output.height)
  }
  context.putImageData(current, 0, 0)
  smartFilterCache.set(source, { paramsKey: cacheKey, result: output })
  return output
}

type MaskLuma = "average" | "rec601"

type MaskAlphaEntry = { epoch: number; result: HTMLCanvasElement }

const maskAlphaCache = new WeakMap<HTMLCanvasElement, Partial<Record<MaskLuma, MaskAlphaEntry>>>()

function getMaskAsAlphaCanvas(mask: HTMLCanvasElement, luma: MaskLuma = "average"): HTMLCanvasElement | null {
  const entry = maskAlphaCache.get(mask) ?? {}
  const cached = entry[luma]
  if (
    cached &&
    cached.epoch === maskAlphaEpoch &&
    cached.result.width === mask.width &&
    cached.result.height === mask.height
  ) {
    return cached.result
  }
  if (typeof mask.getContext !== "function") return null
  const sourceContext = mask.getContext("2d")
  if (!sourceContext) return null
  const width = mask.width
  const height = mask.height
  const output = cached?.result.width === width && cached.result.height === height
    ? cached.result
    : document.createElement("canvas")
  output.width = width
  output.height = height
  const outputContext = output.getContext("2d")!
  const source = sourceContext.getImageData(0, 0, width, height)
  const destination = outputContext.createImageData(width, height)
  const sourceData = source.data
  const destinationData = destination.data
  for (let index = 0; index < sourceData.length; index += 4) {
    const grey =
      luma === "rec601"
        ? 0.299 * sourceData[index] + 0.587 * sourceData[index + 1] + 0.114 * sourceData[index + 2]
        : (sourceData[index] + sourceData[index + 1] + sourceData[index + 2]) / 3
    destinationData[index] = 255
    destinationData[index + 1] = 255
    destinationData[index + 2] = 255
    destinationData[index + 3] = grey * (sourceData[index + 3] / 255)
  }
  outputContext.putImageData(destination, 0, 0)
  entry[luma] = { epoch: maskAlphaEpoch, result: output }
  maskAlphaCache.set(mask, entry)
  return output
}

/**
 * Punch one or more luminance masks into a copy of `source`, on the GPU.
 *
 * The CPU twin of this (`applyLuminanceMaskToCanvas`) reads back *both* the
 * source and the mask and walks every pixel in JS. The compositor runs this
 * once per masked layer per frame, so on a large document a single layer mask
 * stalled every brush stroke. Here only the mask is read back, and only when
 * its cached alpha copy is stale; the masking itself is a destination-in draw.
 *
 * ponytail: the mask->alpha cache is dropped wholesale on every forced render
 * (see invalidateMaskAlphaCache), so a stroke still rebuilds it once a frame.
 * Give mask canvases a content version if that shows up in a profile.
 */
function applyMasksToCanvas(
  source: HTMLCanvasElement,
  ...masks: (HTMLCanvasElement | null | undefined)[]
): HTMLCanvasElement {
  const present = masks.filter(Boolean) as HTMLCanvasElement[]
  if (!present.length) return source
  const output = makeCanvas(source.width, source.height)
  const context = output.getContext("2d")!
  context.drawImage(source, 0, 0)
  context.globalCompositeOperation = "destination-in"
  for (const mask of present) {
    const alpha = getMaskAsAlphaCanvas(mask, "rec601")
    if (alpha) context.drawImage(alpha, 0, 0)
  }
  context.globalCompositeOperation = "source-over"
  return output
}

interface AdjustmentFilterCacheEntry {
  inputFingerprint: string
  paramsKey: string
  width: number
  height: number
  result: HTMLCanvasElement
}

const adjustmentFilterCache = new WeakMap<Layer, AdjustmentFilterCacheEntry>()

export function adjustmentParamsKey(layer: Layer): string {
  if (!layer.adjustment) return ""
  return `${layer.adjustment.type}|${JSON.stringify(layer.adjustment.params)}`
}

export function applyAdjustmentLayer(
  context: CanvasRenderingContext2D,
  layer: Layer,
  width: number,
  height: number,
  clipMask?: HTMLCanvasElement | null,
  inputFingerprint?: string,
) {
  if (!layer.adjustment) return
  if (layer.opacity <= 0 || isAdjustmentNoop(layer.adjustment)) return
  const filter = getFilter(layer.adjustment.type)
  if (!filter) return

  const opacity = Math.max(0, Math.min(1, layer.opacity))
  const maskCanvas = layer.maskEnabled === false ? null : layer.mask ?? null
  const hasMask = !!maskCanvas
  const hasClip = !!clipMask

  const paramsKey = adjustmentParamsKey(layer)
  const cached = adjustmentFilterCache.get(layer)
  let filterOutputCanvas: HTMLCanvasElement
  let reused = false
  if (
    cached &&
    inputFingerprint !== undefined &&
    cached.inputFingerprint === inputFingerprint &&
    cached.paramsKey === paramsKey &&
    cached.width === width &&
    cached.height === height
  ) {
    filterOutputCanvas = cached.result
    reused = true
  } else {
    const before = context.getImageData(0, 0, width, height)
    const after = filter.apply(before, paramsWithDefaults(filter, layer.adjustment.params))
    const output = document.createElement("canvas")
    output.width = width
    output.height = height
    output.getContext("2d")!.putImageData(after, 0, 0)
    filterOutputCanvas = output
    if (inputFingerprint !== undefined) {
      adjustmentFilterCache.set(layer, {
        inputFingerprint,
        paramsKey,
        width,
        height,
        result: output,
      })
    }
  }

  if (!hasMask && !hasClip && opacity >= 1) {
    context.clearRect(0, 0, width, height)
    context.drawImage(filterOutputCanvas, 0, 0)
    return
  }

  const temporary = acquireCanvas(width, height)
  const temporaryContext = temporary.getContext("2d")!
  temporaryContext.drawImage(filterOutputCanvas, 0, 0)

  if (hasMask) {
    const maskAlpha = getMaskAsAlphaCanvas(maskCanvas!)
    if (maskAlpha) {
      temporaryContext.globalCompositeOperation = "destination-in"
      temporaryContext.drawImage(maskAlpha, 0, 0)
      temporaryContext.globalCompositeOperation = "source-over"
    }
  }
  if (hasClip) {
    temporaryContext.globalCompositeOperation = "destination-in"
    temporaryContext.drawImage(clipMask!, 0, 0)
    temporaryContext.globalCompositeOperation = "source-over"
  }

  context.save()
  context.globalAlpha = opacity
  context.drawImage(temporary, 0, 0)
  context.restore()
  releaseCanvas(temporary)
  void reused
}
