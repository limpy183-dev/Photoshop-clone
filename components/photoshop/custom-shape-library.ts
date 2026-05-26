import type { AssetLibraryItem, ShapeProps } from "./types"

export interface CustomShapeLibraryExport {
  app: "Photoshop Web"
  format: "ps-custom-shapes"
  version: 1
  name: string
  exportedAt: string
  shapeCount: number
  groups: string[]
  shapes: AssetLibraryItem[]
}

export type CustomShapeConflictPolicy = "keep-both" | "replace" | "skip"
export type CustomShapeSortKey = "name" | "group" | "createdAt" | "updatedAt"

export interface CustomShapeMergeOptions {
  conflictPolicy?: CustomShapeConflictPolicy
  idFactory?: (id: string, attempt: number) => string
}

export interface CustomShapeMergeResult {
  shapes: AssetLibraryItem[]
  added: number
  replaced: number
  skipped: number
  renamed: number
  conflicts: Array<{ id: string; reason: "duplicate-id" | "duplicate-name"; resolution: CustomShapeConflictPolicy | "renamed" }>
}

export interface CustomShapeOrganizationOptions {
  query?: string
  group?: string
  sortBy?: CustomShapeSortKey
  sortDirection?: "asc" | "desc"
}

export interface CustomShapeLibraryGroup {
  group: string
  items: AssetLibraryItem[]
}

const SHAPE_TYPES = new Set(["rect", "ellipse", "custom", "polygon", "star"])
const MAX_SHAPES = 512
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function shapePresetToAsset(
  shape: ShapeProps,
  options: { name?: string; group?: string; tags?: string[]; now?: number } = {},
): AssetLibraryItem {
  return {
    id: `shape_${slug(options.name ?? shape.type)}_${Math.random().toString(36).slice(2, 8)}`,
    name: cleanText(options.name, `${shape.type} shape`, 80),
    kind: "shape",
    group: cleanOptionalText(options.group, 80) ?? "Custom Shapes",
    tags: cleanTags(options.tags),
    payload: normalizeShapePayload(shape),
    createdAt: Number.isFinite(options.now) ? Number(options.now) : Date.now(),
  }
}

export function shapeAssetToPreset(
  asset: AssetLibraryItem,
  rect: { x: number; y: number; w: number; h: number; fill?: string; stroke?: ShapeProps["stroke"] },
): ShapeProps {
  const shape = normalizeShapePayload(asset.payload)
  return {
    ...shape,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    fill: rect.fill ?? shape.fill,
    stroke: rect.stroke !== undefined ? rect.stroke : shape.stroke,
  }
}

export function normalizeCustomShapeLibrary(input: unknown): AssetLibraryItem[] {
  const source = extractShapeArray(input)
  const out: AssetLibraryItem[] = []
  const seen = new Set<string>()
  for (const [index, raw] of source.slice(0, MAX_SHAPES).entries()) {
    const asset = normalizeShapeAsset(raw, index)
    if (!asset || seen.has(asset.id)) continue
    seen.add(asset.id)
    out.push(asset)
  }
  return out
}

export function exportCustomShapeLibrary(
  shapes: readonly AssetLibraryItem[],
  options: { name?: string; exportedAt?: string } = {},
): CustomShapeLibraryExport {
  const normalized = normalizeCustomShapeLibrary([...shapes])
  return {
    app: "Photoshop Web",
    format: "ps-custom-shapes",
    version: 1,
    name: cleanText(options.name, "Custom Shapes", 80),
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    shapeCount: normalized.length,
    groups: [...new Set(normalized.map((asset) => asset.group ?? "Custom Shapes"))].sort((a, b) => a.localeCompare(b)),
    shapes: normalized,
  }
}

