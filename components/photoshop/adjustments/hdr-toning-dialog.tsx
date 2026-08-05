"use client"

/**
 * HDR Toning — method dropdown, Local Adaptation knobs and presets.
 *
 * One of the adjustment dialogs split out of `adjustment-dialogs.tsx`. Each is
 * lazy-loaded on its own, so opening one no longer pulls in the other five.
 * Results dispatch through the normal reducer/commit path, landing in history
 * exactly like a manual filter run.
 */

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEditor } from "@/components/photoshop/editor/context"
import { FILTERS, HDR_TONING_PRESETS } from "@/editor/filters"
import { toast } from "sonner"
import { activeRasterLayer, commitFilterResult } from "@/editor/document/adjustment-helpers"
import { Group, SelectRow, SliderRow } from "@/components/photoshop/adjustments/adjustment-controls"
const HDR_PRESET_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "monochromatic", label: "Monochromatic" },
  { value: "more-saturated", label: "More Saturated" },
  { value: "photorealistic", label: "Photorealistic" },
  { value: "surrealistic", label: "Surrealistic" },
  { value: "highlight-compression", label: "Highlight Compression" },
  { value: "equalize-histogram", label: "Equalize Histogram" },
]

interface HdrToningState {
  method: string
  radius: number
  strength: number
  edgeGlow: number
  gamma: number
  exposureEv: number
  detail: number
  shadow: number
  highlight: number
  vibrance: number
  saturation: number
  toningCurve: string
}

const HDR_DEFAULT_STATE: HdrToningState = {
  method: "local-adaptation",
  radius: 60,
  strength: 100,
  edgeGlow: 30,
  gamma: 1,
  exposureEv: 0,
  detail: 0,
  shadow: 0,
  highlight: 0,
  vibrance: 0,
  saturation: 0,
  toningCurve: "0,0;255,255",
}

export function HdrToningDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const [state, setState] = React.useState<HdrToningState>(HDR_DEFAULT_STATE)
  const [preset, setPreset] = React.useState<string>("default")

  React.useEffect(() => {
    if (open) {
      setPreset("default")
      setState(HDR_DEFAULT_STATE)
    }
  }, [open])

  const applyPreset = (id: string) => {
    setPreset(id)
    const def = HDR_TONING_PRESETS[id]
    if (def) setState({ ...HDR_DEFAULT_STATE, ...def })
  }

  const set = <K extends keyof HdrToningState>(key: K, value: HdrToningState[K]) => {
    setPreset("(custom)")
    setState((s) => ({ ...s, [key]: value }))
  }

  const isLocalAdaptation = state.method === "local-adaptation"

  const apply = () => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("No editable layer.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const filter = FILTERS["hdr-toning"]
    const result = filter.apply(src, state as unknown as Record<string, number | string | boolean>)
    commitFilterResult(activeDoc, layer, result, "HDR Toning", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>HDR Toning</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectRow label="Preset" value={preset} onChange={applyPreset} options={[...HDR_PRESET_OPTIONS, { value: "(custom)", label: "Custom" }]} />
            <SelectRow
              label="Method"
              value={state.method}
              onChange={(v) => set("method", v)}
              options={[
                { value: "local-adaptation", label: "Local Adaptation" },
                { value: "exposure-gamma", label: "Exposure and Gamma" },
                { value: "highlight-compression", label: "Highlight Compression" },
                { value: "equalize-histogram", label: "Equalize Histogram" },
              ]}
            />
          </div>
          {isLocalAdaptation ? (
            <Group title="Edge Glow">
              <SliderRow label="Radius" suffix="px" min={1} max={250} step={1} value={state.radius} onChange={(v) => set("radius", v)} />
              <SliderRow label="Strength" suffix="%" min={0} max={200} step={1} value={state.strength} onChange={(v) => set("strength", v)} />
              <SliderRow label="Edge Glow" min={0} max={100} step={1} value={state.edgeGlow} onChange={(v) => set("edgeGlow", v)} />
            </Group>
          ) : null}
          <Group title="Tone and Detail">
            <SliderRow label="Gamma" min={0.3} max={3} step={0.01} value={state.gamma} onChange={(v) => set("gamma", v)} />
            <SliderRow label="Exposure" suffix="EV" min={-4} max={4} step={0.01} value={state.exposureEv} onChange={(v) => set("exposureEv", v)} />
            {isLocalAdaptation ? <SliderRow label="Detail" min={-100} max={100} step={1} value={state.detail} onChange={(v) => set("detail", v)} /> : null}
          </Group>
          {isLocalAdaptation ? (
            <Group title="Advanced">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SliderRow label="Shadow" min={-100} max={100} step={1} value={state.shadow} onChange={(v) => set("shadow", v)} />
                <SliderRow label="Highlight" min={-100} max={100} step={1} value={state.highlight} onChange={(v) => set("highlight", v)} />
                <SliderRow label="Vibrance" min={-100} max={100} step={1} value={state.vibrance} onChange={(v) => set("vibrance", v)} />
                <SliderRow label="Saturation" min={-100} max={100} step={1} value={state.saturation} onChange={(v) => set("saturation", v)} />
              </div>
            </Group>
          ) : null}
          {isLocalAdaptation ? (
            <Group title="Toning Curve">
              <label className="grid gap-1 text-[11px]">
                <span className="text-[var(--ps-text-dim)]">Curve points (x,y;x,y;...)</span>
                <input
                  className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 font-mono text-[11px]"
                  value={state.toningCurve}
                  onChange={(e) => set("toningCurve", e.target.value)}
                />
              </label>
            </Group>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Match Color                                                     */
/* ------------------------------------------------------------------ */
