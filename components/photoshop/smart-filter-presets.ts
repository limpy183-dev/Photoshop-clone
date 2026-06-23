import type { BlendMode } from "./types"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "./client-storage"
import {
  normalizeSmartFilterMaskDensity,
  normalizeSmartFilterMaskFeather,
} from "./smart-filter-masks"

export const SMART_FILTER_PRESET_STORAGE_KEY = CLIENT_STORAGE_KEYS.smartFilterStackPresets.key

export interface SmartFilterStackEntryLike {
  id?: string
  filterId: string
  filterName?: string
  name?: string
  params?: Record<string, number | string | boolean>
  visible?: boolean
  enabled?: boolean
  opacity?: number
  blendMode?: BlendMode
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
  maskDensity?: number
  maskFeather?: number
  maskLinked?: boolean
}

export interface SmartFilterStackPresetEntry {
  filterId: string
  filterName: string
  params: Record<string, number | string | boolean>
  visible: boolean
  opacity: number
  blendMode: BlendMode
  maskEnabled: boolean
  maskDensity: number
  maskFeather: number
  maskLinked: boolean
}

export interface SmartFilterStackPreset {
  id: string
  name: string
  entries: SmartFilterStackPresetEntry[]
  createdAt: number
  updatedAt: number
}

export interface HydratedSmartFilterStackEntry extends SmartFilterStackPresetEntry {
  id: string
  mask: null
}

const MAX_PRESETS = 80
const MAX_PRESET_ENTRIES = 40

function clamp01(value: unknown, fallback = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function cleanName(name: string | undefined, fallback = "Smart Filter Stack") {
  const trimmed = String(name ?? "").trim()
  return trimmed || fallback
}

function cleanId(id: string | undefined, fallbackPrefix = "sf_preset") {
  const trimmed = String(id ?? "").trim()
  if (trimmed) return trimmed
  return `${fallbackPrefix}_${Date.now().toString(36)}`
}

function cleanParams(params: unknown): Record<string, number | string | boolean> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {}
  const out: Record<string, number | string | boolean> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value
    else if (typeof value === "string" || typeof value === "boolean") out[key] = value
  }
  return out
}

export function createSmartFilterStackPreset(
  name: string,
  entries: SmartFilterStackEntryLike[],
  options: { id?: string; now?: number } = {},
): SmartFilterStackPreset {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  return {
    id: cleanId(options.id),
    name: cleanName(name),
    createdAt: now,
    updatedAt: now,
    entries: entries.slice(0, MAX_PRESET_ENTRIES).map((entry) => ({
      filterId: String(entry.filterId),
      filterName: cleanName(entry.filterName ?? entry.name, String(entry.filterId)),
      params: cleanParams(entry.params),
      visible: entry.visible ?? entry.enabled ?? true,
      opacity: clamp01(entry.opacity, 1),
      blendMode: (entry.blendMode ?? "normal") as BlendMode,
      maskEnabled: entry.maskEnabled !== false,
      maskDensity: normalizeSmartFilterMaskDensity(entry.maskDensity),
      maskFeather: normalizeSmartFilterMaskFeather(entry.maskFeather),
      maskLinked: entry.maskLinked !== false,
    })),
  }
}

export function hydrateSmartFilterStackPresetEntries(
  preset: SmartFilterStackPreset,
  options: {
    idFactory?: (filterId: string, index: number) => string
    defaultParams?: (filterId: string) => Record<string, number | string | boolean>
  } = {},
): HydratedSmartFilterStackEntry[] {
  return preset.entries.map((entry, index) => ({
    ...entry,
    id: options.idFactory?.(entry.filterId, index) ?? `${entry.filterId}_${Date.now()}_${index}`,
    params: {
      ...(options.defaultParams?.(entry.filterId) ?? {}),
      ...entry.params,
    },
    mask: null,
  }))
}

