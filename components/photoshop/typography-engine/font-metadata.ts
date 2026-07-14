import type {
  TextProps,
  TypographyAxisDefinition,
  TypographyEmbeddedFont,
  TypographyNamedInstance,
} from "../types"
import {
  clamp,
  compareAxisOrder,
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  formatAxisValue,
  WEB_SAFE_FONT_CANDIDATES,
  type OpenTypeFontMetadata,
  type VariableFontAxisControl,
  type VariableFontAxisControlModel,
  type VariableFontInspection,
  type VariableFontMetadata,
} from "../typography-engine-types"
import { embeddedFontToArrayBuffer } from "./embedded-fonts"
import {
  detectSfntFormat,
  fixed16,
  parseLayoutFeatureTags,
  parseNameTable,
  readTag,
  sfntTables,
} from "./font-parser"

export function parseOpenTypeFontMetadata(buffer: ArrayBuffer): OpenTypeFontMetadata {
  const { data, view, tables } = sfntTables(buffer)
  const variable = parseVariableFontMetadata(buffer)
  const head = tables.get("head")
  const maxp = tables.get("maxp")
  const name = tables.get("name")
  const names = name ? parseNameTable(data, view, name.offset, name.length) : new Map<number, string>()
  const featureTags = [...new Set([
    ...parseLayoutFeatureTags(data, view, tables.get("GSUB")),
    ...parseLayoutFeatureTags(data, view, tables.get("GPOS")),
  ])].sort()
  return {
    ...variable,
    format: detectSfntFormat(buffer),
    unitsPerEm: head && head.length >= 20 ? view.getUint16(head.offset + 18, false) : undefined,
    glyphCount: maxp && maxp.length >= 6 ? view.getUint16(maxp.offset + 4, false) : undefined,
    featureTags,
    familyNames: [names.get(1), names.get(4), names.get(6)].filter((value): value is string => !!value),
  }
}

export function parseVariableFontMetadata(buffer: ArrayBuffer): VariableFontMetadata {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (data.length < 12) return { axes: [], namedInstances: [] }
  const tableCount = view.getUint16(4, false)
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16
    if (record + 16 > data.length) break
    const tag = readTag(data, record)
    const offset = view.getUint32(record + 8, false)
    const length = view.getUint32(record + 12, false)
    if (offset + length <= data.length) tables.set(tag, { offset, length })
  }

  const fvar = tables.get("fvar")
  if (!fvar || fvar.length < 16) return { axes: [], namedInstances: [] }
  const name = tables.get("name")
  const names = name ? parseNameTable(data, view, name.offset, name.length) : new Map<number, string>()
  const axisOffset = fvar.offset + view.getUint16(fvar.offset + 4, false)
  const axisCount = view.getUint16(fvar.offset + 8, false)
  const axisSize = view.getUint16(fvar.offset + 10, false)
  const instanceCount = view.getUint16(fvar.offset + 12, false)
  const instanceSize = view.getUint16(fvar.offset + 14, false)
  if (axisSize < 20 || axisOffset + axisCount * axisSize > fvar.offset + fvar.length) {
    return { axes: [], namedInstances: [] }
  }

  const axes: TypographyAxisDefinition[] = []
  for (let i = 0; i < axisCount; i++) {
    const record = axisOffset + i * axisSize
    const tag = readTag(data, record)
    if (!tag.trim()) continue
    const nameId = view.getUint16(record + 18, false)
    axes.push({
      tag,
      name: names.get(nameId) ?? tag.toUpperCase(),
      min: fixed16(view, record + 4),
      defaultValue: fixed16(view, record + 8),
      max: fixed16(view, record + 12),
    })
  }

  const namedInstances: TypographyNamedInstance[] = []
  const instanceOffset = axisOffset + axisCount * axisSize
  for (let i = 0; i < instanceCount; i++) {
    const record = instanceOffset + i * instanceSize
    if (record + 4 + axes.length * 4 > fvar.offset + fvar.length) break
    const nameId = view.getUint16(record, false)
    const coordinates: Record<string, number> = {}
    axes.forEach((axis, axisIndex) => {
      coordinates[axis.tag] = fixed16(view, record + 4 + axisIndex * 4)
    })
    namedInstances.push({ name: names.get(nameId) ?? `Instance ${i + 1}`, coordinates })
  }

  return { axes, namedInstances }
}

interface LocalFontAccessData {
  family: string
  fullName?: string
  postscriptName?: string
  style?: string
  blob?: () => Promise<Blob>
}

type QueryLocalFonts = (options?: { postscriptNames?: string[] }) => Promise<LocalFontAccessData[]>

