"use client"

/**
 * Device Preview tab — renders the document against common device presets.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import { downloadCanvas } from "@/components/photoshop/advanced/subsystems-dialog-helpers"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { EmptyState, Panel, SelectField } from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { useEditor } from "@/components/photoshop/editor/context"
import { renderDocumentComposite } from "@/editor/document/io"
type DevicePreset = {
  id: string
  name: string
  width: number
  height: number
  background: string
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: "phone", name: "Phone 390 x 844", width: 390, height: 844, background: "#0f172a" },
  { id: "tablet", name: "Tablet 820 x 1180", width: 820, height: 1180, background: "#111827" },
  { id: "desktop", name: "Desktop 1440 x 900", width: 1440, height: 900, background: "#171717" },
  { id: "social", name: "Social Square 1080", width: 1080, height: 1080, background: "#1f2937" },
]

export function DevicePreviewWorkspace() {
  const { activeDoc } = useEditor()
  const [presetId, setPresetId] = React.useState(DEVICE_PRESETS[0].id)
  const [mode, setMode] = React.useState<"contain" | "cover" | "actual">("contain")
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const preset = DEVICE_PRESETS.find((item) => item.id === presetId) ?? DEVICE_PRESETS[0]

  React.useEffect(() => {
    const canvas = previewRef.current
    if (!canvas || !activeDoc) return
    canvas.width = preset.width
    canvas.height = preset.height
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = preset.background
    ctx.fillRect(0, 0, preset.width, preset.height)
    const flat = renderDocumentComposite(activeDoc, { transparent: true })
    const ratio =
      mode === "actual"
        ? 1
        : mode === "cover"
          ? Math.max(preset.width / activeDoc.width, preset.height / activeDoc.height)
          : Math.min(preset.width / activeDoc.width, preset.height / activeDoc.height)
    const dw = activeDoc.width * ratio
    const dh = activeDoc.height * ratio
    const dx = (preset.width - dw) / 2
    const dy = (preset.height - dh) / 2
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(flat, dx, dy, dw, dh)
    ctx.strokeStyle = "rgba(255,255,255,0.28)"
    ctx.lineWidth = Math.max(2, Math.round(Math.min(preset.width, preset.height) / 280))
    ctx.strokeRect(0, 0, preset.width, preset.height)
  }, [activeDoc, preset, mode])

  if (!activeDoc) return <EmptyState text="Open a document before using device preview." />

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="max-h-[640px] overflow-auto rounded-sm border border-[var(--ps-divider)] bg-[#202020] p-4">
        <canvas ref={previewRef} className="mx-auto block h-auto max-h-[600px] max-w-full rounded-[18px] shadow-2xl" />
      </div>
      <Panel title="Device Preview">
        <SelectField label="Device" value={presetId} options={DEVICE_PRESETS.map((item) => item.id)} onChange={setPresetId} />
        <SelectField label="Fit" value={mode} options={["contain", "cover", "actual"]} onChange={(value) => setMode(value as typeof mode)} />
        <div className="rounded-sm border border-[var(--ps-divider)] p-2 text-[11px] text-[var(--ps-text-dim)]">
          {preset.name} - document {activeDoc.width} x {activeDoc.height}
        </div>
        <Button size="sm" onClick={() => previewRef.current && downloadCanvas(previewRef.current, `${activeDoc.name}-${preset.id}-preview.png`)}>
          Export Preview PNG
        </Button>
      </Panel>
    </div>
  )
}