export function normalizeSmartFilterStackPresets(raw: unknown): SmartFilterStackPreset[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const out: SmartFilterStackPreset[] = []
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const entries = Array.isArray(record.entries) ? record.entries : []
    const preset = createSmartFilterStackPreset(
      cleanName(record.name as string | undefined),
      entries.map((entry) => {
        const value = entry && typeof entry === "object" && !Array.isArray(entry)
          ? entry as SmartFilterStackEntryLike
          : { filterId: "" }
        return value
      }).filter((entry) => String(entry.filterId ?? "").trim()),
      {
        id: cleanId(record.id as string | undefined),
        now: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : Date.now(),
      },
    )
    if (!preset.entries.length || seen.has(preset.id)) continue
    seen.add(preset.id)
    preset.createdAt = Number.isFinite(record.createdAt) ? Number(record.createdAt) : preset.createdAt
    preset.updatedAt = Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : preset.updatedAt
    out.push(preset)
    if (out.length >= MAX_PRESETS) break
  }
  return out
}

export function loadSmartFilterStackPresets(storage?: Pick<Storage, "getItem"> | null): SmartFilterStackPreset[] {
  if (!storage) return normalizeSmartFilterStackPresets(readClientStorageJson(CLIENT_STORAGE_KEYS.smartFilterStackPresets))
  try {
    const raw = storage.getItem(SMART_FILTER_PRESET_STORAGE_KEY)
    return normalizeSmartFilterStackPresets(raw ? JSON.parse(raw) : [])
  } catch {
    return []
  }
}

export function saveSmartFilterStackPresets(
  presets: SmartFilterStackPreset[],
  storage?: Pick<Storage, "setItem"> | null,
) {
  const normalized = normalizeSmartFilterStackPresets(presets)
  if (storage) {
    storage.setItem(SMART_FILTER_PRESET_STORAGE_KEY, JSON.stringify(normalized))
  } else {
    writeClientStorageJson(CLIENT_STORAGE_KEYS.smartFilterStackPresets, normalized)
  }
}

export const SMART_FILTER_PRESET_EXPORT_VERSION = 1
export const SMART_FILTER_PRESET_EXPORT_FORMAT = "ps-smart-filter-stack-presets"

export interface SmartFilterStackPresetExport {
  format: typeof SMART_FILTER_PRESET_EXPORT_FORMAT
  version: number
  exportedAt: number
  presets: SmartFilterStackPreset[]
}

/**
 * Serialize a list of presets into a portable JSON envelope. The envelope
 * includes a format string and version so imports from older app builds can
 * be detected and migrated.
 */
export function serializeSmartFilterStackPresetsForExport(
  presets: SmartFilterStackPreset[],
  options: { now?: number; pretty?: boolean } = {},
): string {
  const payload: SmartFilterStackPresetExport = {
    format: SMART_FILTER_PRESET_EXPORT_FORMAT,
    version: SMART_FILTER_PRESET_EXPORT_VERSION,
    exportedAt: Number.isFinite(options.now) ? Number(options.now) : Date.now(),
    presets: normalizeSmartFilterStackPresets(presets),
  }
  return options.pretty === false ? JSON.stringify(payload) : JSON.stringify(payload, null, 2)
}

/**
 * Parse an exported JSON envelope back into a normalized preset list. Accepts
 * either an envelope produced by `serializeSmartFilterStackPresetsForExport`
 * or a bare array (older exports / hand-written files).
 */
export function parseSmartFilterStackPresetsImport(text: string | null | undefined): SmartFilterStackPreset[] {
  if (!text) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (Array.isArray(parsed)) return normalizeSmartFilterStackPresets(parsed)
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.presets)) return normalizeSmartFilterStackPresets(record.presets)
  }
  return []
}

/**
 * Merge an incoming list of presets with the existing list. Imports keyed by
 * the same id overwrite the existing entry; imports keyed by a unique name
 * append after the current presets. The resulting list is capped at the
 * stored MAX_PRESETS via `normalizeSmartFilterStackPresets`.
 */
export function mergeSmartFilterStackPresets(
  current: SmartFilterStackPreset[],
  incoming: SmartFilterStackPreset[],
): SmartFilterStackPreset[] {
  if (!incoming.length) return normalizeSmartFilterStackPresets(current)
  const byId = new Map<string, SmartFilterStackPreset>()
  for (const preset of current) byId.set(preset.id, preset)
  for (const preset of incoming) byId.set(preset.id, preset)
  return normalizeSmartFilterStackPresets(Array.from(byId.values()))
}
