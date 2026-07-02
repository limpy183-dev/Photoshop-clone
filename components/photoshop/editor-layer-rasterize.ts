import { flattenLayerMasks, normalizeAdvancedBlending } from "./layer-workflows"
import { applyLayerStyle } from "./layer-styles"
import type { Layer, PsDocument } from "./types"

export type RasterizeLayerOption =
  | "layer"
  | "type"
  | "shape"
  | "smart-object"
  | "layer-style"
  | "video"
  | "3d"
  | "all"

export function flattenLayerStylePixels(layer: Layer): Layer {
  if (!layer.style) return layer
  const advanced = normalizeAdvancedBlending(layer.advancedBlending)
  const canvas = applyLayerStyle(layer, layer.fillOpacity ?? 1, {
    transparencyShapesLayer: advanced.transparencyShapesLayer,
  })
  return {
    ...layer,
    canvas,
    style: undefined,
    fillOpacity: 1,
  }
}

export function rasterizeLayerForOption(layer: Layer, option: RasterizeLayerOption, doc: PsDocument): Layer {
  if (layer.kind === "group") return layer
  let next = layer
  if (option === "layer-style" || option === "all") next = flattenLayerStylePixels(next)
  if (option === "all") next = flattenLayerMasks(next, doc.width, doc.height)
  if (option === "type" && next.kind !== "text") return next
  if (option === "shape" && next.kind !== "shape" && !next.path) return next
  if (option === "smart-object" && !next.smartObject && next.kind !== "smart-object") return next
  if (option === "video" && next.kind !== "video" && !next.video) return next
  if (option === "3d" && next.kind !== "3d" && !next.threeD) return next
  if (option === "layer-style") return next

  return {
    ...next,
    kind: "raster",
    smartObject: undefined,
    smartSource: undefined,
    smartFilters: option === "smart-object" || option === "all" ? undefined : next.smartFilters,
    text: option === "type" || option === "layer" || option === "all" ? undefined : next.text,
    shape: option === "shape" || option === "layer" || option === "all" ? undefined : next.shape,
    path: option === "shape" || option === "layer" || option === "all" ? undefined : next.path,
    adjustment: option === "layer" || option === "all" ? undefined : next.adjustment,
    frame: option === "layer" || option === "all" ? undefined : next.frame,
    artboard: option === "layer" || option === "all" ? undefined : next.artboard,
    threeD: option === "3d" || option === "layer" || option === "all" ? undefined : next.threeD,
    video: option === "video" || option === "layer" || option === "all" ? undefined : next.video,
  }
}
