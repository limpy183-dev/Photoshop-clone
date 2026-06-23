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
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "./client-storage"
import { useEditor } from "./editor-context"
import {
  CAMERA_RAW_LENS_PROFILES,
  applyCameraRawImageData,
  applyCameraRawPreset,
  createCameraRawPreset,
  createCameraRawSnapshot,
  DEFAULT_CAMERA_RAW_SETTINGS,
  deleteCameraRawSnapshot,
  duplicateCameraRawSnapshot,
  normalizeCameraRawPresetLibrary,
  promoteCameraRawSnapshotToPreset,
  renameCameraRawSnapshot,
  type CameraRawPreset,
  type CameraRawSettings,
  type CameraRawSnapshot,
} from "./camera-raw-engine"

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

function readStoredPresets() {
  return readClientStorageJson(CLIENT_STORAGE_KEYS.cameraRawUserPresets).slice(0, 80) as CameraRawPreset[]
}

function readStoredSnapshots() {
  return readClientStorageJson(CLIENT_STORAGE_KEYS.cameraRawSnapshots).slice(0, 80) as CameraRawSnapshot[]
}

function storePresets(presets: CameraRawPreset[]) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.cameraRawUserPresets, presets.slice(0, 80))
}

function storeSnapshots(snapshots: CameraRawSnapshot[]) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.cameraRawSnapshots, snapshots.slice(0, 80))
}

