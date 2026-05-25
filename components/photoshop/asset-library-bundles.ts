import type { AssetLibraryItem } from "./types"

export interface AssetLibraryBundle {
  app: "Photoshop Web"
  format: "ps-local-library"
  version: 1
  name: string
  documentName?: string
  exportedAt: string
  assets: AssetLibraryItem[]
  tags: string[]
  groups: string[]
}

export interface AssetLibraryFilter {
  kind?: AssetLibraryItem["kind"] | "all"
  query?: string
  tag?: string
}

export function normalizeAssetTags(tags: unknown, limit = 12): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (typeof tag !== "string") continue
    const clean = tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= limit) break
  }
  return out
}

export function createAssetLibraryBundle(
  assets: AssetLibraryItem[],
  options: { name?: string; documentName?: string; exportedAt?: string } = {},
): AssetLibraryBundle {
  const cleaned = assets.map((asset) => ({
    ...clonePlain(asset),
    tags: normalizeAssetTags(asset.tags),
  }))
  return {
    app: "Photoshop Web",
    format: "ps-local-library",
    version: 1,
    name: cleanText(options.name, "Local Library", 80),
    documentName: cleanOptionalText(options.documentName, 120),
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    assets: cleaned,
    tags: collectAssetTags(cleaned).map((entry) => entry.tag),
    groups: collectAssetGroups(cleaned),
  }
}

export function extractAssetLibraryArray(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed
  if (!isRecord(parsed)) return undefined
  if (Array.isArray(parsed.assets)) return parsed.assets
  if (parsed.format === "ps-local-library" && Array.isArray(parsed.items)) return parsed.items
  return undefined
}

export function filterAssetLibrary(assets: AssetLibraryItem[], filter: AssetLibraryFilter): AssetLibraryItem[] {
  const kind = filter.kind ?? "all"
  const tag = normalizeAssetTags(filter.tag ? [filter.tag] : [])[0]
  return assets.filter((asset) => {
    if (kind !== "all" && asset.kind !== kind) return false
    if (tag && !normalizeAssetTags(asset.tags).includes(tag)) return false
    return assetMatchesQuery(asset, filter.query ?? "")
  })
}

export function assetMatchesQuery(asset: AssetLibraryItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).map((word) => word.trim()).filter(Boolean)
  if (!words.length) return true
  const haystack = [
    asset.name,
    asset.kind,
    asset.group,
    asset.description,
    ...(asset.tags ?? []),
    payloadSearchText(asset.payload),
  ].filter(Boolean).join(" ").toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export function collectAssetTags(assets: AssetLibraryItem[]) {
  const counts = new Map<string, number>()
  for (const asset of assets) {
    for (const tag of normalizeAssetTags(asset.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function collectAssetGroups(assets: AssetLibraryItem[]) {
  return [...new Set(assets.map((asset) => cleanOptionalText(asset.group, 80)).filter((group): group is string => !!group))]
    .sort((a, b) => a.localeCompare(b))
}

function payloadSearchText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.slice(0, 32).map(payloadSearchText).join(" ")
  if (isRecord(value)) {
    return Object.entries(value).slice(0, 32).map(([key, nested]) => `${key} ${payloadSearchText(nested)}`).join(" ")
  }
  return ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  const clean = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return (clean || fallback).slice(0, maxLength)
}

function cleanOptionalText(value: unknown, maxLength: number) {
  const clean = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return clean ? clean.slice(0, maxLength) : undefined
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
