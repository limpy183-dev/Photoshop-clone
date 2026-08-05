"use client"

/**
 * Shadows/Highlights — grouped controls plus \"Save As Defaults\" persistence.
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
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "@/editor/client-storage"
import { FILTERS } from "@/editor/filters"
import { toast } from "sonner"
import { RotateCcw, Save } from "lucide-react"
import { activeRasterLayer, commitFilterResult } from "@/editor/document/adjustment-helpers"
import { Group, SliderRow } from "@/components/photoshop/adjustments/adjustment-controls"
/* ------------------------------------------------------------------ */
/* 1. Shadows / Highlights                                            */
/* ------------------------------------------------------------------ */

interface ShadowsHighlightsState {
  shadowsAmount: number
  shadowsTonalWidth: number
  shadowsRadius: number
  highlightsAmount: number
  highlightsTonalWidth: number
  highlightsRadius: number
  colorCorrection: number
  midtoneContrast: number
  blackClip: number
  whiteClip: number
}

const SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS: ShadowsHighlightsState = {
  shadowsAmount: 35,
  shadowsTonalWidth: 50,
  shadowsRadius: 30,
  highlightsAmount: 0,
  highlightsTonalWidth: 50,
  highlightsRadius: 30,
  colorCorrection: 20,
  midtoneContrast: 0,
  blackClip: 0.01,
  whiteClip: 0.01,
}

function loadShadowsHighlightsDefaults(): ShadowsHighlightsState {
  const parsed = readClientStorageJson(CLIENT_STORAGE_KEYS.shadowsHighlightsDefaults)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS
  return { ...SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS, ...(parsed as Partial<ShadowsHighlightsState>) }
}

function saveShadowsHighlightsDefaults(state: ShadowsHighlightsState) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.shadowsHighlightsDefaults, state)
}

export function ShadowsHighlightsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const [state, setState] = React.useState<ShadowsHighlightsState>(SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS)
  const [showMore, setShowMore] = React.useState(true)

  React.useEffect(() => {
    if (open) setState(loadShadowsHighlightsDefaults())
  }, [open])

  const setK = <K extends keyof ShadowsHighlightsState>(key: K, value: ShadowsHighlightsState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  const apply = () => {
    if (!activeDoc) {
      onOpenChange(false)
      return
    }
    const layer = activeRasterLayer(activeDoc)
    if (!layer) {
      toast.info("Select a pixel layer first.")
      onOpenChange(false)
      return
    }
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    const src = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const filter = FILTERS["shadows-highlights"]
    const result = filter.apply(src, state as unknown as Record<string, number | string | boolean>)
    commitFilterResult(activeDoc, layer, result, "Shadows/Highlights", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Shadows/Highlights</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Group title="Shadows">
            <SliderRow label="Amount" suffix="%" min={0} max={100} step={1} value={state.shadowsAmount} onChange={(v) => setK("shadowsAmount", v)} />
            {showMore ? (
              <>
                <SliderRow label="Tonal Width" suffix="%" min={1} max={100} step={1} value={state.shadowsTonalWidth} onChange={(v) => setK("shadowsTonalWidth", v)} />
                <SliderRow label="Radius" suffix="px" min={0} max={250} step={1} value={state.shadowsRadius} onChange={(v) => setK("shadowsRadius", v)} />
              </>
            ) : null}
          </Group>
          <Group title="Highlights">
            <SliderRow label="Amount" suffix="%" min={0} max={100} step={1} value={state.highlightsAmount} onChange={(v) => setK("highlightsAmount", v)} />
            {showMore ? (
              <>
                <SliderRow label="Tonal Width" suffix="%" min={1} max={100} step={1} value={state.highlightsTonalWidth} onChange={(v) => setK("highlightsTonalWidth", v)} />
                <SliderRow label="Radius" suffix="px" min={0} max={250} step={1} value={state.highlightsRadius} onChange={(v) => setK("highlightsRadius", v)} />
              </>
            ) : null}
          </Group>
          {showMore ? (
            <Group title="Adjustments">
              <SliderRow label="Color Correction" min={-100} max={100} step={1} value={state.colorCorrection} onChange={(v) => setK("colorCorrection", v)} />
              <SliderRow label="Midtone Contrast" min={-100} max={100} step={1} value={state.midtoneContrast} onChange={(v) => setK("midtoneContrast", v)} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SliderRow label="Black Clip" suffix="%" min={0} max={50} step={0.01} value={state.blackClip} onChange={(v) => setK("blackClip", v)} />
                <SliderRow label="White Clip" suffix="%" min={0} max={50} step={0.01} value={state.whiteClip} onChange={(v) => setK("whiteClip", v)} />
              </div>
            </Group>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2 text-[11px]">
            <Button variant="outline" size="sm" onClick={() => setShowMore((v) => !v)}>
              {showMore ? "Hide Options" : "Show More Options"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setState(SHADOWS_HIGHLIGHTS_FACTORY_DEFAULTS)}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reset
              </Button>
              <Button variant="outline" size="sm" onClick={() => { saveShadowsHighlightsDefaults(state); toast.success("Defaults saved.") }}>
                <Save className="size-3.5" aria-hidden="true" />
                Save As Defaults
              </Button>
            </div>
          </div>
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
/* 2. HDR Toning                                                      */
/* ------------------------------------------------------------------ */
