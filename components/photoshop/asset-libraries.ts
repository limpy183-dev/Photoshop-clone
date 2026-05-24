import type { GradientStop } from "./types"

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const CSS_COLOR = /^(#[0-9a-f]{6}|rgba?\([^)]+\))$/i
const SAFE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i
const MAX_ITEMS = 512
const MAX_NAME = 80
const MAX_DATA_URL_LENGTH = 4_000_000

export interface SwatchEntry {
  id: string
  name: string
  color: string
  group: string
  createdAt: number
}

export interface GradientLibraryPreset {
  id: string
  name: string
  group: string
  stops: { pos: number; color: string }[]
  createdAt: number
}

export interface PatternLibraryEntry {
  id: string
  name: string
  group: string
  dataURL: string
  width: number
  height: number
  createdAt: number
}

function cleanText(value: unknown, fallback: string, max = MAX_NAME) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return (text || fallback).slice(0, max)
}

function cleanId(value: unknown, prefix: string, index: number) {
  const text = typeof value === "string" ? value.trim() : ""
  if (/^[A-Za-z0-9_-]{1,80}$/.test(text) && !["__proto__", "constructor", "prototype"].includes(text)) return text
  return `${prefix}_${index}_${Math.random().toString(36).slice(2, 8)}`
}

function cleanCreatedAt(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : Date.now()
}

function cleanGroup(value: unknown, fallback = "User") {
  return cleanText(value, fallback, 48)
}

export function normalizeSwatchEntries(input: unknown): SwatchEntry[] {
  const source =
    input && typeof input === "object" && !Array.isArray(input) && "swatches" in input
      ? (input as { swatches?: unknown }).swatches
      : input
  if (!Array.isArray(source)) return []

  const out: SwatchEntry[] = []
  const seen = new Set<string>()
  for (const [index, raw] of source.slice(0, MAX_ITEMS).entries()) {
    const color = typeof raw === "string"
      ? raw.trim().toLowerCase()
      : raw && typeof raw === "object" && typeof (raw as { color?: unknown }).color === "string"
        ? String((raw as { color: string }).color).trim().toLowerCase()
        : ""
    if (!HEX_COLOR.test(color) || seen.has(color)) continue
    seen.add(color)
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    out.push({
      id: cleanId(record.id, "swatch", index),
      name: cleanText(record.name, color.toUpperCase()),
      color,
      group: cleanGroup(record.group, "User"),
      createdAt: cleanCreatedAt(record.createdAt),
    })
  }
  return out
}

export function swatchEntriesToExport(swatches: readonly SwatchEntry[]) {
  return {
    app: "Photoshop Web",
    format: "ps-swatches",
    version: 2,
    swatches,
  }
}

function cleanGradientStops(value: unknown): { pos: number; color: string }[] {
  if (!Array.isArray(value)) return []
  const stops = value
    .slice(0, 16)
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null
      const record = raw as Record<string, unknown>
      const rawPos = typeof record.pos === "number" ? record.pos : typeof record.offset === "number" ? record.offset : 0
      const color = typeof record.color === "string" && CSS_COLOR.test(record.color.trim()) ? record.color.trim() : ""
      if (!color) return null
      return { pos: Math.max(0, Math.min(1, rawPos)), color }
    })
    .filter((stop): stop is { pos: number; color: string } => !!stop)
    .sort((a, b) => a.pos - b.pos)
  return stops.length >= 2 ? stops : []
}

export function normalizeGradientPresets(input: unknown): GradientLibraryPreset[] {
  const source =
    input && typeof input === "object" && !Array.isArray(input) && "gradients" in input
      ? (input as { gradients?: unknown }).gradients
      : input
  if (!Array.isArray(source)) return []

  const out: GradientLibraryPreset[] = []
  const seen = new Set<string>()
  for (const [index, raw] of source.slice(0, MAX_ITEMS).entries()) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Record<string, unknown>
    const stops = cleanGradientStops(record.stops)
    if (!stops.length) continue
    const id = cleanId(record.id, "gradient", index)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: cleanText(record.name, `Gradient ${index + 1}`),
      group: cleanGroup(record.group, "User"),
      stops,
      createdAt: cleanCreatedAt(record.createdAt),
    })
  }
  return out
}

export function gradientStopsToEditorStops(stops: readonly { pos: number; color: string }[]): GradientStop[] {
  return stops.map((stop) => ({
    offset: stop.pos,
    color: stop.color,
    opacity: stop.color.includes("rgba") && /,\s*0\s*\)$/i.test(stop.color) ? 0 : 1,
  }))
}

export function normalizePatternEntries(input: unknown): PatternLibraryEntry[] {
  const source =
    input && typeof input === "object" && !Array.isArray(input) && "patterns" in input
      ? (input as { patterns?: unknown }).patterns
      : input
  if (!Array.isArray(source)) return []

  const out: PatternLibraryEntry[] = []
  const seen = new Set<string>()
  for (const [index, raw] of source.slice(0, 128).entries()) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Record<string, unknown>
    const dataURL = typeof record.dataURL === "string" ? record.dataURL.trim() : ""
    if (dataURL.length > MAX_DATA_URL_LENGTH || !SAFE_DATA_URL.test(dataURL)) continue
    const id = cleanId(record.id, "pattern", index)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: cleanText(record.name, `Pattern ${index + 1}`),
      group: cleanGroup(record.group, "User"),
      dataURL,
      width: Math.max(1, Math.min(4096, Math.round(Number(record.width) || 1))),
      height: Math.max(1, Math.min(4096, Math.round(Number(record.height) || 1))),
      createdAt: cleanCreatedAt(record.createdAt),
    })
  }
  return out
}

export function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]) {
  const byId = new Map<string, T>()
  for (const item of existing) byId.set(item.id, item)
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()]
}
