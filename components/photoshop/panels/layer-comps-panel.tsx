"use client"

import * as React from "react"
import { AlertTriangle, Copy, Download, FileText, Play, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorSelector } from "../editor-context"
import type { Layer, LayerComp, PsDocument } from "../types"
import { captureLayerCompState, createLayerCompFromDocument, summarizeLayerComp } from "../layer-workflows"
import { uid } from "../uid"
import { downloadBlob, renderDocumentComposite, rasterMime } from "../document-io"
import { buildPresentationPdf } from "../pdf-presentation"

type RasterFormat = "png" | "jpeg" | "webp"

function nextName(comps: LayerComp[]) {
  let index = comps.length + 1
  const names = new Set(comps.map((comp) => comp.name.toLowerCase()))
  while (names.has(`layer comp ${index}`)) index++
  return `Layer Comp ${index}`
}

function safeExportSegment(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "layer-comp"
}

export function layerCompExportFilename(docName: string, compName: string, format: RasterFormat) {
  const extension = format === "jpeg" ? "jpg" : format
  return `${safeExportSegment(docName)}-${safeExportSegment(compName)}.${extension}`
}

function comparableLayerState(layer: Pick<Layer, "visible" | "opacity" | "fillOpacity" | "blendMode" | "clipped" | "maskEnabled" | "colorLabel">) {
  return {
    visible: layer.visible,
    opacity: layer.opacity,
    fillOpacity: layer.fillOpacity,
    blendMode: layer.blendMode,
    clipped: layer.clipped,
    maskEnabled: layer.maskEnabled,
    colorLabel: layer.colorLabel,
  }
}

export function layerCompNeedsUpdate(comp: LayerComp, doc: Pick<PsDocument, "layers">): boolean {
  for (const layer of doc.layers) {
    const saved = comp.state[layer.id]
    if (!saved) return true
    const current = comparableLayerState(layer)
    for (const [key, value] of Object.entries(current)) {
      if (saved[key as keyof typeof saved] !== value) return true
    }
  }
  return Object.keys(comp.state).some((id) => !doc.layers.some((layer) => layer.id === id))
}

function layerWithCompState(layer: Layer, comp: LayerComp): Layer {
  const saved = comp.state[layer.id]
  if (!saved) return layer
  return {
    ...layer,
    visible: saved.visible,
    opacity: saved.opacity,
    fillOpacity: saved.fillOpacity,
    advancedBlending: saved.advancedBlending,
    blendMode: saved.blendMode,
    clipped: saved.clipped,
    maskEnabled: saved.maskEnabled,
    vectorMask: saved.vectorMask,
    style: saved.style,
    text: saved.text,
    shape: saved.shape,
    path: saved.path,
    adjustment: saved.adjustment,
    smartFilters: saved.smartFilters,
    colorLabel: saved.colorLabel,
    notes: saved.notes,
    metadata: saved.metadata,
  }
}

function documentForComp(doc: PsDocument, comp: LayerComp): PsDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) => layerWithCompState(layer, comp)),
    activeLayerId: comp.activeLayerId ?? doc.activeLayerId,
    selectedLayerIds: comp.selectedLayerIds ?? doc.selectedLayerIds,
  }
}

function renderCompCanvas(doc: PsDocument, comp: LayerComp) {
  return renderDocumentComposite(documentForComp(doc, comp), { matte: doc.background ?? "#ffffff" })
}

function compThumbnail(doc: PsDocument, comp: LayerComp) {
  if (typeof document === "undefined") return ""
  const source = renderCompCanvas(doc, comp)
  const thumb = document.createElement("canvas")
  thumb.width = 96
  thumb.height = 64
  const ctx = thumb.getContext("2d")
  if (!ctx) return ""
  ctx.fillStyle = "#111827"
  ctx.fillRect(0, 0, thumb.width, thumb.height)
  const scale = Math.min(thumb.width / Math.max(1, source.width), thumb.height / Math.max(1, source.height))
  const w = Math.max(1, source.width * scale)
  const h = Math.max(1, source.height * scale)
  ctx.drawImage(source, (thumb.width - w) / 2, (thumb.height - h) / 2, w, h)
  return thumb.toDataURL("image/png")
}

export function LayerCompsPanel() {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
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
    if (layerCompNeedsUpdate(comp, activeDoc) && typeof window !== "undefined") {
      const ok = window.confirm("Update this layer comp with the current layer visibility, styles, and selection?")
      if (!ok) return
    }
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

  const exportComp = async (comp: LayerComp, format: RasterFormat = "png") => {
    try {
      const canvas = renderCompCanvas(activeDoc, comp)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, rasterMime(format), format === "png" ? undefined : 0.92))
      if (!blob) throw new Error("Could not render layer comp.")
      downloadBlob(blob, layerCompExportFilename(activeDoc.name, comp.name, format))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export layer comp")
    }
  }

  const exportCompsPdf = async () => {
    try {
      const sources = visible.length ? visible : comps
      if (!sources.length) return
      const result = await buildPresentationPdf(
        sources.map((comp) => ({ canvas: renderCompCanvas(activeDoc, comp), caption: comp.name, name: comp.name })),
        {
          title: `${activeDoc.name} Layer Comps`,
          author: "Photoshop Web",
          pageSize: "fit-source",
          fit: "fit",
          background: "#ffffff",
          marginPt: 18,
          showCaptions: true,
          captionFontSize: 10,
        },
      )
      downloadBlob(result.blob, `${safeExportSegment(activeDoc.name)}-layer-comps.pdf`)
      toast.success(`Exported ${result.pageCount} layer comp${result.pageCount === 1 ? "" : "s"} to PDF.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export layer comps PDF")
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <Button size="sm" className="w-full" onClick={createComp}>
          <Plus className="h-3.5 w-3.5" />
          Capture Current Layer Comp
        </Button>
        <Button size="sm" variant="outline" className="w-full" disabled={!comps.length} onClick={() => void exportCompsPdf()}>
          <FileText className="h-3.5 w-3.5" />
          Export Visible Comps to PDF
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
                <div className="mb-2 grid grid-cols-[96px_1fr] gap-2">
                  <img
                    src={compThumbnail(activeDoc, comp)}
                    alt={`${comp.name} thumbnail`}
                    className="h-16 w-24 rounded-sm border border-[var(--ps-divider)] bg-black object-contain"
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="truncate text-[12px]">{comp.name}</div>
                    {layerCompNeedsUpdate(comp, activeDoc) ? (
                      <div className="flex items-start gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[10px] text-amber-200">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        Current layers differ from this snapshot.
                      </div>
                    ) : (
                      <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-1 text-[10px] text-emerald-200">
                        Snapshot matches current state.
                      </div>
                    )}
                  </div>
                </div>
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
                <div className="grid grid-cols-5 gap-1">
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
                  <Icon label="Export PNG" onClick={() => void exportComp(comp, "png")}>
                    <Download className="h-3.5 w-3.5" />
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
