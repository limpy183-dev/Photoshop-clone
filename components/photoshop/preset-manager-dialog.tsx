"use client"

// Unified Preset Manager — implements gap-report item #2.
//
// A single dialog (Edit > Presets > Preset Manager…) that exposes every
// preset family in one place: brushes, swatches, gradients, patterns,
// styles, shapes, tool presets, contours, custom shapes, and assets. The
// dialog reads and writes through the same browser stores as the per-family
// panels — `editor-context` reducer state for brush/style/asset presets,
// `swatches-store` for swatches, `shape-preset-library` for shape presets,
// and the existing `ps-gradients` / `ps-patterns` localStorage keys for
// gradients and patterns. No state is duplicated; saving here updates the
// same stores the right-dock panels and the existing Preset Manager Panel
// read from.

import * as React from "react"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { downloadText } from "./document-io"
import { useActiveDocument, useActiveLayer, useEditorCommands, useEditorStateSelector, type Action } from "./editor-context"
import type {
  AssetLibraryItem,
  BrushPreset,
  BrushSettings,
  CloneSourceSettings,
  CustomShapeId,
  EraserSettings,
  GradientSettings,
  GradientStop,
  LayerStyle,
  PsDocument,
  SelectionOptions,
  ToolId,
} from "./types"
import {
  collectPresetSets,
  createPresetBundle,
  deletePresetItem,
  filterPresetItems,
  mergePresetItems,
  movePresetToSet,
  parsePresetBundle,
  presetFamilyLabel,
  presetKey,
  renamePresetItem,
  reorderPresetItem,
  type PresetImportConflictPolicy,
  type UnifiedPresetFamily,
  type UnifiedPresetItem,
} from "./preset-manager"
import {
  isAssetKind,
  loadManagedGradients,
  loadManagedPatterns,
  loadManagedShapes,
  loadManagedSwatches,
  normalizeGradientStops,
  saveManagedGradients,
  saveManagedPatterns,
  saveManagedShapes,
  saveManagedSwatches,
  type ManagerGradientEntry,
  type ManagerPatternEntry,
  type ManagerSwatchEntry,
} from "./preset-stores"
import type { ShapePresetEntry } from "./shape-preset-library"

const MAX_UNIFIED_IMPORT_BYTES = 2 * 1024 * 1024
const HEX_OR_RGBA = /^(#[0-9a-f]{3,8}|rgba?\([^()]{1,80}\))$/i
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i

// The Type dropdown surfaces 10 entries (CLAUDE prompt). Eight map directly to
// `UnifiedPresetFamily`; two ("contour", "custom-shape") are virtual filters
// over existing families (asset library for custom shapes, a built-in
// contour list for the layer-style contour curves).
type DialogFamily =
  | UnifiedPresetFamily
  | "contour"
  | "custom-shape"

interface FamilyDescriptor {
  key: DialogFamily
  label: string
  color: string
}

const FAMILY_OPTIONS: FamilyDescriptor[] = [
  { key: "brush", label: "Brushes", color: "#38bdf8" },
  { key: "swatch", label: "Swatches", color: "#f97316" },
  { key: "gradient", label: "Gradients", color: "#a78bfa" },
  { key: "pattern", label: "Patterns", color: "#22c55e" },
  { key: "style", label: "Styles", color: "#facc15" },
  { key: "shape", label: "Shapes", color: "#fb7185" },
  { key: "tool-preset", label: "Tool Presets", color: "#2dd4bf" },
  { key: "contour", label: "Contours", color: "#e879f9" },
  { key: "custom-shape", label: "Custom Shapes", color: "#f472b6" },
  { key: "asset", label: "Assets", color: "#94a3b8" },
]

const FAMILY_ACCENTS: Record<DialogFamily, string> = FAMILY_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.key]: option.color }),
  {} as Record<DialogFamily, string>,
)

// Layer-style contour curves are baked into `layer-styles.ts`, so the
// manager surfaces them as read-only built-in items the user can rename in
// downstream copies. They behave like swatches in that "apply" pushes the
// curve into the active layer style if one exists.
const CONTOUR_BUILTINS = [
  { id: "linear", name: "Linear", curve: "linear" as const, description: "Flat 1:1 falloff" },
  { id: "soft", name: "Soft Edge", curve: "soft" as const, description: "Smoothstep 3v² − 2v³" },
  { id: "sharp", name: "Sharp", curve: "sharp" as const, description: "Power 0.42 emphasis" },
  { id: "ring", name: "Ring", curve: "ring" as const, description: "Sinusoidal halo" },
  { id: "cone", name: "Cone", curve: "cone" as const, description: "Triangular peak" },
]

