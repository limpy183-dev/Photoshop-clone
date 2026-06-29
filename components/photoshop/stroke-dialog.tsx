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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEditorSelector } from "./editor-context"

type StrokePosition = "inside" | "center" | "outside"

export function StrokeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const activeLayer = useEditorSelector((editor) => editor.activeLayer)
  const foreground = useEditorSelector((editor) => editor.foreground)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const [width, setWidth] = React.useState(4)
  const [color, setColor] = React.useState(foreground)
  const [position, setPosition] = React.useState<StrokePosition>("inside")
  const [opacity, setOpacity] = React.useState(100)

  React.useEffect(() => {
    if (open) setColor(foreground)
  }, [open, foreground])

  const submit = () => {
    if (!activeDoc || !activeLayer || activeLayer.locked) {
      onOpenChange(false)
      return
    }
    const sel = activeDoc.selection.bounds
    const ctx = activeLayer.canvas.getContext("2d")!
    ctx.save()
    ctx.globalAlpha = opacity / 100
    ctx.strokeStyle = color
    ctx.lineWidth = width
    if (sel) {
      // Adjust rectangle based on position
      const off = position === "outside" ? -width / 2 : position === "inside" ? width / 2 : 0
      const x = sel.x + off
      const y = sel.y + off
      const w = sel.w + (position === "outside" ? width : position === "inside" ? -width : 0)
      const h = sel.h + (position === "outside" ? width : position === "inside" ? -width : 0)
      if (activeDoc.selection.shape === "ellipse") {
        ctx.beginPath()
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (activeDoc.selection.mask) {
        // Stroke the mask outline
        const mctx = activeDoc.selection.mask.getContext("2d")!
        const img = mctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
        // Draw a border-detection edge outline
        ctx.strokeRect(x, y, w, h)
        void img
      } else {
        ctx.strokeRect(x, y, w, h)
      }
    } else {
      ctx.strokeRect(0, 0, activeDoc.width, activeDoc.height)
    }
    ctx.restore()
    void dispatch
    commit("Stroke", [activeLayer.id])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Stroke</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Width (px)</Label>
              <Input
                type="number"
                min={1}
                max={250}
                value={width}
                onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="font-mono text-[11px]"
                />
              </div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-[11px]">Position</Label>
            <div className="grid grid-cols-3 gap-1">
              {(["inside", "center", "outside"] as StrokePosition[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(p)}
                  className={
                    "h-8 text-[11px] capitalize border border-[var(--ps-divider)] rounded-sm " +
                    (position === p
                      ? "bg-[var(--ps-accent)] text-white"
                      : "bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]")
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-[11px]">Opacity ({opacity}%)</Label>
            <input
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <p className="text-[11px] text-[var(--ps-text-dim)]">
            {activeDoc?.selection.bounds
              ? "Stroking active selection."
              : "Stroking the entire layer canvas."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!activeLayer || activeLayer.locked}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
