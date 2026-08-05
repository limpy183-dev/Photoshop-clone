"use client"

/**
 * Variables tab — data-driven design: variable bindings, data sets and variant generation.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import {
  downloadCanvasWithPreset,
  imageFromDataUrl,
} from "@/components/photoshop/advanced/subsystems-dialog-helpers"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  EmptyState,
  FileButton,
  NumberField,
  Panel,
  SelectField,
} from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { isImportRecord } from "@/editor/advanced/subsystems-import-normalizers"
import { useEditor, makeCanvas } from "@/components/photoshop/editor/context"
import { downloadText, loadRasterCanvasFromFile, renderDocumentComposite } from "@/editor/document/io"
import { uid } from "@/editor/uid"
import {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  createVariableDocumentVariantAsync,
} from "@/editor/advanced/subsystems"
import { renderTemplateName, type AutomationOutputPreset } from "@/editor/automation-engine"
import {
  buildDataset,
  buildVariableDataSetExportPayload,
  createBinding,
  inferVariableBindings,
  parseDataset,
  parseVariableDataSetImportPayload,
  serializeDatasetRowsCsv,
  upsertBinding,
} from "@/editor/variables-engine"
import type { VariableBinding, VariableDataSet } from "@/editor/types"
export function VariablesWorkspace() {
  const { activeDoc, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState("")
  const [rowIndex, setRowIndex] = React.useState(0)
  const [imageFiles, setImageFiles] = React.useState<File[]>([])
  const [bindingLayerId, setBindingLayerId] = React.useState("")
  const [bindingProperty, setBindingProperty] = React.useState<VariableBinding["property"]>("text")
  const [bindingColumn, setBindingColumn] = React.useState("")
  const [outputFormat, setOutputFormat] = React.useState<AutomationOutputPreset["format"]>("png")
  const [quality, setQuality] = React.useState(0.92)
  const [filenameTemplate, setFilenameTemplate] = React.useState("{{name}}-{{dataset}}-{{index}}")
  const [previewThumbnails, setPreviewThumbnails] = React.useState<{ index: number; dataUrl: string; label: string }[]>([])
  const [generatingPreviews, setGeneratingPreviews] = React.useState(false)
  if (!activeDoc) return <EmptyState text="Open a document before using variable data sets." />
  const dataSets = activeDoc.variableDataSets ?? []
  const selected = dataSets.find((set) => set.id === selectedId) ?? dataSets[0]
  const setDataSets = (next: VariableDataSet[]) => dispatch({ type: "set-variable-data-sets", dataSets: next })
  const columns = selected ? Array.from(new Set(selected.rows.flatMap((row) => Object.keys(row)))) : []
  const activeRow = selected?.rows[rowIndex] ?? null
  const importData = async (file: File) => {
    assertAdvancedFileSize(file, file.name.toLowerCase().endsWith(".json") ? ADVANCED_FILE_LIMITS.jsonBytes : ADVANCED_FILE_LIMITS.csvBytes, "Data set file")
    const text = await file.text()
    let imported: VariableDataSet[] = []
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const parsed: unknown = JSON.parse(text)
        if (isImportRecord(parsed) && parsed.format === "ps-variable-data-sets") {
          imported = parseVariableDataSetImportPayload(parsed, { doc: activeDoc, makeId: (prefix) => uid(prefix) })
        }
      } catch {
        imported = []
      }
    }
    if (!imported.length) {
      const parsed = parseDataset(text, file.name)
      const dataSet = buildDataset(file.name, parsed)
      imported = [{ ...dataSet, bindings: inferVariableBindings(activeDoc, parsed.columns) }]
    }
    setDataSets([...imported, ...dataSets])
    setSelectedId(imported[0]?.id ?? "")
    setRowIndex(0)
    setBindingLayerId(activeDoc.layers[0]?.id ?? "")
    setBindingColumn(Object.keys(imported[0]?.rows[0] ?? {})[0] ?? "")
  }
  const canvasForImageValue = async (value: string) => {
    const trimmed = value.trim()
    let img: HTMLImageElement | null = null
    let fileCanvas: HTMLCanvasElement | null = null
    if (/^data:image\//i.test(trimmed)) {
      img = await imageFromDataUrl(trimmed)
    } else {
      const base = trimmed.split(/[\\/]/).pop()?.toLowerCase()
      const file = imageFiles.find((item) => item.name.toLowerCase() === trimmed.toLowerCase() || item.name.toLowerCase() === base)
      if (file) fileCanvas = (await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })).canvas
    }
    if (fileCanvas) return fileCanvas
    if (!img) return null
    const canvas = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height)
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  const addBinding = () => {
    if (!selected || !bindingLayerId || !bindingColumn) return
    const next = upsertBinding(selected, createBinding(bindingLayerId, bindingProperty, bindingColumn))
    setDataSets(dataSets.map((set) => set.id === selected.id ? next : set))
  }
  const updateBinding = (id: string, patch: Partial<VariableBinding>) => {
    if (!selected) return
    const next: VariableDataSet = {
      ...selected,
      bindings: selected.bindings.map((binding) => binding.id === id ? { ...binding, ...patch } : binding),
    }
    setDataSets(dataSets.map((set) => set.id === selected.id ? next : set))
  }
  const removeBinding = (id: string) => {
    if (!selected) return
    setDataSets(dataSets.map((set) => set.id === selected.id ? { ...set, bindings: set.bindings.filter((binding) => binding.id !== id) } : set))
  }
  const setActiveRow = (index: number) => {
    if (!selected) return
    const nextIndex = Math.max(0, Math.min(selected.rows.length - 1, Math.round(index)))
    setRowIndex(nextIndex)
    setDataSets(dataSets.map((set) => set.id === selected.id ? { ...set, activeRow: nextIndex } : set))
  }
  const exportSelectedSet = () => {
    if (!selected) return
    downloadText(JSON.stringify(buildVariableDataSetExportPayload([selected]), null, 2), `${selected.name}.psvars.json`, "application/json")
  }
  const exportSelectedRows = () => {
    if (!selected) return
    downloadText(serializeDatasetRowsCsv(selected.rows, columns), `${selected.name}.csv`, "text/csv")
  }
  const generatePreviewThumbnails = async () => {
    if (!selected || !selected.bindings.length) {
      toast.error("Add bindings before generating previews")
      return
    }
    setGeneratingPreviews(true)
    const maxPreviews = Math.min(selected.rows.length, 24)
    const thumbSize = 96
    const results: { index: number; dataUrl: string; label: string }[] = []
    try {
      for (let i = 0; i < maxPreviews; i++) {
        const row = selected.rows[i]
        const variant = await createVariableDocumentVariantAsync(
          activeDoc,
          row,
          selected.bindings,
          (value) => canvasForImageValue(value),
        )
        const flat = renderDocumentComposite(variant, { transparent: true })
        const scale = Math.min(thumbSize / flat.width, thumbSize / flat.height, 1)
        const tw = Math.max(1, Math.round(flat.width * scale))
        const th = Math.max(1, Math.round(flat.height * scale))
        const thumb = makeCanvas(tw, th)
        const tctx = thumb.getContext("2d")
        if (tctx) {
          tctx.imageSmoothingEnabled = true
          tctx.imageSmoothingQuality = "high"
          tctx.drawImage(flat, 0, 0, tw, th)
        }
        const firstCol = columns[0]
        const label = firstCol && row[firstCol] ? `${i + 1}: ${String(row[firstCol]).slice(0, 20)}` : `Row ${i + 1}`
        results.push({ index: i, dataUrl: thumb.toDataURL("image/png"), label })
      }
      setPreviewThumbnails(results)
      if (maxPreviews < selected.rows.length) {
        toast.info(`Showing previews for ${maxPreviews} of ${selected.rows.length} rows`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview generation failed")
    } finally {
      setGeneratingPreviews(false)
    }
  }
  const deleteSelectedSet = () => {
    if (!selected) return
    const next = dataSets.filter((set) => set.id !== selected.id)
    setDataSets(next)
    setSelectedId(next[0]?.id ?? "")
    setRowIndex(0)
  }
  const applyRow = async (row = selected?.rows[rowIndex]) => {
    if (!selected || !row) return
    for (const binding of selected.bindings) {
      const layer = activeDoc.layers.find((item) => item.id === binding.layerId)
      const value = row[binding.column]
      if (!layer || value === undefined) continue
      if (binding.property === "text" && layer.text) {
        dispatch({ type: "set-layer-text", id: layer.id, text: { ...layer.text, content: value } })
      } else if (binding.property === "visibility") {
        dispatch({ type: "set-layer-visibility", id: layer.id, visible: !/^(false|0|no|off)$/i.test(value.trim()) })
      } else if (binding.property === "opacity") {
        const opacity = Number(value)
        const normalized = Number.isFinite(opacity) && opacity <= 1 ? opacity : opacity / 100
        dispatch({ type: "set-layer-opacity", id: layer.id, opacity: Math.max(0, Math.min(1, normalized || 0)) })
      } else if (binding.property === "image") {
        const canvas = await canvasForImageValue(value)
        if (canvas) dispatch({ type: "replace-smart-object-contents", id: layer.id, canvas, source: { fileName: value.trim() || binding.column } })
      }
    }
    requestRender()
    window.setTimeout(() => commit("Apply Variable Data Set", "all"), 0)
  }
  const exportRows = async () => {
    if (!selected) return
    for (let index = 0; index < selected.rows.length; index++) {
      const row = selected.rows[index]
      const variant = await createVariableDocumentVariantAsync(activeDoc, row, selected.bindings, (value) => canvasForImageValue(value))
      const flat = renderDocumentComposite(variant, { transparent: true })
      const filename = renderTemplateName(filenameTemplate, row, index, { name: activeDoc.name, dataset: selected.name })
      await downloadCanvasWithPreset(flat, filename, { format: outputFormat, quality, transparent: true, matte: "#ffffff", filenameTemplate })
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Data Sets">
        <FileButton accept=".csv,.json,.psvars,.psvars.json,text/csv,application/json" label="Import CSV / JSON / Set" onFile={importData} />
        <label className="flex cursor-pointer items-center justify-between rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2 text-[11px]">
          <span>{imageFiles.length ? `${imageFiles.length} image assets selected` : "Choose image assets"}</span>
          <input type="file" multiple accept="image/*" className="hidden" onChange={(event) => setImageFiles(Array.from(event.target.files ?? []))} />
        </label>
        <div className="mt-3 max-h-80 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {dataSets.map((set) => (
            <button key={set.id} type="button" onClick={() => { setSelectedId(set.id); setRowIndex(set.activeRow ?? 0) }} className={`grid w-full grid-cols-[1fr_auto] border-b border-[var(--ps-divider)] p-2 text-left text-[11px] ${selected?.id === set.id ? "bg-[var(--ps-tool-active)]" : "hover:bg-[var(--ps-tool-hover)]"}`}>
              <span>{set.name}</span>
              <span className="text-[var(--ps-text-dim)]">{set.rows.length} rows</span>
            </button>
          ))}
        </div>
        {selected ? (
          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" variant="secondary" onClick={exportSelectedSet}>Export Set</Button>
            <Button size="sm" variant="secondary" onClick={exportSelectedRows}>Export CSV</Button>
            <Button size="sm" variant="ghost" onClick={deleteSelectedSet}>Delete</Button>
          </div>
        ) : null}
        {selected && selected.bindings.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--ps-text)]">Row Previews</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void generatePreviewThumbnails()}
                disabled={generatingPreviews}
                data-testid="variable-generate-previews"
              >
                {generatingPreviews ? "Generating…" : previewThumbnails.length ? "Refresh" : "Generate"}
              </Button>
            </div>
            {previewThumbnails.length > 0 ? (
              <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-2" data-testid="variable-preview-grid">
                {previewThumbnails.map((thumb) => (
                  <button
                    key={thumb.index}
                    type="button"
                    onClick={() => setActiveRow(thumb.index)}
                    className={`flex flex-col items-center gap-1 rounded-sm border p-1 text-[9px] transition-colors ${
                      rowIndex === thumb.index
                        ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]"
                        : "border-[var(--ps-divider)] hover:border-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)]"
                    }`}
                    title={thumb.label}
                  >
                    <img src={thumb.dataUrl} alt={thumb.label} className="h-16 w-16 rounded-sm object-contain" />
                    <span className="w-full truncate text-center text-[var(--ps-text-dim)]">{thumb.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <Panel title="Bindings & Output">
        {selected ? (
          <>
            <NumberField label="Row" value={rowIndex + 1} min={1} max={Math.max(1, selected.rows.length)} onChange={(value) => setActiveRow(value - 1)} />
            <div className="grid grid-cols-[1fr_120px_1fr_auto] gap-2">
              <SelectField label="Layer" value={bindingLayerId || activeDoc.layers[0]?.id || ""} options={activeDoc.layers.map((layer) => layer.id)} onChange={setBindingLayerId} />
              <SelectField label="Property" value={bindingProperty} options={["text", "visibility", "opacity", "image"]} onChange={(value) => setBindingProperty(value as VariableBinding["property"])} />
              <SelectField label="Column" value={bindingColumn || columns[0] || ""} options={columns.length ? columns : [""]} onChange={setBindingColumn} />
              <Button className="self-end" size="sm" onClick={addBinding}>Add</Button>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
              {selected.bindings.map((binding) => {
                const layer = activeDoc.layers.find((item) => item.id === binding.layerId)
                return (
                  <div key={binding.id} className="grid grid-cols-[1fr_108px_1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-[11px]">
                    <select value={binding.layerId} onChange={(event) => updateBinding(binding.id, { layerId: event.target.value })} className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1">
                      {activeDoc.layers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select value={binding.property} onChange={(event) => updateBinding(binding.id, { property: event.target.value as VariableBinding["property"] })} className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1">
                      {["text", "visibility", "opacity", "image"].map((property) => <option key={property} value={property}>{property}</option>)}
                    </select>
                    <select value={binding.column} onChange={(event) => updateBinding(binding.id, { column: event.target.value })} className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1">
                      {columns.map((column) => <option key={column} value={column}>{column}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" onClick={() => removeBinding(binding.id)}>{layer ? "Remove" : "Drop"}</Button>
                  </div>
                )
              })}
            </div>
            <div className="max-h-28 overflow-y-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[10px]">
              {activeRow ? columns.map((column) => (
                <div key={column} className="grid grid-cols-[96px_1fr] gap-2 border-b border-[var(--ps-divider)]/40 py-0.5">
                  <span className="truncate text-[var(--ps-text-dim)]">{column}</span>
                  <span className="truncate">{activeRow[column]}</span>
                </div>
              )) : <span className="text-[var(--ps-text-dim)]">No row selected.</span>}
            </div>
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <SelectField label="Format" value={outputFormat} options={["png", "jpeg", "webp", "gif", "avif"]} onChange={(value) => setOutputFormat(value as AutomationOutputPreset["format"])} />
              <NumberField label="Quality" value={quality} min={0.1} max={1} step={0.01} onChange={setQuality} />
            </div>
            <Input value={filenameTemplate} onChange={(event) => setFilenameTemplate(event.target.value)} className="h-8" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => void applyRow()}>Apply Row</Button>
              <Button size="sm" variant="secondary" onClick={() => void exportRows()}>Export All Rows</Button>
            </div>
          </>
        ) : <EmptyState text="Import a CSV to create text and visibility bindings." />}
      </Panel>
    </div>
  )
}
