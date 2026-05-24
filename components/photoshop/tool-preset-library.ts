import type { AssetLibraryItem } from "./types"

const MAX_TOOL_PRESETS = 256
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

function cleanText(value: unknown, fallback: string, max = 80) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return (text || fallback).slice(0, max)
}

function cleanId(value: unknown, index: number) {
  const text = typeof value === "string" ? value.trim() : ""
  return SAFE_ID.test(text) && !["__proto__", "constructor", "prototype"].includes(text)
    ? text
    : `tool_preset_${Date.now()}_${index}`
}

export function normalizeToolPresetAssets(input: unknown): AssetLibraryItem[] {
  const source =
    input && typeof input === "object" && !Array.isArray(input) && "presets" in input
      ? (input as { presets?: unknown }).presets
      : input
  if (!Array.isArray(source)) return []
  const out: AssetLibraryItem[] = []
  const seen = new Set<string>()
  for (const [index, raw] of source.slice(0, MAX_TOOL_PRESETS).entries()) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Record<string, unknown>
    if (record.kind !== "tool-preset" && !record.payload) continue
    const id = cleanId(record.id, index)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: cleanText(record.name, `Tool Preset ${index + 1}`),
      kind: "tool-preset",
      group: cleanText(record.group, "Tools", 48),
      createdAt: Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : Date.now(),
      payload: record.payload && typeof record.payload === "object" ? record.payload : record,
    })
  }
  return out
}

export function serializeToolPresetAssets(presets: readonly AssetLibraryItem[]) {
  return JSON.stringify(
    {
      app: "Photoshop Web",
      format: "ps-tool-presets",
      version: 1,
      exportedAt: new Date().toISOString(),
      presets,
    },
    null,
    2,
  )
}

export function mergeToolPresetAssets(existing: readonly AssetLibraryItem[], incoming: readonly AssetLibraryItem[]) {
  const byId = new Map<string, AssetLibraryItem>()
  for (const preset of existing) byId.set(preset.id, preset)
  for (const preset of incoming) byId.set(preset.id, preset)
  return [...byId.values()].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name))
}
