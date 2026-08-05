"use client"

/**
 * Replace Color — eyedropper add/subtract sampling over a live preview.
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
import { Minus, Plus, XIcon } from "lucide-react"
import {
  activeRasterLayer,
  commitFilterResult,
  compositeDocument,
  hexToRgb,
  rgbToHex,
} from "@/editor/document/adjustment-helpers"
import { Group, SliderRow } from "@/components/photoshop/adjustments/adjustment-controls"
type Sample = { r: number; g: number; b: number }

export function ReplaceColorDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, commit } = useEditor()
  const previewRef = React.useRef<HTMLCanvasElement>(null)

  const [includeSamples, setIncludeSamples] = React.useState<Sample[]>([])
  const [excludeSamples, setExcludeSamples] = React.useState<Sample[]>([])
  const [pickMode, setPickMode] = React.useState<"add" | "subtract">("add")
  const [fuzziness, setFuzziness] = React.useState(40)
  const [localizedClusters, setLocalizedClusters] = React.useState(false)
  const [replacementHue, setReplacementHue] = React.useState(0)
  const [replacementSaturation, setReplacementSaturation] = React.useState(0)
  const [replacementLightness, setReplacementLightness] = React.useState(0)
  const [resultHex, setResultHex] = React.useState<string>("")

  // Rendered composite canvas (full-doc resolution) cached so we can both
  // draw the preview thumbnail and sample exact pixels.
  const composite = React.useMemo(() => (activeDoc ? compositeDocument(activeDoc) : null), [activeDoc])
  const activeDocId = activeDoc?.id

  React.useEffect(() => {
    if (!open || !activeDocId) return
    setIncludeSamples([])
    setExcludeSamples([])
    setFuzziness(40)
    setLocalizedClusters(false)
    setReplacementHue(0)
    setReplacementSaturation(0)
    setReplacementLightness(0)
    setResultHex("")
    setPickMode("add")
  }, [open, activeDocId])

  // Render preview with a colored overlay indicating the matched zone.
  React.useEffect(() => {
    if (!open || !activeDoc || !composite) return
    const cv = previewRef.current
    if (!cv) return
    const max = 280
    const ratio = Math.min(max / activeDoc.width, max / activeDoc.height, 1)
    cv.width = Math.max(1, Math.floor(activeDoc.width * ratio))
    cv.height = Math.max(1, Math.floor(activeDoc.height * ratio))
    const ctx = cv.getContext("2d")!
    ctx.drawImage(composite, 0, 0, cv.width, cv.height)
    // Sketch include samples as a halo on the preview so the user can see
    // what got picked.
    for (const s of includeSamples) {
      ctx.strokeStyle = rgbToHex(s.r, s.g, s.b)
      ctx.lineWidth = 1
      ctx.strokeRect(2, 2, cv.width - 4, cv.height - 4)
    }
  }, [open, activeDoc, composite, includeSamples, excludeSamples])

  const samplePreview = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeDoc || !composite) return
    const cv = previewRef.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * activeDoc.width
    const y = ((e.clientY - rect.top) / rect.height) * activeDoc.height
    const ctx = composite.getContext("2d")!
    const px = ctx.getImageData(
      Math.max(0, Math.min(activeDoc.width - 1, Math.floor(x))),
      Math.max(0, Math.min(activeDoc.height - 1, Math.floor(y))),
      1,
      1,
    ).data
    const sample: Sample = { r: px[0], g: px[1], b: px[2] }
    if (pickMode === "add") setIncludeSamples((arr) => [...arr, sample])
    else setExcludeSamples((arr) => [...arr, sample])
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
    const filter = FILTERS["replace-color"]
    const includeStr = includeSamples.map((s) => `${s.r},${s.g},${s.b}`).join(";")
    const excludeStr = excludeSamples.map((s) => `${s.r},${s.g},${s.b}`).join(";")
    const result = filter.apply(src, {
      includeSamples: includeStr,
      excludeSamples: excludeStr,
      fuzziness,
      localizedClusters,
      replacementHue,
      replacementSaturation,
      replacementLightness,
      resultColor: resultHex ? (() => { const c = hexToRgb(resultHex); return `${c.r},${c.g},${c.b}` })() : "",
    })
    commitFilterResult(activeDoc, layer, result, "Replace Color", commit)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)] sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Replace Color</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3">
            <Group title="Selection">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={pickMode === "add" ? "default" : "outline"} onClick={() => setPickMode("add")}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add Sample
                </Button>
                <Button size="sm" variant={pickMode === "subtract" ? "default" : "outline"} onClick={() => setPickMode("subtract")}>
                  <Minus className="size-3.5" aria-hidden="true" />
                  Subtract
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setIncludeSamples([]); setExcludeSamples([]) }}>
                  <XIcon className="size-3.5" aria-hidden="true" />
                  Clear
                </Button>
              </div>
              <div className="text-[11px] text-[var(--ps-text-dim)]">
                Includes: {includeSamples.length}, Excludes: {excludeSamples.length}
              </div>
              <SliderRow label="Fuzziness" min={0} max={200} step={1} value={fuzziness} onChange={setFuzziness} />
              <label className="flex items-center gap-2 text-[11px]">
                <Checkbox checked={localizedClusters} onCheckedChange={(v) => setLocalizedClusters(v === true)} />
                Localized Color Clusters
              </label>
            </Group>
            <Group title="Replacement">
              <SliderRow label="Hue" suffix="deg" min={0} max={360} step={1} value={replacementHue} onChange={setReplacementHue} />
              <SliderRow label="Saturation" min={-100} max={100} step={1} value={replacementSaturation} onChange={setReplacementSaturation} />
              <SliderRow label="Lightness" min={-100} max={100} step={1} value={replacementLightness} onChange={setReplacementLightness} />
              <label className="grid gap-1 text-[11px]">
                <span className="text-[var(--ps-text-dim)]">Result color (overrides HSL shift)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={resultHex || "#808080"}
                    onChange={(e) => setResultHex(e.target.value)}
                    className="h-7 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
                  />
                  <Button size="sm" variant="ghost" onClick={() => setResultHex("")}>Clear</Button>
                  <span className="text-[10px] font-mono text-[var(--ps-text-dim)]">{resultHex || "(none)"}</span>
                </div>
              </label>
            </Group>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="text-[11px] text-[var(--ps-text-dim)]">Selection preview — click to sample</div>
            <div className="inline-block max-w-full overflow-hidden border border-[var(--ps-divider)] bg-black p-1">
              <canvas ref={previewRef} onClick={samplePreview} className="block max-w-full cursor-crosshair" />
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px] text-[var(--ps-text-dim)]">
              <div>+ {includeSamples.length} include</div>
              <div>− {excludeSamples.length} exclude</div>
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
/* 5. Equalize prompt                                                 */
/* ------------------------------------------------------------------ */
