"use client"

import * as React from "react"
import { Check, Copy, Download, Plus, Search, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorSelector } from "../editor-context"
import type {
  AssetLibraryItem,
  BrushSettings,
  CloneSourceSettings,
  EraserSettings,
  SelectionOptions,
  ToolId,
} from "../types"
import { uid } from "../uid"
import { downloadText } from "../document-io"
import { mergeToolPresetAssets, normalizeToolPresetAssets, serializeToolPresetAssets } from "../tool-preset-library"
import { toast } from "sonner"

type ToolPresetPayload = {
  tool: ToolId
  brush: BrushSettings
  eraser: EraserSettings
  cloneSource: CloneSourceSettings
  selectionOptions: SelectionOptions
  foreground: string
  background: string
}

export interface ToolPresetFilterOptions {
  query: string
  group: string
  currentToolOnly: boolean
  tool: ToolId
  sort: "recent" | "name" | "tool" | "manual"
}

function presetTool(asset: AssetLibraryItem) {
  return (asset.payload as Partial<ToolPresetPayload>).tool
}

export function filterToolPresetAssets(assets: readonly AssetLibraryItem[], options: ToolPresetFilterOptions): AssetLibraryItem[] {
  const q = options.query.trim().toLowerCase()
  return assets
    .filter((asset) => asset.kind === "tool-preset")
    .filter((preset) => {
      const payload = preset.payload as Partial<ToolPresetPayload>
      if (options.group !== "All" && (preset.group ?? "Tools") !== options.group) return false
      if (options.currentToolOnly && payload.tool !== options.tool) return false
      return !q || `${preset.name} ${preset.group ?? ""} ${payload.tool ?? ""}`.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (options.sort === "name") return a.name.localeCompare(b.name)
      if (options.sort === "tool") return String(presetTool(a) ?? "").localeCompare(String(presetTool(b) ?? ""))
      if (options.sort === "manual") return 0
      return b.createdAt - a.createdAt
    })
}

export function reorderToolPresetAssets(assets: readonly AssetLibraryItem[], sourceId: string, targetId: string): AssetLibraryItem[] {
  if (sourceId === targetId) return [...assets]
  const next = [...assets]
  const from = next.findIndex((asset) => asset.id === sourceId)
  const to = next.findIndex((asset) => asset.id === targetId)
  if (from < 0 || to < 0) return next
  const [item] = next.splice(from, 1)
  next.splice(from < to ? to - 1 : to, 0, item)
  return next
}

