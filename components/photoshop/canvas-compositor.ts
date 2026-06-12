import { compositeLayer } from "./blend-modes"
import { getFilter, type FilterDef } from "./filters"
import {
  applyGpuLayerStyleToCanvas,
  applyGpuSmartFiltersToCanvas,
  cropWebGLSource,
  rasterizeVectorMaskForWebGL,
  type WebGLCompositeLayerContext,
} from "./webgl-compositor"
import { acquirePooledCanvas, makeCanvas, releasePooledCanvas } from "./canvas-utils"
import { isAdjustmentNoop } from "./adjustment-layers"
import { smartFilterMaskAmountAt, smartFilterMaskToImageData } from "./smart-filter-masks"
import { applyLuminanceMaskToCanvas, normalizeAdvancedBlending } from "./layer-workflows"
import {
  canvasIdFor,
  layerStyleCacheKey,
  maskAlphaEpoch,
  offsetPath,
  smartFilterCacheKey,
} from "./canvas-compositor-cache"
import type { BlendMode, Layer } from "./types"

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
  const fillMasks = [layerMask, vectorMask].filter(Boolean) as HTMLCanvasElement[]
  let fillContent = content
  for (const mask of fillMasks) fillContent = applyLuminanceMaskToCanvas(fillContent, mask)

  let effectContent = content
  if (advanced.layerMaskHidesEffects && layerMask) effectContent = applyLuminanceMaskToCanvas(effectContent, layerMask)
  if (advanced.vectorMaskHidesEffects && vectorMask) effectContent = applyLuminanceMaskToCanvas(effectContent, vectorMask)

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
      const { applyLayerStyle } = require("./layer-styles") as typeof import("./layer-styles")
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
    knockoutMask: advanced.transparencyShapesLayer ? effectContent : makeOpaqueMask(content.width, content.height),
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
    toDraw = applyLuminanceMaskToCanvas(toDraw, clipMask)
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

const maskAlphaCache = new WeakMap<HTMLCanvasElement, {
  epoch: number
  result: HTMLCanvasElement
}>()

function getMaskAsAlphaCanvas(mask: HTMLCanvasElement): HTMLCanvasElement | null {
  const cached = maskAlphaCache.get(mask)
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
    const luminance =
      ((sourceData[index] + sourceData[index + 1] + sourceData[index + 2]) *
        (sourceData[index + 3] / 255)) /
      3
    destinationData[index] = 255
    destinationData[index + 1] = 255
    destinationData[index + 2] = 255
    destinationData[index + 3] = luminance
  }
  outputContext.putImageData(destination, 0, 0)
  maskAlphaCache.set(mask, { epoch: maskAlphaEpoch, result: output })
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
