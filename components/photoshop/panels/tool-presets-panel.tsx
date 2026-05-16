"use client"

import * as React from "react"
import { Check, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditor } from "../editor-context"
import type { AssetLibraryItem, ToolId } from "../types"

type ToolPresetPayload = {
  tool: ToolId
  brush: ReturnType<typeof useEditor>["brush"]
  eraser: ReturnType<typeof useEditor>["eraser"]
  cloneSource: ReturnType<typeof useEditor>["cloneSource"]
  selectionOptions: ReturnType<typeof useEditor>["selectionOptions"]
  foreground: string
  background: string
}

function uid(prefix = "preset") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export function ToolPresetsPanel() {
  const {
    activeDoc,
    tool,
    brush,
    eraser,
    cloneSource,
    selectionOptions,
    foreground,
    background,
    dispatch,
    commit,
  } = useEditor()
  const [name, setName] = React.useState("")
  const [filter, setFilter] = React.useState("")

  if (!activeDoc) return null

  const presets = (activeDoc.assetLibrary ?? []).filter((asset) => asset.kind === "tool-preset")
  const visible = presets.filter((preset) => {
    const payload = preset.payload as Partial<ToolPresetPayload>
    const q = filter.trim().toLowerCase()
    return !q || `${preset.name} ${payload.tool ?? ""}`.toLowerCase().includes(q)
  })

  const savePreset = () => {
    const trimmed = name.trim() || `${tool} preset`
    const asset: AssetLibraryItem = {
      id: uid(),
      name: trimmed,
      kind: "tool-preset",
      group: "Tools",
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

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") savePreset()
            }}
            placeholder={`${tool} preset name`}
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
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visible.length ? (
          <div className="space-y-1">
            {visible.map((preset) => {
              const payload = preset.payload as Partial<ToolPresetPayload>
              return (
                <div key={preset.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px]">{preset.name}</div>
                    <div className="text-[10px] text-[var(--ps-text-dim)]">{payload.tool ?? "Tool"} - {new Date(preset.createdAt).toLocaleDateString()}</div>
                  </div>
                  <Button variant="ghost" size="icon-sm" title="Apply preset" onClick={() => applyPreset(preset)}>
                    <Check className="h-3.5 w-3.5" />
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