export function mergeCustomShapeLibraries(
  existingShapes: readonly AssetLibraryItem[],
  incomingShapes: readonly AssetLibraryItem[],
  options: CustomShapeMergeOptions = {},
): CustomShapeMergeResult {
  const conflictPolicy = options.conflictPolicy ?? "keep-both"
  const existing = normalizeCustomShapeLibrary([...existingShapes])
  const incoming = normalizeCustomShapeLibrary([...incomingShapes])
  const shapes = existing.map((asset) => cloneAsset(asset))
  const conflicts: CustomShapeMergeResult["conflicts"] = []
  const ids = new Set(shapes.map((asset) => asset.id))
  const names = new Set(shapes.map((asset) => normalizeNameKey(asset.name)))
  let added = 0
  let replaced = 0
  let skipped = 0
  let renamed = 0

  for (const rawAsset of incoming) {
    const asset = cloneAsset(rawAsset)
    const existingIndex = shapes.findIndex((candidate) => candidate.id === asset.id)
    if (existingIndex >= 0) {
      conflicts.push({ id: asset.id, reason: "duplicate-id", resolution: conflictPolicy })
      if (conflictPolicy === "skip") {
        skipped += 1
        continue
      }
      if (conflictPolicy === "replace") {
        const previous = shapes[existingIndex]
        names.delete(normalizeNameKey(previous.name))
        shapes[existingIndex] = asset
        names.add(normalizeNameKey(asset.name))
        replaced += 1
        continue
      }
      asset.id = makeUniqueShapeId(asset.id, ids, options.idFactory)
    }

    const nameKey = normalizeNameKey(asset.name)
    if (names.has(nameKey)) {
      conflicts.push({ id: asset.id, reason: "duplicate-name", resolution: "renamed" })
      asset.name = makeUniqueShapeName(asset.name, names)
      renamed += 1
    }
    ids.add(asset.id)
    names.add(normalizeNameKey(asset.name))
    shapes.push(asset)
    added += 1
  }

  return { shapes, added, replaced, skipped, renamed, conflicts }
}

export function organizeCustomShapeLibrary(
  shapes: readonly AssetLibraryItem[],
  options: CustomShapeOrganizationOptions = {},
): CustomShapeLibraryGroup[] {
  const query = normalizeSearch(options.query)
  const groupFilter = normalizeSearch(options.group)
  const sortBy = options.sortBy ?? "group"
  const direction = options.sortDirection ?? "asc"
  const multiplier = direction === "desc" ? -1 : 1
  const normalized = normalizeCustomShapeLibrary([...shapes]).filter((asset) => {
    const group = asset.group ?? "Custom Shapes"
    if (groupFilter && normalizeSearch(group) !== groupFilter) return false
    if (!query) return true
    const haystack = normalizeSearch([
      asset.name,
      group,
      asset.description ?? "",
      ...(asset.tags ?? []),
    ].join(" "))
    return haystack.includes(query)
  })

  normalized.sort((a, b) => compareShapeAssets(a, b, sortBy) * multiplier || compareShapeAssets(a, b, "name"))

  const groups = new Map<string, AssetLibraryItem[]>()
  for (const asset of normalized) {
    const group = asset.group ?? "Custom Shapes"
    const bucket = groups.get(group) ?? []
    bucket.push(asset)
    groups.set(group, bucket)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => ({ group, items }))
}

function normalizeShapeAsset(raw: unknown, index: number): AssetLibraryItem | null {
  if (!isRecord(raw)) return null
  const kind = typeof raw.kind === "string" ? raw.kind : "shape"
  if (kind !== "shape") return null
  const payload = normalizeShapePayload(raw.payload ?? raw)
  return {
    id: cleanId(raw.id, "shape", index),
    name: cleanText(raw.name, `${payload.type} shape`, 80),
    kind: "shape",
    group: cleanOptionalText(raw.group, 80) ?? "Custom Shapes",
    tags: cleanTags(raw.tags),
    description: cleanOptionalText(raw.description, 180),
    payload,
    createdAt: cleanTimestamp(raw.createdAt),
    updatedAt: cleanOptionalTimestamp(raw.updatedAt),
  }
}

