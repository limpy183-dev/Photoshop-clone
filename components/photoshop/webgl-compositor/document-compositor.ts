import type { Layer } from "../types"
import type { WebGLCompositeDocumentOptions, WebGLCompositeFallback, WebGLCompositeLayerContext, WebGLCompositeResult, WebGLEffectFallback, WebGLLayerInput } from "./types"
import { GPU_ADJUSTMENT_TYPES, positiveInt } from "./shared"
import { detectWebGL, WebGL2DCompositor } from "./webgl-runtime"
import { getWebGLLayerCapability, planWebGLLayerStack } from "./planning"
import { applyGpuAdjustmentLayerToCanvas, prepareLayerInputForWebGL } from "./pass-execution"

function resolveClipMask(layers: readonly Layer[], index: number): HTMLCanvasElement | null {
  if (!layers[index]?.clipped) return null
  for (let j = index - 1; j >= 0; j--) {
    if (!layers[j].clipped) return layers[j].canvas
  }
  return null
}

function appendFallbacks(target: WebGLCompositeFallback[], layer: Layer, effects: readonly WebGLEffectFallback[]) {
  for (const effect of effects) target.push({ layerId: layer.id, reason: effect })
}

export function compositeDocumentWithWebGL(
  target: HTMLCanvasElement,
  layers: readonly Layer[],
  options: WebGLCompositeDocumentOptions = {},
): WebGLCompositeResult {
  const width = positiveInt(options.width ?? target.width, 1)
  const height = positiveInt(options.height ?? target.height, 1)
  if (target.width !== width) target.width = width
  if (target.height !== height) target.height = height

  const webglAvailable = options.webglAvailable ?? (() => {
    const probe = document.createElement("canvas")
    return !!detectWebGL(probe)
  })()
  const stackPlan = planWebGLLayerStack({
    width,
    height,
    layerCount: layers.length,
    layers,
    preferWebGL: options.preferWebGL,
    webglAvailable,
    maxTextureSize: options.maxTextureSize,
    cpuLayerFallbackAvailable: !!options.prepareLayer || !!options.drawCpuLayer,
    cpuAdjustmentFallbackAvailable: !!options.applyCpuAdjustment,
  })

  if (stackPlan.path === "canvas-2d") {
    return { completed: false, reason: "webgl-unavailable", layersDrawn: 0, path: stackPlan.path }
  }
  if (stackPlan.unsupportedLayers.some((entry) => entry.reasons.includes("unsupported-blend-mode"))) {
    return { completed: false, reason: "unsupported-blend-mode", layersDrawn: 0, path: stackPlan.path }
  }
  if (stackPlan.unsupportedLayers.length > 0 && !options.drawCpuLayer) {
    return { completed: false, reason: "unsupported-layer", layersDrawn: 0, path: stackPlan.path }
  }

  if (stackPlan.path === "tiled-webgl" && !options.disableTiling) {
    const tileSize = positiveInt(options.tileSize ?? stackPlan.tileSize, stackPlan.maxTextureSize)
    const ctx = target.getContext("2d")
    if (!ctx) return { completed: false, reason: "unsupported-layer", layersDrawn: 0, path: "tiled-webgl" }
    ctx.clearRect(0, 0, width, height)
    let tilesDrawn = 0
    let layersDrawn = 0
    const fallbacks: WebGLCompositeFallback[] = []
    for (let y = 0; y < height; y += tileSize) {
      for (let x = 0; x < width; x += tileSize) {
        const tileRect = { x, y, w: Math.min(tileSize, width - x), h: Math.min(tileSize, height - y) }
        const tileCanvas = document.createElement("canvas")
        tileCanvas.width = tileRect.w
        tileCanvas.height = tileRect.h
        const result = compositeDocumentWithWebGL(tileCanvas, layers, {
          ...options,
          width: tileRect.w,
          height: tileRect.h,
          tileRect,
          disableTiling: true,
          maxTextureSize: Math.max(tileRect.w, tileRect.h, 1),
        })
        if (!result.completed) return { ...result, path: "tiled-webgl", tilesDrawn }
        ctx.drawImage(tileCanvas, x, y)
        tilesDrawn += 1
        layersDrawn += result.layersDrawn
        fallbacks.push(...(result.fallbacks ?? []))
      }
    }
    return { completed: true, layersDrawn, path: "tiled-webgl", tilesDrawn, fallbacks }
  }

  const ctx = target.getContext("2d")
  if (!ctx) return { completed: false, reason: "unsupported-layer", layersDrawn: 0, path: "webgl" }
  ctx.clearRect(0, 0, width, height)

  let gpuBatch: WebGLLayerInput[] = []
  let layersDrawn = 0
  const fallbacks: WebGLCompositeFallback[] = []

  const flushGpu = (): WebGLCompositeResult | null => {
    if (!gpuBatch.length) return null
    const glCanvas = document.createElement("canvas")
    glCanvas.width = width
    glCanvas.height = height
    const result = new WebGL2DCompositor(glCanvas).composite(gpuBatch, { initialSource: target })
    if (!result.completed) return result
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(glCanvas, 0, 0)
    gpuBatch = []
    return null
  }

  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]
    if (!layer.visible || layer.kind === "group") continue
    const clipMask = resolveClipMask(layers, index)
    const context: WebGLCompositeLayerContext = {
      width,
      height,
      tileRect: options.tileRect,
      clipMask,
      filterPreviewCanvas: options.filterPreviews?.[layer.id],
    }

    if (layer.kind === "adjustment") {
      const failed = flushGpu()
      if (failed) return failed
      const adjustmentType = layer.adjustment?.type
      const isGpuAdjustment = !!adjustmentType && GPU_ADJUSTMENT_TYPES.has(adjustmentType)
      if (isGpuAdjustment && applyGpuAdjustmentLayerToCanvas(ctx, layer, context)) {
        layersDrawn += 1
        continue
      }
      if (!options.applyCpuAdjustment) {
        return { completed: false, reason: "unsupported-layer", layersDrawn, path: "webgl", fallbacks }
      }
      options.applyCpuAdjustment(ctx, layer, context)
      fallbacks.push({ layerId: layer.id, reason: "adjustment-layer" })
      layersDrawn += 1
      continue
    }

    const capability = getWebGLLayerCapability(layer, {
      cpuLayerFallbackAvailable: !!options.prepareLayer || !!options.drawCpuLayer,
      hasFilterPreview: !!context.filterPreviewCanvas,
    })
    appendFallbacks(fallbacks, layer, capability.effectFallbacks)

    const prepared = capability.supported
      ? options.prepareLayer?.(layer, context) ?? prepareLayerInputForWebGL(layer, context)
      : null
    if (!prepared) {
      const failed = flushGpu()
      if (failed) return failed
      if (!options.drawCpuLayer) {
        return { completed: false, reason: "unsupported-layer", layersDrawn, path: "webgl", fallbacks }
      }
      options.drawCpuLayer(ctx, layer, context)
      for (const reason of capability.unsupportedReasons) fallbacks.push({ layerId: layer.id, reason })
      layersDrawn += 1
      continue
    }

    gpuBatch.push(prepared)
    layersDrawn += 1
  }

  const failed = flushGpu()
  if (failed) return failed
  return { completed: true, layersDrawn, path: "webgl", fallbacks }
}

