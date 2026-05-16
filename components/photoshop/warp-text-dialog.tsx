"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useEditor } from "./editor-context"
import { rasterizeText } from "./tool-helpers"
import type { WarpStyle } from "./types"

const STYLES: { id: WarpStyle; label: string }[] = [
  { id: "none", label: "None" },
  { id: "arc", label: "Arc" },
  { id: "arch", label: "Arch" },
  { id: "bulge", label: "Bulge" },
  { id: "flag", label: "Flag" },
  { id: "wave", label: "Wave" },
  { id: "fish", label: "Fish" },
  { id: "rise", label: "Rise" },
  { id: "squeeze", label: "Squeeze" },
  { id: "twist", label: "Twist" },
]

export function WarpTextDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeLayer, dispatch, commit, requestRender } = useEditor()
  const baseline = React.useRef<NonNullable<typeof activeLayer>["text"] | null>(null)

  React.useEffect(() => {
    if (open && activeLayer?.text) {
      baseline.current = JSON.parse(JSON.stringify(activeLayer.text))
    }
  }, [open, activeLayer])

  if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Warp Text (metadata warp)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Select a text layer first.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const warp = activeLayer.text.warp ?? { style: "none", bend: 0, horizontal: 0, vertical: 0 }

  const update = (patch: Partial<NonNullable<typeof warp>>) => {
    if (!activeLayer.text) return
    const next = {
      ...activeLayer.text,
      warp: { ...warp, ...patch },
    }
    dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
    rasterizeText(activeLayer.canvas, next)
    requestRender()
  }

  const cancel = () => {
    if (baseline.current && activeLayer) {
      dispatch({ type: "set-layer-text", id: activeLayer.id, text: baseline.current })
      rasterizeText(activeLayer.canvas, baseline.current)
      requestRender()
    }
    onOpenChange(false)
  }

  const apply = () => {
    commit("Warp Text", [activeLayer.id])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : cancel())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Warp Text (metadata warp)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <Field label="Style">
            <Select value={warp.style} onValueChange={(v) => update({ style: v as WarpStyle })}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <SliderRow
            label="Bend"
            value={warp.bend}
            min={-1}
            max={1}
            step={0.01}
            disabled={warp.style === "none"}
            onChange={(v) => update({ bend: v })}
            display={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Horizontal Distortion"
            value={warp.horizontal}
            min={-1}
            max={1}
            step={0.01}
            disabled={warp.style === "none"}
            onChange={(v) => update({ horizontal: v })}
            display={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Vertical Distortion"
            value={warp.vertical}
            min={-1}
            max={1}
            step={0.01}
            disabled={warp.style === "none"}
            onChange={(v) => update({ vertical: v })}
            display={(v) => `${Math.round(v * 100)}%`}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  display,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (v: number) => void
  display?: (v: number) => string
}) {
  return (
    <div className="grid grid-cols-[120px_1fr_56px] items-center gap-3">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
      />
      <span className="text-[11px] tabular-nums text-right">
        {display ? display(value) : value.toFixed(2)}
      </span>
    </div>
  )
}
