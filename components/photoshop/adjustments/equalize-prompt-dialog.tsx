"use client"

/**
 * Equalize prompt — selection-only versus whole-image.
 *
 * One of the adjustment dialogs split out of `adjustment-dialogs.tsx`. Each is
 * lazy-loaded on its own, so opening one no longer pulls in the other five.
 * Results dispatch through the normal reducer/commit path, landing in history
 * exactly like a manual filter run.
 */

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEditor, makeCanvas } from "@/components/photoshop/editor/context"
import { FILTERS } from "@/editor/filters"
import { toast } from "sonner"
import { activeRasterLayer, commitFilterResult } from "@/editor/document/adjustment-helpers"
export function EqualizePromptDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const [mode, setMode] = React.useState<"image" | "selection-only" | "selection-source">("selection-only")

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
    // Build the selection mask in layer-pixel coordinates (matches filter
    // expectations: 0 / 255 byte array of length width*height).
    let selectionMask: Uint8Array | null = null
    const sel = activeDoc.selection
    if ((mode === "selection-only" || mode === "selection-source") && (sel.mask || sel.bounds)) {
      try {
        const c = makeCanvas(layer.canvas.width, layer.canvas.height)
        const cctx = c.getContext("2d")!
        if (sel.mask) cctx.drawImage(sel.mask, 0, 0)
        else if (sel.bounds) {
          cctx.fillStyle = "#fff"
          if (sel.shape === "ellipse") {
            cctx.beginPath()
            cctx.ellipse(sel.bounds.x + sel.bounds.w / 2, sel.bounds.y + sel.bounds.h / 2, sel.bounds.w / 2, sel.bounds.h / 2, 0, 0, Math.PI * 2)
            cctx.fill()
          } else {
            cctx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
          }
        }
        const data = cctx.getImageData(0, 0, c.width, c.height)
        selectionMask = new Uint8Array(c.width * c.height)
        for (let i = 0; i < selectionMask.length; i++) selectionMask[i] = data.data[i * 4 + 3] > 8 ? 255 : 0
      } catch {
        selectionMask = null
      }
    }
    const filter = FILTERS["equalize"]
    const result = filter.apply(src, { mode }, { selectionMask, selectionMode: mode })
    commitFilterResult(activeDoc, layer, result, "Equalize", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Equalize</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[12px]">
          <p className="text-[var(--ps-text-dim)]">An active selection was detected. How should equalize behave?</p>
          <fieldset className="space-y-1.5">
            <label className="flex items-start gap-2">
              <input type="radio" name="equalize-mode" checked={mode === "selection-only"} onChange={() => setMode("selection-only")} />
              <span>
                <span className="font-medium">Equalize selected area only</span>
                <span className="block text-[11px] text-[var(--ps-text-dim)]">Apply CDF to selection pixels in isolation.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="equalize-mode" checked={mode === "selection-source"} onChange={() => setMode("selection-source")} />
              <span>
                <span className="font-medium">Equalize entire image based on selected area</span>
                <span className="block text-[11px] text-[var(--ps-text-dim)]">Build the CDF from selected pixels, apply to everything.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="equalize-mode" checked={mode === "image"} onChange={() => setMode("image")} />
              <span>
                <span className="font-medium">Equalize entire image</span>
                <span className="block text-[11px] text-[var(--ps-text-dim)]">Ignore the selection.</span>
              </span>
            </label>
          </fieldset>
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
/* 6. Auto Options                                                    */
/* ------------------------------------------------------------------ */
