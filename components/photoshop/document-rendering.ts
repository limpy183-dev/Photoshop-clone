"use client"

import { applyModeAndColorManagement } from "./document-color-management"
import { isAdjustmentNoop } from "./adjustment-layers"
import { compositeLayer } from "./blend-modes"
import { assertCanvasSize } from "./canvas-limits"
import { getFilter } from "./filters"
import {
  renderDocumentHighBitPreviewCanvas,
  type HighBitDocument,
  type HighBitLayer,
} from "./high-bit-document"
import { applyLayerStyle } from "./layer-styles"
import { applyLuminanceMaskToCanvas, normalizeAdvancedBlending } from "./layer-workflows"
import { smartFilterMaskAmountAt, smartFilterMaskToImageData } from "./smart-filter-masks"
import type { Layer, PsDocument } from "./types"

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
  return mask ? applyLuminanceMaskToCanvas(source, mask) : source
}

function renderableLayer(layer: Layer) {
  const smartFiltered = applySmartFiltersForIo(layer.canvas, layer.smartFilters)
  const advanced = normalizeAdvancedBlending(layer.advancedBlending)
  const layerMask = layer.mask && layer.maskEnabled !== false ? layer.mask : null
  const fillContent = withLayerMask(smartFiltered, layerMask)
  const effectContent = advanced.layerMaskHidesEffects ? withLayerMask(smartFiltered, layerMask) : smartFiltered
  const renderLayer = { ...layer, canvas: fillContent }
  return layer.style
    ? applyLayerStyle(renderLayer, layer.fillOpacity ?? 1, {
        effectSourceCanvas: effectContent,
        transparencyShapesLayer: advanced.transparencyShapesLayer,
      })
    : fillContent
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
    } else {
      out[param.key] = typeof raw === "string" ? raw : param.default
    }
  }
  return out
}

function imageDataToCanvas(data: ImageData) {
  const c = makeIoCanvas(data.width, data.height)
  c.getContext("2d")!.putImageData(data, 0, 0)
  return c
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
    const mask = smartFilter.maskEnabled === false || !smartFilter.mask
      ? null
      : smartFilterMaskToImageData(smartFilter.mask, c.width, c.height, smartFilter.maskFeather ?? 0)
    if (!mask && opacity >= 1 && (smartFilter.blendMode ?? "normal") === "normal") {
      current = after
      continue
    }
    const overlay = new ImageData(new Uint8ClampedArray(after.data), c.width, c.height)
    if (mask) {
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4
          overlay.data[i + 3] = Math.round(overlay.data[i + 3] * smartFilterMaskAmountAt(mask, x, y, smartFilter.maskDensity ?? 1))
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

function maskAmountAt(mask: ImageData | null, x: number, y: number) {
  if (!mask || x >= mask.width || y >= mask.height) return 1
  const i = (y * mask.width + x) * 4
  const luminance = (mask.data[i] + mask.data[i + 1] + mask.data[i + 2]) / 765
  return luminance * (mask.data[i + 3] / 255)
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
  options: { transparent?: boolean; matte?: string; colorPurpose?: "preview" | "export" } = {},
) {
  if (doc.bitDepth > 8 || (doc as HighBitDocument).__highBitImageData || doc.layers.some((layer) => !!(layer as HighBitLayer).__highBitImageData || !!(layer as HighBitLayer).__highBitDepthData)) {
    const highBit = renderDocumentHighBitPreviewCanvas(doc, options)
    if (highBit) return applyModeAndColorManagement(highBit.canvas, doc, { purpose: options.colorPurpose ?? "preview" })
  }

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
  return applyModeAndColorManagement(flat, doc, { purpose: options.colorPurpose ?? "preview" })
}
