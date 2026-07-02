"use client"

import * as React from "react"
import { toast } from "sonner"
import { useActiveDocument, useActiveLayer, useEditorCommands, useEditorStateSelector } from "../editor-context"
import { dispatchPhotoshopEvent } from "../events"
import { downloadBlob, downloadText } from "../document-io"
import { Archive, Brush, CircleDot, Download, FolderOpen, Palette, Plus, Sparkles, Trash2, Upload } from "lucide-react"
import type { AssetLibraryItem, BrushSettings, GradientSettings, ImageAssetGeneratorSettings, LayerStyle } from "../types"
import {
  collectAssetTags,
  createAssetLibraryBundle,
  extractAssetLibraryArray,
  filterAssetLibrary,
  normalizeAssetTags,
} from "../asset-library-bundles"
import { normalizeCustomShapeLibrary, shapeAssetToPreset, shapePresetToAsset } from "../custom-shape-library"
import {
  collectImageAssetGeneratorPlan,
  createImageAssetGeneratorReport,
  exportImageAssetsToZip,
  imageAssetGeneratorSettings,
  safeImageAssetArchiveName,
} from "../image-assets-generator"

type AssetKind = AssetLibraryItem["kind"] | "all"

export const MAX_ASSET_IMPORT_BYTES = 1_000_000
export const MAX_ASSET_IMPORT_COUNT = 250

const KIND_LABEL: Record<AssetLibraryItem["kind"], string> = {
  brush: "Brush",
  gradient: "Gradient",
  pattern: "Pattern",
  style: "Style",
  swatch: "Swatch",
  shape: "Shape",
  export: "Export",
  "tool-preset": "Tool Preset",
  plugin: "Plugin",
  "cloud-library": "Cloud Library",
  stock: "Stock",
  font: "Font",
  "icc-profile": "ICC Profile",
  "variable-data": "Variable Data",
  prepress: "Prepress",
}

const ASSET_KINDS = new Set<AssetLibraryItem["kind"]>(Object.keys(KIND_LABEL) as AssetLibraryItem["kind"][])
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i
const GRADIENT_TYPES = new Set(["linear", "radial", "angular", "reflected", "diamond"])
const BRUSH_TIP_SHAPES = new Set(["round", "square", "bristle", "erodible"])
const BRUSH_CONTROLS = new Set(["off", "pressure", "tilt", "velocity", "fade", "random"])
const EXPORT_FORMATS = new Set(["png", "jpeg", "jpg", "webp", "gif", "avif", "svg"])

type AssetImportOptions = {
  fileSizeBytes?: number
  now?: number
  makeId?: (prefix: string, index: number) => string
}

