export type UnifiedPresetFamily =
  | "brush"
  | "swatch"
  | "gradient"
  | "pattern"
  | "style"
  | "shape"
  | "tool-preset"
  | "asset"

export type PresetFamilyFilter = UnifiedPresetFamily | "all"
export type PresetImportConflictPolicy = "keep-both" | "replace" | "skip"

export interface UnifiedPresetItem {
  key: string
  family: UnifiedPresetFamily
  id: string
  name: string
  set: string
  payload: unknown
  createdAt?: number
  sourceKind?: string
  preview?: string
  readonly?: boolean
}

export interface PresetFamilySummary {
  family: PresetFamilyFilter
  label: string
  count: number
}

export interface PresetSetSummary {
  set: string
  count: number
}

export interface PresetFilter {
  family?: PresetFamilyFilter
  set?: string
  query?: string
}

export interface SerializedPresetItem {
  family: UnifiedPresetFamily
  id: string
  name: string
  set: string
  payload: unknown
  createdAt?: number
  sourceKind?: string
}

export interface UnifiedPresetBundle {
  app: "Photoshop Web"
  format: "ps-unified-presets"
  version: 1
  exportedAt: string
  sourceDocumentName?: string
  presets: SerializedPresetItem[]
}

export interface PresetImportConflict {
  reason: "duplicate-id" | "duplicate-name"
  family: UnifiedPresetFamily
  id: string
  name: string
  set: string
  existingKey: string
  incomingKey: string
}

export interface MergePresetOptions {
  conflictPolicy?: PresetImportConflictPolicy
  idFactory?: (family: UnifiedPresetFamily, id: string, attempt: number) => string
}

export interface MergePresetResult {
  items: UnifiedPresetItem[]
  conflicts: PresetImportConflict[]
  added: number
  replaced: number
  skipped: number
  renamed: number
}

export interface PresetBundleOptions {
  exportedAt?: string
  sourceDocumentName?: string
}

export interface ParsePresetBundleOptions {
  now?: number
}

const PRESET_LABELS: Record<UnifiedPresetFamily, string> = {
  brush: "Brushes",
  swatch: "Swatches",
  gradient: "Gradients",
  pattern: "Patterns",
  style: "Styles",
  shape: "Shapes",
  "tool-preset": "Tool Setups",
  asset: "Assets",
}

export const PRESET_FAMILIES: UnifiedPresetFamily[] = [
  "brush",
  "swatch",
  "gradient",
  "pattern",
  "style",
  "shape",
  "tool-preset",
  "asset",
]

const FAMILY_SET = new Set<UnifiedPresetFamily>(PRESET_FAMILIES)
const MAX_PRESET_NAME = 96
const MAX_PRESET_SET = 80
const MAX_PRESET_ID = 96
const MAX_BUNDLE_PRESETS = 500
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function presetKey(family: UnifiedPresetFamily, id: string) {
  return `${family}:${id}`
}

export function presetFamilyLabel(family: PresetFamilyFilter) {
  return family === "all" ? "All Presets" : PRESET_LABELS[family]
}

export function collectPresetFamilies(items: readonly UnifiedPresetItem[]): PresetFamilySummary[] {
  const counts = new Map<UnifiedPresetFamily, number>()
  for (const family of PRESET_FAMILIES) counts.set(family, 0)
  for (const item of items) counts.set(item.family, (counts.get(item.family) ?? 0) + 1)
  return [
    { family: "all", label: "All Presets", count: items.length },
    ...PRESET_FAMILIES.map((family) => ({
      family,
      label: PRESET_LABELS[family],
      count: counts.get(family) ?? 0,
    })),
  ]
}

export function collectPresetSets(
  items: readonly UnifiedPresetItem[],
  family: PresetFamilyFilter = "all",
): PresetSetSummary[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (family !== "all" && item.family !== family) continue
    counts.set(item.set, (counts.get(item.set) ?? 0) + 1)
  }
  return [
    { set: "All", count: [...counts.values()].reduce((sum, count) => sum + count, 0) },
    ...[...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([set, count]) => ({ set, count })),
  ]
}

export function filterPresetItems(items: readonly UnifiedPresetItem[], filter: PresetFilter = {}) {
  const family = filter.family ?? "all"
  const set = filter.set ?? "all"
  const query = cleanSearch(filter.query)

  return items.filter((item) => {
    if (family !== "all" && item.family !== family) return false
    if (set.toLowerCase() !== "all" && item.set !== set) return false
    if (!query) return true
    return searchablePresetText(item).includes(query)
  })
}

export function renamePresetItem(
  items: readonly UnifiedPresetItem[],
  key: string,
  name: string,
): UnifiedPresetItem[] {
  return items.map((item) => {
    if (item.key !== key || item.readonly) return item
    return { ...item, name: cleanText(name, item.name, MAX_PRESET_NAME) }
  })
}

