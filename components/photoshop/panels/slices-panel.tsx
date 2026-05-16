"use client"

import * as React from "react"
import { toast } from "sonner"
import { Download, Plus, Trash2 } from "lucide-react"
import { useEditor, makeCanvas } from "../editor-context"
import { downloadBlob, rasterMime, renderDocumentComposite } from "../document-io"
import type { Slice } from "../types"

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "slice"
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeSlice(slice: Slice, width: number, height: number) {
  const x = clamp(slice.x, 0, Math.max(0, width - 1))
  const y = clamp(slice.y, 0, Math.max(0, height - 1))
  const w = clamp(slice.w, 1, Math.max(1, width - x))
  const h = clamp(slice.h, 1, Math.max(1, height - y))
  return { ...slice, x, y, w, h }
}

async function exportSlice(source: HTMLCanvasElement, slice: Slice, filename: string) {
  const crop = makeCanvas(slice.w, slice.h)
  crop.getContext("2d")!.drawImage(source, slice.x, slice.y, slice.w, slice.h, 0, 0, slice.w, slice.h)
  const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, rasterMime("png")))
  if (!blob) throw new Error(`Could not export ${slice.name}`)
  downloadBlob(blob, `${filename}.png`)
}

export function SlicesPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [prefix, setPrefix] = React.useState("slice")

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const slices = activeDoc.slices ?? []
  const selectedSlice = slices.find((slice) => slice.id === activeDoc.selectedSliceId)

  const addSlice = () => {
    const slice: Slice = {
      id: uid("slice"),
      name: `Slice ${slices.length + 1}`,
      x: Math.round(activeDoc.width * 0.25),
      y: Math.round(activeDoc.height * 0.25),
      w: Math.max(1, Math.round(activeDoc.width * 0.5)),
      h: Math.max(1, Math.round(activeDoc.height * 0.5)),
    }
    dispatch({ type: "add-slice", slice })
    window.setTimeout(() => commit("Add Slice", []), 0)
  }

  const addGrid = (columns: number, rows: number) => {
    const next: Slice[] = []
    const cellW = activeDoc.width / columns
    const cellH = activeDoc.height / rows
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        next.push({
          id: uid("slice"),
          name: `${columns}x${rows}-${row + 1}-${column + 1}`,
          x: Math.round(column * cellW),
          y: Math.round(row * cellH),
          w: Math.round(column === columns - 1 ? activeDoc.width - column * cellW : cellW),
          h: Math.round(row === rows - 1 ? activeDoc.height - row * cellH : cellH),
        })
      }
    }
    next.forEach((slice) => dispatch({ type: "add-slice", slice }))
    window.setTimeout(() => commit(`Add ${columns}x${rows} Slice Grid`, []), 0)
  }

  const updateSlice = (id: string, patch: Partial<Slice>) => {
    dispatch({ type: "update-slice", id, patch })
  }

  const exportAll = async () => {
    if (!slices.length) return
    try {
      const composite = renderDocumentComposite(activeDoc, { transparent: true })
      for (const slice of slices) {
        const normalized = normalizeSlice(slice, activeDoc.width, activeDoc.height)
        await exportSlice(composite, normalized, `${safeName(activeDoc.name)}-${safeName(prefix)}-${safeName(slice.name)}`)
      }
      toast.success(`Exported ${slices.length} slice${slices.length === 1 ? "" : "s"}`)
      window.setTimeout(() => commit("Export Slices", []), 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Slice export failed")
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] p-2">
        <ToolButton title="Add slice" onClick={addSlice}><Plus className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Export all slices" disabled={!slices.length} onClick={exportAll}><Download className="h-3.5 w-3.5" /></ToolButton>
        <button
          type="button"
          disabled={!slices.length}
          onClick={() => {
            dispatch({ type: "clear-slices" })
            window.setTimeout(() => commit("Clear Slices", []), 0)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title="Clear slices"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto text-[10px] text-[var(--ps-text-dim)]">{slices.length} slice{slices.length === 1 ? "" : "s"}</span>
      </div>
      {selectedSlice ? (
        <div className="border-b border-[var(--ps-divider)] px-2 py-1 text-[10px] text-orange-200">
          Selected slice: {selectedSlice.name}
        </div>
      ) : null}

      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
          Export prefix
          <input
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none"
          />
        </label>
        <div className="grid grid-cols-3 gap-1">
          <SmallButton label="2 x 2" onClick={() => addGrid(2, 2)} />
          <SmallButton label="3 x 3" onClick={() => addGrid(3, 3)} />
          <SmallButton label="Hero + Footer" onClick={() => {
            dispatch({ type: "add-slice", slice: { id: uid("slice"), name: "Hero", x: 0, y: 0, w: activeDoc.width, h: Math.round(activeDoc.height * 0.62) } })
            dispatch({ type: "add-slice", slice: { id: uid("slice"), name: "Footer", x: 0, y: Math.round(activeDoc.height * 0.62), w: activeDoc.width, h: Math.round(activeDoc.height * 0.38) } })
            window.setTimeout(() => commit("Add Hero/Footer Slices", []), 0)
          }} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {slices.length === 0 ? (
          <PanelEmpty text="Create slices for web export regions." />
        ) : (
          slices.map((slice) => {
            const normalized = normalizeSlice(slice, activeDoc.width, activeDoc.height)
            return (
              <div
                key={slice.id}
                className={`space-y-2 border-b border-[var(--ps-divider)] p-2 ${
                  activeDoc.selectedSliceId === slice.id ? "bg-orange-500/10" : ""
                }`}
              >
                <div className="grid grid-cols-[1fr_auto] gap-1">
                  <input
                    value={slice.name}
                    onChange={(event) => updateSlice(slice.id, { name: event.target.value })}
                    className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
                  />
                  <ToolButton title="Delete slice" onClick={() => {
                    dispatch({ type: "remove-slice", id: slice.id })
                    window.setTimeout(() => commit("Remove Slice", []), 0)
                  }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </ToolButton>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <NumberField label="X" value={normalized.x} onChange={(value) => updateSlice(slice.id, { x: clamp(value, 0, activeDoc.width - 1) })} />
                  <NumberField label="Y" value={normalized.y} onChange={(value) => updateSlice(slice.id, { y: clamp(value, 0, activeDoc.height - 1) })} />
                  <NumberField label="W" value={normalized.w} onChange={(value) => updateSlice(slice.id, { w: clamp(value, 1, activeDoc.width - normalized.x) })} />
                  <NumberField label="H" value={normalized.h} onChange={(value) => updateSlice(slice.id, { h: clamp(value, 1, activeDoc.height - normalized.y) })} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] text-[var(--ps-text)] outline-none"
      />
    </label>
  )
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
    >
      {label}
    </button>
  )
}

function ToolButton({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
