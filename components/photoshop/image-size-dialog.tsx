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
import { Link2, Link2Off } from "lucide-react"
import { useEditor } from "./editor-context"
import { MAX_CANVAS_DIMENSION, canvasSizeError } from "./canvas-limits"

export function ImageSizeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, resizeDocument } = useEditor()
  const [width, setWidth] = React.useState(activeDoc?.width ?? 1200)
  const [height, setHeight] = React.useState(activeDoc?.height ?? 800)
  const [linked, setLinked] = React.useState(true)
  const [resample, setResample] = React.useState<"nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper">("bicubic")

  React.useEffect(() => {
    if (open && activeDoc) {
      setWidth(activeDoc.width)
      setHeight(activeDoc.height)
    }
  }, [open, activeDoc])

  const aspect = activeDoc ? activeDoc.width / activeDoc.height : 1
  const sizeError = canvasSizeError(width, height, "Image")

  const setW = (v: number) => {
    const next = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, v))
    setWidth(next)
    if (linked) setHeight(Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Math.round(next / aspect))))
  }
  const setH = (v: number) => {
    const next = Math.max(1, Math.min(MAX_CANVAS_DIMENSION, v))
    setHeight(next)
    if (linked) setWidth(Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Math.round(next * aspect))))
  }

  const submit = () => {
    if (!activeDoc) return
    if (sizeError) return
    resizeDocument(width, height, resample)
    onOpenChange(false)
  }

  if (!activeDoc) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Image Size</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="text-[11px] text-[var(--ps-text-dim)]">
            Image size:{" "}
            <span className="text-[var(--ps-text)] font-medium">
              {((width * height * 4) / 1024 / 1024).toFixed(2)} MB
            </span>
            {" — "}
            was{" "}
            <span className="text-[var(--ps-text)] font-medium">
              {((activeDoc.width * activeDoc.height * 4) / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
          <div className="grid grid-cols-[1fr_24px_1fr] items-end gap-2">
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Width</Label>
              <Input
                type="number"
                value={width}
                min={1}
                max={MAX_CANVAS_DIMENSION}
                onChange={(e) => setW(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <button
              type="button"
              aria-label={linked ? "Unlink dimensions" : "Link dimensions"}
              onClick={() => setLinked(!linked)}
              className="h-9 w-9 mx-auto flex items-center justify-center text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
            >
              {linked ? <Link2 className="w-4 h-4" /> : <Link2Off className="w-4 h-4" />}
            </button>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Height</Label>
              <Input
                type="number"
                value={height}
                min={1}
                max={MAX_CANVAS_DIMENSION}
                onChange={(e) => setH(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>
          {sizeError && (
            <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
              {sizeError}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label className="text-[11px]">Resample</Label>
            <select
              value={resample}
              onChange={(e) => setResample(e.target.value as typeof resample)}
              className="h-8 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-2 text-[11px]"
            >
              <option value="bicubic">Bicubic (smooth gradients)</option>
              <option value="bicubic-smoother">Bicubic Smoother (enlargement)</option>
              <option value="bicubic-sharper">Bicubic Sharper (reduction)</option>
              <option value="bilinear">Bilinear</option>
              <option value="nearest">Nearest Neighbor (hard edges)</option>
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