export function deletePresetItem(items: readonly UnifiedPresetItem[], key: string): UnifiedPresetItem[] {
  return items.filter((item) => item.key !== key || item.readonly)
}

export function movePresetToSet(
  items: readonly UnifiedPresetItem[],
  key: string,
  set: string,
): UnifiedPresetItem[] {
  return items.map((item) => {
    if (item.key !== key || item.readonly) return item
    return { ...item, set: cleanText(set, item.set, MAX_PRESET_SET) }
  })
}

export function reorderPresetItem(
  items: readonly UnifiedPresetItem[],
  key: string,
  delta: number,
): UnifiedPresetItem[] {
  const index = items.findIndex((item) => item.key === key && !item.readonly)
  if (index < 0) return [...items]
  const nextIndex = Math.max(0, Math.min(items.length - 1, index + delta))
  if (nextIndex === index) return [...items]
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

export function createPresetBundle(
  items: readonly UnifiedPresetItem[],
  options: PresetBundleOptions = {},
): UnifiedPresetBundle {
  const bundle: UnifiedPresetBundle = {
    app: "Photoshop Web",
    format: "ps-unified-presets",
    version: 1,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    presets: items.map(serializePresetItem),
  }
  const sourceDocumentName = cleanOptionalText(options.sourceDocumentName, 120)
  if (sourceDocumentName) bundle.sourceDocumentName = sourceDocumentName
  return bundle
}

export function parsePresetBundle(input: unknown, options: ParsePresetBundleOptions = {}): UnifiedPresetItem[] {
  const parsed = typeof input === "string" ? JSON.parse(input) : input
  const source = isRecord(parsed) && Array.isArray(parsed.presets)
    ? parsed.presets
    : Array.isArray(parsed)
      ? parsed
      : null

  if (!source) throw new Error("Preset file does not contain a presets array.")
  if (source.length > MAX_BUNDLE_PRESETS) throw new Error(`Preset imports are limited to ${MAX_BUNDLE_PRESETS} items.`)

  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  return source.map((item, index) => normalizePresetImport(item, index, now))
}

export function mergePresetItems(
  existing: readonly UnifiedPresetItem[],
  incoming: readonly UnifiedPresetItem[],
  options: MergePresetOptions = {},
): MergePresetResult {
  const conflictPolicy = options.conflictPolicy ?? "keep-both"
  const result: UnifiedPresetItem[] = existing.map(normalizeExistingItem)
  const conflicts: PresetImportConflict[] = []
  let added = 0
  let replaced = 0
  let skipped = 0
  let renamed = 0

  for (const raw of incoming) {
    let item = normalizeExistingItem(raw)
    const idIndex = result.findIndex((existingItem) => samePresetId(existingItem, item))
    if (idIndex >= 0) {
      conflicts.push(makeConflict("duplicate-id", result[idIndex], item))
      if (conflictPolicy === "replace") {
        result[idIndex] = item
        replaced += 1
        continue
      }
      if (conflictPolicy === "skip") {
        skipped += 1
        continue
      }
      item = { ...item, id: uniquePresetId(result, item, options.idFactory) }
      item = { ...item, key: presetKey(item.family, item.id), name: uniquePresetName(result, item) }
      renamed += 1
      result.push(item)
      added += 1
      continue
    }

    const nameIndex = result.findIndex((existingItem) => samePresetName(existingItem, item))
    if (nameIndex >= 0) {
      conflicts.push(makeConflict("duplicate-name", result[nameIndex], item))
      if (conflictPolicy === "replace") {
        result[nameIndex] = item
        replaced += 1
        continue
      }
      if (conflictPolicy === "skip") {
        skipped += 1
        continue
      }
      item = { ...item, name: uniquePresetName(result, item) }
      renamed += 1
    }

    result.push(item)
    added += 1
  }

  return { items: result, conflicts, added, replaced, skipped, renamed }
}

function serializePresetItem(item: UnifiedPresetItem): SerializedPresetItem {
  const serialized: SerializedPresetItem = {
    family: item.family,
    id: cleanId(item.id, item.family, 0),
    name: cleanText(item.name, PRESET_LABELS[item.family], MAX_PRESET_NAME),
    set: cleanText(item.set, "User", MAX_PRESET_SET),
    payload: normalizePortableJson(item.payload, 0, 6),
  }
  if (Number.isFinite(item.createdAt)) serialized.createdAt = Number(item.createdAt)
  const sourceKind = cleanOptionalText(item.sourceKind, 40)
  if (sourceKind) serialized.sourceKind = sourceKind
  return serialized
}

function normalizePresetImport(raw: unknown, index: number, now: number): UnifiedPresetItem {
  if (!isRecord(raw)) throw new Error(`Preset ${index + 1} must be an object.`)
  const family = raw.family
  if (typeof family !== "string" || !FAMILY_SET.has(family as UnifiedPresetFamily)) {
    throw new Error(`Preset ${index + 1} uses an unsupported family.`)
  }
  const presetFamily = family as UnifiedPresetFamily
  const id = cleanId(raw.id, presetFamily, index)
  const name = cleanText(raw.name, `${PRESET_LABELS[presetFamily]} ${index + 1}`, MAX_PRESET_NAME)
  const set = cleanText(raw.set, "Imported", MAX_PRESET_SET)
  const sourceKind = cleanOptionalText(raw.sourceKind, 40)
  const item: UnifiedPresetItem = {
    key: presetKey(presetFamily, id),
    family: presetFamily,
    id,
    name,
    set,
    payload: normalizePortableJson(raw.payload, 0, 6),
    createdAt: cleanTimestamp(raw.createdAt, now),
  }
  if (sourceKind) item.sourceKind = sourceKind
  return item
}

function normalizeExistingItem(item: UnifiedPresetItem): UnifiedPresetItem {
  const family = FAMILY_SET.has(item.family) ? item.family : "asset"
  const id = cleanId(item.id, family, 0)
  return {
    ...item,
    family,
    id,
    key: presetKey(family, id),
    name: cleanText(item.name, PRESET_LABELS[family], MAX_PRESET_NAME),
    set: cleanText(item.set, "User", MAX_PRESET_SET),
    payload: normalizePortableJson(item.payload, 0, 6),
  }
}

function samePresetId(left: UnifiedPresetItem, right: UnifiedPresetItem) {
  return left.family === right.family && left.id === right.id
}

function samePresetName(left: UnifiedPresetItem, right: UnifiedPresetItem) {
  return (
    left.family === right.family &&
    left.set.toLowerCase() === right.set.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  )
}

function makeConflict(
  reason: PresetImportConflict["reason"],
  existing: UnifiedPresetItem,
  incoming: UnifiedPresetItem,
): PresetImportConflict {
  return {
    reason,
    family: incoming.family,
    id: incoming.id,
    name: incoming.name,
    set: incoming.set,
    existingKey: existing.key,
    incomingKey: incoming.key,
  }
}

function uniquePresetId(
  items: readonly UnifiedPresetItem[],
  item: UnifiedPresetItem,
  idFactory?: (family: UnifiedPresetFamily, id: string, attempt: number) => string,
) {
  const used = new Set(items.filter((existing) => existing.family === item.family).map((existing) => existing.id))
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const candidate = cleanId(
      idFactory ? idFactory(item.family, item.id, attempt) : `${item.id}-${attempt + 1}`,
      item.family,
      attempt,
    )
    if (!used.has(candidate)) return candidate
  }
  return cleanId(`${item.id}-${Date.now()}`, item.family, 0)
}

