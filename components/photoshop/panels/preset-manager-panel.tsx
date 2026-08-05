"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  FolderInput,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  CLIENT_STORAGE_KEYS,
  readClientStorageJson,
  writeClientStorageJson,
  type ClientStorageKey,
} from "@/editor/client-storage"
import { downloadText } from "@/editor/document/io"
import { useEditor } from "@/components/photoshop/editor/context"
import { dispatchPhotoshopEvent } from "@/editor/events"
import type {
  AssetLibraryItem,
  BrushPreset,
  BrushSettings,
  CustomShapeId,
  GradientSettings,
  LayerStyle,
  PsDocument,
} from "@/editor/types"
import {
  collectPresetFamilies,
  collectPresetSets,
  createPresetBundle,
  deletePresetItem,
  filterPresetItems,
  mergePresetItems,
  movePresetToSet,
  parsePresetBundle,
  presetFamilyLabel,
  renamePresetItem,
  reorderPresetItem,
  type PresetFamilyFilter,
  type PresetImportConflictPolicy,
  type UnifiedPresetFamily,
  type UnifiedPresetItem,
} from "@/editor/preset-manager"
import { readShapePresets, writeShapePresets, type ShapePresetEntry } from "@/editor/shape-preset-library"
import {
  loadSwatches as loadStoredSwatches,
  saveSwatches as saveStoredSwatches,
} from "@/editor/swatches-store"
import {
  applyToolPreset,
  assetToItem,
  brushPresetToItem,
  cleanNumber,
  gradientCss,
  gradientToItem,
  HEX_OR_RGBA,
  IMAGE_DATA_URL,
  itemToBrushPreset,
  itemToGradientSettings,
  MAX_UNIFIED_IMPORT_BYTES,
  patternToItem,
  recordOf,
  safeColor,
  shapeToItem,
  splitUnifiedItems,
  styleToItem,
  swatchToItem,
  type ToolPresetPayload,
} from "@/editor/document/preset-conversion"
// These entry shapes are owned by the stores that persist them; the panel used
// to re-declare its own structurally-identical copies.
import type { ManagerGradientEntry, ManagerPatternEntry, ManagerSwatchEntry } from "@/editor/preset-stores"
const FAMILY_ACCENTS: Record<UnifiedPresetFamily, string> = {
  brush: "#38bdf8",
  swatch: "#f97316",
  gradient: "#a78bfa",
  pattern: "#22c55e",
  style: "#facc15",
  shape: "#fb7185",
  "tool-preset": "#2dd4bf",
  asset: "#94a3b8",
}

