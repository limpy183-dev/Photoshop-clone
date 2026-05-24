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
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { compositeFilterImageData, FILTERS, type FilterDef, type FilterParam } from "./filters"
import { useEditor } from "./editor-context"
import { Trash2, Plus, Eye, EyeOff, ChevronDown, ChevronRight, GripVertical } from "lucide-react"
import type { BlendMode, SmartFilter } from "./types"
import { normalizeSmartFilterMaskDensity, normalizeSmartFilterMaskFeather, smartFilterMaskToImageData } from "./smart-filter-masks"

interface FilterStackEntry {
  id: string
  filterId: string
  filterName: string
  params: Record<string, number | string | boolean>
  visible: boolean
  opacity: number
  blendMode: BlendMode
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
  maskDensity?: number
  maskFeather?: number
}

const BLEND_MODES: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "darken",
  "lighten",
  "color",
  "luminosity",
  "difference",
]

function getFilterCategories(): Record<string, FilterDef[]> {
  const cats: Record<string, FilterDef[]> = {}
  for (const f of Object.values(FILTERS)) {
    if (!cats[f.category]) cats[f.category] = []
    cats[f.category].push(f)
  }
  return cats
}

function defaultParams(f: FilterDef): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const p of f.params) {
    out[p.key] = p.default
  }
  return out
}

function entryMaskData(entry: FilterStackEntry, width: number, height: number) {
  if (!entry.mask || entry.maskEnabled === false) return null
  return smartFilterMaskToImageData(entry.mask, width, height, entry.maskFeather ?? 0)
}

function compositeStackEntry(before: ImageData, after: ImageData, entry: FilterStackEntry) {
  const mask = entryMaskData(entry, before.width, before.height)
  return compositeFilterImageData(before, after, {
    opacity: entry.opacity ?? 1,
    blendMode: entry.blendMode ?? "normal",
    maskData: mask?.data ?? null,
    maskWidth: mask?.width,
    maskHeight: mask?.height,
    maskEnabled: entry.maskEnabled ?? true,
    maskDensity: entry.maskDensity ?? 1,
  })
}

