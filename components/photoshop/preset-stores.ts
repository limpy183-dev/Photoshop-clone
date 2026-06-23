// Shared load/save adapters for the per-family preset stores.
//
// The Photoshop editor surfaces preset libraries through several browser
// stores: the editor reducer (brushes, style presets, asset library), the
// `swatches-store` module (localStorage with doc-scoped keys), the
// `shape-preset-library` module (localStorage), and ad-hoc localStorage
// entries for gradients and patterns. This module centralizes the read/write
// adapters so both `panels/preset-manager-panel.tsx` (right-dock surface)
// and `preset-manager-dialog.tsx` (Edit > Presets > Preset Manager…) read and
// write through the same keys without duplicating storage logic.
//
// Adapters here intentionally mirror the shapes used by the existing panel —
// extracting them as a side-effect-free module that does not depend on the
// React tree.

import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson, type ClientStorageKey } from "./client-storage"
import { dispatchPhotoshopEvent } from "./events"
import type { AssetLibraryItem } from "./types"
import {
  loadSwatches as loadStoredSwatches,
  saveSwatches as saveStoredSwatches,
  type SwatchEntry,
} from "./swatches-store"
import {
  readShapePresets,
  writeShapePresets,
  type ShapePresetEntry,
} from "./shape-preset-library"

export type ManagerSwatchEntry = SwatchEntry & {
  id?: string
  createdAt?: number
}

export type ManagerGradientEntry = {
  id: string
  name: string
  stops: { pos: number; color: string }[]
  category?: string
  createdAt?: number
}

export type ManagerPatternEntry = {
  id: string
  name: string
  group?: string
  dataURL: string
  width: number
  height: number
  createdAt?: number
}

export const GRADIENT_STORAGE_KEY = "ps-gradients"
export const PATTERN_STORAGE_KEY = "ps-patterns"

const HEX_OR_RGBA = /^(#[0-9a-f]{3,8}|rgba?\([^()]{1,80}\))$/i
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function finiteTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function cleanNumber(value: unknown, min: number, max: number, fallback: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(min, Math.min(max, next)))
}

export function scopedStorageKey(base: string, docId?: string) {
  return docId ? `${base}:${docId}` : base
}

function scopedPatternStorageKey(docId?: string): ClientStorageKey<unknown[]> {
  const descriptor = CLIENT_STORAGE_KEYS.patterns
  return docId ? { ...descriptor, key: scopedStorageKey(descriptor.key, docId) } : descriptor
}

export function loadManagedSwatches(docId?: string): ManagerSwatchEntry[] {
  return loadStoredSwatches(docId).map((swatch, index) => ({
    ...swatch,
    id: `swatch-${index}-${swatch.color.replace("#", "")}`,
  }))
}

export function saveManagedSwatches(docId: string | undefined, swatches: ManagerSwatchEntry[]) {
  const next = saveStoredSwatches(swatches, docId)
  if (typeof window !== "undefined") {
    dispatchPhotoshopEvent("ps-swatches-changed", { docId, swatches: next })
  }
  return next
}

export function loadManagedGradients(): ManagerGradientEntry[] {
  return normalizeGradients(readClientStorageJson(CLIENT_STORAGE_KEYS.gradients))
}

export function saveManagedGradients(gradients: ManagerGradientEntry[]) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.gradients, gradients)
  dispatchPhotoshopEvent("ps-gradients-changed", { gradients })
}

export function loadManagedPatterns(docId?: string): ManagerPatternEntry[] {
  const scoped = readClientStorageJson(scopedPatternStorageKey(docId))
  return normalizePatterns(scoped.length || !docId ? scoped : readClientStorageJson(CLIENT_STORAGE_KEYS.patterns))
}

export function saveManagedPatterns(docId: string | undefined, patterns: ManagerPatternEntry[]) {
  writeClientStorageJson(scopedPatternStorageKey(docId), patterns)
  dispatchPhotoshopEvent("ps-patterns-changed", { docId, patterns })
}

export function loadManagedShapes(): ShapePresetEntry[] {
  return readShapePresets()
}

export function saveManagedShapes(shapes: ShapePresetEntry[]) {
  writeShapePresets(shapes)
}

export function normalizeGradients(value: unknown): ManagerGradientEntry[] {
  const source = isRecord(value) && Array.isArray(value.gradients) ? value.gradients : value
  if (!Array.isArray(source)) return []
  return source.slice(0, 256).flatMap((item, index) => {
    if (!isRecord(item)) return []
    const stops = normalizeGradientStops(item.stops)
    if (stops.length < 2) return []
    return [
      {
        id: typeof item.id === "string" ? item.id.slice(0, 96) : `grad-${index + 1}`,
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim().slice(0, 96)
            : `Gradient ${index + 1}`,
        category:
          typeof item.category === "string"
            ? item.category.trim().slice(0, 80) || "Custom"
            : typeof item.group === "string"
              ? item.group.trim().slice(0, 80) || "Custom"
              : "Custom",
        stops,
        createdAt: finiteTimestamp(item.createdAt),
      },
    ]
  })
}

export function normalizePatterns(value: unknown): ManagerPatternEntry[] {
  const source = isRecord(value) && Array.isArray(value.patterns) ? value.patterns : value
  if (!Array.isArray(source)) return []
  return source.slice(0, 256).flatMap((item, index) => {
    if (!isRecord(item) || typeof item.dataURL !== "string" || !IMAGE_DATA_URL.test(item.dataURL)) return []
    return [
      {
        id: typeof item.id === "string" ? item.id.slice(0, 96) : `pattern-${index + 1}`,
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim().slice(0, 96)
            : `Pattern ${index + 1}`,
        group:
          typeof item.group === "string" ? item.group.trim().slice(0, 80) || "User" : "User",
        dataURL: item.dataURL,
        width: cleanNumber(item.width, 1, 4096, 1),
        height: cleanNumber(item.height, 1, 4096, 1),
        createdAt: finiteTimestamp(item.createdAt),
      },
    ]
  })
}

export function normalizeGradientStops(value: unknown): { pos: number; color: string }[] {
  if (!Array.isArray(value))
    return [
      { pos: 0, color: "#000000" },
      { pos: 1, color: "#ffffff" },
    ]
  const stops = value.slice(0, 16).flatMap((stop) => {
    if (!isRecord(stop)) return []
    const pos =
      typeof stop.pos === "number" ? stop.pos : typeof stop.offset === "number" ? stop.offset : NaN
    const color = typeof stop.color === "string" ? stop.color : ""
    if (!Number.isFinite(pos) || !HEX_OR_RGBA.test(color)) return []
    return [{ pos: Math.max(0, Math.min(1, pos)), color }]
  })
  return stops.length >= 2
    ? stops.sort((a, b) => a.pos - b.pos)
    : [
        { pos: 0, color: "#000000" },
        { pos: 1, color: "#ffffff" },
      ]
}

export function isAssetKind(value: unknown): value is AssetLibraryItem["kind"] {
  return (
    value === "brush" ||
    value === "gradient" ||
    value === "pattern" ||
    value === "style" ||
    value === "swatch" ||
    value === "shape" ||
    value === "export" ||
    value === "tool-preset" ||
    value === "plugin" ||
    value === "cloud-library" ||
    value === "stock" ||
    value === "font" ||
    value === "icc-profile" ||
    value === "variable-data" ||
    value === "prepress"
  )
}

export const PRESET_HEX_OR_RGBA = HEX_OR_RGBA
export const PRESET_IMAGE_DATA_URL = IMAGE_DATA_URL
