"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEditor } from "./editor-context"
import { applyCameraRawImageData, CAMERA_RAW_PRESETS, createCameraRawSnapshot, DEFAULT_CAMERA_RAW_SETTINGS, type CameraRawSettings } from "./camera-raw-engine"

const DEFAULTS: CameraRawSettings = DEFAULT_CAMERA_RAW_SETTINGS
type BasicCameraRawKey = keyof Pick<CameraRawSettings, "temperature" | "tint" | "exposure" | "contrast" | "highlights" | "shadows" | "whites" | "blacks" | "clarity" | "dehaze" | "vibrance" | "saturation">

const CONTROL_GROUPS: { title: string; keys: BasicCameraRawKey[] }[] = [
  { title: "White Balance", keys: ["temperature", "tint"] },
  { title: "Tone", keys: ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"] },
  { title: "Presence", keys: ["clarity", "dehaze", "vibrance", "saturation"] },
]

const LABELS: Record<BasicCameraRawKey, string> = {
  temperature: "Temp",
  tint: "Tint",
  exposure: "Exposure",
  contrast: "Contrast",
  highlights: "Highlights",
  shadows: "Shadows",
  whites: "Whites",
  blacks: "Blacks",
  clarity: "Clarity",
  dehaze: "Dehaze",
  vibrance: "Vibrance",
  saturation: "Saturation",
}

function applyCameraRaw(src: ImageData, settings: CameraRawSettings) {
  return applyCameraRawImageData(src, settings)
}

export function CameraRawDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { activeLayer, commit, requestRender } = useEditor()
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const [settings, setSettings] = React.useState<CameraRawSettings>(DEFAULTS)
  const [snapshotName, setSnapshotName] = React.useState("Snapshot 1")
  const [snapshots, setSnapshots] = React.useState<ReturnType<typeof createCameraRawSnapshot>[]>([])

  const updatePreview = React.useCallback(() => {
    if (!activeLayer || !previewRef.current) return
    const sourceCtx = activeLayer.canvas.getContext("2d")
    if (!sourceCtx) return
    const processed = applyCameraRaw(
      sourceCtx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height),
      settings,
    )
    const preview = previewRef.current
    const maxW = 420
    const maxH = 360
    const scale = Math.min(maxW / processed.width, maxH / processed.height, 1)
    preview.width = Math.max(1, Math.round(processed.width * scale))
    preview.height = Math.max(1, Math.round(processed.height * scale))
    const tmp = document.createElement("canvas")
    tmp.width = processed.width
    tmp.height = processed.height
    tmp.getContext("2d")!.putImageData(processed, 0, 0)
    const pctx = preview.getContext("2d")!
    pctx.clearRect(0, 0, preview.width, preview.height)
    pctx.imageSmoothingEnabled = true
    pctx.imageSmoothingQuality = "high"
    pctx.drawImage(tmp, 0, 0, preview.width, preview.height)
  }, [activeLayer, settings])

  React.useEffect(() => {
    if (open) updatePreview()
  }, [open, updatePreview])

  const apply = () => {
    if (!activeLayer) return
    const ctx = activeLayer.canvas.getContext("2d")
    if (!ctx) return
    const next = applyCameraRaw(ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height), settings)
    ctx.putImageData(next, 0, 0)
    requestRender()
    commit("Camera Raw Filter", [activeLayer.id])
    onOpenChange(false)
  }

  if (!activeLayer) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[920px] border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)]">
        <DialogHeader className="border-b border-[var(--ps-divider)] px-4 py-2">
          <DialogTitle className="text-sm">Camera Raw Filter (8-bit RGB)</DialogTitle>
          <DialogDescription className="sr-only">
            Adjust rendered layer pixels with camera-raw-style controls; this is not a RAW demosaic or high-bit pipeline.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_280px] min-h-[520px]">
          <div className="flex items-center justify-center overflow-hidden bg-[#1b1b1b] p-4">
            <div className="ps-checker overflow-hidden rounded-sm border border-[var(--ps-divider)]">
              <canvas ref={previewRef} className="block max-h-[460px] max-w-full" />
            </div>
          </div>
          <div className="space-y-3 overflow-y-auto border-l border-[var(--ps-divider)] p-3 text-[11px]">
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 leading-5 text-[var(--ps-text-dim)]">
              Rendered layer pixels only. Local HSL, optics, calibration, snapshots, and presets are implemented; RAW demosaic and native camera profiles still require a dedicated RAW engine.
            </div>
            <div className="grid grid-cols-3 gap-1">
              {Object.values(CAMERA_RAW_PRESETS).map((preset) => (
                <Button key={preset.id} type="button" variant="secondary" size="sm" onClick={() => setSettings(preset.settings)}>
                  {preset.name}
                </Button>
              ))}
            </div>
            {CONTROL_GROUPS.map((group) => (
              <div key={group.title} className="rounded-sm border border-[var(--ps-divider)]">
                <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
                  {group.title}
                </div>
                <div className="space-y-2 p-2">
                  {group.keys.map((key) => (
                    <label key={key} className="grid grid-cols-[74px_1fr_48px] items-center gap-2">
                      <span className="text-[var(--ps-text-dim)]">{LABELS[key]}</span>
                      <input
                        type="range"
                        min={key === "exposure" ? -5 : -100}
                        max={key === "exposure" ? 5 : 100}
                        step={key === "exposure" ? 0.1 : 1}
                        value={settings[key]}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, [key]: Number(event.target.value) }))
                        }
                      />
                      <input
                        type="number"
                        min={key === "exposure" ? -5 : -100}
                        max={key === "exposure" ? 5 : 100}
                        step={key === "exposure" ? 0.1 : 1}
                        value={settings[key]}
                        onChange={(event) =>
                          setSettings((current) => ({ ...current, [key]: Number(event.target.value) }))
                        }
                        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-right"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="rounded-sm border border-[var(--ps-divider)]">
              <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
                Optics
              </div>
              <div className="space-y-2 p-2">
                <NestedSlider label="Distortion" value={settings.optics?.distortion ?? 0} onChange={(value) => setSettings((current) => ({ ...current, optics: { ...(current.optics ?? {}), distortion: value } }))} />
                <NestedSlider label="Vignette" value={settings.optics?.vignette ?? 0} onChange={(value) => setSettings((current) => ({ ...current, optics: { ...(current.optics ?? {}), vignette: value } }))} />
                <NestedSlider label="Chromatic" value={settings.optics?.chromaticAberration ?? 0} onChange={(value) => setSettings((current) => ({ ...current, optics: { ...(current.optics ?? {}), chromaticAberration: value } }))} />
              </div>
            </div>
            <div className="rounded-sm border border-[var(--ps-divider)]">
              <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
                Snapshots
              </div>
              <div className="space-y-2 p-2">
                <input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2" />
                <Button type="button" variant="secondary" size="sm" className="w-full" onClick={() => setSnapshots((current) => [createCameraRawSnapshot(snapshotName || `Snapshot ${current.length + 1}`, settings), ...current])}>
                  Save Snapshot
                </Button>
                {snapshots.slice(0, 4).map((snapshot) => (
                  <button key={snapshot.id} type="button" className="block w-full truncate rounded-sm px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]" onClick={() => setSettings(snapshot.settings)}>
                    {snapshot.name}
                  </button>
                ))}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setSettings(DEFAULTS)}>
              Reset
            </Button>
          </div>
        </div>
        <DialogFooter className="border-t border-[var(--ps-divider)] px-4 py-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NestedSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[74px_1fr_48px] items-center gap-2">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input type="range" min={-100} max={100} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <input
        type="number"
        min={-100}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-right"
      />
    </label>
  )
}