export function FilterGalleryDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeLayer, activeDoc, commit, dispatch, requestRender } = useEditor()
  const categories = React.useMemo(getFilterCategories, [])
  const categoryNames = React.useMemo(() => Object.keys(categories).sort(), [categories])

  const [stack, setStack] = React.useState<FilterStackEntry[]>([])
  const [selectedIdx, setSelectedIdx] = React.useState(-1)
  const [expandedCats, setExpandedCats] = React.useState<Set<string>>(new Set(["Blur", "Adjustments"]))
  const [draggedFilterIdx, setDraggedFilterIdx] = React.useState<number | null>(null)

  const previewCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const srcDataRef = React.useRef<ImageData | null>(null)

  // Load source image data when dialog opens
  React.useEffect(() => {
    if (!open || !activeLayer || !activeDoc) {
      srcDataRef.current = null
      return
    }
    const ctx = activeLayer.canvas.getContext("2d")!
    srcDataRef.current = ctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
    const existing = activeLayer.smartObject || activeLayer.kind === "smart-object"
      ? activeLayer.smartFilters?.map((sf) => ({
          id: sf.id,
          filterId: sf.filterId,
          filterName: sf.name,
          params: sf.params,
          visible: sf.enabled,
          opacity: sf.opacity ?? 1,
          blendMode: sf.blendMode ?? "normal",
          mask: sf.mask ?? null,
          maskEnabled: sf.maskEnabled ?? true,
          maskDensity: sf.maskDensity ?? 1,
          maskFeather: sf.maskFeather ?? 0,
        })) ?? []
      : []
    setStack(existing)
    setSelectedIdx(existing.length ? 0 : -1)
  }, [open, activeLayer, activeDoc])

  // Render preview whenever stack changes
  React.useEffect(() => {
    const cv = previewCanvasRef.current
    const src = srcDataRef.current
    if (!cv || !src || !activeDoc) return

    const maxPreview = 400
    const scale = Math.min(maxPreview / src.width, maxPreview / src.height, 1)
    const pw = Math.round(src.width * scale)
    const ph = Math.round(src.height * scale)
    cv.width = pw
    cv.height = ph

    // Scale source down for preview
    const srcCanvas = document.createElement("canvas")
    srcCanvas.width = src.width
    srcCanvas.height = src.height
    srcCanvas.getContext("2d")!.putImageData(src, 0, 0)

    const scaledCanvas = document.createElement("canvas")
    scaledCanvas.width = pw
    scaledCanvas.height = ph
    const sctx = scaledCanvas.getContext("2d")!
    sctx.drawImage(srcCanvas, 0, 0, pw, ph)
    let current = sctx.getImageData(0, 0, pw, ph)

    // Apply filter stack
    for (const entry of stack) {
      if (!entry.visible) continue
      const filterDef = FILTERS[entry.filterId]
      if (!filterDef) continue
      const before = current
      const after = filterDef.apply(before, entry.params)
      current = compositeStackEntry(before, after, entry)
    }

    const ctx = cv.getContext("2d")!
    ctx.putImageData(current, 0, 0)
  }, [stack, activeDoc])

  const addFilter = (f: FilterDef) => {
    const entry: FilterStackEntry = {
      id: `${f.id}_${Date.now()}`,
      filterId: f.id,
      filterName: f.name,
      params: defaultParams(f),
      visible: true,
      opacity: 1,
      blendMode: "normal",
      mask: null,
      maskEnabled: true,
      maskDensity: 1,
      maskFeather: 0,
    }
    setStack((prev) => [...prev, entry])
    setSelectedIdx(stack.length)
  }

  const removeFilter = (idx: number) => {
    setStack((prev) => prev.filter((_, i) => i !== idx))
    setSelectedIdx((curr) => (curr >= idx ? Math.max(0, curr - 1) : curr))
  }

  const toggleVisibility = (idx: number) => {
    setStack((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, visible: !e.visible } : e))
    )
  }

  const updateParams = (idx: number, key: string, value: number | string | boolean) => {
    setStack((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, params: { ...e.params, [key]: value } } : e))
    )
  }

  const updateEntry = (idx: number, patch: Partial<FilterStackEntry>) => {
    setStack((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
  }

  const moveFilter = (from: number, direction: "up" | "down") => {
    const to = direction === "up" ? from - 1 : from + 1
    if (to < 0 || to >= stack.length) return
    setStack((prev) => {
      const next = [...prev]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setSelectedIdx(to)
  }

  const moveFilterTo = (from: number, to: number) => {
    if (from === to || from < 0 || from >= stack.length || to < 0 || to >= stack.length) return
    setStack((prev) => {
      const next = [...prev]
      const [entry] = next.splice(from, 1)
      next.splice(to, 0, entry)
      return next
    })
    setSelectedIdx(to)
  }

  const applyToLayer = () => {
    if (!activeLayer || !activeDoc || !srcDataRef.current) return
    if (activeLayer.smartObject || activeLayer.kind === "smart-object") {
      const smartFilters: SmartFilter[] = stack.map((entry) => ({
        id: entry.id,
        filterId: entry.filterId,
        name: entry.filterName,
        enabled: entry.visible,
        opacity: Math.max(0, Math.min(1, entry.opacity ?? 1)),
        blendMode: entry.blendMode ?? "normal",
        mask: entry.mask ?? undefined,
        maskEnabled: entry.maskEnabled ?? true,
        maskDensity: normalizeSmartFilterMaskDensity(entry.maskDensity),
        maskFeather: normalizeSmartFilterMaskFeather(entry.maskFeather),
        params: entry.params,
      }))
      dispatch({ type: "set-layer-smart-filters", id: activeLayer.id, smartFilters })
      requestRender()
      setTimeout(() => commit("Smart Filters", [activeLayer.id]), 0)
      onOpenChange(false)
      return
    }
    let data = srcDataRef.current
    for (const entry of stack) {
      if (!entry.visible) continue
      const filterDef = FILTERS[entry.filterId]
      if (!filterDef) continue
      const before = data
      const after = filterDef.apply(before, entry.params)
      data = compositeStackEntry(before, after, entry)
    }
    const ctx = activeLayer.canvas.getContext("2d")!
    ctx.putImageData(data, 0, 0)
    commit("Filter Gallery", [activeLayer.id])
    onOpenChange(false)
  }

  const selectedEntry = selectedIdx >= 0 && selectedIdx < stack.length ? stack[selectedIdx] : null
  const selectedFilterDef = selectedEntry ? FILTERS[selectedEntry.filterId] : null

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] max-h-[90vh] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-2 border-b border-[var(--ps-divider)]">
          <DialogTitle className="text-sm">Filter Gallery</DialogTitle>
          <DialogDescription className="sr-only">Stack and preview filters on the active layer.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0" style={{ height: "70vh" }}>
          {/* Left: Preview */}
          <div className="flex-1 bg-[#1a1a1a] flex items-center justify-center p-4 overflow-hidden border-r border-[var(--ps-divider)]">
            <div className="ps-checker rounded border border-[var(--ps-divider)] overflow-hidden">
              <canvas ref={previewCanvasRef} className="block max-w-full max-h-full" />
            </div>
          </div>

          {/* Middle: Category tree */}
          <div className="w-[200px] border-r border-[var(--ps-divider)] overflow-y-auto shrink-0">
            <div className="p-1 text-[10px] uppercase text-[var(--ps-text-dim)] px-2 py-1.5 bg-[var(--ps-panel-2)] border-b border-[var(--ps-divider)]">
              Filters
            </div>
            {categoryNames.map((cat) => {
              const isExpanded = expandedCats.has(cat)
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleCat(cat)}
                    className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-[var(--ps-tool-hover)] flex items-center gap-1"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span className="font-medium">{cat}</span>
                    <span className="text-[var(--ps-text-dim)] ml-auto text-[9px]">{categories[cat].length}</span>
                  </button>
                  {isExpanded &&
                    categories[cat]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((f) => (
                        <button
                          key={f.id}
                          onClick={() => addFilter(f)}
                          className="w-full text-left pl-6 pr-2 py-1 text-[11px] hover:bg-[var(--ps-accent)]/20 text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] flex items-center gap-1"
                        >
                          <Plus className="w-2.5 h-2.5 opacity-40" />
                          {f.name}
                        </button>
                      ))}
                </div>
              )
            })}
          </div>

          {/* Right: Stack + Params */}
          <div className="w-[260px] flex flex-col shrink-0">
            {/* Filter Stack */}
            <div className="border-b border-[var(--ps-divider)]">
              <div className="p-1 text-[10px] uppercase text-[var(--ps-text-dim)] px-2 py-1.5 bg-[var(--ps-panel-2)] border-b border-[var(--ps-divider)] flex items-center justify-between">
                <span>Filter Stack ({stack.length})</span>
              </div>
              <div className="max-h-[180px] overflow-y-auto">
                {stack.length === 0 && (
                  <div className="text-center text-[var(--ps-text-dim)] text-[10px] py-6">
                    Click a filter to add it to the stack
                  </div>
                )}
                {stack.map((entry, idx) => (
                  <div
                    key={entry.id}
                    data-testid={`filter-gallery-stack-row-${entry.filterName}`}
                    draggable
                    className={`flex items-center gap-1 px-2 py-1.5 text-[11px] cursor-pointer border-b border-[var(--ps-divider)] ${
                      idx === selectedIdx
                        ? "bg-[var(--ps-accent)]/20 text-[var(--ps-text)]"
                        : "hover:bg-[var(--ps-tool-hover)]"
                    }`}
                    onDragStart={(e) => {
                      setDraggedFilterIdx(idx)
                      e.dataTransfer.setData("application/x-ps-filter-index", String(idx))
                      e.dataTransfer.effectAllowed = "move"
                    }}
                    onDragOver={(e) => {
                      const raw = e.dataTransfer.getData("application/x-ps-filter-index")
                      const from = raw ? Number(raw) : draggedFilterIdx
                      if (typeof from !== "number" || !Number.isFinite(from) || from === idx) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = "move"
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const raw = e.dataTransfer.getData("application/x-ps-filter-index")
                      const from = raw ? Number(raw) : draggedFilterIdx
                      if (typeof from === "number" && Number.isFinite(from)) moveFilterTo(from, idx)
                      setDraggedFilterIdx(null)
                    }}
                    onDragEnd={() => setDraggedFilterIdx(null)}
                    onClick={() => setSelectedIdx(idx)}
                  >
                    <GripVertical className="w-3 h-3 text-[var(--ps-text-dim)] shrink-0" />
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleVisibility(idx) }}
                      className="shrink-0"
                    >
                      {entry.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-[var(--ps-text-dim)]" />}
                    </button>
                    <span className={`flex-1 truncate ${!entry.visible ? "text-[var(--ps-text-dim)] line-through" : ""}`}>
                      {entry.filterName}
                    </span>
                    <div className="flex gap-0.5 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); moveFilter(idx, "up") }}
                        className="px-1 hover:bg-[var(--ps-tool-hover)] rounded-sm text-[9px]"
                        disabled={idx === 0}
                      >▲</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); moveFilter(idx, "down") }}
                        className="px-1 hover:bg-[var(--ps-tool-hover)] rounded-sm text-[9px]"
                        disabled={idx === stack.length - 1}
                      >▼</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFilter(idx) }}
                        className="px-1 hover:bg-red-500/20 rounded-sm"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Selected filter params */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {selectedEntry && selectedFilterDef ? (
                <>
                  <div className="text-[11px] font-medium">{selectedEntry.filterName}</div>
                  <div className="rounded-sm border border-[var(--ps-divider)] p-2 space-y-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[var(--ps-text-dim)]">Opacity</span>
                        <span className="tabular-nums">{Math.round((selectedEntry.opacity ?? 1) * 100)}%</span>
                      </div>
                      <Slider
                        min={0}
                        max={100}
                        value={[Math.round((selectedEntry.opacity ?? 1) * 100)]}
                        onValueChange={(v) => updateEntry(selectedIdx, { opacity: v[0] / 100 })}
                      />
                    </div>
                    <label className="grid gap-1 text-[10px]">
                      <span className="text-[var(--ps-text-dim)]">Blend Mode</span>
                      <select
                        value={selectedEntry.blendMode}
                        onChange={(e) => updateEntry(selectedIdx, { blendMode: e.target.value as BlendMode })}
                        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[11px]"
                      >
                        {BLEND_MODES.map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </label>
                    {selectedEntry.mask ? (
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-[10px]">
                          <Checkbox
                            checked={selectedEntry.maskEnabled !== false}
                            onCheckedChange={(v) => updateEntry(selectedIdx, { maskEnabled: v === true })}
                            className="border-[var(--ps-divider)]"
                          />
                          Enable filter mask
                        </label>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-[var(--ps-text-dim)]">Mask Density</span>
                            <span className="tabular-nums">{Math.round((selectedEntry.maskDensity ?? 1) * 100)}%</span>
                          </div>
                          <Slider
                            min={0}
                            max={100}
                            value={[Math.round((selectedEntry.maskDensity ?? 1) * 100)]}
                            onValueChange={(v) => updateEntry(selectedIdx, { maskDensity: v[0] / 100 })}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-[var(--ps-text-dim)]">Mask Feather</span>
                            <span className="tabular-nums">{Math.round(selectedEntry.maskFeather ?? 0)} px</span>
                          </div>
                          <Slider
                            min={0}
                            max={250}
                            value={[Math.round(selectedEntry.maskFeather ?? 0)]}
                            onValueChange={(v) => updateEntry(selectedIdx, { maskFeather: v[0] })}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {selectedFilterDef.params.map((param) => (
                    <FilterParamControl
                      key={param.key}
                      param={param}
                      value={selectedEntry.params[param.key]}
                      onChange={(v) => updateParams(selectedIdx, param.key, v)}
                    />
                  ))}
                </>
              ) : (
                <div className="text-center text-[var(--ps-text-dim)] text-[10px] py-8">
                  Select a filter from the stack to edit its parameters
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-4 py-2 border-t border-[var(--ps-divider)]">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={applyToLayer} disabled={stack.length === 0}>
            {activeLayer?.smartObject || activeLayer?.kind === "smart-object" ? "Save Smart Filters" : `Apply (${stack.length} filter${stack.length !== 1 ? "s" : ""})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FilterParamControl({
  param,
  value,
  onChange,
}: {
  param: FilterParam
  value: number | string | boolean
  onChange: (v: number | string | boolean) => void
}) {
  if (param.type === "slider") {
    const numVal = typeof value === "number" ? value : param.default
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[var(--ps-text-dim)]">{param.label}</span>
          <span className="tabular-nums">
            {numVal.toFixed(param.step && param.step < 1 ? 1 : 0)}{param.suffix ?? ""}
          </span>
        </div>
        <Slider
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={[numVal]}
          onValueChange={(v) => onChange(v[0])}
        />
      </div>
    )
  }

  if (param.type === "select") {
    return (
      <div className="space-y-1">
        <span className="text-[10px] text-[var(--ps-text-dim)]">{param.label}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
        >
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    )
  }

  if (param.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={value === true}
          onCheckedChange={(v) => onChange(v === true)}
          className="border-[var(--ps-divider)]"
        />
        {param.label}
      </label>
    )
  }

  return null
}
