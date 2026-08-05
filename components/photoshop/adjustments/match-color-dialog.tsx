"use client"

/**
 * Match Color — Destination/Statistics groups and the source picker.
 *
 * One of the adjustment dialogs split out of `adjustment-dialogs.tsx`. Each is
 * lazy-loaded on its own, so opening one no longer pulls in the other five.
 * Results dispatch through the normal reducer/commit path, landing in history
 * exactly like a manual filter run.
 */

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useEditor } from "@/components/photoshop/editor/context"
import { FILTERS } from "@/editor/filters"
import { toast } from "sonner"
import {
  activeRasterLayer,
  commitFilterResult,
  compositeDocument,
} from "@/editor/document/adjustment-helpers"
import { Group, SelectRow, SliderRow } from "@/components/photoshop/adjustments/adjustment-controls"
export function MatchColorDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, documents, commit } = useEditor()
  const [sourceDocId, setSourceDocId] = React.useState<string>("")
  const [sourceLayerId, setSourceLayerId] = React.useState<string>("")
  const [luminance, setLuminance] = React.useState(100)
  const [colorIntensity, setColorIntensity] = React.useState(100)
  const [fade, setFade] = React.useState(0)
  const [neutralize, setNeutralize] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setSourceDocId(activeDoc?.id ?? "")
      setSourceLayerId("")
      setLuminance(100)
      setColorIntensity(100)
      setFade(0)
      setNeutralize(false)
    }
  }, [open, activeDoc?.id])

  const sourceDoc = documents.find((d) => d.id === sourceDocId) ?? activeDoc

  const getSourceImageData = (): ImageData | null => {
    if (!sourceDoc) return null
    if (sourceLayerId) {
      const layer = sourceDoc.layers.find((l) => l.id === sourceLayerId)
      if (layer?.canvas) {
        const ctx = layer.canvas.getContext("2d")
        if (ctx) return ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
      }
      return null
    }
    const c = compositeDocument(sourceDoc)
    return c.getContext("2d")!.getImageData(0, 0, sourceDoc.width, sourceDoc.height)
  }

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
    const matchSource = getSourceImageData()
    const filter = FILTERS["match-color"]
    const result = filter.apply(
      src,
      { luminance, colorIntensity, fade, neutralize },
      { matchColorSource: matchSource },
    )
    commitFilterResult(activeDoc, layer, result, "Match Color", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Match Color</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Group title="Destination Image">
            <div className="text-[11px] text-[var(--ps-text-dim)]">
              {activeDoc ? `Target: ${activeDoc.name} (${activeDoc.width}×${activeDoc.height})` : "No active document"}
            </div>
          </Group>
          <Group title="Image Statistics">
            <SelectRow
              label="Source"
              value={sourceDocId}
              onChange={setSourceDocId}
              options={documents.map((d) => ({ value: d.id, label: d.name }))}
            />
            <SelectRow
              label="Layer"
              value={sourceLayerId}
              onChange={setSourceLayerId}
              options={[
                { value: "", label: "Merged composite" },
                ...((sourceDoc?.layers ?? []).map((l) => ({ value: l.id, label: l.name }))),
              ]}
            />
            <label className="flex items-center gap-2 text-[11px]">
              <Checkbox checked={neutralize} onCheckedChange={(v) => setNeutralize(v === true)} />
              Neutralize (remove a color cast)
            </label>
          </Group>
          <Group title="Image Options">
            <SliderRow label="Luminance" min={0} max={200} step={1} value={luminance} onChange={setLuminance} />
            <SliderRow label="Color Intensity" min={0} max={200} step={1} value={colorIntensity} onChange={setColorIntensity} />
            <SliderRow label="Fade" min={0} max={100} step={1} value={fade} onChange={setFade} />
          </Group>
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
/* 4. Replace Color                                                   */
/* ------------------------------------------------------------------ */
