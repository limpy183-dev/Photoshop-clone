import type { CustomShapeId } from "./types"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "./client-storage"
import { dispatchPhotoshopEvent } from "./events"

export interface ShapePresetEntry {
  id: string
  name: string
  group: string
  customId: CustomShapeId
  createdAt?: number
}

export const SHAPE_PRESETS_STORAGE_KEY = "ps-shape-presets"

export const DEFAULT_SHAPE_PRESETS: ShapePresetEntry[] = [
  { id: "star5", name: "5 Point Star", group: "Stars", customId: "star5" },
  { id: "star6", name: "6 Point Star", group: "Stars", customId: "star6" },
  { id: "heart", name: "Heart", group: "Symbols", customId: "heart" },
  { id: "arrow-right", name: "Arrow Right", group: "Arrows", customId: "arrow-right" },
  { id: "arrow-left", name: "Arrow Left", group: "Arrows", customId: "arrow-left" },
  { id: "arrow-up", name: "Arrow Up", group: "Arrows", customId: "arrow-up" },
  { id: "arrow-down", name: "Arrow Down", group: "Arrows", customId: "arrow-down" },
  { id: "speech", name: "Speech Bubble", group: "Symbols", customId: "speech" },
  { id: "check", name: "Check Mark", group: "Symbols", customId: "check" },
  { id: "cross", name: "Cross", group: "Symbols", customId: "cross" },
  { id: "lightning", name: "Lightning", group: "Symbols", customId: "lightning" },
  { id: "polygon-hex", name: "Hexagon", group: "Polygons", customId: "polygon-hex" },
  { id: "polygon-tri", name: "Triangle", group: "Polygons", customId: "polygon-tri" },
  { id: "diamond", name: "Diamond", group: "Polygons", customId: "diamond" },
]

export function readShapePresets(): ShapePresetEntry[] {
  const saved = readClientStorageJson(CLIENT_STORAGE_KEYS.shapePresets)
  return saved.length ? normalizeShapePresets(saved) : DEFAULT_SHAPE_PRESETS
}

export function writeShapePresets(shapes: readonly ShapePresetEntry[]) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.shapePresets, [...shapes])
  dispatchPhotoshopEvent("ps-shape-presets-changed", [...shapes])
}

export function normalizeShapePresets(value: unknown): ShapePresetEntry[] {
  const source = isRecord(value) && Array.isArray(value.shapes) ? value.shapes : value
  if (!Array.isArray(source)) return DEFAULT_SHAPE_PRESETS
  const out = source.slice(0, 256).flatMap((item, index) => {
    if (!isRecord(item)) return []
    const customId = typeof item.customId === "string" ? item.customId : typeof item.id === "string" ? item.id : "star5"
    const id = typeof item.id === "string" ? item.id.trim().slice(0, 96) : ""
    return [{
      id: id || `shape-${index + 1}`,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 96) : `Shape ${index + 1}`,
      group: typeof item.group === "string" ? item.group.trim().slice(0, 80) || "Shapes" : "Shapes",
      customId: customId as CustomShapeId,
      createdAt: finiteTimestamp(item.createdAt),
    }]
  })
  return out.length ? out : DEFAULT_SHAPE_PRESETS
}

function finiteTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
