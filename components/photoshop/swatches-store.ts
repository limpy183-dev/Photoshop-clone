import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson, type ClientStorageKey } from "./client-storage"
import { dispatchPhotoshopEvent } from "./events"

export interface SwatchEntry {
  color: string
  name?: string
  group?: string
}

export const DEFAULT_SWATCH_GROUP = "Default"
export const SWATCH_STORAGE_KEY = "ps-swatches"
export const SWATCHES_UPDATED_EVENT = "ps-swatches-updated"

export const DEFAULT_SWATCH_HEXES = [
  "#000000","#1a1a1a","#333333","#4d4d4d","#666666","#808080","#999999","#b3b3b3","#cccccc","#e6e6e6","#ffffff",
  "#ff0000","#ff3300","#ff6600","#ff9900","#ffcc00","#ffff00","#ccff00","#99ff00","#66ff00","#33ff00","#00ff00",
  "#00ff33","#00ff66","#00ff99","#00ffcc","#00ffff","#00ccff","#0099ff","#0066ff","#0033ff","#0000ff",
  "#3300ff","#6600ff","#9900ff","#cc00ff","#ff00ff","#ff00cc","#ff0099","#ff0066","#ff0033",
  "#800000","#804000","#808000","#408000","#008000","#008040","#008080","#004080","#000080","#400080","#800080",
  "#ffcccc","#ffe0cc","#ffffcc","#e0ffcc","#ccffcc","#ccffe0","#ccffff","#cce0ff","#ccccff","#e0ccff","#ffccff",
]

export const DEFAULT_SWATCHES: SwatchEntry[] = DEFAULT_SWATCH_HEXES.map((color) => ({
  color,
  group: DEFAULT_SWATCH_GROUP,
}))

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MAX_SWATCHES = 256
export const MAX_SWATCH_NAME_LENGTH = 40
const MAX_GROUP_LENGTH = 40

export function scopedSwatchStorageKey(docId: string | undefined) {
  return docId ? `${SWATCH_STORAGE_KEY}:${docId}` : SWATCH_STORAGE_KEY
}

function scopedSwatchStorageDescriptor(docId?: string): ClientStorageKey<unknown[]> {
  const descriptor = CLIENT_STORAGE_KEYS.swatches
  return docId ? { ...descriptor, key: scopedSwatchStorageKey(docId) } : descriptor
}

export function normalizeSwatches(value: unknown): SwatchEntry[] {
  const source =
    value && typeof value === "object" && !Array.isArray(value) && "swatches" in value
      ? (value as { swatches?: unknown }).swatches
      : value
  if (!Array.isArray(source)) return DEFAULT_SWATCHES
  const seen = new Set<string>()
  const out: SwatchEntry[] = []
  for (const item of source) {
    let color: string | null = null
    let name: string | undefined
    let group: string | undefined
    if (typeof item === "string") {
      if (HEX_COLOR.test(item)) color = item.toLowerCase()
    } else if (item && typeof item === "object") {
      const candidate = item as Partial<SwatchEntry>
      if (typeof candidate.color === "string" && HEX_COLOR.test(candidate.color)) {
        color = candidate.color.toLowerCase()
      }
      if (typeof candidate.name === "string") name = candidate.name.trim().slice(0, MAX_SWATCH_NAME_LENGTH) || undefined
      if (typeof candidate.group === "string") group = candidate.group.trim().slice(0, MAX_GROUP_LENGTH) || undefined
    }
    if (!color) continue
    const key = `${color}|${name ?? ""}|${group ?? DEFAULT_SWATCH_GROUP}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ color, name, group: group ?? DEFAULT_SWATCH_GROUP })
    if (out.length >= MAX_SWATCHES) break
  }
  return out.length ? out : DEFAULT_SWATCHES
}

export function loadSwatches(docId?: string): SwatchEntry[] {
  const scoped = readClientStorageJson(scopedSwatchStorageDescriptor(docId))
  const saved = scoped.length || !docId ? scoped : readClientStorageJson(CLIENT_STORAGE_KEYS.swatches)
  return saved.length ? normalizeSwatches(saved) : DEFAULT_SWATCHES
}

export function saveSwatches(swatches: SwatchEntry[], docId?: string): SwatchEntry[] {
  const next = normalizeSwatches(swatches)
  writeClientStorageJson(scopedSwatchStorageDescriptor(docId), next)
  dispatchPhotoshopEvent(SWATCHES_UPDATED_EVENT, { docId, swatches: next })
  return next
}

export function captureSwatchEntry(swatches: SwatchEntry[], entry: SwatchEntry): SwatchEntry[] {
  const normalized = normalizeSwatches([entry])[0]
  if (!normalized) return normalizeSwatches(swatches)
  const current = normalizeSwatches(swatches)
  const key = `${normalized.color}|${normalized.name ?? ""}|${normalized.group ?? DEFAULT_SWATCH_GROUP}`
  if (current.some((swatch) => `${swatch.color}|${swatch.name ?? ""}|${swatch.group ?? DEFAULT_SWATCH_GROUP}` === key)) {
    return current
  }
  return normalizeSwatches([...current, normalized])
}

export function captureSwatch(entry: SwatchEntry, docId?: string): SwatchEntry[] {
  const next = captureSwatchEntry(loadSwatches(docId), entry)
  return saveSwatches(next, docId)
}

export function describeSwatch(entry: SwatchEntry): string {
  return entry.name ? `${entry.name} (${entry.color})` : entry.color
}