interface DialogPresetItem extends UnifiedPresetItem {
  dialogFamily: DialogFamily
}

type ToolPresetPayload = {
  tool?: ToolId
  brush?: Partial<BrushSettings>
  eraser?: Partial<EraserSettings>
  cloneSource?: Partial<CloneSourceSettings>
  selectionOptions?: Partial<SelectionOptions>
  foreground?: string
  background?: string
}

type ManagerStylePreset = NonNullable<PsDocument["stylePresets"]>[number]

export function PresetManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const activeDoc = useActiveDocument()
  const activeLayer = useActiveLayer()
  const brushPresets = useEditorStateSelector((state) => state.brushPresets)
  const { dispatch, commit } = useEditorCommands()

  const [swatches, setSwatches] = React.useState<ManagerSwatchEntry[]>(() => loadManagedSwatches(activeDoc?.id))
  const [gradients, setGradients] = React.useState<ManagerGradientEntry[]>(loadManagedGradients)
  const [patterns, setPatterns] = React.useState<ManagerPatternEntry[]>(() => loadManagedPatterns(activeDoc?.id))
  const [shapes, setShapes] = React.useState<ShapePresetEntry[]>(loadManagedShapes)

  const [family, setFamily] = React.useState<DialogFamily>("brush")
  const [activeSet, setActiveSet] = React.useState<string>("All")
  const [query, setQuery] = React.useState("")
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>([])
  const [lastAnchor, setLastAnchor] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState("")
  const [newSetName, setNewSetName] = React.useState("")
  const [conflictPolicy, setConflictPolicy] = React.useState<PresetImportConflictPolicy>("keep-both")
  const [importSummary, setImportSummary] = React.useState("")
  const importRef = React.useRef<HTMLInputElement>(null)
  const lastDocIdRef = React.useRef<string | undefined>(activeDoc?.id)

  // Reload doc-scoped stores when switching documents.
  React.useEffect(() => {
    if (!open) return
    if (lastDocIdRef.current === activeDoc?.id) return
    lastDocIdRef.current = activeDoc?.id
    setSwatches(loadManagedSwatches(activeDoc?.id))
    setPatterns(loadManagedPatterns(activeDoc?.id))
    setSelectedKeys([])
  }, [open, activeDoc?.id])

  // Refresh on every open to pick up changes from other surfaces.
  React.useEffect(() => {
    if (!open) return
    setSwatches(loadManagedSwatches(activeDoc?.id))
    setGradients(loadManagedGradients())
    setPatterns(loadManagedPatterns(activeDoc?.id))
    setShapes(loadManagedShapes())
    setSelectedKeys([])
    setImportSummary("")
  }, [open, activeDoc?.id])

  const allItems = React.useMemo<DialogPresetItem[]>(() => {
    const items: DialogPresetItem[] = [
      ...brushPresets.map((preset) => tagFamily(brushPresetToItem(preset), "brush")),
      ...swatches.map((entry, index) => tagFamily(swatchToItem(entry, index), "swatch")),
      ...gradients.map((entry) => tagFamily(gradientToItem(entry), "gradient")),
      ...patterns.map((entry) => tagFamily(patternToItem(entry), "pattern")),
      ...(activeDoc?.stylePresets ?? []).map((entry) => tagFamily(styleToItem(entry), "style")),
      ...shapes.map((entry) => tagFamily(shapeToItem(entry), "shape")),
      ...(activeDoc?.assetLibrary ?? []).map((entry) => {
        const item = assetToItem(entry)
        // Custom uploaded shapes live in the asset library; surface them
        // under the "Custom Shapes" dialog family so the user can manage
        // them without flipping to the assets panel.
        if (entry.kind === "shape") return tagFamily(item, "custom-shape")
        if (entry.kind === "tool-preset") return tagFamily(item, "tool-preset")
        return tagFamily(item, "asset")
      }),
      ...CONTOUR_BUILTINS.map((contour) => contourToItem(contour)),
    ]
    return items
  }, [activeDoc?.assetLibrary, activeDoc?.stylePresets, brushPresets, gradients, patterns, shapes, swatches])

  const familyItems = React.useMemo(
    () => allItems.filter((item) => item.dialogFamily === family),
    [allItems, family],
  )

  const sets = React.useMemo(
    () => collectPresetSets(familyItems, "all"),
    [familyItems],
  )

  React.useEffect(() => {
    if (!sets.some((entry) => entry.set === activeSet)) setActiveSet("All")
  }, [activeSet, sets])

  const visibleItems = React.useMemo(
    () => filterPresetItems(familyItems, { family: "all", set: activeSet, query }) as DialogPresetItem[],
    [activeSet, familyItems, query],
  )

  const selectedItems = React.useMemo(
    () => allItems.filter((item) => selectedKeys.includes(item.key)),
    [allItems, selectedKeys],
  )

  // Keep rename draft synchronized with the latest single-selection.
  React.useEffect(() => {
    if (selectedItems.length === 1) {
      setRenameDraft(selectedItems[0].name)
    } else {
      setRenameDraft("")
    }
  }, [selectedItems])

  const applyAllItems = React.useCallback(
    (nextItems: DialogPresetItem[] | UnifiedPresetItem[], label: string) => {
      const split = splitUnifiedItems(nextItems as UnifiedPresetItem[])
      setSwatches(split.swatches)
      saveManagedSwatches(activeDoc?.id, split.swatches)
      setGradients(split.gradients)
      saveManagedGradients(split.gradients)
      setPatterns(split.patterns)
      saveManagedPatterns(activeDoc?.id, split.patterns)
      setShapes(split.shapes)
      saveManagedShapes(split.shapes)
      dispatch({ type: "set-brush-presets", presets: split.brushPresets })
      if (activeDoc) {
        dispatch({
          type: "set-style-presets",
          presets: split.styles as NonNullable<PsDocument["stylePresets"]>,
        })
        dispatch({ type: "set-asset-library", assets: split.assets })
        window.setTimeout(() => commit(label, []), 0)
      }
    },
    [activeDoc, commit, dispatch],
  )

  const handleSelect = (key: string, event: React.MouseEvent | React.KeyboardEvent) => {
    const shift = event.shiftKey
    const meta = event.metaKey || event.ctrlKey
    if (shift && lastAnchor) {
      const start = visibleItems.findIndex((item) => item.key === lastAnchor)
      const end = visibleItems.findIndex((item) => item.key === key)
      if (start >= 0 && end >= 0) {
        const [a, b] = start <= end ? [start, end] : [end, start]
        const range = visibleItems.slice(a, b + 1).map((item) => item.key)
        setSelectedKeys((prev) => {
          const next = new Set(prev)
          for (const k of range) next.add(k)
          return [...next]
        })
        return
      }
    }
    if (meta) {
      setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
      setLastAnchor(key)
      return
    }
    setSelectedKeys([key])
    setLastAnchor(key)
  }

  const renameSelected = () => {
    if (selectedItems.length !== 1) return
    const trimmed = renameDraft.trim()
    if (!trimmed) return
    applyAllItems(renamePresetItem(allItems, selectedItems[0].key, trimmed), "Rename Preset")
  }

  const deleteSelected = () => {
    if (!selectedItems.length) return
    let next: UnifiedPresetItem[] = allItems
    let removed = 0
    for (const item of selectedItems) {
      if (item.readonly) continue
      const before = next.length
      next = deletePresetItem(next, item.key)
      if (next.length < before) removed += 1
    }
    applyAllItems(next, removed === 1 ? "Delete Preset" : `Delete ${removed} Presets`)
    setSelectedKeys([])
  }

  const duplicateSelected = () => {
    if (!selectedItems.length) return
    const duplicates: UnifiedPresetItem[] = []
    for (const item of selectedItems) {
      if (item.readonly) continue
      duplicates.push({
        ...item,
        id: `${item.id}-copy-${Math.random().toString(36).slice(2, 6)}`,
        key: presetKey(item.family, `${item.id}-copy-${Math.random().toString(36).slice(2, 6)}`),
        name: `${item.name} copy`,
        createdAt: Date.now(),
      })
    }
    if (!duplicates.length) return
    const merged = mergePresetItems(allItems, duplicates, { conflictPolicy: "keep-both" })
    applyAllItems(merged.items, duplicates.length === 1 ? "Duplicate Preset" : `Duplicate ${duplicates.length} Presets`)
  }

  const reorderSelected = (delta: number) => {
    if (selectedItems.length !== 1) return
    applyAllItems(reorderPresetItem(allItems, selectedItems[0].key, delta), "Reorder Preset")
  }

  const moveSelectedToSet = (targetSet: string) => {
    if (!selectedItems.length) return
    const trimmed = targetSet.trim() || "User"
    let next: UnifiedPresetItem[] = allItems
    for (const item of selectedItems) {
      if (item.readonly) continue
      next = movePresetToSet(next, item.key, trimmed)
    }
    applyAllItems(next, "Move Preset")
    setActiveSet(trimmed)
  }

  const handleDropIntoSet = (event: React.DragEvent, setName: string) => {
    event.preventDefault()
    const payload = event.dataTransfer.getData("text/plain")
    if (!payload) return
    const keys = payload.includes(",") ? payload.split(",").filter(Boolean) : [payload]
    let next: UnifiedPresetItem[] = allItems
    for (const key of keys) {
      const target = allItems.find((item) => item.key === key)
      if (!target || target.readonly) continue
      next = movePresetToSet(next, key, setName)
    }
    applyAllItems(next, keys.length === 1 ? "Move Preset" : `Move ${keys.length} Presets`)
    setActiveSet(setName)
    setSelectedKeys(keys)
  }

  const exportSelection = () => {
    const target = selectedItems.length ? selectedItems : visibleItems
    if (!target.length) {
      toast.error("Nothing to export.")
      return
    }
    const familyLabel = FAMILY_OPTIONS.find((option) => option.key === family)?.label ?? "presets"
    downloadText(
      JSON.stringify(
        createPresetBundle(target, { sourceDocumentName: activeDoc?.name }),
        null,
        2,
      ),
      `${familyLabel.toLowerCase().replace(/\s+/g, "-")}.pspresets.json`,
    )
  }

  const importBundle = async (file: File) => {
    try {
      if (file.size > MAX_UNIFIED_IMPORT_BYTES) {
        throw new Error("Preset libraries are limited to 2 MB.")
      }
      const imported = parsePresetBundle(await file.text())
      const merged = mergePresetItems(allItems, imported, {
        conflictPolicy,
        idFactory: (incomingFamily, id, attempt) => `${incomingFamily}-${id}-import-${attempt}`,
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

  const applyPreset = (item: DialogPresetItem) => {
    if (item.family === "brush") {
      dispatch({ type: "apply-brush-preset", preset: itemToBrushPreset(item) })
      toast.success(`Applied brush: ${item.name}`)
      return
    }
    if (item.family === "swatch") {
      const color = recordOf(item.payload).color
      if (typeof color === "string") {
        dispatch({ type: "set-foreground", color })
        toast.success(`Foreground: ${color}`)
      }
      return
    }
    if (item.family === "gradient") {
      dispatch({ type: "set-gradient", gradient: itemToGradientSettings(item) })
      toast.success(`Gradient: ${item.name}`)
      return
    }
    if (item.family === "style" && activeLayer) {
      dispatch({ type: "set-layer-style", id: activeLayer.id, style: item.payload as LayerStyle })
      window.setTimeout(() => commit("Apply Style Preset", [activeLayer.id]), 0)
      toast.success(`Style: ${item.name}`)
      return
    }
    if (item.family === "shape") {
      const customId = recordOf(item.payload).customId
      if (typeof customId === "string") {
        window.__psCustomShape = customId as CustomShapeId
        dispatch({ type: "set-tool", tool: "custom-shape" })
        toast.success(`Shape: ${item.name}`)
      }
      return
    }
    if (item.family === "tool-preset") {
      applyToolPreset(item.payload as ToolPresetPayload, dispatch)
      toast.success(`Tool preset: ${item.name}`)
      return
    }
    if (item.family === "asset") {
      const kind = item.sourceKind
      if (kind === "swatch") {
        const color = recordOf(item.payload).color
        if (typeof color === "string") dispatch({ type: "set-foreground", color })
      }
      toast.success(`Asset: ${item.name}`)
    }
  }

  const familyOption = FAMILY_OPTIONS.find((option) => option.key === family) ?? FAMILY_OPTIONS[0]
  const allowReadonly = selectedItems.length === 1 && !selectedItems[0].readonly
  const allowMulti = selectedItems.length >= 1 && selectedItems.some((item) => !item.readonly)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)] sm:max-w-[920px]"
        style={{ maxHeight: "calc(100vh - 96px)" }}
      >
        <DialogHeader>
          <DialogTitle>Preset Manager</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Browse, rename, reorder, import and export every preset family in one place.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={importRef}
          type="file"
          accept=".json,.pspresets,.pspresets.json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void importBundle(file)
          }}
        />

        {/* Toolbar */}
        <div className="grid grid-cols-[200px_1fr_auto_auto] items-center gap-2 border-b border-[var(--ps-divider)] pb-3">
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              Preset Type
            </Label>
            <select
              value={family}
              onChange={(event) => {
                setFamily(event.target.value as DialogFamily)
                setActiveSet("All")
                setSelectedKeys([])
              }}
              className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[12px]"
              aria-label="Preset type"
            >
              {FAMILY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              Search
            </Label>
            <div className="flex h-8 items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2">
              <Search className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${familyOption.label.toLowerCase()}`}
                className="h-full flex-1 border-0 bg-transparent text-[12px] outline-none"
                aria-label="Search presets"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              On Conflict
            </Label>
            <select
              value={conflictPolicy}
              onChange={(event) => setConflictPolicy(event.target.value as PresetImportConflictPolicy)}
              className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[12px]"
              aria-label="Conflict resolution policy"
            >
              <option value="keep-both">Keep both</option>
              <option value="replace">Replace</option>
              <option value="skip">Skip</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              Bundle
            </Label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => importRef.current?.click()}
                aria-label="Import preset bundle"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exportSelection}
                disabled={!visibleItems.length}
                aria-label="Export selection or visible presets"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
          </div>
        </div>

        {importSummary ? (
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[11px] text-[var(--ps-text-dim)]">
            {importSummary}
          </div>
        ) : null}

        {/* Body — set tree (left) + grid (right) */}
        <div
          className="grid min-h-0 grid-cols-[220px_1fr] gap-3"
          style={{ minHeight: 380, maxHeight: "calc(100vh - 360px)" }}
        >
          <div className="flex min-h-0 flex-col rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]">
            <div className="flex items-center justify-between border-b border-[var(--ps-divider)] px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              <span>Sets</span>
              <span>{familyItems.length}</span>
            </div>
            <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
              {sets.map((entry) => {
                const isActive = activeSet === entry.set
                return (
                  <button
                    key={entry.set}
                    type="button"
                    onClick={() => setActiveSet(entry.set)}
                    onDragOver={(event) => {
                      if (entry.set !== "All") event.preventDefault()
                    }}
                    onDrop={(event) => {
                      if (entry.set !== "All") handleDropIntoSet(event, entry.set)
                    }}
                    className={`flex w-full items-center justify-between border-b border-[var(--ps-divider)] px-2 py-2 text-left text-[11px] hover:bg-[var(--ps-tool-hover)] ${
                      isActive ? "bg-[var(--ps-tool-active)]" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <FolderOpen
                        className="h-3.5 w-3.5"
                        style={{ color: FAMILY_ACCENTS[family] }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{entry.set}</span>
                    </span>
                    <span className="text-[10px] text-[var(--ps-text-dim)]">{entry.count}</span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-[var(--ps-divider)] p-2">
              <div className="flex gap-1">
                <Input
                  value={newSetName}
                  onChange={(event) => setNewSetName(event.target.value)}
                  placeholder="New set"
                  className="h-7 bg-[var(--ps-panel)] text-[11px]"
                  aria-label="New set name"
                />
                <Button
                  size="icon-sm"
                  variant="outline"
                  title="Move selection into a new set"
                  aria-label="Create set from selection"
                  disabled={!allowMulti || !newSetName.trim()}
                  onClick={() => {
                    const name = newSetName.trim()
                    if (!name) return
                    moveSelectedToSet(name)
                    setNewSetName("")
                  }}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]">
            <div className="flex items-center justify-between border-b border-[var(--ps-divider)] px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              <span>
                {familyOption.label} — {activeSet === "All" ? "All sets" : activeSet}
              </span>
              <span>
                {visibleItems.length} visible / {selectedItems.length} selected
              </span>
            </div>
            <div
              className="flex-1 overflow-y-auto p-2"
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelectedKeys([])
              }}
            >
              {visibleItems.length ? (
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}
                >
                  {visibleItems.map((item) => {
                    const selected = selectedKeys.includes(item.key)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        draggable={!item.readonly}
                        onDragStart={(event) => {
                          const payload = selected && selectedKeys.length > 1 ? selectedKeys.join(",") : item.key
                          event.dataTransfer.setData("text/plain", payload)
                          event.dataTransfer.effectAllowed = "move"
                        }}
                        onClick={(event) => handleSelect(item.key, event)}
                        onDoubleClick={() => applyPreset(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            handleSelect(item.key, event)
                          }
                        }}
                        className={`group flex flex-col items-center gap-1 rounded-sm border px-2 py-2 text-[11px] transition-colors ${
                          selected
                            ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]"
                            : "border-[var(--ps-divider)] bg-[var(--ps-panel)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-tool-hover)]"
                        }`}
                        aria-pressed={selected}
                        title={`${item.name} — ${presetFamilyLabel(item.family)} / ${item.set}${
                          item.readonly ? " (built-in)" : ""
                        }`}
                      >
                        <PresetPreview item={item} />
                        <span className="line-clamp-2 w-full text-center text-[11px] leading-tight">
                          {item.name}
                        </span>
                        <span className="text-[10px] text-[var(--ps-text-dim)]">{item.set}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-[12px] text-[var(--ps-text-dim)]">
                  No {familyOption.label.toLowerCase()} match this search.
                </div>
              )}
            </div>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-1 border-t border-[var(--ps-divider)] p-2">
              <Input
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") renameSelected()
                }}
                disabled={!allowReadonly}
                placeholder={
                  selectedItems.length === 1
                    ? "Rename selected"
                    : selectedItems.length > 1
                      ? `${selectedItems.length} selected`
                      : "Select a preset"
                }
                className="h-7 bg-[var(--ps-panel)] text-[11px]"
                aria-label="Rename selected preset"
              />
              <Button
                size="icon-sm"
                variant="outline"
                title="Rename selected preset"
                aria-label="Rename selected preset"
                disabled={!allowReadonly}
                onClick={renameSelected}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                title="Duplicate selection"
                aria-label="Duplicate selected presets"
                disabled={!allowMulti}
                onClick={duplicateSelected}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                title="Move selection up"
                aria-label="Move selected preset up"
                disabled={!allowReadonly}
                onClick={() => reorderSelected(-1)}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                title="Move selection down"
                aria-label="Move selected preset down"
                disabled={!allowReadonly}
                onClick={() => reorderSelected(1)}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                title="Delete selection"
                aria-label="Delete selected presets"
                disabled={!allowMulti}
                onClick={deleteSelected}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-between gap-2 text-[11px] text-[var(--ps-text-dim)]">
          <span>
            Tip: shift-click to range-select, ctrl/cmd-click to toggle, drag onto a set to move,
            double-click a preset to apply.
          </span>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Preview cell
