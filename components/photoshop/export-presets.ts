import type { ExportFormat } from "./document-io"
import type { TiffCompression } from "./raster-codecs"
import type { AssetLibraryItem } from "./types"

export type ExportPresetPayload = Partial<{
  dialog: "export-as"
  format: ExportFormat
  scale: number
  quality: number
  transparent: boolean
  matte: string
  dither: boolean
  losslessWebp: boolean
  webpNearLossless: number
  webpMethod: number
  webpExactAlpha: boolean
  webpAlphaQuality: number
  webpAlphaFilter: "none" | "fast" | "best"
  avifLossless: boolean
  avifSpeed: number
  avifBitDepth: number
  avifChromaSubsampling: string
  avifTileRowsLog2: number
  avifTileColsLog2: number
  tgaJobName: string
  tgaSoftwareId: string
  tgaAspectRatioNumerator: number
  tgaAspectRatioDenominator: number
  tgaGamma: number
  netpbmComments: string
  netpbmSourceMaxValue: number
  includeMetadata: boolean
  precision: number
  tiffCompression: TiffCompression
  tgaRle: boolean
  metadataAuthor: string
  metadataCopyright: string
  metadataDescription: string
  metadataCreationDate: string
}>

export interface ExportPresetMutationInput {
  id?: string
  name: string
  payload: ExportPresetPayload
}

interface ExportPresetTools {
  idFactory?: () => string
  now?: () => number
}

interface ExportPresetLibraryFile {
  format: "ps-export-presets"
  version: 1
  presets: Array<{
    id?: string
    name: string
    payload: ExportPresetPayload
    createdAt?: number
  }>
}

const DEFAULT_TOOLS: Required<ExportPresetTools> = {
  idFactory: () => `asset_${Math.random().toString(36).slice(2, 9)}`,
  now: () => Date.now(),
}

function tools(input?: ExportPresetTools) {
  return {
    idFactory: input?.idFactory ?? DEFAULT_TOOLS.idFactory,
    now: input?.now ?? DEFAULT_TOOLS.now,
  }
}

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 80) || "Export Preset"
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function exportPresetAssets(assets: readonly AssetLibraryItem[] | undefined) {
  return (assets ?? []).filter((asset) => asset.kind === "export")
}

export function upsertExportPresetAsset(
  assets: readonly AssetLibraryItem[],
  input: ExportPresetMutationInput,
  options?: ExportPresetTools,
): AssetLibraryItem[] {
  const t = tools(options)
  const name = cleanName(input.name)
  const id = input.id || t.idFactory()
  const existing = assets.find((asset) => asset.id === id)
  const nextAsset: AssetLibraryItem = {
    id,
    name,
    kind: "export",
    group: "Export",
    payload: {
      ...input.payload,
      dialog: input.payload.dialog ?? "export-as",
    },
    createdAt: existing?.createdAt ?? t.now(),
  }
  if (existing) {
    return assets.map((asset) => (asset.id === id ? nextAsset : asset))
  }
  return [nextAsset, ...assets]
}

export function deleteExportPresetAsset(
  assets: readonly AssetLibraryItem[],
  id: string,
): AssetLibraryItem[] {
  return assets.filter((asset) => asset.id !== id)
}

export function duplicateExportPresetAsset(
  assets: readonly AssetLibraryItem[],
  id: string,
  options?: ExportPresetTools,
): AssetLibraryItem[] {
  const source = assets.find((asset) => asset.id === id)
  if (!source) return [...assets]
  const t = tools(options)
  const copy: AssetLibraryItem = {
    ...source,
    id: t.idFactory(),
    name: `${cleanName(source.name)} Copy`,
    payload: isPlainObject(source.payload) ? { ...source.payload } : source.payload,
    createdAt: t.now(),
  }
  return [copy, ...assets]
}

export function serializeExportPresetLibrary(assets: readonly AssetLibraryItem[]) {
  const file: ExportPresetLibraryFile = {
    format: "ps-export-presets",
    version: 1,
    presets: exportPresetAssets(assets).map((asset) => ({
      id: asset.id,
      name: cleanName(asset.name),
      payload: isPlainObject(asset.payload) ? asset.payload as ExportPresetPayload : { dialog: "export-as" },
      createdAt: asset.createdAt,
    })),
  }
  return JSON.stringify(file, null, 2)
}

export function parseExportPresetLibrary(json: string, options?: ExportPresetTools): AssetLibraryItem[] {
  const parsed = JSON.parse(json) as ExportPresetLibraryFile | ExportPresetLibraryFile["presets"]
  const presets = Array.isArray(parsed) ? parsed : parsed.format === "ps-export-presets" && parsed.version === 1 ? parsed.presets : []
  const t = tools(options)
  const seen = new Set<string>()
  const assets: AssetLibraryItem[] = []
  for (const preset of presets) {
    if (!preset || typeof preset.name !== "string" || !isPlainObject(preset.payload)) continue
    const id = preset.id && !seen.has(preset.id) ? preset.id : t.idFactory()
    seen.add(id)
    assets.push({
      id,
      name: cleanName(preset.name),
      kind: "export",
      group: "Export",
      payload: {
        ...(preset.payload as ExportPresetPayload),
        dialog: (preset.payload as ExportPresetPayload).dialog ?? "export-as",
      },
      createdAt: Number.isFinite(preset.createdAt) ? Number(preset.createdAt) : t.now(),
    })
  }
  return assets
}