export function CameraRawDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { activeLayer, commit, requestRender } = useEditor()
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const [settings, setSettings] = React.useState<CameraRawSettings>(DEFAULTS)
  const [snapshotName, setSnapshotName] = React.useState("Snapshot 1")
  const [presetName, setPresetName] = React.useState("Custom preset")
  const [userPresets, setUserPresets] = React.useState<CameraRawPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = React.useState("neutral")
  const [snapshots, setSnapshots] = React.useState<CameraRawSnapshot[]>([])
  const presetLibrary = React.useMemo(() => normalizeCameraRawPresetLibrary(userPresets), [userPresets])
  const allPresets = React.useMemo(() => [...presetLibrary.builtIn, ...presetLibrary.user], [presetLibrary])

  React.useEffect(() => {
    if (!open) return
    setUserPresets(normalizeCameraRawPresetLibrary(readStoredPresets()).user)
    setSnapshots(readStoredSnapshots())
  }, [open])

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

  const applyPresetId = (id: string) => {
    const preset = allPresets.find((item) => item.id === id)
    if (!preset) return
    setSelectedPresetId(id)
    setSettings((current) => applyCameraRawPreset(current, preset, "replace"))
  }

  const savePreset = () => {
    const preset = createCameraRawPreset(presetName, settings, "User")
    setUserPresets((current) => {
      const next = [preset, ...current].slice(0, 80)
      storePresets(next)
      return next
    })
    setSelectedPresetId(preset.id)
  }

  const deletePreset = () => {
    if (!selectedPresetId || presetLibrary.builtIn.some((preset) => preset.id === selectedPresetId)) return
    setUserPresets((current) => {
      const next = current.filter((preset) => preset.id !== selectedPresetId)
      storePresets(next)
      return next
    })
    setSelectedPresetId("neutral")
  }

  const saveSnapshot = () => {
    setSnapshots((current) => {
      const next = [createCameraRawSnapshot(snapshotName || `Snapshot ${current.length + 1}`, settings), ...current].slice(0, 80)
      storeSnapshots(next)
      return next
    })
  }

  const updateSnapshots = (next: CameraRawSnapshot[]) => {
    setSnapshots(next)
    storeSnapshots(next)
  }

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
              Rendered layer pixels only. Local HSL, optics, calibration, snapshots, presets, and lens profile approximations are implemented; RAW demosaic and native camera profiles still require a dedicated RAW engine.
            </div>
            <div className="rounded-sm border border-[var(--ps-divider)]">
              <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
                Presets
              </div>
              <div className="space-y-2 p-2">
                <select
                  value={selectedPresetId}
                  onChange={(event) => applyPresetId(event.target.value)}
                  className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2"
                  aria-label="Camera Raw preset"
                >
                  <optgroup label="Built-in">
                    {presetLibrary.builtIn.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </optgroup>
                  {presetLibrary.user.length ? (
                    <optgroup label="User">
                      {presetLibrary.user.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                    </optgroup>
                  ) : null}
                </select>
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  aria-label="Camera Raw preset name"
                  className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2"
                />
                <div className="grid grid-cols-2 gap-1">
                  <Button type="button" variant="secondary" size="sm" onClick={savePreset}>Save Preset</Button>
                  <Button type="button" variant="outline" size="sm" onClick={deletePreset} disabled={presetLibrary.builtIn.some((preset) => preset.id === selectedPresetId)}>Delete</Button>
                </div>
              </div>
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
                <label className="grid grid-cols-[74px_1fr] items-center gap-2">
                  <span className="text-[var(--ps-text-dim)]">Profile</span>
                  <select
                    value={settings.optics?.profileId ?? "none"}
                    onChange={(event) => setSettings((current) => ({ ...current, optics: { ...(current.optics ?? {}), profileId: event.target.value as keyof typeof CAMERA_RAW_LENS_PROFILES } }))}
                    className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
                    aria-label="Camera Raw lens profile"
                  >
                    {Object.values(CAMERA_RAW_LENS_PROFILES).map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                </label>
                <NestedSlider label="Profile %" value={settings.optics?.profileStrength ?? 100} min={0} max={150} onChange={(value) => setSettings((current) => ({ ...current, optics: { ...(current.optics ?? {}), profileStrength: value } }))} />
                <NestedSlider label="Defringe" value={settings.optics?.defringe ?? 0} min={0} max={100} onChange={(value) => setSettings((current) => ({ ...current, optics: { ...(current.optics ?? {}), defringe: value } }))} />
              </div>
            </div>
            <div className="rounded-sm border border-[var(--ps-divider)]">
              <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
                Snapshots
              </div>
              <div className="space-y-2 p-2">
                <input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2" />
                <Button type="button" variant="secondary" size="sm" className="w-full" onClick={saveSnapshot}>
                  Save Snapshot
                </Button>
                {snapshots.slice(0, 4).map((snapshot) => (
                  <div key={snapshot.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-1 rounded-sm px-1 py-1 hover:bg-[var(--ps-tool-hover)]">
                    <button type="button" className="truncate text-left" title={snapshot.name} onClick={() => setSettings(snapshot.settings)}>
                      {snapshot.name}
                    </button>
                    <button type="button" className="rounded-sm px-1 text-[10px] hover:bg-[var(--ps-panel)]" onClick={() => updateSnapshots(snapshots.map((item) => item.id === snapshot.id ? renameCameraRawSnapshot(item, `${item.name} edited`) : item))}>Rename</button>
                    <button type="button" className="rounded-sm px-1 text-[10px] hover:bg-[var(--ps-panel)]" onClick={() => updateSnapshots([duplicateCameraRawSnapshot(snapshot), ...snapshots])}>Copy</button>
                    <button type="button" className="rounded-sm px-1 text-[10px] hover:bg-[var(--ps-panel)]" onClick={() => {
                      const preset = promoteCameraRawSnapshotToPreset(snapshot)
                      const next = [preset, ...userPresets].slice(0, 80)
                      setUserPresets(next)
                      storePresets(next)
                    }}>Preset</button>
                    <button type="button" className="rounded-sm px-1 text-[10px] hover:bg-[var(--ps-panel)]" onClick={() => updateSnapshots(deleteCameraRawSnapshot(snapshots, snapshot.id))}>Delete</button>
                  </div>
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

function NestedSlider({
  label,
  value,
  onChange,
  min = -100,
  max = 100,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
}) {
  return (
    <label className="grid grid-cols-[74px_1fr_48px] items-center gap-2">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-right"
      />
    </label>
  )
}
