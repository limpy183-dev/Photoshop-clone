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
import { useEditor } from "./editor-context"
import { compositeLayer } from "./blend-modes"
import { colorRangeMask, hexToRgb, makeCanvas, selectionFromMask } from "./tool-helpers"
import { Pipette } from "lucide-react"

export function ColorRangeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, dispatch, commit } = useEditor()
  const [tolerance, setTolerance] = React.useState(40)
  const [target, setTarget] = React.useState<{ r: number; g: number; b: number; hex: string }>({
    r: 128,
    g: 128,
    b: 128,
    hex: "#808080",
  })
  const previewRef = React.useRef<HTMLCanvasElement>(null)

  const buildComposite = React.useCallback(() => {
    if (!activeDoc) return null
    const c = makeCanvas(activeDoc.width, activeDoc.height)
    const ctx = c.getContext("2d")!
    ctx.fillStyle = activeDoc.background
    ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
    for (const l of activeDoc.layers) {
      if (!l.visible) continue
      compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
    }
    return c
  }, [activeDoc])

  // Render preview thumb
  React.useEffect(() => {
    if (!open || !activeDoc) return
    const composite = buildComposite()
    if (!composite) return
    const cv = previewRef.current
    if (!cv) return
    const max = 280
    const ratio = Math.min(max / activeDoc.width, max / activeDoc.height, 1)
    cv.width = Math.max(1, Math.floor(activeDoc.width * ratio))
    cv.height = Math.max(1, Math.floor(activeDoc.height * ratio))
    const ctx = cv.getContext("2d")!
    // Build mask at full size, scale down
    const fullCtx = composite.getContext("2d")!
    const img = fullCtx.getImageData(0, 0, composite.width, composite.height)
    const mask = colorRangeMask(img, target, tolerance)
    // Render: white on black where selected
    const scratch = makeCanvas(composite.width, composite.height)
    scratch.getContext("2d")!.putImageData(mask, 0, 0)
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, cv.width, cv.height)
    // Replace alpha with white pixels
    const tinted = makeCanvas(composite.width, composite.height)
    const tctx = tinted.getContext("2d")!
    tctx.fillStyle = "#fff"
    tctx.fillRect(0, 0, composite.width, composite.height)
    tctx.globalCompositeOperation = "destination-in"
    tctx.drawImage(scratch, 0, 0)
    ctx.drawImage(tinted, 0, 0, cv.width, cv.height)
  }, [open, activeDoc, target, tolerance, buildComposite])

  const setSampleFromComposite = (x: number, y: number) => {
    if (!activeDoc) return
    const composite = buildComposite()
    if (!composite) return
    const ctx = composite.getContext("2d")!
    const px = ctx.getImageData(
      Math.max(0, Math.min(activeDoc.width - 1, Math.floor(x))),
      Math.max(0, Math.min(activeDoc.height - 1, Math.floor(y))),
      1,
      1,
    ).data
    setTarget({
      r: px[0],
      g: px[1],
      b: px[2],
      hex: "#" + [px[0], px[1], px[2]].map((c) => c.toString(16).padStart(2, "0")).join(""),
    })
  }

  const sample = () => {
    if (!activeDoc) return
    setSampleFromComposite(activeDoc.width / 2, activeDoc.height / 2)
  }

  const samplePreview = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeDoc) return
    const cv = previewRef.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * activeDoc.width
    const y = ((e.clientY - rect.top) / rect.height) * activeDoc.height
    setSampleFromComposite(x, y)
  }

  const apply = () => {
    if (!activeDoc) return
    const composite = buildComposite()
    if (!composite) return
    const ctx = composite.getContext("2d")!
    const img = ctx.getImageData(0, 0, composite.width, composite.height)
    const mask = colorRangeMask(img, target, tolerance)
    const m = makeCanvas(composite.width, composite.height)
    m.getContext("2d")!.putImageData(mask, 0, 0)
    dispatch({ type: "set-selection", selection: selectionFromMask(m, "color") })
    commit("Color Range", [])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Color Range</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_300px] gap-4">
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Sampled color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={target.hex}
                  onChange={(e) => {
                    const c = hexToRgb(e.target.value)
                    setTarget({ ...c, hex: e.target.value })
                  }}
                  className="h-8 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
                />
                <span className="text-[11px] tabular-nums font-mono">{target.hex}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={sample}
                  className="ml-auto h-7 text-[11px]"
                >
                  <Pipette className="w-3 h-3 mr-1" /> Sample center
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Fuzziness ({tolerance})</Label>
              <input
                type="range"
                min={0}
                max={200}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
            </div>
            <p className="text-[11px] text-[var(--ps-text-dim)]">
              Selects composite RGB pixels that match the sampled color within the
              fuzziness range; layer/channel targeting is not applied here.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[11px] text-[var(--ps-text-dim)]">Selection preview</div>
            <div className="border border-[var(--ps-divider)] bg-black p-1 inline-block">
              <canvas ref={previewRef} onClick={samplePreview} className="block cursor-crosshair" />
            </div>
          </div>
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