export async function inspectVariableFont(
  fontFamily: string,
  options: { allowLocalFontAccess?: boolean; embeddedFont?: TypographyEmbeddedFont; fontData?: ArrayBuffer } = {},
): Promise<VariableFontInspection> {
  const fallback = WEB_SAFE_FONT_CANDIDATES.find((candidate) => candidate.family.toLowerCase() === fontFamily.toLowerCase())
  const fallbackAxes = fallback?.variableAxes ?? []
  const fontData = options.fontData ?? (options.embeddedFont ? embeddedFontToArrayBuffer(options.embeddedFont) : undefined)
  if (fontData) {
    const metadata = parseOpenTypeFontMetadata(fontData)
    return {
      family: fontFamily,
      source: "embedded-font",
      axes: metadata.axes,
      namedInstances: metadata.namedInstances,
    }
  }
  if (options.allowLocalFontAccess) {
    const root = globalThis as typeof globalThis & { queryLocalFonts?: QueryLocalFonts }
    try {
      const localFonts = root.queryLocalFonts ? await root.queryLocalFonts() : []
      const match = localFonts.find((font) =>
        [font.family, font.fullName, font.postscriptName]
          .filter(Boolean)
          .some((name) => String(name).toLowerCase() === fontFamily.toLowerCase()),
      )
      if (match?.blob) {
        const blob = await match.blob()
        const metadata = parseVariableFontMetadata(await blob.arrayBuffer())
        if (metadata.axes.length || metadata.namedInstances.length) {
          return { family: fontFamily, source: "font-access", ...metadata }
        }
      }
    } catch (error) {
      return {
        family: fontFamily,
        source: "fallback",
        axes: fallbackAxes,
        namedInstances: [],
        error: error instanceof Error ? error.message : "Unable to inspect local font",
      }
    }
  }

  return {
    family: fontFamily,
    source: fallbackAxes.length ? "font-face" : "fallback",
    axes: fallbackAxes,
    namedInstances: [],
  }
}

function mergeAxisDefinitions(
  activeValues: Record<string, number> | undefined,
  definitions: readonly TypographyAxisDefinition[],
  customSource: VariableFontAxisControl["source"],
) {
  const controls: VariableFontAxisControl[] = definitions
    .filter((axis) => axis.tag.trim())
    .map((axis) => ({
      ...axis,
      value: clamp(Number(activeValues?.[axis.tag] ?? axis.defaultValue), axis.min, axis.max),
      source: customSource,
    }))
  const known = new Set(controls.map((axis) => axis.tag))
  for (const [tag, rawValue] of Object.entries(activeValues ?? {})) {
    if (known.has(tag) || !Number.isFinite(rawValue)) continue
    controls.push({
      tag,
      name: tag.toUpperCase(),
      min: Math.min(-1000, rawValue),
      max: Math.max(1000, rawValue),
      defaultValue: rawValue,
      value: rawValue,
      source: "custom",
    })
  }
  return controls.sort((a, b) => compareAxisOrder(a.tag, b.tag))
}

export function buildVariableFontAxisControlModel(
  text: TextProps,
  inspection?: VariableFontInspection | null,
): VariableFontAxisControlModel {
  const discovered = inspection?.axes ?? []
  const stored = text.variableAxisDefinitions ?? []
  const definitions = discovered.length ? discovered : stored.length ? stored : DEFAULT_VARIABLE_AXIS_DEFINITIONS
  const source: VariableFontAxisControlModel["source"] = discovered.length
    ? inspection?.source ?? "font-face"
    : stored.length
      ? "stored"
      : "default"
  const axisSource: VariableFontAxisControl["source"] = discovered.length
    ? "discovered"
    : stored.length
      ? "stored"
      : "default"
  const axes = mergeAxisDefinitions(text.variableAxes, definitions, axisSource)
  const namedInstances = (inspection?.namedInstances ?? []).map((instance) => ({
    ...instance,
    label: instance.name,
    summary: Object.entries(instance.coordinates)
      .sort(([a], [b]) => compareAxisOrder(a, b))
      .map(([tag, value]) => `${tag} ${formatAxisValue(value)}`)
      .join(", "),
  }))
  const discoveredCount = discovered.length
  const customCount = axes.filter((axis) => axis.source === "custom").length
  const sourceLabel =
    source === "embedded-font"
      ? "embedded font file"
      : source === "font-access"
      ? "local font file"
      : source === "font-face"
        ? "font metadata"
        : source === "stored"
          ? "stored layer metadata"
          : "default axis presets"
  const status = `${discoveredCount || axes.length} ${discoveredCount ? "discovered" : "available"} axes from ${sourceLabel}${customCount ? `, ${customCount} custom active axis${customCount === 1 ? "" : "es"}` : ""}`
  return {
    family: inspection?.family ?? text.font,
    source,
    axes,
    namedInstances,
    status,
    error: inspection?.error,
  }
}
