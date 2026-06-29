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
import { cn } from "@/lib/utils"
import { MAX_CANVAS_DIMENSION, canvasSizeError } from "./canvas-limits"

const ANCHOR_POSITIONS: Array<[number, number, string]> = [
  [0, 0, "top-left"],
  [0.5, 0, "top"],
  [1, 0, "top-right"],
  [0, 0.5, "left"],
  [0.5, 0.5, "center"],
  [1, 0.5, "right"],
  [0, 1, "bottom-left"],
  [0.5, 1, "bottom"],
  [1, 1, "bottom-right"],
]

export function CanvasSizeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const resizeCanvas = useEditorSelector((editor) => editor.resizeCanvas)
  const [width, setWidth] = React.useState(activeDoc?.width ?? 1200)
  const [height, setHeight] = React.useState(activeDoc?.height ?? 800)
  const [anchorX, setAnchorX] = React.useState(0.5)
  const [anchorY, setAnchorY] = React.useState(0.5)
  const [fill, setFill] = React.useState("white")
  const sizeError = canvasSizeError(width, height, "Canvas")

  React.useEffect(() => {
    if (open && activeDoc) {
      setWidth(activeDoc.width)
      setHeight(activeDoc.height)
    }
  }, [open, activeDoc])

  const submit = () => {
    if (!activeDoc) return
    if (sizeError) return
    const fillStyle = fill === "white" ? "#ffffff" : fill === "black" ? "#000000" : "transparent"
    resizeCanvas(width, height, anchorX, anchorY, fillStyle)
    onOpenChange(false)
  }

  if (!activeDoc) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Canvas Size</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="text-[11px] text-[var(--ps-text-dim)]">
            Current size: {activeDoc.width} × {activeDoc.height} px
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Width (px)</Label>
              <Input
                type="number"
                value={width}
                min={1}
                max={MAX_CANVAS_DIMENSION}
                onChange={(e) => setWidth(Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Height (px)</Label>
              <Input
                type="number"
                value={height}
                min={1}
                max={MAX_CANVAS_DIMENSION}
                onChange={(e) => setHeight(Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Number(e.target.value) || 1)))}
              />
            </div>
          </div>
          {sizeError && (
            <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
              {sizeError}
            </div>
          )}
          <div>
            <Label className="text-[11px] mb-1.5 block">Anchor</Label>
            <div className="grid grid-cols-3 gap-1 w-[108px]">
              {ANCHOR_POSITIONS.map(([ax, ay, key]) => {
                const selected = ax === anchorX && ay === anchorY
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    onClick={() => {
                      setAnchorX(ax)
                      setAnchorY(ay)
                    }}
                    className={cn(
                      "w-8 h-8 border border-[var(--ps-divider)] rounded-sm flex items-center justify-center",
                      selected
                        ? "bg-[var(--ps-accent)] text-white"
                        : "bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]",
                    )}
                  >
                    <span className="block w-2 h-2 rounded-full bg-current" />
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-[11px]">Canvas extension color</Label>
            <select
              value={fill}
              onChange={(e) => setFill(e.target.value)}
              className="h-8 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-2 text-[11px]"
            >
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="transparent">Transparent</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!!sizeError}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
