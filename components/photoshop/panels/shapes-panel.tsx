"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  FolderPlus,
  Pencil,
  Save,
  Search,
  Shapes,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditor } from "../editor-context"
import { downloadText } from "../document-io"
import { uid } from "../uid"
import {
  exportCustomShapeLibrary,
  mergeCustomShapeLibraries,
  normalizeCustomShapeLibrary,
  shapeAssetToPreset,
  shapePresetToAsset,
} from "../custom-shape-library"
import {
  DEFAULT_SHAPE_PRESETS,
  readShapePresets,
  writeShapePresets,
  type ShapePresetEntry,
} from "../shape-preset-library"
import type { AssetLibraryItem, CustomShapeId, ShapeProps } from "../types"

type Tab = "custom" | "bundled"

function renderShapePreview(shape: ShapeProps, size = 56): React.ReactElement {
  const stroke = shape.stroke
  const fill = shape.fill ?? "#94a3b8"
  if (shape.type === "rect") {
    const radius = shape.radius ?? 0
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <rect x={6} y={6} width={88} height={88} rx={radius} ry={radius} fill={fill} stroke={stroke?.color} strokeWidth={stroke?.width ?? 0} />
      </svg>
    )
  }
  if (shape.type === "ellipse") {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <ellipse cx={50} cy={50} rx={44} ry={44} fill={fill} stroke={stroke?.color} strokeWidth={stroke?.width ?? 0} />
      </svg>
    )
  }
  if (shape.type === "polygon") {
    const sides = Math.max(3, shape.sides ?? 6)
    const radius = 40
    const points = Array.from({ length: sides }, (_, index) => {
      const angle = (Math.PI * 2 * index) / sides - Math.PI / 2
      return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`
    }).join(" ")
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <polygon points={points} fill={fill} stroke={stroke?.color} strokeWidth={stroke?.width ?? 0} />
      </svg>
    )
  }
  if (shape.type === "star") {
    const points = Math.max(3, shape.starPoints ?? 5)
    const outer = 42
    const inner = outer * (shape.innerRadiusRatio ?? 0.45)
    const coords: string[] = []
    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI * i) / points - Math.PI / 2
      const radius = i % 2 === 0 ? outer : inner
      coords.push(`${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`)
    }
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <polygon points={coords.join(" ")} fill={fill} stroke={stroke?.color} strokeWidth={stroke?.width ?? 0} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect x={20} y={20} width={60} height={60} rx={8} fill={fill} stroke={stroke?.color ?? "#475569"} strokeWidth={stroke?.width ?? 1} />
      <text x={50} y={54} textAnchor="middle" fontSize={12} fill="#94a3b8">{shape.type}</text>
    </svg>
  )
}

const SHAPE_SVG_PATHS: Record<CustomShapeId, string> = {
  star5: "M50 4 L61 38 L96 38 L67 60 L78 94 L50 73 L22 94 L33 60 L4 38 L39 38 Z",
  star6: "M50 4 L63 32 L96 32 L70 52 L80 82 L50 64 L20 82 L30 52 L4 32 L37 32 Z",
  heart: "M50 88 L18 56 C8 44 12 24 28 18 C38 14 48 22 50 30 C52 22 62 14 72 18 C88 24 92 44 82 56 Z",
  "arrow-right": "M10 40 L60 40 L60 20 L94 50 L60 80 L60 60 L10 60 Z",
  "arrow-left": "M90 40 L40 40 L40 20 L6 50 L40 80 L40 60 L90 60 Z",
  "arrow-up": "M40 10 L40 60 L20 60 L50 94 L80 60 L60 60 L60 10 Z",
  "arrow-down": "M40 90 L40 40 L20 40 L50 6 L80 40 L60 40 L60 90 Z",
  speech: "M12 14 H88 V70 H58 L40 92 L40 70 H12 Z",
  check: "M14 50 L40 76 L92 18 L82 12 L40 60 L24 42 Z",
  cross: "M22 14 L50 42 L78 14 L88 24 L60 52 L88 80 L78 90 L50 62 L22 90 L12 80 L40 52 L12 24 Z",
  lightning: "M58 4 L24 56 H46 L34 96 L78 38 H54 L70 4 Z",
  "polygon-hex": "M50 4 L86 24 L86 76 L50 96 L14 76 L14 24 Z",
  "polygon-tri": "M50 6 L92 84 L8 84 Z",
  diamond: "M50 6 L94 50 L50 94 L6 50 Z",
}

function renderBundledShapePreview(customId: CustomShapeId, color = "#94a3b8", size = 56) {
  const path = SHAPE_SVG_PATHS[customId]
  if (!path) {
    return (
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <rect x={10} y={10} width={80} height={80} fill={color} />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path d={path} fill={color} />
    </svg>
  )
}

export function ShapesPanel() {
  const { activeDoc, activeLayer, dispatch, commit, foreground } = useEditor()
  const [tab, setTab] = React.useState<Tab>("custom")
  const [query, setQuery] = React.useState("")
  const [shapePresets, setShapePresets] = React.useState<ShapePresetEntry[]>(readShapePresets)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState("")
  const [dragId, setDragId] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<ShapePresetEntry[]>).detail
      setShapePresets(Array.isArray(detail) ? detail : readShapePresets())
    }
    window.addEventListener("ps-shape-presets-changed", sync)
    return () => window.removeEventListener("ps-shape-presets-changed", sync)
  }, [])

  if (!activeDoc) {
    return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No document open.</div>
  }

  const allAssets = activeDoc.assetLibrary ?? []
  const shapeAssets = allAssets.filter((asset): asset is AssetLibraryItem => asset.kind === "shape")

  const customGroups = React.useMemo(() => {
    const set = new Set<string>()
    for (const asset of shapeAssets) set.add(asset.group ?? "Custom Shapes")
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [shapeAssets])

  const bundledGroups = React.useMemo(() => {
    const set = new Set<string>()
    for (const preset of shapePresets) set.add(preset.group ?? "Shapes")
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [shapePresets])

  const visibleCustom = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return shapeAssets
    return shapeAssets.filter((asset) => `${asset.name} ${asset.group ?? ""} ${asset.tags?.join(" ") ?? ""}`.toLowerCase().includes(q))
  }, [shapeAssets, query])

  const visibleBundled = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return shapePresets
    return shapePresets.filter((preset) => `${preset.name} ${preset.group}`.toLowerCase().includes(q))
  }, [shapePresets, query])

  const groupedCustom = React.useMemo(() => {
    const buckets = new Map<string, AssetLibraryItem[]>()
    for (const asset of visibleCustom) {
      const group = asset.group ?? "Custom Shapes"
      const bucket = buckets.get(group) ?? []
      bucket.push(asset)
      buckets.set(group, bucket)
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visibleCustom])

  const groupedBundled = React.useMemo(() => {
    const buckets = new Map<string, ShapePresetEntry[]>()
    for (const preset of visibleBundled) {
      const group = preset.group || "Shapes"
      const bucket = buckets.get(group) ?? []
      bucket.push(preset)
      buckets.set(group, bucket)
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visibleBundled])

  const setAssets = (assets: AssetLibraryItem[], label: string) => {
    dispatch({ type: "set-asset-library", assets })
    window.setTimeout(() => commit(label, []), 0)
  }

  const persistBundled = (next: ShapePresetEntry[], label: string) => {
    setShapePresets(next)
    try {
      writeShapePresets(next)
    } catch {
      toast.error("Shape preset library is too large to save locally.")
    }
    toast.success(label)
  }

  const saveActiveShape = () => {
    if (!activeLayer?.shape) {
      toast.error("Select a layer with a vector shape.")
      return
    }
    const asset = shapePresetToAsset(activeLayer.shape, {
      name: `${activeLayer.name} shape`,
      group: "Custom Shapes",
      tags: ["shape", "vector"],
    })
    setAssets([asset, ...allAssets], "Save Custom Shape")
    toast.success(`Saved “${asset.name}”.`)
  }

  const selectCustomAsset = (asset: AssetLibraryItem) => {
    if (typeof window === "undefined") return
    window.__psCustomShapePreset = shapeAssetToPreset(asset, { x: 0, y: 0, w: 100, h: 100, fill: foreground })
    window.__psCustomShape = undefined
    dispatch({ type: "set-tool", tool: "custom-shape" })
    toast.success(`“${asset.name}” active — drag on the canvas to draw.`)
  }

  const selectBundledShape = (preset: ShapePresetEntry) => {
    if (typeof window === "undefined") return
    window.__psCustomShapePreset = undefined
    window.__psCustomShape = preset.customId
    dispatch({ type: "set-tool", tool: "custom-shape" })
    toast.success(`“${preset.name}” active — drag on the canvas to draw.`)
  }

  const renameAsset = (asset: AssetLibraryItem, name: string) => {
    const trimmed = name.trim().slice(0, 80)
    if (!trimmed) return
    setAssets(
      allAssets.map((entry) => entry.id === asset.id ? { ...entry, name: trimmed, updatedAt: Date.now() } : entry),
      "Rename Custom Shape",
    )
  }

  const moveAssetToGroup = (asset: AssetLibraryItem, group: string) => {
    const trimmed = group.trim().slice(0, 80) || "Custom Shapes"
    setAssets(
      allAssets.map((entry) => entry.id === asset.id ? { ...entry, group: trimmed, updatedAt: Date.now() } : entry),
      "Move Custom Shape",
    )
  }

  const removeAsset = (asset: AssetLibraryItem) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete custom shape “${asset.name}”?`)) return
    setAssets(allAssets.filter((entry) => entry.id !== asset.id), "Delete Custom Shape")
  }

  const renamePreset = (preset: ShapePresetEntry, name: string) => {
    const trimmed = name.trim().slice(0, 80)
    if (!trimmed) return
    persistBundled(
      shapePresets.map((entry) => entry.id === preset.id ? { ...entry, name: trimmed } : entry),
      "Renamed shape preset",
    )
  }

  const movePresetToGroup = (preset: ShapePresetEntry, group: string) => {
    const trimmed = group.trim().slice(0, 80) || "Shapes"
    persistBundled(
      shapePresets.map((entry) => entry.id === preset.id ? { ...entry, group: trimmed } : entry),
      "Moved shape preset",
    )
  }

  const removePreset = (preset: ShapePresetEntry) => {
    if (typeof window !== "undefined" && !window.confirm(`Hide bundled shape “${preset.name}”?`)) return
    persistBundled(shapePresets.filter((entry) => entry.id !== preset.id), "Removed shape preset")
  }

  const restoreBundledDefaults = () => {
    if (typeof window !== "undefined" && !window.confirm("Restore bundled shape defaults? Existing custom names will be lost.")) return
    persistBundled(DEFAULT_SHAPE_PRESETS, "Restored bundled shapes")
  }

  const reorderCustomInto = (sourceId: string, targetId: string | null, group: string) => {
    if (!sourceId) return
    const fromIndex = allAssets.findIndex((entry) => entry.id === sourceId)
    if (fromIndex < 0) return
    const source = { ...allAssets[fromIndex], group, updatedAt: Date.now() }
    const remaining = allAssets.filter((entry) => entry.id !== sourceId)
    let insertAt = remaining.length
    if (targetId) {
      const targetIndex = remaining.findIndex((entry) => entry.id === targetId)
      if (targetIndex >= 0) insertAt = targetIndex
    }
    const next = [...remaining.slice(0, insertAt), source, ...remaining.slice(insertAt)]
    setAssets(next, "Reorder Custom Shape")
  }

  const reorderBundledInto = (sourceId: string, targetId: string | null, group: string) => {
    if (!sourceId) return
    const fromIndex = shapePresets.findIndex((entry) => entry.id === sourceId)
    if (fromIndex < 0) return
    const source = { ...shapePresets[fromIndex], group }
    const remaining = shapePresets.filter((entry) => entry.id !== sourceId)
    let insertAt = remaining.length
    if (targetId) {
      const targetIndex = remaining.findIndex((entry) => entry.id === targetId)
      if (targetIndex >= 0) insertAt = targetIndex
    }
    const next = [...remaining.slice(0, insertAt), source, ...remaining.slice(insertAt)]
    persistBundled(next, "Reordered bundled shapes")
  }

  const newCustomGroup = () => {
    if (typeof window === "undefined") return
    const name = window.prompt("New custom shape folder name")
    if (!name?.trim()) return
    const trimmed = name.trim().slice(0, 80)
    if (customGroups.includes(trimmed)) {
      toast.error("Folder already exists.")
      return
    }
    setCollapsed((current) => ({ ...current, [trimmed]: false }))
    if (!activeLayer?.shape) {
      toast.success(`Folder “${trimmed}” will appear when you save a shape into it.`)
      return
    }
    const asset = shapePresetToAsset(activeLayer.shape, {
      name: `${activeLayer.name} shape`,
      group: trimmed,
      tags: ["shape", "vector"],
    })
    setAssets([asset, ...allAssets], "Add Custom Shape Group")
  }

  const exportCustom = () => {
    if (!shapeAssets.length) {
      toast.error("No custom shapes to export.")
      return
    }
    downloadText(
      JSON.stringify(exportCustomShapeLibrary(shapeAssets, { name: `${activeDoc.name} Shapes` }), null, 2),
      `${activeDoc.name}-custom-shapes.psshapes.json`,
    )
  }

  const importCustom = async (file: File) => {
    try {
      const text = await file.text()
      const incoming = normalizeCustomShapeLibrary(JSON.parse(text))
      if (!incoming.length) {
        const altShapes = normalizeBundledShapesImport(text)
        if (!altShapes.length) {
          toast.error("No shapes found in that file.")
          return
        }
        persistBundled([...altShapes, ...shapePresets], `Imported ${altShapes.length} bundled shape${altShapes.length === 1 ? "" : "s"}`)
        return
      }
      const merged = mergeCustomShapeLibraries(shapeAssets, incoming, { conflictPolicy: "keep-both" })
      const nonShapeAssets = allAssets.filter((asset) => asset.kind !== "shape")
      setAssets([...merged.shapes, ...nonShapeAssets], "Import Custom Shapes")
      const conflictNote = merged.renamed || merged.skipped || merged.replaced
        ? ` (${merged.renamed} renamed, ${merged.replaced} replaced, ${merged.skipped} skipped)`
        : ""
      toast.success(`Imported ${merged.added} shape${merged.added === 1 ? "" : "s"}${conflictNote}.`)
    } catch (err) {
      toast.error(`Could not import: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
          <Shapes className="h-3 w-3" /> Shapes ({shapeAssets.length} custom · {shapePresets.length} bundled)
        </div>
        <div className="flex gap-1 text-[10px]">
          <button
            type="button"
            onClick={() => setTab("custom")}
            className={`flex-1 rounded-sm border px-2 py-1 ${tab === "custom" ? "border-[var(--ps-accent,#3b82f6)] bg-[var(--ps-panel-2)]" : "border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]"}`}
          >
            Custom
          </button>
          <button
            type="button"
            onClick={() => setTab("bundled")}
            className={`flex-1 rounded-sm border px-2 py-1 ${tab === "bundled" ? "border-[var(--ps-accent,#3b82f6)] bg-[var(--ps-panel-2)]" : "border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]"}`}
          >
            Bundled
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ps-text-dim)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "custom" ? "Search custom shapes" : "Search bundled shapes"}
            className="h-7 bg-[var(--ps-panel-2)] pl-7 text-[11px]"
          />
        </div>
        {tab === "custom" ? (
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="ghost" disabled={!activeLayer?.shape} onClick={saveActiveShape} className="h-7 justify-start gap-1 text-[11px]">
              <Save className="h-3 w-3" /> Save Active
            </Button>
            <Button size="sm" variant="ghost" onClick={newCustomGroup} className="h-7 justify-start gap-1 text-[11px]">
              <FolderPlus className="h-3 w-3" /> New Folder
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} className="h-7 justify-start gap-1 text-[11px]">
              <Upload className="h-3 w-3" /> Import
            </Button>
            <Button size="sm" variant="ghost" disabled={!shapeAssets.length} onClick={exportCustom} className="h-7 justify-start gap-1 text-[11px]">
              <Download className="h-3 w-3" /> Export
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} className="h-7 justify-start gap-1 text-[11px]">
              <Upload className="h-3 w-3" /> Import
            </Button>
            <Button size="sm" variant="ghost" onClick={restoreBundledDefaults} className="h-7 justify-start gap-1 text-[11px]">
              <CircleDot className="h-3 w-3" /> Restore Defaults
            </Button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,.psshapes,.pslibrary,.psshapes.json,application/json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (file) await importCustom(file)
            event.target.value = ""
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === "custom" ? (
          groupedCustom.length ? groupedCustom.map(([group, items]) => {
            const isCollapsed = collapsed[`custom:${group}`]
            return (
              <section
                key={group}
                className="mb-2"
                onDragOver={(event) => { if (dragId?.startsWith("custom:")) event.preventDefault() }}
                onDrop={(event) => {
                  if (!dragId?.startsWith("custom:")) return
                  event.preventDefault()
                  reorderCustomInto(dragId.slice("custom:".length), null, group)
                  setDragId(null)
                }}
              >
                <button
                  type="button"
                  onClick={() => setCollapsed((current) => ({ ...current, [`custom:${group}`]: !current[`custom:${group}`] }))}
                  className="mb-1 flex w-full items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
                >
                  {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {group} ({items.length})
                </button>
                {!isCollapsed ? (
                  <div className="grid grid-cols-3 gap-1">
                    {items.map((asset) => {
                      const shape = shapeAssetToPreset(asset, { x: 0, y: 0, w: 100, h: 100, fill: asset.payload && typeof asset.payload === "object" && "fill" in asset.payload ? (asset.payload as { fill?: string }).fill ?? foreground : foreground })
                      return (
                        <div
                          key={asset.id}
                          draggable
                          onDragStart={(event) => {
                            setDragId(`custom:${asset.id}`)
                            event.dataTransfer.effectAllowed = "move"
                            event.dataTransfer.setData("text/plain", asset.id)
                          }}
                          onDragEnd={() => setDragId(null)}
                          onDragOver={(event) => {
                            if (dragId?.startsWith("custom:") && dragId !== `custom:${asset.id}`) event.preventDefault()
                          }}
                          onDrop={(event) => {
                            if (!dragId?.startsWith("custom:")) return
                            event.preventDefault()
                            reorderCustomInto(dragId.slice("custom:".length), asset.id, asset.group ?? group)
                            setDragId(null)
                          }}
                          className="group rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1"
                        >
                          <button
                            type="button"
                            onClick={() => selectCustomAsset(asset)}
                            onDoubleClick={() => selectCustomAsset(asset)}
                            className="flex h-14 w-full items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)]"
                            title={asset.name}
                          >
                            {renderShapePreview(shape, 48)}
                          </button>
                          {renamingId === asset.id ? (
                            <Input
                              autoFocus
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onBlur={() => {
                                renameAsset(asset, renameDraft)
                                setRenamingId(null)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  renameAsset(asset, renameDraft)
                                  setRenamingId(null)
                                } else if (event.key === "Escape") {
                                  setRenamingId(null)
                                }
                              }}
                              className="mt-1 h-5 bg-[var(--ps-panel)] text-[10px]"
                              aria-label="Rename shape"
                            />
                          ) : (
                            <div className="mt-1 truncate text-[10px]" title={asset.name}>{asset.name}</div>
                          )}
                          <select
                            value={asset.group ?? "Custom Shapes"}
                            onChange={(event) => moveAssetToGroup(asset, event.target.value)}
                            aria-label="Custom shape folder"
                            className="mt-0.5 h-5 w-full min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[10px] outline-none"
                          >
                            {customGroups.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                            {!customGroups.includes(asset.group ?? "Custom Shapes") ? <option value={asset.group ?? "Custom Shapes"}>{asset.group ?? "Custom Shapes"}</option> : null}
                          </select>
                          <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px]"
                              aria-label={`Rename ${asset.name}`}
                              onClick={() => {
                                setRenamingId(asset.id)
                                setRenameDraft(asset.name)
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px] text-red-300"
                              aria-label={`Delete ${asset.name}`}
                              onClick={() => removeAsset(asset)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            )
          }) : (
            <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
              {shapeAssets.length === 0
                ? "No custom shapes yet. Draw a shape, then click Save Active."
                : "No custom shapes match the current search."}
            </div>
          )
        ) : (
          groupedBundled.length ? groupedBundled.map(([group, items]) => {
            const isCollapsed = collapsed[`bundled:${group}`]
            return (
              <section
                key={group}
                className="mb-2"
                onDragOver={(event) => { if (dragId?.startsWith("bundled:")) event.preventDefault() }}
                onDrop={(event) => {
                  if (!dragId?.startsWith("bundled:")) return
                  event.preventDefault()
                  reorderBundledInto(dragId.slice("bundled:".length), null, group)
                  setDragId(null)
                }}
              >
                <button
                  type="button"
                  onClick={() => setCollapsed((current) => ({ ...current, [`bundled:${group}`]: !current[`bundled:${group}`] }))}
                  className="mb-1 flex w-full items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
                >
                  {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {group} ({items.length})
                </button>
                {!isCollapsed ? (
                  <div className="grid grid-cols-3 gap-1">
                    {items.map((preset) => (
                      <div
                        key={preset.id}
                        draggable
                        onDragStart={(event) => {
                          setDragId(`bundled:${preset.id}`)
                          event.dataTransfer.effectAllowed = "move"
                          event.dataTransfer.setData("text/plain", preset.id)
                        }}
                        onDragEnd={() => setDragId(null)}
                        onDragOver={(event) => {
                          if (dragId?.startsWith("bundled:") && dragId !== `bundled:${preset.id}`) event.preventDefault()
                        }}
                        onDrop={(event) => {
                          if (!dragId?.startsWith("bundled:")) return
                          event.preventDefault()
                          reorderBundledInto(dragId.slice("bundled:".length), preset.id, preset.group ?? group)
                          setDragId(null)
                        }}
                        className="group rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1"
                      >
                        <button
                          type="button"
                          onClick={() => selectBundledShape(preset)}
                          onDoubleClick={() => selectBundledShape(preset)}
                          className="flex h-14 w-full items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)]"
                          title={preset.name}
                        >
                          {renderBundledShapePreview(preset.customId, foreground, 48)}
                        </button>
                        {renamingId === preset.id ? (
                          <Input
                            autoFocus
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onBlur={() => {
                              renamePreset(preset, renameDraft)
                              setRenamingId(null)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                renamePreset(preset, renameDraft)
                                setRenamingId(null)
                              } else if (event.key === "Escape") {
                                setRenamingId(null)
                              }
                            }}
                            className="mt-1 h-5 bg-[var(--ps-panel)] text-[10px]"
                            aria-label="Rename shape preset"
                          />
                        ) : (
                          <div className="mt-1 truncate text-[10px]" title={preset.name}>{preset.name}</div>
                        )}
                        <select
                          value={preset.group}
                          onChange={(event) => movePresetToGroup(preset, event.target.value)}
                          aria-label="Bundled shape folder"
                          className="mt-0.5 h-5 w-full min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[10px] outline-none"
                        >
                          {bundledGroups.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                          {!bundledGroups.includes(preset.group) ? <option value={preset.group}>{preset.group}</option> : null}
                        </select>
                        <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1 text-[10px]"
                            aria-label={`Rename ${preset.name}`}
                            onClick={() => {
                              setRenamingId(preset.id)
                              setRenameDraft(preset.name)
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1 text-[10px] text-red-300"
                            aria-label={`Delete ${preset.name}`}
                            onClick={() => removePreset(preset)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            )
          }) : (
            <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
              No bundled shapes found.
            </div>
          )
        )}
      </div>
      <div className="border-t border-[var(--ps-divider)] p-2 text-[10px] text-[var(--ps-text-dim)]">
        Foreground: <span className="font-mono">{foreground}</span> · Tool: <span className="font-mono">custom-shape</span>
      </div>
    </div>
  )
}

function normalizeBundledShapesImport(text: string): ShapePresetEntry[] {
  try {
    const parsed = JSON.parse(text)
    const source = parsed && typeof parsed === "object" && Array.isArray((parsed as { presets?: unknown[] }).presets)
      ? (parsed as { presets: unknown[] }).presets
      : Array.isArray(parsed) ? parsed : []
    const out: ShapePresetEntry[] = []
    for (const raw of source.slice(0, 256)) {
      if (!raw || typeof raw !== "object") continue
      const record = raw as Partial<ShapePresetEntry>
      if (typeof record.customId !== "string") continue
      out.push({
        id: typeof record.id === "string" && record.id ? record.id : uid("shape"),
        name: typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 80) : "Shape",
        group: typeof record.group === "string" && record.group.trim() ? record.group.trim().slice(0, 80) : "Shapes",
        customId: record.customId as CustomShapeId,
        createdAt: Number.isFinite(record.createdAt as number) ? Number(record.createdAt) : Date.now(),
      })
    }
    return out
  } catch {
    return []
  }
}
