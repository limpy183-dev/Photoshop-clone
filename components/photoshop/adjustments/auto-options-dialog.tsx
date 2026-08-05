"use client"

/**
 * Auto Options — algorithm, Snap Neutral Midtones and clip percentages.
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
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "@/editor/client-storage"
import { AUTO_DEFAULTS, applyAutoAdjustment, type AutoAlgorithm, type AutoOptions } from "@/editor/filters"
import { toast } from "sonner"
import { activeRasterLayer, commitFilterResult } from "@/editor/document/adjustment-helpers"
import { ColorTargetRow, Group, SliderRow } from "@/components/photoshop/adjustments/adjustment-controls"
function loadAutoDefaults(): AutoOptions {
  const parsed = readClientStorageJson(CLIENT_STORAGE_KEYS.autoOptionsDefaults)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return AUTO_DEFAULTS
  return { ...AUTO_DEFAULTS, ...(parsed as Partial<AutoOptions>) }
}

function saveAutoDefaults(opts: AutoOptions) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.autoOptionsDefaults, opts)
}

export function AutoOptionsDialog({
  open,
  onOpenChange,
  initialAlgorithm,
  label,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Pre-select an algorithm to match the menu item used (Auto Tone / Auto Contrast / Auto Color). */
  initialAlgorithm?: AutoAlgorithm
  label?: string
}) {
  const { activeDoc, commit } = useEditor()
  const [opts, setOpts] = React.useState<AutoOptions>(AUTO_DEFAULTS)

  React.useEffect(() => {
    if (open) {
      const loaded = loadAutoDefaults()
      if (initialAlgorithm) loaded.algorithm = initialAlgorithm
      setOpts(loaded)
    }
  }, [open, initialAlgorithm])

  const set = <K extends keyof AutoOptions>(key: K, value: AutoOptions[K]) => setOpts((o) => ({ ...o, [key]: value }))

  const apply = (saveAsDefault = false) => {
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
    const result = applyAutoAdjustment(src, opts)
    commitFilterResult(activeDoc, layer, result, label ?? "Auto Adjust", commit)
    if (saveAsDefault) saveAutoDefaults(opts)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{label ?? "Auto"} Options</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Group title="Algorithms">
            <fieldset className="space-y-1.5 text-[12px]">
              {[
                { value: "monochromatic-contrast", label: "Enhance Monochromatic Contrast" },
                { value: "per-channel-contrast", label: "Enhance Per Channel Contrast" },
                { value: "dark-light-colors", label: "Find Dark & Light Colors" },
                { value: "brightness-contrast", label: "Enhance Brightness and Contrast" },
              ].map((alg) => (
                <label key={alg.value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="auto-alg"
                    checked={opts.algorithm === alg.value}
                    onChange={() => set("algorithm", alg.value as AutoAlgorithm)}
                  />
                  {alg.label}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox checked={opts.snapNeutralMidtones} onCheckedChange={(v) => set("snapNeutralMidtones", v === true)} />
              Snap Neutral Midtones
            </label>
          </Group>
          <Group title="Target Colors and Clipping">
            <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
              <ColorTargetRow label="Shadows" value={opts.shadowsTargetRgb} onChange={(v) => set("shadowsTargetRgb", v)} />
              <ColorTargetRow label="Midtones" value={opts.midtoneTargetRgb} onChange={(v) => set("midtoneTargetRgb", v)} />
              <ColorTargetRow label="Highlights" value={opts.highlightsTargetRgb} onChange={(v) => set("highlightsTargetRgb", v)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SliderRow label="Clip Shadows" suffix="%" min={0} max={50} step={0.01} value={opts.shadowsClipPct} onChange={(v) => set("shadowsClipPct", v)} />
              <SliderRow label="Clip Highlights" suffix="%" min={0} max={50} step={0.01} value={opts.highlightsClipPct} onChange={(v) => set("highlightsClipPct", v)} />
            </div>
          </Group>
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => apply(true)}>Save Defaults &amp; Apply</Button>
          <Button onClick={() => apply(false)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Reusable group + row primitives                                    */
/* ------------------------------------------------------------------ */
