/**
 * Conversion between the unified preset item shape and the per-family stores.
 *
 * The Preset Manager exists twice — as a dialog and as a dock panel — and both
 * need the same round trip: store entry -> `UnifiedPresetItem` for display,
 * and back again for persistence. This module is that round trip, once.
 *
 * It previously existed as two copies that had drifted: eleven functions with
 * the same name and different bodies. The differences were mostly cosmetic (a
 * helper renamed, brace style) but `splitUnifiedItems` was not — only one copy
 * dropped the synthetic built-in contour entries before persisting. That copy
 * is the one kept here, so the panel no longer risks writing phantom
 * `contour-*` styles into a document's style presets.
 */

import type { Action } from "@/editor/reducer-model"
import { presetKey, type UnifiedPresetItem } from "@/editor/preset-manager"
import {
  isAssetKind,
  normalizeGradientStops,
  type ManagerGradientEntry,
  type ManagerPatternEntry,
  type ManagerSwatchEntry,
} from "@/editor/preset-stores"
import type { ShapePresetEntry } from "@/editor/shape-preset-library"
import type {
  AssetLibraryItem,
  BrushPreset,
  BrushSettings,
  CloneSourceSettings,
  CustomShapeId,
  EraserSettings,
  GradientSettings,
  GradientStop,
  LayerStyle,
  PsDocument,
  SelectionOptions,
  ToolId,
} from "@/editor/types"