export function ToolPresetsPanel() {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const tool = useEditorSelector((editor) => editor.tool)
  const brush = useEditorSelector((editor) => editor.brush)
  const eraser = useEditorSelector((editor) => editor.eraser)
  const cloneSource = useEditorSelector((editor) => editor.cloneSource)
  const selectionOptions = useEditorSelector((editor) => editor.selectionOptions)
  const foreground = useEditorSelector((editor) => editor.foreground)
  const background = useEditorSelector((editor) => editor.background)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const [name, setName] = React.useState("")
  const [group, setGroup] = React.useState("Tools")
  const [filter, setFilter] = React.useState("")
  const [groupFilter, setGroupFilter] = React.useState("All")
  const [sort, setSort] = React.useState<ToolPresetFilterOptions["sort"]>("recent")
  const [currentToolOnly, setCurrentToolOnly] = React.useState(false)
  const [dragPresetId, setDragPresetId] = React.useState<string | null>(null)
  const importRef = React.useRef<HTMLInputElement>(null)

  if (!activeDoc) return null

  const presets = (activeDoc.assetLibrary ?? []).filter((asset) => asset.kind === "tool-preset")
  const groups = ["All", ...Array.from(new Set(presets.map((preset) => preset.group ?? "Tools"))).sort()]
  const visible = filterToolPresetAssets(activeDoc.assetLibrary ?? [], {
    query: filter,
    group: groupFilter,
    currentToolOnly,
    tool,
    sort,
  })

  const savePreset = () => {
    const trimmed = name.trim() || `${tool} preset`
    const asset: AssetLibraryItem = {
      id: uid("preset"),
      name: trimmed,
      kind: "tool-preset",
      group: group.trim() || "Tools",
      createdAt: Date.now(),
      payload: {
        tool,
        brush,
        eraser,
        cloneSource,
        selectionOptions,
        foreground,
        background,
      } satisfies ToolPresetPayload,
    }
    dispatch({ type: "set-asset-library", assets: [asset, ...(activeDoc.assetLibrary ?? [])] })
    window.setTimeout(() => commit("Save Tool Preset", []), 0)
    setName("")
  }

  const applyPreset = (preset: AssetLibraryItem) => {
    const payload = preset.payload as Partial<ToolPresetPayload>
    if (payload.tool) dispatch({ type: "set-tool", tool: payload.tool })
    if (payload.brush) dispatch({ type: "set-brush", brush: payload.brush })
    if (payload.eraser) dispatch({ type: "set-eraser", eraser: payload.eraser })
    if (payload.cloneSource) dispatch({ type: "set-clone-source", cloneSource: payload.cloneSource })
    if (payload.selectionOptions) dispatch({ type: "set-selection-options", selectionOptions: payload.selectionOptions })
    if (payload.foreground) dispatch({ type: "set-foreground", color: payload.foreground })
    if (payload.background) dispatch({ type: "set-background", color: payload.background })
  }

  const removePreset = (id: string) => {
    dispatch({ type: "set-asset-library", assets: (activeDoc.assetLibrary ?? []).filter((asset) => asset.id !== id) })
    window.setTimeout(() => commit("Delete Tool Preset", []), 0)
  }

  const duplicatePreset = (preset: AssetLibraryItem) => {
    const copy: AssetLibraryItem = {
      ...preset,
      id: uid("preset"),
      name: `${preset.name} copy`,
      createdAt: Date.now(),
    }
    dispatch({ type: "set-asset-library", assets: [copy, ...(activeDoc.assetLibrary ?? [])] })
    window.setTimeout(() => commit("Duplicate Tool Preset", []), 0)
  }

  const reorderPreset = (sourceId: string, targetId: string) => {
    dispatch({ type: "set-asset-library", assets: reorderToolPresetAssets(activeDoc.assetLibrary ?? [], sourceId, targetId) })
    window.setTimeout(() => commit("Reorder Tool Presets", []), 0)
  }

  const exportPresets = () => {
    downloadText(serializeToolPresetAssets(presets), "photoshop-tool-presets.pstoolpresets.json")
  }

  const importPresets = async (file: File) => {
    try {
      if (file.size > 512 * 1024) throw new Error("Tool preset files are limited to 512 KB.")
      const imported = normalizeToolPresetAssets(JSON.parse(await file.text()))
      if (!imported.length) throw new Error("Tool preset file does not contain valid presets.")
      const otherAssets = (activeDoc.assetLibrary ?? []).filter((asset) => asset.kind !== "tool-preset")
      dispatch({ type: "set-asset-library", assets: [...otherAssets, ...mergeToolPresetAssets(presets, imported)] })
      toast.success(`Imported ${imported.length} tool preset${imported.length === 1 ? "" : "s"}`)
      window.setTimeout(() => commit("Import Tool Presets", []), 0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import tool presets")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <input
        ref={importRef}
        type="file"
        accept=".json,.pstoolpresets,.pstoolpresets.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void importPresets(file)
        }}
      />
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="grid grid-cols-[1fr_88px_auto] gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") savePreset()
            }}
            placeholder={`${tool} preset name`}
            className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
          />
          <Input
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            placeholder="Group"
            className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
          />
          <Button size="sm" onClick={savePreset}>
            <Plus className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search tool presets"
          className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
        />
        <div className="grid grid-cols-2 gap-1">
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]">
            {groups.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]">
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="tool">Tool</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <label className="flex h-6 items-center gap-1.5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px]">
          <input
            type="checkbox"
            checked={currentToolOnly}
            onChange={(event) => setCurrentToolOnly(event.target.checked)}
          />
          Current tool only ({tool})
        </label>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
          <Button size="sm" variant="outline" onClick={exportPresets} disabled={!presets.length}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <div className="ml-auto flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)]">
            <Search className="h-3 w-3" />
            {visible.length}/{presets.length}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visible.length ? (
          <div className="space-y-1">
            {visible.map((preset) => {
              const payload = preset.payload as Partial<ToolPresetPayload>
              return (
                <div
                  key={preset.id}
                  draggable
                  onDragStart={(event) => {
                    setDragPresetId(preset.id)
                    event.dataTransfer.setData("text/plain", preset.id)
                  }}
                  onDragOver={(event) => {
                    if (dragPresetId && dragPresetId !== preset.id) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const sourceId = dragPresetId ?? event.dataTransfer.getData("text/plain")
                    if (sourceId && sourceId !== preset.id) reorderPreset(sourceId, preset.id)
                    setDragPresetId(null)
                    setSort("manual")
                  }}
                  onDragEnd={() => setDragPresetId(null)}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px]">{preset.name}</div>
                    <div className="text-[10px] text-[var(--ps-text-dim)]">{payload.tool ?? "Tool"} - {preset.group ?? "Tools"} - {new Date(preset.createdAt).toLocaleDateString()}</div>
                  </div>
                  <Button variant="ghost" size="icon-sm" title="Apply preset" onClick={() => applyPreset(preset)}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="Duplicate preset" onClick={() => duplicatePreset(preset)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="Delete preset" onClick={() => removePreset(preset.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            No tool presets saved.
          </div>
        )}
      </div>
    </div>
  )
}