function normalizeShapePayload(value: unknown): ShapeProps {
  const record = isRecord(value) ? value : {}
  const type = typeof record.type === "string" && SHAPE_TYPES.has(record.type) ? record.type as ShapeProps["type"] : "custom"
  const fill = typeof record.fill === "string" && HEX_COLOR.test(record.fill) ? record.fill : "#ffffff"
  return {
    type,
    x: cleanNumber(record.x, 0),
    y: cleanNumber(record.y, 0),
    w: Math.max(1, cleanNumber(record.w, 100)),
    h: Math.max(1, cleanNumber(record.h, 100)),
    fill,
    stroke: normalizeStroke(record.stroke),
    radius: clampOptional(record.radius, 0, 10000),
    cornerRadii: normalizeCornerRadii(record.cornerRadii),
    customId: typeof record.customId === "string" ? record.customId as ShapeProps["customId"] : undefined,
    sides: clampOptional(record.sides, 3, 64),
    innerRadiusRatio: clampOptional(record.innerRadiusRatio, 0.05, 0.95),
    rotation: clampOptional(record.rotation, -360, 360),
    vertexRoundness: clampOptional(record.vertexRoundness, 0, 1),
    smoothCorners: typeof record.smoothCorners === "boolean" ? record.smoothCorners : undefined,
    smoothIndent: typeof record.smoothIndent === "boolean" ? record.smoothIndent : undefined,
    starPoints: clampOptional(record.starPoints, 3, 64),
    computedPath: isRecord(record.computedPath) ? record.computedPath as unknown as ShapeProps["computedPath"] : undefined,
    components: Array.isArray(record.components) ? record.components as ShapeProps["components"] : undefined,
    booleanOperation: typeof record.booleanOperation === "string" ? record.booleanOperation as ShapeProps["booleanOperation"] : undefined,
  }
}

function normalizeStroke(value: unknown): ShapeProps["stroke"] {
  if (!isRecord(value)) return null
  const color = typeof value.color === "string" && HEX_COLOR.test(value.color) ? value.color : "#000000"
  const width = Math.max(0, cleanNumber(value.width, 0))
  return width > 0 ? { color, width } : null
}

function normalizeCornerRadii(value: unknown): ShapeProps["cornerRadii"] {
  if (!Array.isArray(value) || value.length < 4) return undefined
  return value.slice(0, 4).map((entry) => Math.max(0, cleanNumber(entry, 0))) as [number, number, number, number]
}

function extractShapeArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input)) return []
  if (Array.isArray(input.shapes)) return input.shapes
  if (Array.isArray(input.assets)) return input.assets.filter((asset) => isRecord(asset) && asset.kind === "shape")
  return []
}

function cleanNumber(value: unknown, fallback: number) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function clampOptional(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return undefined
  const next = cleanNumber(value, NaN)
  return Number.isFinite(next) ? Math.max(min, Math.min(max, next)) : undefined
}

function cleanText(value: unknown, fallback: string, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return (text || fallback).slice(0, max)
}

function cleanOptionalText(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return text ? text.slice(0, max) : undefined
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32))
    .filter(Boolean))]
    .slice(0, 12)
}

function cleanTimestamp(value: unknown) {
  const next = Number(value)
  return Number.isFinite(next) ? next : Date.now()
}

function cleanOptionalTimestamp(value: unknown) {
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

function cleanId(value: unknown, prefix: string, index: number) {
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value)) {
    return value
  }
  return `${prefix}_${index}_${Math.random().toString(36).slice(2, 8)}`
}

function cloneAsset(asset: AssetLibraryItem): AssetLibraryItem {
  return {
    ...asset,
    tags: asset.tags ? [...asset.tags] : undefined,
    payload: normalizeShapePayload(asset.payload),
  }
}

function normalizeNameKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function normalizeSearch(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : ""
}

function sanitizeIdFragment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "shape"
}

function makeUniqueShapeId(
  baseId: string,
  ids: Set<string>,
  idFactory: ((id: string, attempt: number) => string) | undefined,
) {
  const base = sanitizeIdFragment(baseId)
  for (let attempt = 1; attempt < 1000; attempt++) {
    const candidate = sanitizeIdFragment(idFactory ? idFactory(base, attempt) : `${base}-copy-${attempt}`)
    if (!ids.has(candidate) && !["__proto__", "constructor", "prototype"].includes(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

function makeUniqueShapeName(baseName: string, names: Set<string>) {
  const base = cleanText(baseName, "Shape", 72).replace(/\s+copy(?:\s+\d+)?$/i, "")
  for (let attempt = 1; attempt < 1000; attempt++) {
    const candidate = attempt === 1 ? `${base} copy` : `${base} copy ${attempt}`
    if (!names.has(normalizeNameKey(candidate))) return candidate
  }
  return `${base} copy ${Date.now()}`
}

function compareShapeAssets(a: AssetLibraryItem, b: AssetLibraryItem, key: CustomShapeSortKey) {
  if (key === "createdAt" || key === "updatedAt") {
    return (a[key] ?? 0) - (b[key] ?? 0)
  }
  const left = key === "group" ? a.group ?? "Custom Shapes" : a.name
  const right = key === "group" ? b.group ?? "Custom Shapes" : b.name
  return left.localeCompare(right)
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "custom"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