/** Import guard: a preset bundle above this size is rejected before parsing. */
export const MAX_UNIFIED_IMPORT_BYTES = 2 * 1024 * 1024
export const HEX_OR_RGBA = /^(#[0-9a-f]{3,8}|rgba?\([^()]{1,80}\))$/i
export const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i

export type ManagerStylePreset = NonNullable<PsDocument["stylePresets"]>[number]

export type ToolPresetPayload = {
  tool?: ToolId
  brush?: Partial<BrushSettings>
  eraser?: Partial<EraserSettings>
  cloneSource?: Partial<CloneSourceSettings>
  selectionOptions?: Partial<SelectionOptions>
  foreground?: string
  background?: string
}

/** Apply a saved tool preset by dispatching each field it carries. */
export function applyToolPreset(payload: ToolPresetPayload, dispatch: (action: Action) => void) {
  if (payload.tool) dispatch({ type: "set-tool", tool: payload.tool })
  if (payload.brush) dispatch({ type: "set-brush", brush: payload.brush })
  if (payload.eraser && typeof payload.eraser === "object") {
    dispatch({ type: "set-eraser", eraser: payload.eraser })
  }
  if (payload.cloneSource && typeof payload.cloneSource === "object") {
    dispatch({ type: "set-clone-source", cloneSource: payload.cloneSource })
  }
  if (payload.selectionOptions && typeof payload.selectionOptions === "object") {
    dispatch({ type: "set-selection-options", selectionOptions: payload.selectionOptions })
  }
  if (typeof payload.foreground === "string") {
    dispatch({ type: "set-foreground", color: payload.foreground })
  }
  if (typeof payload.background === "string") {
    dispatch({ type: "set-background", color: payload.background })
  }
}

/* -------------------------------------------------------------------------- */
/* Store entry -> unified item                                                */
/* -------------------------------------------------------------------------- */

export function brushPresetToItem(preset: BrushPreset): UnifiedPresetItem {
  return {
    key: presetKey("brush", preset.id),
    family: "brush",
    id: preset.id,
    name: preset.name,
    set: preset.folder ?? "General",
    payload: {
      size: preset.size,
      hardness: preset.hardness,
      spacing: preset.spacing,
      settings: preset.settings,
      thumbnail: preset.thumbnail,
    },
    preview: preset.thumbnail,
  }
}

export function swatchToItem(swatch: ManagerSwatchEntry, index: number): UnifiedPresetItem {
  const id = swatch.id ?? `swatch-${index}-${swatch.color.replace("#", "")}`
  return {
    key: presetKey("swatch", id),
    family: "swatch",
    id,
    name: swatch.name ?? swatch.color.toUpperCase(),
    set: swatch.group ?? "Default",
    payload: { color: swatch.color },
    createdAt: swatch.createdAt,
  }
}

export function gradientToItem(preset: ManagerGradientEntry): UnifiedPresetItem {
  return {
    key: presetKey("gradient", preset.id),
    family: "gradient",
    id: preset.id,
    name: preset.name,
    set: preset.category ?? "Custom",
    payload: { stops: preset.stops },
    createdAt: preset.createdAt,
  }
}

export function patternToItem(pattern: ManagerPatternEntry): UnifiedPresetItem {
  return {
    key: presetKey("pattern", pattern.id),
    family: "pattern",
    id: pattern.id,
    name: pattern.name,
    set: pattern.group ?? "User",
    payload: {
      dataURL: pattern.dataURL,
      width: pattern.width,
      height: pattern.height,
    },
    createdAt: pattern.createdAt,
  }
}

export function styleToItem(preset: NonNullable<PsDocument["stylePresets"]>[number]): UnifiedPresetItem {
  const styled = preset as ManagerStylePreset & { group?: string; createdAt?: number }
  return {
    key: presetKey("style", styled.id),
    family: "style",
    id: styled.id,
    name: styled.name,
    set: styled.group ?? "Styles",
    payload: styled.style,
    createdAt: styled.createdAt,
  }
}

export function shapeToItem(shape: ShapePresetEntry): UnifiedPresetItem {
  return {
    key: presetKey("shape", shape.id),
    family: "shape",
    id: shape.id,
    name: shape.name,
    set: shape.group,
    payload: { customId: shape.customId },
    createdAt: shape.createdAt,
  }
}

export function assetToItem(asset: AssetLibraryItem): UnifiedPresetItem {
  if (asset.kind === "tool-preset") {
    return {
      key: presetKey("tool-preset", asset.id),
      family: "tool-preset",
      id: asset.id,
      name: asset.name,
      set: asset.group ?? "Tools",
      payload: asset.payload,
      createdAt: asset.createdAt,
      sourceKind: asset.kind,
    }
  }
  return {
    key: presetKey("asset", asset.id),
    family: "asset",
    id: asset.id,
    name: asset.name,
    set: asset.group ?? asset.kind,
    payload: asset.payload,
    createdAt: asset.createdAt,
    sourceKind: asset.kind,
  }
}

/* -------------------------------------------------------------------------- */
/* Unified item -> store entry                                                */
/* -------------------------------------------------------------------------- */

export function splitUnifiedItems(items: readonly UnifiedPresetItem[]) {
  const brushPresets = items.filter((item) => item.family === "brush").map(itemToBrushPreset)
  const swatches = items.filter((item) => item.family === "swatch").map(itemToSwatch)
  const gradients = items.filter((item) => item.family === "gradient").map(itemToGradient)
  const patterns = items
    .filter((item) => item.family === "pattern")
    .map(itemToPattern)
    .filter((entry): entry is ManagerPatternEntry => entry !== null)
  // Drop synthetic built-in contour items before persisting — they live in
  // `layer-styles.ts`, not in any user store.
  const styles = items
    .filter((item) => item.family === "style" && !item.id.startsWith("contour-"))
    .map(itemToStyle)
  const shapes = items.filter((item) => item.family === "shape").map(itemToShape)
  const assets = items
    .filter((item) => item.family === "tool-preset" || item.family === "asset")
    .map(itemToAsset)
    .filter((entry): entry is AssetLibraryItem => entry !== null)
  return { brushPresets, swatches, gradients, patterns, styles, shapes, assets }
}

export function itemToBrushPreset(item: UnifiedPresetItem): BrushPreset {
  const record = recordOf(item.payload)
  const settings = recordOf(record.settings) as Partial<BrushSettings>
  return {
    id: item.id,
    name: item.name,
    folder: item.set,
    size: cleanNumber(record.size, 1, 500, settings.size ?? 30),
    hardness: cleanNumber(record.hardness, 0, 100, settings.hardness ?? 80),
    spacing: cleanNumber(record.spacing, 1, 400, settings.spacing ?? 25),
    settings,
    thumbnail: typeof record.thumbnail === "string" ? record.thumbnail : item.preview,
  }
}

export function itemToSwatch(item: UnifiedPresetItem): ManagerSwatchEntry {
  const record = recordOf(item.payload)
  const color = safeColor(record.color, "#000000")
  return {
    id: item.id,
    name: item.name === color.toUpperCase() ? undefined : item.name,
    group: item.set,
    color,
    createdAt: item.createdAt,
  }
}

export function itemToGradient(item: UnifiedPresetItem): ManagerGradientEntry {
  const record = recordOf(item.payload)
  return {
    id: item.id,
    name: item.name,
    category: item.set,
    stops: normalizeGradientStops(record.stops),
    createdAt: item.createdAt,
  }
}

export function itemToPattern(item: UnifiedPresetItem): ManagerPatternEntry | null {
  const record = recordOf(item.payload)
  const dataURL = typeof record.dataURL === "string" ? record.dataURL : ""
  if (!IMAGE_DATA_URL.test(dataURL)) return null
  return {
    id: item.id,
    name: item.name,
    group: item.set,
    dataURL,
    width: cleanNumber(record.width, 1, 4096, 1),
    height: cleanNumber(record.height, 1, 4096, 1),
    createdAt: item.createdAt,
  }
}

export function itemToStyle(item: UnifiedPresetItem): ManagerStylePreset & { group?: string; createdAt?: number } {
  return {
    id: item.id,
    name: item.name,
    group: item.set,
    style: recordOf(item.payload) as LayerStyle,
    createdAt: item.createdAt,
  }
}

export function itemToShape(item: UnifiedPresetItem): ShapePresetEntry {
  const customId = recordOf(item.payload).customId
  return {
    id: item.id,
    name: item.name,
    group: item.set,
    customId: typeof customId === "string" ? (customId as CustomShapeId) : "star5",
    createdAt: item.createdAt,
  }
}

export function itemToAsset(item: UnifiedPresetItem): AssetLibraryItem | null {
  const kind = item.family === "tool-preset"
    ? "tool-preset"
    : isAssetKind(item.sourceKind)
      ? item.sourceKind
      : "cloud-library"
  return {
    id: item.id,
    name: item.name,
    kind,
    group: item.set,
    payload: item.payload,
    createdAt: item.createdAt ?? Date.now(),
  }
}

export function itemToGradientSettings(item: UnifiedPresetItem): Partial<GradientSettings> {
  const record = recordOf(item.payload)
  if (typeof record.type === "string") return record as Partial<GradientSettings>
  return {
    type: "linear",
    reverse: false,
    stops: normalizeGradientStops(record.stops).map((stop) => ({
      offset: stop.pos,
      color: stop.color,
      opacity: 1,
    } satisfies GradientStop)),
  }
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

export function recordOf(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
}

export function safeColor(value: unknown, fallback: string) {
  return typeof value === "string" && HEX_OR_RGBA.test(value) ? value : fallback
}

export function cleanNumber(value: unknown, min: number, max: number, fallback: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(min, Math.min(max, next)))
}

export function gradientCss(stops: unknown) {
  const normalized = normalizeGradientStops(stops)
  return `linear-gradient(90deg, ${normalized
    .map((stop) => `${stop.color} ${Math.round(stop.pos * 100)}%`)
    .join(", ")})`
}
