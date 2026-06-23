"use client"

import * as React from "react"
import { Check, Eye, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorSelector } from "../editor-context"
import { buildRetouchingFeedbackModel } from "../retouch-feedback"
import type { CloneSourcePreset } from "../types"
import { uid } from "../uid"

export function CloneSourcePanel() {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const activeLayer = useEditorSelector((editor) => editor.activeLayer)
  const tool = useEditorSelector((editor) => editor.tool)
  const brush = useEditorSelector((editor) => editor.brush)
  const cloneSource = useEditorSelector((editor) => editor.cloneSource)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const [name, setName] = React.useState("")

  if (!activeDoc) return null

  const activePreset = cloneSource.presets.find((preset) => preset.id === cloneSource.activePresetId)
  const feedback = buildRetouchingFeedbackModel({
    tool,
    brush,
    cloneSource,
    cursor: activePreset ? { x: activePreset.sourceX + cloneSource.offsetX, y: activePreset.sourceY + cloneSource.offsetY } : null,
  })

  const update = (patch: Partial<typeof cloneSource>) => dispatch({ type: "set-clone-source", cloneSource: patch })

  const savePreset = () => {
    if (!activeLayer) return
    const preset: CloneSourcePreset = {
      id: uid("clone"),
      name: name.trim() || `Source ${cloneSource.presets.length + 1}`,
      layerId: activeLayer.id,
      sourceX: activeDoc.width / 2,
      sourceY: activeDoc.height / 2,
      scale: cloneSource.scale,
      rotation: cloneSource.rotation,
      offsetX: cloneSource.offsetX,
      offsetY: cloneSource.offsetY,
    }
    update({ activePresetId: preset.id, presets: [preset, ...cloneSource.presets] })
    window.setTimeout(() => commit("Save Clone Source", []), 0)
    setName("")
  }

  const applyPreset = (preset: CloneSourcePreset) => {
    update({
      activePresetId: preset.id,
      scale: preset.scale,
      rotation: preset.rotation,
      offsetX: preset.offsetX,
      offsetY: preset.offsetY,
    })
  }

  const updateActivePreset = () => {
    if (!activePreset) return
    update({
      presets: cloneSource.presets.map((preset) =>
        preset.id === activePreset.id
          ? {
              ...preset,
              scale: cloneSource.scale,
              rotation: cloneSource.rotation,
              offsetX: cloneSource.offsetX,
              offsetY: cloneSource.offsetY,
            }
          : preset,
      ),
    })
    window.setTimeout(() => commit("Update Clone Source", []), 0)
  }

  const removePreset = (id: string) => {
    update({
      activePresetId: cloneSource.activePresetId === id ? null : cloneSource.activePresetId,
      presets: cloneSource.presets.filter((preset) => preset.id !== id),
    })
    window.setTimeout(() => commit("Delete Clone Source", []), 0)
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-3 border-b border-[var(--ps-divider)] p-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Clone source name"
            className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
          />
          <Button size="sm" onClick={savePreset} disabled={!activeLayer}>
            <Plus className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cloneSource.aligned} onChange={(event) => update({ aligned: event.target.checked })} />
            Aligned
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cloneSource.showOverlay} onChange={(event) => update({ showOverlay: event.target.checked })} />
            Overlay
          </label>
        </div>
        <label className="grid gap-1">
          <span className="text-[var(--ps-text-dim)]">Sample</span>
          <select value={cloneSource.sample} onChange={(event) => update({ sample: event.target.value as typeof cloneSource.sample })} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2">
            <option value="current-layer">Current layer</option>
            <option value="current-below">Current and below</option>
            <option value="all-layers">All layers</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Scale %" value={cloneSource.scale} min={10} max={400} onChange={(value) => update({ scale: value })} />
          <NumberField label="Rotation" value={cloneSource.rotation} min={-180} max={180} onChange={(value) => update({ rotation: value })} />
          <NumberField label="Offset X" value={cloneSource.offsetX} min={-2000} max={2000} onChange={(value) => update({ offsetX: value })} />
          <NumberField label="Offset Y" value={cloneSource.offsetY} min={-2000} max={2000} onChange={(value) => update({ offsetY: value })} />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={updateActivePreset} disabled={!activePreset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Update Active Preset
        </Button>
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--ps-text)]">{feedback.primaryStatus}</span>
            <span className="text-[10px] text-[var(--ps-text-dim)]">{feedback.brushEdge.detail}</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <InfoChip label="Radius" value={`${feedback.brushEdge.radius}px`} />
            <InfoChip label="Hard edge" value={`${feedback.brushEdge.hardnessRadius}px`} />
            <InfoChip label="Spacing" value={`${feedback.brushEdge.spacing}px`} />
            <InfoChip label="Scatter" value={`${feedback.brushEdge.scatterRadius}px`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {feedback.hudChips.map((chip) => (
              <span
                key={`${chip.value}-${chip.label}`}
                className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${
                  chip.tone === "warning"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    : chip.tone === "accent"
                      ? "border-sky-400/35 bg-sky-400/10 text-sky-200"
                      : "border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text-dim)]"
                }`}
                title={chip.value}
              >
                {chip.label}
              </span>
            ))}
          </div>
          {feedback.previewGhost.visible && feedback.previewGhost.sourcePoint && feedback.previewGhost.destinationPoint ? (
            <div className="mt-2 rounded-sm border border-sky-400/25 bg-sky-400/10 px-2 py-1 text-[10px] text-sky-100">
              Ghost {Math.round(feedback.previewGhost.sourcePoint.x)}, {Math.round(feedback.previewGhost.sourcePoint.y)}
              {" -> "}
              {Math.round(feedback.previewGhost.destinationPoint.x)}, {Math.round(feedback.previewGhost.destinationPoint.y)}
            </div>
          ) : feedback.healingPreview.mode === "sample-required" && feedback.hudChips.some((chip) => chip.tone === "warning") ? (
            <div className="mt-2 rounded-sm border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
              {feedback.healingPreview.label}
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {cloneSource.presets.length ? (
          <div className="space-y-1">
            {cloneSource.presets.map((preset) => (
              <div key={preset.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px]">{preset.name}</div>
                  <div className="text-[10px] text-[var(--ps-text-dim)]">
                    x{Math.round(preset.sourceX)}, y{Math.round(preset.sourceY)} - {preset.scale}% - {preset.rotation} deg
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" title="Use clone source" onClick={() => applyPreset(preset)}>
                  {cloneSource.activePresetId === preset.id ? <Eye className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon-sm" title="Delete clone source" onClick={() => removePreset(preset.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            Alt-click with Clone Stamp or Healing Brush to capture exact source points.
          </div>
        )}
      </div>
    </div>
  )
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-1">
      <div className="uppercase text-[9px] text-[var(--ps-text-dim)]">{label}</div>
      <div className="tabular-nums text-[var(--ps-text)]">{value}</div>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
      />
    </label>
  )
}