export function PresetManagerPanel() {
  const {
    activeDoc,
    activeLayer,
    brushPresets,
    dispatch,
    commit,
  } = useEditor()
  const [swatches, setSwatches] = React.useState<ManagerSwatchEntry[]>(() => loadSwatches(activeDoc?.id))
  const [gradients, setGradients] = React.useState<ManagerGradientEntry[]>(loadGradients)
  const [patterns, setPatterns] = React.useState<ManagerPatternEntry[]>(() => loadPatterns(activeDoc?.id))
  const [shapes, setShapes] = React.useState<ShapePresetEntry[]>(readShapePresets)
  const [family, setFamily] = React.useState<PresetFamilyFilter>("all")
  const [setFilter, setSetFilter] = React.useState("All")
  const [query, setQuery] = React.useState("")
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState("")
  const [targetSet, setTargetSet] = React.useState("User")
  const [conflictPolicy, setConflictPolicy] = React.useState<PresetImportConflictPolicy>("keep-both")
  const [importSummary, setImportSummary] = React.useState("")
  const importRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setSwatches(loadSwatches(activeDoc?.id))
    setPatterns(loadPatterns(activeDoc?.id))
    setSelectedKey(null)
  }, [activeDoc?.id])

  const allItems = React.useMemo(
    () => buildUnifiedItems({
      brushPresets,
      swatches,
      gradients,
      patterns,
      styles: activeDoc?.stylePresets ?? [],
      shapes,
      assets: activeDoc?.assetLibrary ?? [],
    }),
    [activeDoc?.assetLibrary, activeDoc?.stylePresets, brushPresets, gradients, patterns, shapes, swatches],
  )

  const families = React.useMemo(() => collectPresetFamilies(allItems), [allItems])
  const sets = React.useMemo(() => collectPresetSets(allItems, family), [allItems, family])
  const visible = React.useMemo(
    () => filterPresetItems(allItems, { family, set: setFilter, query }),
    [allItems, family, query, setFilter],
  )
  const selected = React.useMemo(
    () => allItems.find((item) => item.key === selectedKey) ?? null,
    [allItems, selectedKey],
  )

  React.useEffect(() => {
    if (!selected) {
      setRenameDraft("")
      return
    }
    setRenameDraft(selected.name)
    setTargetSet(selected.set)
  }, [selected])

  React.useEffect(() => {
    if (!sets.some((entry) => entry.set === setFilter)) setSetFilter("All")
  }, [setFilter, sets])

  const applyAllItems = React.useCallback((nextItems: UnifiedPresetItem[], label: string) => {
    const next = splitUnifiedItems(nextItems)
    setSwatches(next.swatches)
    saveSwatches(activeDoc?.id, next.swatches)
    setGradients(next.gradients)
    saveGradients(next.gradients)
    setPatterns(next.patterns)
    savePatterns(activeDoc?.id, next.patterns)
    setShapes(next.shapes)
    saveShapePresets(next.shapes)
    dispatch({ type: "set-brush-presets", presets: next.brushPresets })
    if (activeDoc) {
      dispatch({ type: "set-style-presets", presets: next.styles as NonNullable<PsDocument["stylePresets"]> })
      dispatch({ type: "set-asset-library", assets: next.assets })
      window.setTimeout(() => commit(label, []), 0)
    }
  }, [activeDoc, commit, dispatch])

  const renameSelected = () => {
    if (!selected) return
    applyAllItems(renamePresetItem(allItems, selected.key, renameDraft), "Rename Preset")
  }

  const deleteSelected = () => {
    if (!selected) return
    applyAllItems(deletePresetItem(allItems, selected.key), "Delete Preset")
    setSelectedKey(null)
  }

  const moveSelected = () => {
    if (!selected) return
    applyAllItems(movePresetToSet(allItems, selected.key, targetSet), "Move Preset")
  }

  const reorderSelected = (delta: number) => {
    if (!selected) return
    applyAllItems(reorderPresetItem(allItems, selected.key, delta), "Reorder Presets")
  }

  const dropIntoSet = (event: React.DragEvent, setName: string) => {
    event.preventDefault()
    const key = event.dataTransfer.getData("text/plain")
    if (!key) return
    applyAllItems(movePresetToSet(allItems, key, setName), "Move Preset")
    setSelectedKey(key)
  }

  const exportVisible = () => {
    downloadText(
      JSON.stringify(createPresetBundle(visible, { sourceDocumentName: activeDoc?.name }), null, 2),
      "photoshop-unified-presets.pspresets.json",
    )
  }

  const importPresetFile = async (file: File) => {
    try {
      if (file.size > MAX_UNIFIED_IMPORT_BYTES) throw new Error("Preset libraries are limited to 2 MB.")
      const imported = parsePresetBundle(await file.text())
      const merged = mergePresetItems(allItems, imported, {
        conflictPolicy,
        idFactory: (itemFamily, id, attempt) => `${itemFamily}-${id}-import-${attempt}`,
      })
      applyAllItems(merged.items, "Import Presets")
      const summary = `${merged.added} added, ${merged.replaced} replaced, ${merged.skipped} skipped, ${merged.renamed} renamed`
      setImportSummary(summary)
      toast.success(`Imported presets: ${summary}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import presets")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  const applyPreset = (item: UnifiedPresetItem) => {
    setSelectedKey(item.key)
    if (item.family === "brush") {
      dispatch({ type: "apply-brush-preset", preset: itemToBrushPreset(item) })
      return
    }
    if (item.family === "swatch") {
      const color = recordOf(item.payload).color
      if (typeof color === "string") dispatch({ type: "set-foreground", color })
      return
    }
    if (item.family === "gradient") {
      dispatch({ type: "set-gradient", gradient: itemToGradientSettings(item) })
      return
    }
    if (item.family === "style" && activeLayer) {
      dispatch({ type: "set-layer-style", id: activeLayer.id, style: item.payload as LayerStyle })
      window.setTimeout(() => commit("Apply Style Preset", [activeLayer.id]), 0)
      return
    }
    if (item.family === "shape") {
      const customId = recordOf(item.payload).customId
      if (typeof customId === "string") {
        window.__psCustomShape = customId as CustomShapeId
        dispatch({ type: "set-tool", tool: "custom-shape" })
      }
      return
    }
    if (item.family === "tool-preset") {
      applyToolPreset(item.payload as ToolPresetPayload, dispatch)
      return
    }
    if (item.family === "asset") {
      applyAssetPreset(item, activeLayer?.id, dispatch, commit)
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <input
        ref={importRef}
        type="file"
        accept=".json,.pspresets,.pspresets.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void importPresetFile(file)
        }}
      />

      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-dim)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search presets"
            className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
            aria-label="Preset manager search"
          />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <select
            value={family}
            onChange={(event) => {
              setFamily(event.target.value as PresetFamilyFilter)
              setSetFilter("All")
            }}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
            aria-label="Preset family"
          >
            {families.map((entry) => (
              <option key={entry.family} value={entry.family}>
                {entry.label} ({entry.count})
              </option>
            ))}
          </select>
          <select
            value={setFilter}
            onChange={(event) => setSetFilter(event.target.value)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
            aria-label="Preset set"
          >
            {sets.map((entry) => (
              <option key={entry.set} value={entry.set}>
                {entry.set} ({entry.count})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-1">
          <select
            value={conflictPolicy}
            onChange={(event) => setConflictPolicy(event.target.value as PresetImportConflictPolicy)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
            aria-label="Preset import conflict policy"
          >
            <option value="keep-both">Keep both</option>
            <option value="replace">Replace</option>
            <option value="skip">Skip</option>
          </select>
          <Button size="sm" variant="outline" aria-label="Import preset library" onClick={() => importRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
          <Button size="sm" variant="outline" aria-label="Export visible presets" onClick={exportVisible} disabled={!visible.length}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
        {importSummary ? <div className="text-[10px] text-[var(--ps-text-dim)]">{importSummary}</div> : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto]">
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--ps-divider)] p-2">
          {sets.filter((entry) => entry.set !== "All").map((entry) => (
            <button
              key={entry.set}
              type="button"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropIntoSet(event, entry.set)}
              onClick={() => setSetFilter(entry.set)}
              className={`h-7 shrink-0 rounded-sm border px-2 text-[10px] ${
                setFilter === entry.set
                  ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]"
                  : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]"
              }`}
            >
              {entry.set} ({entry.count})
            </button>
          ))}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {visible.length ? (
            visible.map((item) => (
              <button
                key={item.key}
                type="button"
                draggable={!item.readonly}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", item.key)
                  event.dataTransfer.effectAllowed = "move"
                }}
                onClick={() => applyPreset(item)}
                className={`grid w-full grid-cols-[32px_1fr_auto] items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-2 text-left hover:bg-[var(--ps-tool-hover)] ${
                  selectedKey === item.key ? "bg-[var(--ps-tool-active)]" : ""
                }`}
              >
                <PresetPreview item={item} />
                <span className="min-w-0">
                  <span className="block truncate text-[11px]">{item.name}</span>
                  <span className="block truncate text-[10px] text-[var(--ps-text-dim)]">
                    {presetFamilyLabel(item.family)} - {item.set}
                  </span>
                </span>
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: FAMILY_ACCENTS[item.family] }}
                />
              </button>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No presets match.</div>
          )}
        </div>

        <div className="space-y-2 border-t border-[var(--ps-divider)] p-2">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1">
            <Input
              value={renameDraft}
              disabled={!selected}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") renameSelected()
              }}
              placeholder="Preset name"
              className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
              aria-label="Selected preset name"
            />
            <Button size="icon-sm" variant="outline" title="Rename preset" aria-label="Rename selected preset" disabled={!selected} onClick={renameSelected}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="outline" title="Move preset up" aria-label="Move selected preset up" disabled={!selected} onClick={() => reorderSelected(-1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="outline" title="Move preset down" aria-label="Move selected preset down" disabled={!selected} onClick={() => reorderSelected(1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-1">
            <Input
              value={targetSet}
              disabled={!selected}
              onChange={(event) => setTargetSet(event.target.value)}
              placeholder="Set"
              className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
              aria-label="Selected preset set"
            />
            <Button size="sm" variant="outline" disabled={!selected} onClick={moveSelected}>
              <FolderInput className="h-3.5 w-3.5" />
              Move
            </Button>
            <Button size="sm" variant="outline" disabled={!selected} onClick={deleteSelected}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--ps-text-dim)]">
            <span>{visible.length}/{allItems.length} visible</span>
            <span>{selected ? `${presetFamilyLabel(selected.family)} selected` : "No selection"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PresetPreview({ item }: { item: UnifiedPresetItem }) {
  const record = recordOf(item.payload)
  if (item.family === "swatch") {
    return <span className="h-7 w-7 rounded-sm border border-[var(--ps-divider)]" style={{ backgroundColor: safeColor(record.color, "#000000") }} />
  }
  if (item.family === "gradient") {
    const stops = Array.isArray(record.stops) ? record.stops : []
    return (
      <span
        className="h-7 w-7 rounded-sm border border-[var(--ps-divider)]"
        style={{ background: gradientCss(stops) }}
      />
    )
  }
  if (item.family === "pattern" && typeof record.dataURL === "string") {
    return (
      <span
        className="h-7 w-7 rounded-sm border border-[var(--ps-divider)] bg-cover bg-center"
        style={{ backgroundImage: `url(${record.dataURL})` }}
      />
    )
  }
  if (item.family === "brush" && typeof record.thumbnail === "string") {
    return (
      <span
        className="h-7 w-7 rounded-sm border border-[var(--ps-divider)] bg-cover bg-center"
        style={{ backgroundImage: `url(${record.thumbnail})` }}
      />
    )
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]">
      <Check className="h-3.5 w-3.5" style={{ color: FAMILY_ACCENTS[item.family] }} />
    </span>
  )
}

function buildUnifiedItems(input: {
  brushPresets: readonly BrushPreset[]
  swatches: readonly ManagerSwatchEntry[]
  gradients: readonly ManagerGradientEntry[]
  patterns: readonly ManagerPatternEntry[]
  styles: ReadonlyArray<NonNullable<PsDocument["stylePresets"]>[number]>
  shapes: readonly ShapePresetEntry[]
  assets: readonly AssetLibraryItem[]
}): UnifiedPresetItem[] {
  return [
    ...input.brushPresets.map(brushPresetToItem),
    ...input.swatches.map(swatchToItem),
    ...input.gradients.map(gradientToItem),
    ...input.patterns.map(patternToItem),
    ...input.styles.map(styleToItem),
    ...input.shapes.map(shapeToItem),
    ...input.assets.map(assetToItem),
  ]
}

function applyAssetPreset(
  item: UnifiedPresetItem,
  activeLayerId: string | undefined,
  dispatch: ReturnType<typeof useEditor>["dispatch"],
  commit: ReturnType<typeof useEditor>["commit"],
) {
  const kind = item.sourceKind
  if (kind === "swatch") {
    const color = recordOf(item.payload).color
    if (typeof color === "string") dispatch({ type: "set-foreground", color })
  } else if (kind === "brush") {
    dispatch({ type: "set-brush", brush: item.payload as Partial<BrushSettings> })
  } else if (kind === "gradient") {
    dispatch({ type: "set-gradient", gradient: item.payload as Partial<GradientSettings> })
  } else if (kind === "style" && activeLayerId) {
    dispatch({ type: "set-layer-style", id: activeLayerId, style: item.payload as LayerStyle })
    window.setTimeout(() => commit("Apply Asset Style", [activeLayerId]), 0)
  } else if (kind === "export") {
    const payload = recordOf(item.payload)
    if (payload.dialog === "batch-export" || payload.scope) {
      dispatchPhotoshopEvent("ps-open-batch-export", item.payload)
    } else {
      dispatchPhotoshopEvent("ps-open-export-as", { dialog: "export-as", ...payload })
    }
  }
}

function scopedStorageKey(base: string, docId?: string) {
  return docId ? `${base}:${docId}` : base
}

function scopedPatternStorageKey(docId?: string): ClientStorageKey<unknown[]> {
  const descriptor = CLIENT_STORAGE_KEYS.patterns
  return docId ? { ...descriptor, key: scopedStorageKey(descriptor.key, docId) } : descriptor
}

function loadSwatches(docId?: string): ManagerSwatchEntry[] {
  return loadStoredSwatches(docId).map((swatch, index) => ({
    ...swatch,
    id: `swatch-${index}-${swatch.color.replace("#", "")}`,
  }))
}

function saveSwatches(docId: string | undefined, swatches: ManagerSwatchEntry[]) {
  try {
    const next = saveStoredSwatches(swatches, docId)
    dispatchPhotoshopEvent("ps-swatches-changed", { docId, swatches: next })
  } catch {
    toast.error("Swatch library is too large to save locally.")
  }
}

function loadGradients(): ManagerGradientEntry[] {
  try {
    return normalizeGradients(readClientStorageJson(CLIENT_STORAGE_KEYS.gradients))
  } catch {
    return []
  }
}

function saveGradients(gradients: ManagerGradientEntry[]) {
  try {
    writeClientStorageJson(CLIENT_STORAGE_KEYS.gradients, gradients)
    dispatchPhotoshopEvent("ps-gradients-changed", { gradients })
  } catch {
    toast.error("Gradient library is too large to save locally.")
  }
}

function loadPatterns(docId?: string): ManagerPatternEntry[] {
  try {
    const scoped = readClientStorageJson(scopedPatternStorageKey(docId))
    return normalizePatterns(scoped.length || !docId ? scoped : readClientStorageJson(CLIENT_STORAGE_KEYS.patterns))
  } catch {
    return []
  }
}

function savePatterns(docId: string | undefined, patterns: ManagerPatternEntry[]) {
  try {
    writeClientStorageJson(scopedPatternStorageKey(docId), patterns)
    dispatchPhotoshopEvent("ps-patterns-changed", { docId, patterns })
  } catch {
    toast.error("Pattern library is too large to save locally.")
  }
}

function saveShapePresets(shapes: ShapePresetEntry[]) {
  try {
    writeShapePresets(shapes)
  } catch {
    toast.error("Shape preset library is too large to save locally.")
  }
}

function normalizeGradients(value: unknown): ManagerGradientEntry[] {
  const source = isRecord(value) && Array.isArray(value.gradients) ? value.gradients : value
  if (!Array.isArray(source)) return []
  return source.slice(0, 256).flatMap((item, index) => {
    if (!isRecord(item)) return []
    const stops = normalizeGradientStops(item.stops)
    if (stops.length < 2) return []
    return [{
      id: typeof item.id === "string" ? item.id.slice(0, 96) : `grad-${index + 1}`,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 96) : `Gradient ${index + 1}`,
      category: typeof item.category === "string"
        ? item.category.trim().slice(0, 80) || "Custom"
        : typeof item.group === "string"
          ? item.group.trim().slice(0, 80) || "Custom"
          : "Custom",
      stops,
      createdAt: finiteTimestamp(item.createdAt),
    }]
  })
}

function normalizePatterns(value: unknown): ManagerPatternEntry[] {
  const source = isRecord(value) && Array.isArray(value.patterns) ? value.patterns : value
  if (!Array.isArray(source)) return []
  return source.slice(0, 256).flatMap((item, index) => {
    if (!isRecord(item) || typeof item.dataURL !== "string" || !IMAGE_DATA_URL.test(item.dataURL)) return []
    return [{
      id: typeof item.id === "string" ? item.id.slice(0, 96) : `pattern-${index + 1}`,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 96) : `Pattern ${index + 1}`,
      group: typeof item.group === "string" ? item.group.trim().slice(0, 80) || "User" : "User",
      dataURL: item.dataURL,
      width: cleanNumber(item.width, 1, 4096, 1),
      height: cleanNumber(item.height, 1, 4096, 1),
      createdAt: finiteTimestamp(item.createdAt),
    }]
  })
}

function normalizeGradientStops(value: unknown): { pos: number; color: string }[] {
  if (!Array.isArray(value)) return [
    { pos: 0, color: "#000000" },
    { pos: 1, color: "#ffffff" },
  ]
  const stops = value.slice(0, 16).flatMap((stop) => {
    if (!isRecord(stop)) return []
    const pos = typeof stop.pos === "number" ? stop.pos : typeof stop.offset === "number" ? stop.offset : NaN
    const color = typeof stop.color === "string" ? stop.color : ""
    if (!Number.isFinite(pos) || !HEX_OR_RGBA.test(color)) return []
    return [{ pos: Math.max(0, Math.min(1, pos)), color }]
  })
  return stops.length >= 2 ? stops.sort((a, b) => a.pos - b.pos) : [
    { pos: 0, color: "#000000" },
    { pos: 1, color: "#ffffff" },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function finiteTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

