"use client"

import * as React from "react"
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
import { Copy, Play, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { useEditorSelector } from "./editor-context"
import type { LayerComp } from "./types"
import { captureLayerCompState, createLayerCompFromDocument, summarizeLayerComp } from "./layer-workflows"
import { uid } from "./uid"

function uniqueCompName(comps: LayerComp[]) {
  let index = comps.length + 1
  const names = new Set(comps.map((comp) => comp.name.toLowerCase()))
  while (names.has(`layer comp ${index}`.toLowerCase())) index++
  return `Layer Comp ${index}`
}

export function LayerCompsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)

  if (!activeDoc) return null

  const comps = activeDoc.comps ?? []

  const saveComp = (comp: LayerComp, label = "Save Layer Comp") => {
    dispatch({ type: "save-comp", comp: { ...comp, updatedAt: Date.now() } })
    window.setTimeout(() => commit(label, []), 0)
  }

  const newComp = () => {
    saveComp(createLayerCompFromDocument(activeDoc, uniqueCompName(comps)), "New Layer Comp")
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

  const duplicateComp = (comp: LayerComp) => {
    saveComp(
      {
        ...comp,
        id: uid("comp"),
        name: `${comp.name} Copy`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      "Duplicate Layer Comp",
    )
  }

  const renameComp = (comp: LayerComp, name: string) => {
    saveComp({ ...comp, name: name.trim() || "Layer Comp" }, "Rename Layer Comp")
  }

  const applyComp = (id: string) => {
    dispatch({ type: "apply-comp", id })
    window.setTimeout(() => commit("Apply Layer Comp", []), 0)
  }

  const deleteComp = (id: string) => {
    dispatch({ type: "remove-comp", id })
    window.setTimeout(() => commit("Delete Layer Comp", []), 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Layer Comps</DialogTitle>
          <DialogDescription className="sr-only">
            Capture, update, duplicate, apply, and delete layer visibility and appearance states.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            <Stat label="Comps" value={comps.length} />
            <Stat label="Layers" value={activeDoc.layers.length} />
            <Stat label="Selected" value={activeDoc.selectedLayerIds.length} />
            <Stat label="Visible" value={activeDoc.layers.filter((layer) => layer.visible).length} />
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={newComp}>
              <Plus className="h-3.5 w-3.5" />
              New From Current
            </Button>
            <span className="text-[11px] text-[var(--ps-text-dim)]">
              Captures visibility, opacity, fill, blend mode, clipping, masks, styles, editable layer props, notes, metadata, active layer, and selected layers.
            </span>
          </div>

          <div className="max-h-[48vh] overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
            {comps.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">
                No layer comps yet. Capture the current document state to create one.
              </div>
            ) : (
              comps.map((comp) => {
                const stats = summarizeLayerComp(comp, activeDoc)
                return (
                  <div key={comp.id} className="border-b border-[var(--ps-divider)] p-2 last:border-b-0">
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Input
                        value={comp.name}
                        onChange={(event) => dispatch({ type: "save-comp", comp: { ...comp, name: event.target.value, updatedAt: Date.now() } })}
                        onBlur={(event) => renameComp(comp, event.target.value)}
                        className="h-8 text-[12px]"
                      />
                      <div className="flex items-center gap-1">
                        <IconButton label="Apply comp" onClick={() => applyComp(comp.id)}>
                          <Play className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton label="Update from current" onClick={() => updateComp(comp)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton label="Duplicate comp" onClick={() => duplicateComp(comp)}>
                          <Copy className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton label="Delete comp" onClick={() => deleteComp(comp.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-1 text-[10px] text-[var(--ps-text-dim)]">
                      <MiniStat label="Layers" value={stats.layers} />
                      <MiniStat label="Visible" value={stats.visible} />
                      <MiniStat label="Hidden" value={stats.hidden} />
                      <MiniStat label="Faded" value={stats.faded} />
                      <MiniStat label="Filters" value={stats.smartFiltered} />
                      <MiniStat label="Notes" value={stats.annotated} />
                      <MiniStat label="Missing" value={stats.missing} />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={newComp}>
            <Save className="h-3.5 w-3.5" />
            Capture Current
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{label}</div>
      <div className="text-lg tabular-nums">{value}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1">
      <span>{label}: </span>
      <span className="tabular-nums text-[var(--ps-text)]">{value}</span>
    </div>
  )
}

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" title={label} aria-label={label} onClick={onClick} className="h-8 w-8">
      {children}
    </Button>
  )
}