// ---------------------------------------------------------------------------

function PresetPreview({ item }: { item: DialogPresetItem }) {
  const record = recordOf(item.payload)
  if (item.family === "swatch") {
    const color = safeColor(record.color, "#000000")
    return (
      <span
        className="h-12 w-full rounded-sm border border-[var(--ps-divider)]"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
    )
  }
  if (item.family === "gradient") {
    return (
      <span
        className="h-12 w-full rounded-sm border border-[var(--ps-divider)]"
        style={{ background: gradientCss(record.stops) }}
        aria-hidden="true"
      />
    )
  }
  if (item.family === "pattern" && typeof record.dataURL === "string") {
    return (
      <span
        className="h-12 w-full rounded-sm border border-[var(--ps-divider)] bg-cover bg-center"
        style={{ backgroundImage: `url(${record.dataURL})` }}
        aria-hidden="true"
      />
    )
  }
  if (item.family === "brush" && typeof record.thumbnail === "string") {
    return (
      <span
        className="h-12 w-full rounded-sm border border-[var(--ps-divider)] bg-cover bg-center"
        style={{ backgroundImage: `url(${record.thumbnail})` }}
        aria-hidden="true"
      />
    )
  }
  if (item.dialogFamily === "contour") {
    return (
      <span
        className="h-12 w-full overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)]"
        aria-hidden="true"
      >
        <ContourCurve curve={(record.curve as string | undefined) ?? "linear"} />
      </span>
    )
  }
  return (
    <span
      className="grid h-12 w-full place-items-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)]"
      aria-hidden="true"
    >
      <Check className="h-4 w-4" style={{ color: FAMILY_ACCENTS[item.dialogFamily] }} />
    </span>
  )
}