export function normalizeImportedAssetLibrary(parsed: unknown, options: AssetImportOptions = {}): AssetLibraryItem[] {
  if (typeof options.fileSizeBytes === "number" && options.fileSizeBytes > MAX_ASSET_IMPORT_BYTES) {
    throw new Error(`Asset imports are limited to ${formatImportBytes(MAX_ASSET_IMPORT_BYTES)}.`)
  }
  const imported = extractAssetLibraryArray(parsed)
  if (!Array.isArray(imported)) throw new Error("Asset file does not contain an asset array")
  if (imported.length > MAX_ASSET_IMPORT_COUNT) {
    throw new Error(`Asset imports are limited to ${MAX_ASSET_IMPORT_COUNT} items.`)
  }

  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  return imported.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Asset ${index + 1} must be an object.`)
    const kind = raw.kind
    if (typeof kind !== "string" || !ASSET_KINDS.has(kind as AssetLibraryItem["kind"])) {
      throw new Error(`Unsupported asset kind: ${typeof kind === "string" ? kind : "unknown"}.`)
    }
    const assetKind = kind as AssetLibraryItem["kind"]
    const payload = normalizeAssetPayload(assetKind, raw.payload)
    const tags = normalizeAssetTags(raw.tags)
    const description = cleanOptionalText(raw.description, 180)
    const updatedAt = cleanOptionalTimestamp(raw.updatedAt)
    const asset: AssetLibraryItem = {
      id: cleanId(raw.id, "asset", index, options.makeId),
      name: cleanText(raw.name, KIND_LABEL[assetKind], 80),
      kind: assetKind,
      group: cleanOptionalText(raw.group, 80),
      payload,
      createdAt: cleanTimestamp(raw.createdAt, now),
    }
    if (tags.length) asset.tags = tags
    if (description) asset.description = description
    if (updatedAt) asset.updatedAt = updatedAt
    return asset
  })
}

export function AssetsPanel() {
  const activeDoc = useActiveDocument()
  const activeLayer = useActiveLayer()
  const brush = useEditorStateSelector((state) => state.brush)
  const gradient = useEditorStateSelector((state) => state.gradient)
  const foreground = useEditorStateSelector((state) => state.foreground)
  const { dispatch, commit } = useEditorCommands()
  const [kind, setKind] = React.useState<AssetKind>("all")
  const [group, setGroup] = React.useState("Project")
  const [query, setQuery] = React.useState("")
  const [tag, setTag] = React.useState("all")
  const [tagInput, setTagInput] = React.useState("")

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const assets = activeDoc.assetLibrary ?? []
  const tags = collectAssetTags(assets)
  const visible = filterAssetLibrary(assets, { kind, query, tag: tag === "all" ? undefined : tag })
  const generatorPlan = React.useMemo(() => collectImageAssetGeneratorPlan(activeDoc), [activeDoc])
  const generatorSettings = imageAssetGeneratorSettings(activeDoc.metadata?.imageAssetGenerator)

  const setAssets = (next: AssetLibraryItem[]) => dispatch({ type: "set-asset-library", assets: next })
  const setGeneratorSettings = (patch: Partial<ImageAssetGeneratorSettings>) => {
    dispatch({
      type: "set-document-metadata",
      metadata: {
        ...(activeDoc.metadata ?? {}),
        imageAssetGenerator: {
          ...(activeDoc.metadata?.imageAssetGenerator ?? {}),
          ...patch,
        },
      },
    })
  }

  const addAsset = (asset: Omit<AssetLibraryItem, "id" | "createdAt">) => {
    const next: AssetLibraryItem = {
      ...asset,
      id: `asset_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      tags: parseTagInput(tagInput),
    }
    setAssets([next, ...assets])
  }

  const captureBrush = () => addAsset({ name: `Brush ${Math.round(brush.size)}px`, kind: "brush", group, payload: brush })
  const captureGradient = () => addAsset({ name: `${gradient.type} gradient`, kind: "gradient", group, payload: gradient })
  const captureSwatch = () => addAsset({ name: foreground.toUpperCase(), kind: "swatch", group, payload: { color: foreground } })
  const captureStyle = () => {
    if (!activeLayer?.style) return
    addAsset({ name: `${activeLayer.name} style`, kind: "style", group, payload: activeLayer.style })
  }
  const captureShape = () => {
    if (!activeLayer?.shape) return
    const asset = shapePresetToAsset(activeLayer.shape, { name: `${activeLayer.name} shape`, group, tags: parseTagInput(tagInput) })
    setAssets([asset, ...assets])
  }
  const addExportPreset = () => addAsset({
    name: "PNG 200% transparent",
    kind: "export",
    group,
    payload: { dialog: "export-as", format: "png", scale: 200, quality: 92, transparent: true, matte: "#ffffff" },
  })

  const applyAsset = (asset: AssetLibraryItem) => {
    if (asset.kind === "swatch") {
      const color = (asset.payload as { color?: string }).color
      if (typeof color === "string") dispatch({ type: "set-foreground", color })
    }
    if (asset.kind === "brush") dispatch({ type: "set-brush", brush: asset.payload as Partial<BrushSettings> })
    if (asset.kind === "gradient") dispatch({ type: "set-gradient", gradient: asset.payload as Partial<GradientSettings> })
    if (asset.kind === "style" && activeLayer) {
      dispatch({ type: "set-layer-style", id: activeLayer.id, style: asset.payload as LayerStyle })
      window.setTimeout(() => commit("Apply Asset Style", [activeLayer.id]), 0)
    }
    if (asset.kind === "shape") {
      window.__psCustomShapePreset = shapeAssetToPreset(asset, { x: 0, y: 0, w: 100, h: 100, fill: foreground })
      window.__psCustomShape = undefined
      dispatch({ type: "set-tool", tool: "custom-shape" })
    }
    if (asset.kind === "export") {
      const payload = asset.payload as { dialog?: string; scope?: string }
      if (payload.dialog === "batch-export" || payload.scope) {
        dispatchPhotoshopEvent("ps-open-batch-export", asset.payload)
      } else {
        dispatchPhotoshopEvent("ps-open-export-as", { dialog: "export-as", ...payload })
      }
    }
  }

  const importAssets = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json,.pslibrary,application/json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        if (file.size > MAX_ASSET_IMPORT_BYTES) {
          throw new Error(`Asset imports are limited to ${formatImportBytes(MAX_ASSET_IMPORT_BYTES)}.`)
        }
        const parsed = JSON.parse(await file.text())
        const cleaned = normalizeImportedAssetLibrary(parsed, { fileSizeBytes: file.size })
        setAssets([...cleaned, ...assets])
        toast.success(`Imported ${cleaned.length} asset${cleaned.length === 1 ? "" : "s"}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not import assets")
      }
    }
    input.click()
  }

  const generateLayerAssets = async () => {
    try {
      const result = await exportImageAssetsToZip(activeDoc, { trigger: "manual" })
      dispatch({ type: "add-document-report", report: createImageAssetGeneratorReport(activeDoc, result) })
      if (result.entries.length) {
        downloadBlob(result.zipBlob, safeImageAssetArchiveName(activeDoc.name))
        toast.success(`Generated ${result.entries.length} asset${result.entries.length === 1 ? "" : "s"}`)
      } else if (result.issues.length) {
        toast.error("No assets generated; review the Image Assets Generator report.")
      } else {
        toast.info("No generator layer names found.")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate image assets")
    }
  }

  const chooseGeneratorFolder = async () => {
    const picker = (window as typeof window & {
      showDirectoryPicker?: () => Promise<{ name?: string }>
    }).showDirectoryPicker
    if (!picker) {
      toast.error("Folder auto-export requires File System Access support.")
      return
    }
    try {
      const directoryHandle = await picker()
      dispatchPhotoshopEvent("ps-image-assets-generator-directory", { docId: activeDoc.id, directoryHandle })
      setGeneratorSettings({ outputFolderName: directoryHandle.name ?? "Selected folder" })
      toast.success("Image asset folder connected")
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast.error(err instanceof Error ? err.message : "Could not connect folder")
      }
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2">
          <Archive className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="h-6 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            placeholder="Asset group"
          />
        </div>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
          placeholder="Tags for new captures, comma-separated"
        />
        <div className="space-y-2 border-y border-[var(--ps-divider)] py-2">
          <div className="flex items-center gap-1">
            <label className="flex h-6 items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px]">
              <input
                type="checkbox"
                checked={generatorSettings.enabled}
                onChange={(event) => setGeneratorSettings({ enabled: event.target.checked })}
              />
              Generator
            </label>
            <label className="flex h-6 items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px]">
              <input
                type="checkbox"
                checked={generatorSettings.autoExportOnSave}
                onChange={(event) => setGeneratorSettings({ autoExportOnSave: event.target.checked })}
              />
              Save
            </label>
            <label className="flex h-6 items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px]">
              <input
                type="checkbox"
                checked={generatorSettings.autoExportOnChange}
                onChange={(event) => setGeneratorSettings({ autoExportOnChange: event.target.checked })}
              />
              Change
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <AssetButton icon={Download} label={`Generate ${generatorPlan.assets.length}`} disabled={!generatorPlan.assets.length} onClick={generateLayerAssets} />
            <AssetButton icon={FolderOpen} label={activeDoc.metadata?.imageAssetGenerator?.outputFolderName ? "Folder Set" : "Folder"} onClick={chooseGeneratorFolder} />
          </div>
          {generatorPlan.issues.length ? (
            <div className="space-y-1 text-[10px] text-amber-200">
              {generatorPlan.issues.slice(0, 3).map((entry, index) => (
                <div key={`${entry.kind}-${entry.filename ?? entry.layerId ?? index}`} className="truncate">
                  {entry.kind}: {entry.filename ?? entry.layerName}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-1">
          <AssetButton icon={Palette} label="Swatch" onClick={captureSwatch} />
          <AssetButton icon={Brush} label="Brush" onClick={captureBrush} />
          <AssetButton icon={CircleDot} label="Gradient" onClick={captureGradient} />
          <AssetButton icon={Sparkles} label="Style" disabled={!activeLayer?.style} onClick={captureStyle} />
          <AssetButton icon={FolderOpen} label="Shape" disabled={!activeLayer?.shape} onClick={captureShape} />
          <AssetButton icon={Plus} label="Export" onClick={addExportPreset} />
          <AssetButton icon={Upload} label="Import" onClick={importAssets} />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
          placeholder="Search assets, tags, groups, payload"
        />
        <div className="flex items-center gap-1">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AssetKind)}
            className="h-6 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[11px]"
          >
            <option value="all">All assets</option>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="h-6 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[11px]"
          >
            <option value="all">All tags</option>
            {tags.map((entry) => (
              <option key={entry.tag} value={entry.tag}>{entry.tag} ({entry.count})</option>
            ))}
          </select>
          <button
            type="button"
            className="flex h-6 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
            onClick={() => downloadText(
              JSON.stringify(createAssetLibraryBundle(assets, { name: `${activeDoc.name} Library`, documentName: activeDoc.name }), null, 2),
              `${activeDoc.name}-library.pslibrary.json`,
            )}
          >
            <Download className="h-3 w-3" />
            Bundle
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <PanelEmpty text="Capture brushes, gradients, styles, swatches, and export presets into this project." />
        ) : (
          visible.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="grid w-full grid-cols-[28px_1fr_auto] items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-2 text-left hover:bg-[var(--ps-tool-hover)]"
              onClick={() => applyAsset(asset)}
            >
              <AssetPreview asset={asset} />
              <span className="min-w-0">
                <span className="block truncate text-[11px]">{asset.name}</span>
                <span className="block truncate text-[10px] text-[var(--ps-text-dim)]">{KIND_LABEL[asset.kind]} · {asset.group ?? "Ungrouped"}</span>
                {asset.tags?.length ? <span className="block truncate text-[10px] text-[var(--ps-text-dim)]">#{asset.tags.join(" #")}</span> : null}
              </span>
              <span
                role="button"
                tabIndex={0}
                className="rounded-sm p-1 text-[var(--ps-text-dim)] hover:bg-red-500/15 hover:text-red-200"
                onClick={(e) => {
                  e.stopPropagation()
                  setAssets(assets.filter((item) => item.id !== asset.id))
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    e.stopPropagation()
                    setAssets(assets.filter((item) => item.id !== asset.id))
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function AssetPreview({ asset }: { asset: AssetLibraryItem }) {
  if (asset.kind === "swatch") {
    const color = (asset.payload as { color?: string }).color ?? "#000000"
    return <span className="h-7 w-7 rounded-sm border border-[var(--ps-divider)]" style={{ background: color }} />
  }
  if (asset.kind === "gradient") {
    return <span className="h-7 w-7 rounded-sm border border-[var(--ps-divider)] bg-gradient-to-br from-black via-white to-[var(--ps-accent)]" />
  }
  const Icon = asset.kind === "brush" ? Brush : asset.kind === "style" ? Sparkles : asset.kind === "shape" ? FolderOpen : asset.kind === "export" ? Download : Archive
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]">
      <Icon className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
    </span>
  )
}

function AssetButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center justify-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}

function normalizeAssetPayload(kind: AssetLibraryItem["kind"], payload: unknown): unknown {
  switch (kind) {
    case "swatch":
      return normalizeSwatchPayload(payload)
    case "brush":
      return normalizeBrushAssetPayload(payload)
    case "gradient":
      return normalizeGradientPayload(payload)
    case "style":
      return normalizeStylePayload(payload)
    case "export":
      return normalizeExportPayload(payload)
    case "pattern":
      return normalizePatternPayload(payload)
    case "shape":
      return normalizeCustomShapeLibrary([{ kind: "shape", payload }])[0]?.payload ??
        normalizeGenericRecordPayload(payload, ["type", "customId", "x", "y", "w", "h", "fill", "stroke", "radius", "cornerRadii", "sides", "starPoints", "innerRadiusRatio", "vertexRoundness", "smoothCorners", "smoothIndent", "rotation", "computedPath", "components", "booleanOperation"])
    case "tool-preset":
      return normalizeGenericRecordPayload(payload, ["tool", "brush", "eraser", "cloneSource", "selectionOptions", "foreground", "background"])
    case "plugin":
      return normalizeGenericRecordPayload(payload, ["id", "name", "kind", "enabled", "version", "author", "permissions", "filterKernel", "filterBias", "filterDivisor"])
    case "cloud-library":
      return normalizeGenericRecordPayload(payload, ["colors", "source", "name", "items"])
    case "stock":
      return normalizeGenericRecordPayload(payload, ["license", "tags", "source", "url", "description"])
    case "font":
      return normalizeGenericRecordPayload(payload, ["family", "source", "style", "weight"])
    case "icc-profile":
      return normalizeGenericRecordPayload(payload, ["size", "preferredCmm", "version", "deviceClass", "colorSpace", "pcs", "createdAt", "signature", "platform", "renderingIntent"])
    case "variable-data":
      return normalizeGenericRecordPayload(payload, ["rows", "bindings", "activeRow", "columns", "name"])
    case "prepress":
      return normalizeGenericRecordPayload(payload, ["misses", "x1", "y1", "x2", "y2", "length", "distancePx", "angle", "scale", "notes", "items"])
    default:
      throw new Error(`Unsupported asset kind: ${kind}.`)
  }
}

function normalizeSwatchPayload(payload: unknown) {
  const record = requireRecord(payload, "Swatch payload")
  return { color: cleanColor(record.color, "Swatch color") }
}

function normalizeBrushAssetPayload(payload: unknown): Partial<BrushSettings> {
  const record = requireRecord(payload, "Brush payload")
  const out: Record<string, unknown> = {}
  copyNumber(record, out, "size", 1, 500, { round: true })
  copyNumber(record, out, "hardness", 0, 100, { round: true })
  copyNumber(record, out, "opacity", 0, 100, { round: true })
  copyNumber(record, out, "flow", 0, 100, { round: true })
  copyNumber(record, out, "smoothing", 0, 100, { round: true })
  copyNumber(record, out, "spacing", 1, 400, { round: true })
  copyEnum(record, out, "tipShape", BRUSH_TIP_SHAPES)
  copyEnum(record, out, "sizeControl", BRUSH_CONTROLS)
  copyEnum(record, out, "angleControl", BRUSH_CONTROLS)
  copyEnum(record, out, "roundnessControl", BRUSH_CONTROLS)
  copyNumber(record, out, "sizeJitter", 0, 100, { round: true })
  copyNumber(record, out, "angleJitter", 0, 360, { round: true })
  copyNumber(record, out, "roundnessJitter", 0, 100, { round: true })
  copyBoolean(record, out, "flipX")
  copyBoolean(record, out, "flipY")
  copyNumber(record, out, "minDiameter", 0, 100, { round: true })
  copyNumber(record, out, "scatter", 0, 1000, { round: true })
  copyNumber(record, out, "scatterCount", 1, 16, { round: true })
  copyNumber(record, out, "scatterCountJitter", 0, 100, { round: true })
  copyNumber(record, out, "fgBgJitter", 0, 100, { round: true })
  copyNumber(record, out, "hueJitter", 0, 100, { round: true })
  copyNumber(record, out, "satJitter", 0, 100, { round: true })
  copyNumber(record, out, "brightJitter", 0, 100, { round: true })
  copyNumber(record, out, "purity", -100, 100, { round: true })
  copyNumber(record, out, "opacityJitter", 0, 100, { round: true })
  copyNumber(record, out, "flowJitter", 0, 100, { round: true })
  copyEnum(record, out, "opacityControl", BRUSH_CONTROLS)
  copyEnum(record, out, "flowControl", BRUSH_CONTROLS)
  copyBoolean(record, out, "wetEdges")
  copyBoolean(record, out, "buildUp")
  copyBoolean(record, out, "noise")
  copyBoolean(record, out, "protectTexture")
  if (isRecord(record.texture)) out.texture = normalizeBrushTexture(record.texture)
  if (isRecord(record.dualBrush)) out.dualBrush = normalizeDualBrush(record.dualBrush)
  if (isRecord(record.pose)) out.pose = normalizeBrushPose(record.pose)
  if (!Object.keys(out).length) throw new Error("Brush payload does not contain supported settings.")
  return out as Partial<BrushSettings>
}

function normalizeBrushTexture(record: Record<string, unknown>): NonNullable<BrushSettings["texture"]> {
  return {
    enabled: record.enabled === true,
    pattern: enumValue(record.pattern, new Set(["noise", "canvas", "paper", "linen"]), "canvas"),
    mode: enumValue(record.mode, new Set(["multiply", "subtract", "burn"]), "multiply"),
    depth: cleanNumber(record.depth, 0, 100, 45, true),
    depthJitter: cleanNumber(record.depthJitter, 0, 100, 0, true),
    minDepth: cleanNumber(record.minDepth, 0, 100, 0, true),
    scale: cleanNumber(record.scale, 20, 400, 100, true),
  }
}

function normalizeDualBrush(record: Record<string, unknown>): NonNullable<BrushSettings["dualBrush"]> {
  return {
    enabled: record.enabled === true,
    size: cleanNumber(record.size, 1, 300, 18, true),
    spacing: cleanNumber(record.spacing, 1, 200, 25, true),
    scatter: cleanNumber(record.scatter, 0, 500, 0, true),
    count: cleanNumber(record.count, 1, 8, 1, true),
    mode: enumValue(record.mode, new Set(["multiply", "screen", "subtract"]), "multiply"),
  }
}

function normalizeBrushPose(record: Record<string, unknown>): NonNullable<BrushSettings["pose"]> {
  return {
    tiltX: cleanNumber(record.tiltX, -90, 90, 0, true),
    tiltY: cleanNumber(record.tiltY, -90, 90, 0, true),
    rotation: cleanNumber(record.rotation, -180, 180, 0, true),
    pressure: cleanNumber(record.pressure, 0, 100, 50, true),
    stylusAngle: cleanNumber(record.stylusAngle, -180, 180, 0, true),
  }
}

function normalizeGradientPayload(payload: unknown): GradientSettings {
  const record = requireRecord(payload, "Gradient payload")
  const type = enumValue<GradientSettings["type"]>(record.type, GRADIENT_TYPES, undefined)
  if (!type) throw new Error("Gradient payload must include a supported type.")
  const gradient: GradientSettings = {
    type,
    reverse: record.reverse === true,
  }
  if (typeof record.dither === "boolean") gradient.dither = record.dither
  if (typeof record.cycle === "boolean") gradient.cycle = record.cycle
  if (Array.isArray(record.stops)) {
    gradient.stops = record.stops.slice(0, 16).map((stop, index) => {
      const item = requireRecord(stop, `Gradient stop ${index + 1}`)
      return {
        offset: cleanNumber(item.offset, 0, 1, 0),
        color: cleanColor(item.color, `Gradient stop ${index + 1} color`),
        opacity: cleanNumber(item.opacity, 0, 1, 1),
      }
    })
  }
  return gradient
}

function normalizeStylePayload(payload: unknown): LayerStyle {
  const record = requireRecord(payload, "Style payload")
  const out: Record<string, unknown> = {}
  for (const key of ["stroke", "outerGlow", "innerGlow", "innerShadow", "bevel", "satin", "colorOverlay", "gradientOverlay", "patternOverlay", "dropShadow"]) {
    if (isRecord(record[key])) out[key] = normalizeSafeJson(record[key], 0, 4)
  }
  return out as LayerStyle
}

function normalizeExportPayload(payload: unknown) {
  const record = requireRecord(payload, "Export payload")
  const format = enumValue<"png" | "jpeg" | "jpg" | "webp" | "gif" | "avif" | "svg">(record.format, EXPORT_FORMATS, "png")
  const out: Record<string, unknown> = {
    dialog: record.dialog === "batch-export" ? "batch-export" : "export-as",
    format: format === "jpg" ? "jpeg" : format,
    scale: cleanNumber(record.scale, 1, 800, 100, true),
    quality: cleanNumber(record.quality, 1, 100, 92, true),
    transparent: record.transparent === true,
  }
  if ("matte" in record) out.matte = cleanColor(record.matte, "Export matte")
  if (typeof record.dither === "boolean") out.dither = record.dither
  if (typeof record.losslessWebp === "boolean") out.losslessWebp = record.losslessWebp
  if (typeof record.includeMetadata === "boolean") out.includeMetadata = record.includeMetadata
  if ("precision" in record) out.precision = cleanNumber(record.precision, 0, 6, 2, true)
  if (typeof record.scope === "string") out.scope = cleanText(record.scope, "document", 40)
  return out
}

function normalizePatternPayload(payload: unknown) {
  const record = requireRecord(payload, "Pattern payload")
  const dataURL = typeof record.dataURL === "string" ? record.dataURL.trim() : ""
  if (!IMAGE_DATA_URL.test(dataURL) || dataURL.length > 750_000) {
    throw new Error("Pattern payload must contain a safe image data URL.")
  }
  return {
    dataURL,
    width: cleanNumber(record.width, 1, 4096, 1, true),
    height: cleanNumber(record.height, 1, 4096, 1, true),
  }
}

function normalizeGenericRecordPayload(payload: unknown, allowedKeys: string[]) {
  const record = requireRecord(payload, "Asset payload")
  const out: Record<string, unknown> = {}
  for (const key of allowedKeys) {
    if (!(key in record)) continue
    const value = normalizeSafeJson(record[key], 0, 4)
    if (value !== undefined) out[key] = value
  }
  return out
}

function normalizeSafeJson(value: unknown, depth: number, maxDepth: number): unknown {
  if (value == null) return value
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") return value.trim().slice(0, 1_000)
  if (Array.isArray(value)) {
    if (depth >= maxDepth) return []
    return value.slice(0, 64).map((item) => normalizeSafeJson(item, depth + 1, maxDepth)).filter((item) => item !== undefined)
  }
  if (isRecord(value)) {
    if (depth >= maxDepth) return {}
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value).slice(0, 64)) {
      if (!isSafeRecordKey(key)) continue
      const next = normalizeSafeJson(nested, depth + 1, maxDepth)
      if (next !== undefined) out[key] = next
    }
    return out
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

function cleanId(value: unknown, prefix: string, index: number, makeId?: (prefix: string, index: number) => string) {
  const candidate = typeof value === "string" ? value.trim() : ""
  if (/^[A-Za-z0-9_-]{1,80}$/.test(candidate) && !RESERVED_KEYS.has(candidate)) return candidate
  return makeId ? makeId(prefix, index) : `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function cleanTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function cleanOptionalTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

function cleanOptionalText(value: unknown, maxLength: number) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

function cleanColor(value: unknown, label: string) {
  if (typeof value !== "string" || !HEX_COLOR.test(value.trim())) {
    throw new Error(`${label} must use #RGB or #RRGGBB format.`)
  }
  const clean = value.trim().toLowerCase()
  if (clean.length === 4) {
    const [, r, g, b] = clean
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return clean
}

function cleanNumber(value: unknown, min: number, max: number, fallback: number, round = false) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback
  const clamped = Math.max(min, Math.min(max, next))
  return round ? Math.round(clamped) : clamped
}

function copyNumber(
  record: Record<string, unknown>,
  out: Record<string, unknown>,
  key: keyof BrushSettings,
  min: number,
  max: number,
  options: { round?: boolean } = {},
) {
  if (key in record) out[key] = cleanNumber(record[key], min, max, min, options.round)
}

function copyBoolean(record: Record<string, unknown>, out: Record<string, unknown>, key: keyof BrushSettings) {
  if (typeof record[key] === "boolean") out[key] = record[key]
}

function copyEnum(
  record: Record<string, unknown>,
  out: Record<string, unknown>,
  key: keyof BrushSettings,
  allowed: Set<string>,
) {
  const value = record[key]
  if (typeof value === "string" && allowed.has(value)) out[key] = value
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T
function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T | undefined): T | undefined
function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T | undefined) {
  return typeof value === "string" && allowed.has(value) ? (value as T) : fallback
}

function isSafeRecordKey(key: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key) && !RESERVED_KEYS.has(key)
}

function formatImportBytes(bytes: number) {
  return `${Math.round(bytes / 1000)} KB`
}

function parseTagInput(value: string) {
  return normalizeAssetTags(value.split(/[,\s]+/))
}