function uniquePresetName(items: readonly UnifiedPresetItem[], item: UnifiedPresetItem) {
  const used = new Set(
    items
      .filter((existing) => existing.family === item.family && existing.set.toLowerCase() === item.set.toLowerCase())
      .map((existing) => existing.name.toLowerCase()),
  )
  const base = item.name.replace(/\s+copy(?: \d+)?$/i, "").trim() || PRESET_LABELS[item.family]
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const candidate = attempt === 1 ? `${base} copy` : `${base} copy ${attempt}`
    if (!used.has(candidate.toLowerCase())) return candidate.slice(0, MAX_PRESET_NAME)
  }
  return `${base} copy`.slice(0, MAX_PRESET_NAME)
}

function searchablePresetText(item: UnifiedPresetItem) {
  const source = `${item.name} ${item.set} ${item.family} ${item.sourceKind ?? ""} ${safePayloadText(item.payload)}`
  return source.toLowerCase()
}

function safePayloadText(payload: unknown) {
  try {
    return JSON.stringify(payload) ?? ""
  } catch {
    return ""
  }
}

function cleanSearch(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

function cleanOptionalText(value: unknown, maxLength: number) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

function cleanId(value: unknown, family: UnifiedPresetFamily, index: number) {
  const raw = typeof value === "string" ? value.trim() : ""
  const normalized = raw.replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/-+/g, "-").slice(0, MAX_PRESET_ID)
  if (normalized && !RESERVED_KEYS.has(normalized)) return normalized
  return `${family}-${index + 1}`
}

function cleanTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizePortableJson(value: unknown, depth: number, maxDepth: number): unknown {
  if (value == null) return value
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") return value.slice(0, 1_000)
  if (Array.isArray(value)) {
    if (depth >= maxDepth) return []
    return value
      .slice(0, 256)
      .map((item) => normalizePortableJson(item, depth + 1, maxDepth))
      .filter((item) => item !== undefined)
  }
  if (isRecord(value)) {
    if (depth >= maxDepth) return {}
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value).slice(0, 256)) {
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key) || RESERVED_KEYS.has(key)) continue
      const next = normalizePortableJson(nested, depth + 1, maxDepth)
      if (next !== undefined) out[key] = next
    }
    return out
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