function ContourCurve({ curve }: { curve: string }) {
  const samples = 24
  const points: { x: number; y: number }[] = []
  for (let i = 0; i <= samples; i += 1) {
    const v = i / samples
    let mapped = v
    if (curve === "soft") mapped = v * v * (3 - 2 * v)
    else if (curve === "sharp") mapped = Math.pow(v, 0.42)
    else if (curve === "ring") mapped = Math.sin(v * Math.PI * 2) * 0.5 + 0.5
    else if (curve === "cone") mapped = v < 0.5 ? v * 2 : (1 - v) * 2
    points.push({ x: v * 100, y: 100 - mapped * 100 })
  }
  const d = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ")
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Item builders (mirror the panel — kept here to keep the dialog self
// contained, but reading/writing through the same shared stores so state is
// never duplicated).
// ---------------------------------------------------------------------------

function tagFamily(item: UnifiedPresetItem, dialogFamily: DialogFamily): DialogPresetItem {
  return { ...item, dialogFamily }
}

function brushPresetToItem(preset: BrushPreset): UnifiedPresetItem {
  return {
    key: presetKey("brush", preset.id),
    family: "brush",
    id: preset.id,
    name: preset.name,
    set: preset.folder ?? "General",
    payload: {
      size: preset.size,
      hardness: preset.hardness,
      spacing: preset.spacing,
      settings: preset.settings,
      thumbnail: preset.thumbnail,
    },
    preview: preset.thumbnail,
  }
}

function swatchToItem(swatch: ManagerSwatchEntry, index: number): UnifiedPresetItem {
  const id = swatch.id ?? `swatch-${index}-${swatch.color.replace("#", "")}`
  return {
    key: presetKey("swatch", id),
    family: "swatch",
    id,
    name: swatch.name ?? swatch.color.toUpperCase(),
    set: swatch.group ?? "Default",
    payload: { color: swatch.color },
    createdAt: swatch.createdAt,
  }
}

function gradientToItem(preset: ManagerGradientEntry): UnifiedPresetItem {
  return {
    key: presetKey("gradient", preset.id),
    family: "gradient",
    id: preset.id,
    name: preset.name,
    set: preset.category ?? "Custom",
    payload: { stops: preset.stops },
    createdAt: preset.createdAt,
  }
}

function patternToItem(pattern: ManagerPatternEntry): UnifiedPresetItem {
  return {
    key: presetKey("pattern", pattern.id),
    family: "pattern",
    id: pattern.id,
    name: pattern.name,
    set: pattern.group ?? "User",
    payload: {
      dataURL: pattern.dataURL,
      width: pattern.width,
      height: pattern.height,
    },
    createdAt: pattern.createdAt,
  }
}

function styleToItem(preset: NonNullable<PsDocument["stylePresets"]>[number]): UnifiedPresetItem {
  const styled = preset as ManagerStylePreset & { group?: string; createdAt?: number }
  return {
    key: presetKey("style", styled.id),
    family: "style",
    id: styled.id,
    name: styled.name,
    set: styled.group ?? "Styles",
    payload: styled.style,
    createdAt: styled.createdAt,
  }
}

function shapeToItem(shape: ShapePresetEntry): UnifiedPresetItem {
  return {
    key: presetKey("shape", shape.id),
    family: "shape",
    id: shape.id,
    name: shape.name,
    set: shape.group,
    payload: { customId: shape.customId },
    createdAt: shape.createdAt,
  }
}

function assetToItem(asset: AssetLibraryItem): UnifiedPresetItem {
  if (asset.kind === "tool-preset") {
    return {
      key: presetKey("tool-preset", asset.id),
      family: "tool-preset",
      id: asset.id,
      name: asset.name,
      set: asset.group ?? "Tools",
      payload: asset.payload,
      createdAt: asset.createdAt,
      sourceKind: asset.kind,
    }
  }
  return {
    key: presetKey("asset", asset.id),
    family: "asset",
    id: asset.id,
    name: asset.name,
    set: asset.group ?? asset.kind,
    payload: asset.payload,
    createdAt: asset.createdAt,
    sourceKind: asset.kind,
  }
}

function contourToItem(contour: (typeof CONTOUR_BUILTINS)[number]): DialogPresetItem {
  return {
    key: presetKey("style", `contour-${contour.id}`),
    family: "style",
    dialogFamily: "contour",
    id: `contour-${contour.id}`,
    name: contour.name,
    set: "Built-in",
    payload: { contour: contour.curve, curve: contour.curve, description: contour.description },
    readonly: true,
  }
}

function splitUnifiedItems(items: readonly UnifiedPresetItem[]) {
  const brushPresets = items.filter((item) => item.family === "brush").map(itemToBrushPreset)
  const swatches = items.filter((item) => item.family === "swatch").map(itemToSwatch)
  const gradients = items.filter((item) => item.family === "gradient").map(itemToGradient)
  const patterns = items
    .filter((item) => item.family === "pattern")
    .map(itemToPattern)
    .filter((entry): entry is ManagerPatternEntry => entry !== null)
  // Drop synthetic built-in contour items before persisting — they live in
  // `layer-styles.ts`, not in any user store.
  const styles = items
    .filter((item) => item.family === "style" && !item.id.startsWith("contour-"))
    .map(itemToStyle)
  const shapes = items.filter((item) => item.family === "shape").map(itemToShape)
  const assets = items
    .filter((item) => item.family === "tool-preset" || item.family === "asset")
    .map(itemToAsset)
    .filter((entry): entry is AssetLibraryItem => entry !== null)
  return { brushPresets, swatches, gradients, patterns, styles, shapes, assets }
}

function itemToBrushPreset(item: UnifiedPresetItem): BrushPreset {
  const record = recordOf(item.payload)
  const settings = recordOf(record.settings) as Partial<BrushSettings>
  return {
    id: item.id,
    name: item.name,
    folder: item.set,
    size: cleanNumber(record.size, 1, 500, settings.size ?? 30),
    hardness: cleanNumber(record.hardness, 0, 100, settings.hardness ?? 80),
    spacing: cleanNumber(record.spacing, 1, 400, settings.spacing ?? 25),
    settings,
    thumbnail: typeof record.thumbnail === "string" ? record.thumbnail : item.preview,
  }
}

function itemToSwatch(item: UnifiedPresetItem): ManagerSwatchEntry {
  const record = recordOf(item.payload)
  const color = safeColor(record.color, "#000000")
  return {
    id: item.id,
    name: item.name === color.toUpperCase() ? undefined : item.name,
    group: item.set,
    color,
    createdAt: item.createdAt,
  }
}

function itemToGradient(item: UnifiedPresetItem): ManagerGradientEntry {
  const record = recordOf(item.payload)
  return {
    id: item.id,
    name: item.name,
    category: item.set,
    stops: normalizeGradientStops(record.stops),
    createdAt: item.createdAt,
  }
}

function itemToPattern(item: UnifiedPresetItem): ManagerPatternEntry | null {
  const record = recordOf(item.payload)
  const dataURL = typeof record.dataURL === "string" ? record.dataURL : ""
  if (!IMAGE_DATA_URL.test(dataURL)) return null
  return {
    id: item.id,
    name: item.name,
    group: item.set,
    dataURL,
    width: cleanNumber(record.width, 1, 4096, 1),
    height: cleanNumber(record.height, 1, 4096, 1),
    createdAt: item.createdAt,
  }
}

function itemToStyle(item: UnifiedPresetItem): ManagerStylePreset & { group?: string; createdAt?: number } {
  return {
    id: item.id,
    name: item.name,
    group: item.set,
    style: recordOf(item.payload) as LayerStyle,
    createdAt: item.createdAt,
  }
}

function itemToShape(item: UnifiedPresetItem): ShapePresetEntry {
  const customId = recordOf(item.payload).customId
  return {
    id: item.id,
    name: item.name,
    group: item.set,
    customId: typeof customId === "string" ? (customId as CustomShapeId) : "star5",
    createdAt: item.createdAt,
  }
}

function itemToAsset(item: UnifiedPresetItem): AssetLibraryItem | null {
  const kind = item.family === "tool-preset"
    ? "tool-preset"
    : isAssetKind(item.sourceKind)
      ? item.sourceKind
      : "cloud-library"
  return {
    id: item.id,
    name: item.name,
    kind,
    group: item.set,
    payload: item.payload,
    createdAt: item.createdAt ?? Date.now(),
  }
}

function itemToGradientSettings(item: UnifiedPresetItem): Partial<GradientSettings> {
  const record = recordOf(item.payload)
  if (typeof record.type === "string") return record as Partial<GradientSettings>
  return {
    type: "linear",
    reverse: false,
    stops: normalizeGradientStops(record.stops).map((stop) => ({
      offset: stop.pos,
      color: stop.color,
      opacity: 1,
    } satisfies GradientStop)),
  }
}

function applyToolPreset(
  payload: ToolPresetPayload,
  dispatch: React.Dispatch<Action>,
) {
  if (payload.tool) dispatch({ type: "set-tool", tool: payload.tool })
  if (payload.brush) dispatch({ type: "set-brush", brush: payload.brush })
  if (payload.eraser && typeof payload.eraser === "object") {
    dispatch({ type: "set-eraser", eraser: payload.eraser })
  }
  if (payload.cloneSource && typeof payload.cloneSource === "object") {
    dispatch({ type: "set-clone-source", cloneSource: payload.cloneSource })
  }
  if (payload.selectionOptions && typeof payload.selectionOptions === "object") {
    dispatch({ type: "set-selection-options", selectionOptions: payload.selectionOptions })
  }
  if (typeof payload.foreground === "string") {
    dispatch({ type: "set-foreground", color: payload.foreground })
  }
  if (typeof payload.background === "string") {
    dispatch({ type: "set-background", color: payload.background })
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function recordOf(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
}

function safeColor(value: unknown, fallback: string) {
  return typeof value === "string" && HEX_OR_RGBA.test(value) ? value : fallback
}

function cleanNumber(value: unknown, min: number, max: number, fallback: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.round(Math.max(min, Math.min(max, next)))
}

function gradientCss(stops: unknown) {
  const normalized = normalizeGradientStops(stops)
  return `linear-gradient(90deg, ${normalized
    .map((stop) => `${stop.color} ${Math.round(stop.pos * 100)}%`)
    .join(", ")})`
}
