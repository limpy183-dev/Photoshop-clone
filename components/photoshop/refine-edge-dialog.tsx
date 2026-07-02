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
import { Label } from "@/components/ui/label"
import { useEditorSelector } from "./editor-context"
import { featherMask, selectionFromMask, selectionToMaskCanvas, smoothSelectionMask } from "./tool-helpers"

export function RefineEdgeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const [feather, setFeather] = React.useState(0)
  const [smooth, setSmooth] = React.useState(0)
  const [contrast, setContrast] = React.useState(0)

  const apply = () => {
    if (!activeDoc) return
    const sel = activeDoc.selection
    if (!sel.bounds) {
      onOpenChange(false)
      return
    }
    let mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, sel)
    if (!mask) {
      onOpenChange(false)
      return
    }
    if (smooth > 0) mask = smoothSelectionMask(mask, smooth)
    if (feather > 0) mask = featherMask(mask, feather)
    // Contrast: threshold-shift the alpha
    if (contrast !== 0) {
      const ctx = mask.getContext("2d")!
      const img = ctx.getImageData(0, 0, mask.width, mask.height)
      const c = (contrast + 100) / 100
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (img.data[i + 3] - 128) * c + 128
        img.data[i + 3] = Math.max(0, Math.min(255, v))
      }
      ctx.putImageData(img, 0, 0)
    }
    dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand", feather) })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Refine Edge</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Slider label={`Feather (${feather}px)`} value={feather} onChange={setFeather} max={50} />
          <Slider label={`Smooth (${smooth}px)`} value={smooth} onChange={setSmooth} max={20} />
          <Slider
            label={`Contrast (${contrast})`}
            value={contrast}
            onChange={setContrast}
            min={-100}
            max={100}
          />
          <p className="text-[11px] text-[var(--ps-text-dim)]">
            Mask-based smoothing and feathering soften selection edges. Contrast tightens the alpha cutoff.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px]">{label}</Label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}
