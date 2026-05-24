"use client"

import * as React from "react"
import { Copy, Play, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditor } from "../editor-context"
import type { LayerComp } from "../types"
import { captureLayerCompState, createLayerCompFromDocument, summarizeLayerComp } from "../layer-workflows"
import { uid } from "../uid"

function nextName(comps: LayerComp[]) {
  let index = comps.length + 1
  const names = new Set(comps.map((comp) => comp.name.toLowerCase()))
  while (names.has(`layer comp ${index}`)) index++
  return `Layer Comp ${index}`
}

export function LayerCompsPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [filter, setFilter] = React.useState("")

  if (!activeDoc) return null

  const comps = activeDoc.comps ?? []
  const visible = comps.filter((comp) => comp.name.toLowerCase().includes(filter.trim().toLowerCase()))

  const saveComp = (comp: LayerComp, label: string) => {
    dispatch({ type: "save-comp", comp: { ...comp, updatedAt: Date.now() } })
    window.setTimeout(() => commit(label, []), 0)
  }

  const createComp = () => {
    saveComp(createLayerCompFromDocument(activeDoc, nextName(comps)), "New Layer Comp")
  }

  const updateComp = (comp: LayerComp) => {
    saveComp(
      {
        ...comp,
        state: captureLayerCompState(activeDoc),
        activeLayerId: activeDoc.activeLayerId,
        selectedLayerIds: activeDoc.selectedLayerIds,
      },
      "Update Layer Comp",
    )
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <Button size="sm" className="w-full" onClick={createComp}>
          <Plus className="h-3.5 w-3.5" />
          Capture Current Layer Comp
        </Button>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search layer comps"
          className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
        />
        <div className="grid grid-cols-3 gap-1 text-[10px] text-[var(--ps-text-dim)]">
          <Stat label="Comps" value={comps.length} />
          <Stat label="Layers" value={activeDoc.layers.length} />
          <Stat label="Visible" value={activeDoc.layers.filter((layer) => layer.visible).length} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visible.length ? (
          <div className="space-y-1">
            {visible.map((comp) => (
              <div key={comp.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                {(() => {
                  const stats = summarizeLayerComp(comp, activeDoc)
                  return (
                    <div className="mb-2 grid grid-cols-4 gap-1 text-[10px] text-[var(--ps-text-dim)]">
                      <Stat label="Layers" value={stats.layers} />
                      <Stat label="Blend" value={stats.blended} />
                      <Stat label="Filters" value={stats.smartFiltered} />
                      <Stat label="Notes" value={stats.annotated} />
                    </div>
                  )
                })()}
                <Input
                  value={comp.name}
                  onChange={(event) => dispatch({ type: "save-comp", comp: { ...comp, name: event.target.value, updatedAt: Date.now() } })}
                  onBlur={(event) => saveComp({ ...comp, name: event.target.value.trim() || "Layer Comp" }, "Rename Layer Comp")}
                  className="mb-2 h-8 bg-[var(--ps-panel)] text-[11px]"
                />
                <div className="grid grid-cols-4 gap-1">
                  <Icon label="Apply" onClick={() => {
                    dispatch({ type: "apply-comp", id: comp.id })
                    window.setTimeout(() => commit("Apply Layer Comp", []), 0)
                  }}>
                    <Play className="h-3.5 w-3.5" />
                  </Icon>
                  <Icon label="Update" onClick={() => updateComp(comp)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Icon>
                  <Icon label="Duplicate" onClick={() => saveComp({ ...comp, id: uid("comp"), name: `${comp.name} Copy`, createdAt: Date.now(), updatedAt: Date.now() }, "Duplicate Layer Comp")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Icon>
                  <Icon label="Delete" onClick={() => {
                    dispatch({ type: "remove-comp", id: comp.id })
                    window.setTimeout(() => commit("Delete Layer Comp", []), 0)
                  }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Icon>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            No layer comps saved.
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1">
      <div>{label}</div>
      <div className="text-[var(--ps-text)]">{value}</div>
    </div>
  )
}

function Icon({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" title={label} onClick={onClick} className="h-7 px-2">
      {children}
    </Button>
  )
}
