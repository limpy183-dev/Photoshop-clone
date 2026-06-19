import type { BlendMode, Layer } from "../types"
import type { GpuFilterChainPlan, WebGLCompositorPlan, WebGLCompositorPlanInput, WebGLEffectFallback, WebGLLayerCapability, WebGLLayerStackPlan, WebGLLayerStackPlanInput, WebGLLayerUnsupportedReason } from "./types"
import { COMPATIBLE_BLEND_MODES, GPU_ADJUSTMENT_TYPES, GPU_FILTERS, hasAdvancedKnockout, hasUnsupportedAdvancedKnockout, hasUnsupportedLayerEffects, hasUnsupportedSmartFilters, positiveInt } from "./shared"

export function isWebGLBlendModeCompatible(mode: BlendMode | undefined): boolean {
  return COMPATIBLE_BLEND_MODES.has(mode ?? "normal")
}

export function planGpuFilterChain(filters: readonly string[], env: { webglAvailable?: boolean } = {}): GpuFilterChainPlan {
  if (!env.webglAvailable) {
    return { mode: "cpu", compatibleFilters: [], cpuFilters: [...filters] }
  }
  const compatibleFilters = filters.filter((filter) => GPU_FILTERS.has(filter))
  const cpuFilters = filters.filter((filter) => !GPU_FILTERS.has(filter))
  return {
    mode: cpuFilters.length ? (compatibleFilters.length ? "mixed" : "cpu") : "webgl",
    compatibleFilters,
    cpuFilters,
  }
}

export function planWebGLCompositor(input: WebGLCompositorPlanInput): WebGLCompositorPlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const pixelCount = width * height
  const maxTextureSize = positiveInt(input.maxTextureSize, 16_384)
  const largeDocumentPixels = positiveInt(input.largeDocumentPixels, 16_000_000)

  if (input.preferWebGL === false) {
    return { path: "canvas-2d", reason: "webgl-disabled", pixelCount, maxTextureSize }
  }
  if (!input.webglAvailable) {
    return { path: "canvas-2d", reason: "webgl-unavailable", pixelCount, maxTextureSize }
  }
  if (width > maxTextureSize || height > maxTextureSize) {
    return {
      path: "tiled-webgl",
      reason: "exceeds-max-texture-size",
      tileSize: maxTextureSize,
      pixelCount,
      maxTextureSize,
    }
  }
  if (input.preferWebGL === true) {
    return { path: "webgl", reason: "webgl-preferred", pixelCount, maxTextureSize }
  }
  if (pixelCount < largeDocumentPixels && input.layerCount < 6) {
    return { path: "canvas-2d", reason: "small-document", pixelCount, maxTextureSize }
  }
  return { path: "webgl", reason: "large-compatible-document", pixelCount, maxTextureSize }
}

export function getWebGLLayerCapability(
  layer: Layer,
  options: {
    cpuLayerFallbackAvailable?: boolean
    cpuAdjustmentFallbackAvailable?: boolean
    hasFilterPreview?: boolean
  } = {},
): WebGLLayerCapability {
  const kind = layer.kind ?? "raster"
  const unsupportedReasons: WebGLLayerUnsupportedReason[] = []
  const effectFallbacks: WebGLEffectFallback[] = []
  const isHidden = layer.visible === false
  const isGroup = kind === "group"
  const isAdjustment = kind === "adjustment"
  const adjustmentType = isAdjustment ? layer.adjustment?.type : undefined
  const isGpuAdjustment = !!adjustmentType && GPU_ADJUSTMENT_TYPES.has(adjustmentType)

  if (isHidden) unsupportedReasons.push("hidden")
  if (isGroup) unsupportedReasons.push("group-layer")
  if (!isWebGLBlendModeCompatible(layer.blendMode)) unsupportedReasons.push("unsupported-blend-mode")

  if (hasUnsupportedLayerEffects(layer)) effectFallbacks.push("layer-effects")
  if (hasUnsupportedSmartFilters(layer)) effectFallbacks.push("smart-filters")
  if (isAdjustment && !isGpuAdjustment) effectFallbacks.push("adjustment-layer")
  if (hasAdvancedKnockout(layer) && hasUnsupportedAdvancedKnockout(layer)) effectFallbacks.push("advanced-blending")

  const needsCpuLayerFallback =
    hasUnsupportedLayerEffects(layer) ||
    hasUnsupportedSmartFilters(layer) ||
    (hasAdvancedKnockout(layer) && hasUnsupportedAdvancedKnockout(layer))

  if (!isAdjustment && needsCpuLayerFallback && !options.cpuLayerFallbackAvailable) {
    unsupportedReasons.push("cpu-layer-fallback-unavailable")
  }
  if (isAdjustment && !isGpuAdjustment && !options.cpuAdjustmentFallbackAvailable) {
    unsupportedReasons.push("cpu-adjustment-fallback-unavailable")
  }
  if (hasAdvancedKnockout(layer) && hasUnsupportedAdvancedKnockout(layer) && !options.cpuLayerFallbackAvailable) {
    unsupportedReasons.push("advanced-knockout")
  }

  return {
    layerId: layer.id,
    layerKind: kind,
    supported: unsupportedReasons.length === 0,
    gpuLayer: (!isAdjustment || isGpuAdjustment) && !isHidden && !isGroup,
    gpuBlend: isWebGLBlendModeCompatible(layer.blendMode),
    gpuMasks: !!layer.mask && layer.maskEnabled !== false,
    gpuVectorMasks: !!layer.vectorMask,
    gpuClipping: layer.clipped === true,
    requiresCpuCheckpoint: (isAdjustment && !isGpuAdjustment) || (hasAdvancedKnockout(layer) && hasUnsupportedAdvancedKnockout(layer)),
    effectFallbacks,
    unsupportedReasons,
  }
}

export function planWebGLLayerStack(input: WebGLLayerStackPlanInput): WebGLLayerStackPlan {
  const basePlan = planWebGLCompositor(input)
  const layerCapabilities = input.layers
    .filter((layer) => layer.visible !== false && layer.kind !== "group")
    .map((layer) => getWebGLLayerCapability(layer, {
      cpuLayerFallbackAvailable: input.cpuLayerFallbackAvailable,
      cpuAdjustmentFallbackAvailable: input.cpuAdjustmentFallbackAvailable,
    }))
  const unsupportedLayers = layerCapabilities
    .filter((capability) => capability.unsupportedReasons.length > 0)
    .map((capability) => ({ layerId: capability.layerId, reasons: capability.unsupportedReasons }))
  const effectFallbacks = layerCapabilities
    .map((capability) => ({
      layerId: capability.layerId,
      effects: capability.effectFallbacks.filter((effect) => effect !== "adjustment-layer"),
    }))
    .filter((entry) => entry.effects.length > 0)

  return {
    compatible: unsupportedLayers.length === 0 && basePlan.path !== "canvas-2d",
    path: basePlan.path,
    reason: basePlan.reason,
    tileSize: basePlan.tileSize,
    pixelCount: basePlan.pixelCount,
    maxTextureSize: basePlan.maxTextureSize,
    layerCapabilities,
    gpuLayerCount: layerCapabilities.filter((capability) => capability.supported && capability.gpuLayer).length,
    cpuCheckpointLayerIds: layerCapabilities
      .filter((capability) => capability.supported && capability.requiresCpuCheckpoint)
      .map((capability) => capability.layerId),
    effectFallbacks,
    unsupportedLayers,
  }
}

