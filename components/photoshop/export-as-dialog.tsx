"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Download, FileImage, RefreshCw } from "lucide-react"
import { useEditor } from "./editor-context"
import {
  buildRasterExportCanvas,
  createExportLimitationReport,
  dataUrlBytes,
  downloadDataUrl,
  exportRasterDataUrl,
  exportSvgDataUrl,
  formatBytes,
  rasterMime,
  type ExportFormat,
} from "./document-io"
import { canvasSizeError } from "./canvas-limits"
import { cn } from "@/lib/utils"
import type { AssetLibraryItem } from "./types"

type ExportPresetPayload = Partial<{
  dialog: "export-as"
  format: ExportFormat
  scale: number
  quality: number
  transparent: boolean
  matte: string
  dither: boolean
  losslessWebp: boolean
  includeMetadata: boolean
  precision: number
}>

function presetScaleToPercent(scale: number | undefined) {
  if (!Number.isFinite(scale)) return undefined
  const value = Number(scale)
  return value <= 8 ? Math.round(value * 100) : Math.round(value)
}

export function ExportAsDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: ExportPresetPayload
}) {
  const { activeDoc, dispatch, commit } = useEditor()
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const [format, setFormat] = React.useState<ExportFormat>("png")
  const [scale, setScale] = React.useState(100)
  const [quality, setQuality] = React.useState(92)
  const [transparent, setTransparent] = React.useState(true)
  const [matte, setMatte] = React.useState("#ffffff")
  const [dither, setDither] = React.useState(false)
  const [interlaced, setInterlaced] = React.useState(false)
  const [progressive, setProgressive] = React.useState(true)
  const [losslessWebp, setLosslessWebp] = React.useState(false)
  const [includeMetadata, setIncludeMetadata] = React.useState(false)
  const [precision, setPrecision] = React.useState(2)
  const [estimate, setEstimate] = React.useState("0 KB")
  const [selectedPresetId, setSelectedPresetId] = React.useState("")
  const [presetName, setPresetName] = React.useState("")

  const scaleRatio = Math.max(0.01, scale / 100)

  const refreshPreview = React.useCallback(() => {
    if (!activeDoc || !previewRef.current) return
    const sizeError = canvasSizeError(activeDoc.width * scaleRatio, activeDoc.height * scaleRatio, "Export")
    if (sizeError) {
      const preview = previewRef.current
      preview.width = 1
      preview.height = 1
      setEstimate("Too large")
      return
    }
    const canvas =
      format === "svg"
        ? buildRasterExportCanvas(activeDoc, {
            format: "png",
            scale: scaleRatio,
            quality: 1,
            transparent,
            matte,
          })
        : buildRasterExportCanvas(activeDoc, {
            format,
            scale: scaleRatio,
            quality: losslessWebp && format === "webp" ? 1 : quality / 100,
            transparent,
            matte,
            dither,
          })
    const preview = previewRef.current
    const maxW = 330
    const maxH = 240
    const previewScale = Math.min(maxW / canvas.width, maxH / canvas.height, 1)
    preview.width = Math.max(1, Math.round(canvas.width * previewScale))
    preview.height = Math.max(1, Math.round(canvas.height * previewScale))
    const ctx = preview.getContext("2d")!
    ctx.clearRect(0, 0, preview.width, preview.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(canvas, 0, 0, preview.width, preview.height)

    const dataUrl =
      format === "svg"
        ? exportSvgDataUrl(activeDoc, {
            scale: scaleRatio,
            transparent,
            matte,
            includeMetadata,
            precision,
          })
        : format === "gif"
          ? exportRasterDataUrl(activeDoc, {
              format,
              scale: scaleRatio,
              quality: 1,
              transparent,
              matte,
              dither,
            })
          : canvas.toDataURL(rasterMime(format), losslessWebp && format === "webp" ? 1 : quality / 100)
    setEstimate(formatBytes(dataUrlBytes(dataUrl)))
  }, [
    activeDoc,
    dither,
    format,
    includeMetadata,
    losslessWebp,
    matte,
    precision,
    quality,
    scaleRatio,
    transparent,
  ])

  React.useEffect(() => {
    if (open) refreshPreview()
  }, [open, refreshPreview])

  React.useEffect(() => {
    if (!open || !initial) return
    if (initial.format) setFormat(initial.format)
    const nextScale = presetScaleToPercent(initial.scale)
    if (nextScale) setScale(Math.max(1, Math.min(800, nextScale)))
    if (typeof initial.quality === "number") setQuality(Math.max(1, Math.min(100, initial.quality > 1 ? initial.quality : initial.quality * 100)))
    if (typeof initial.transparent === "boolean") setTransparent(initial.transparent)
    if (typeof initial.matte === "string") setMatte(initial.matte)
    if (typeof initial.dither === "boolean") setDither(initial.dither)
    if (typeof initial.losslessWebp === "boolean") setLosslessWebp(initial.losslessWebp)
    if (typeof initial.includeMetadata === "boolean") setIncludeMetadata(initial.includeMetadata)
    if (typeof initial.precision === "number") setPrecision(Math.max(0, Math.min(6, initial.precision)))
  }, [open, initial])

  React.useEffect(() => {
    if (!open) return
    setPresetName(`${format.toUpperCase()} ${scale}%`)
  }, [format, open, scale])

  if (!activeDoc) return null

  const exportPresets = (activeDoc.assetLibrary ?? []).filter(
    (asset) => asset.kind === "export" && (asset.payload as ExportPresetPayload)?.dialog === "export-as",
  )

  const outW = Math.max(1, Math.round(activeDoc.width * scaleRatio))
  const outH = Math.max(1, Math.round(activeDoc.height * scaleRatio))
  const outputSizeError = canvasSizeError(outW, outH, "Export")
  const limitationReport = createExportLimitationReport(activeDoc, {
    format,
    includeMetadata,
    interlaced,
    progressive,
    transparent,
    quality,
  })
  const visibleLimitations = limitationReport.items.filter((item) => item.status !== "info").slice(0, 6)

  const exportFile = () => {
    if (outputSizeError) {
      toast.error(outputSizeError)
      return
    }
    const safeName = activeDoc.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_")
    if (format === "svg") {
      downloadDataUrl(
        exportSvgDataUrl(activeDoc, { scale: scaleRatio, transparent, matte, includeMetadata, precision }),
        `${safeName}.svg`,
      )
    } else {
      downloadDataUrl(
        exportRasterDataUrl(activeDoc, {
          format,
          scale: scaleRatio,
          quality: losslessWebp && format === "webp" ? 1 : quality / 100,
          transparent,
          matte,
          dither,
        }),
        `${safeName}.${format === "jpeg" ? "jpg" : format}`,
      )
    }
    onOpenChange(false)
  }

  const currentPresetPayload = (): ExportPresetPayload => ({
    dialog: "export-as",
    format,
    scale,
    quality,
    transparent,
    matte,
    dither,
    losslessWebp,
    includeMetadata,
    precision,
  })

  const applyPreset = (asset: AssetLibraryItem) => {
    const payload = asset.payload as ExportPresetPayload
    if (payload.format) setFormat(payload.format)
    const nextScale = presetScaleToPercent(payload.scale)
    if (nextScale) setScale(Math.max(1, Math.min(800, nextScale)))
    if (typeof payload.quality === "number") setQuality(Math.max(1, Math.min(100, payload.quality > 1 ? payload.quality : payload.quality * 100)))
    if (typeof payload.transparent === "boolean") setTransparent(payload.transparent)
    if (typeof payload.matte === "string") setMatte(payload.matte)
    if (typeof payload.dither === "boolean") setDither(payload.dither)
    if (typeof payload.losslessWebp === "boolean") setLosslessWebp(payload.losslessWebp)
    if (typeof payload.includeMetadata === "boolean") setIncludeMetadata(payload.includeMetadata)
    if (typeof payload.precision === "number") setPrecision(Math.max(0, Math.min(6, payload.precision)))
  }

  const savePreset = () => {
    const trimmed = presetName.trim()
    if (!trimmed) return
    const asset: AssetLibraryItem = {
      id: `asset_${Math.random().toString(36).slice(2, 9)}`,
      name: trimmed,
      kind: "export",
      group: "Export",
      payload: currentPresetPayload(),
      createdAt: Date.now(),
    }
    dispatch({ type: "set-asset-library", assets: [asset, ...(activeDoc.assetLibrary ?? [])] })
    window.setTimeout(() => commit("Save Export Preset", []), 0)
    setSelectedPresetId(asset.id)
    toast.success("Export preset saved")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Export As</DialogTitle>
          <DialogDescription className="sr-only">
            Configure document export format, scale, transparency, quality, and metadata.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[360px_1fr] gap-4">
          <div className="space-y-3">
            <div className="ps-checker border border-[var(--ps-divider)] rounded-sm min-h-[250px] flex items-center justify-center overflow-hidden">
              <canvas ref={previewRef} className="block max-w-full max-h-[250px]" />
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-[var(--ps-text-dim)]">
              <InfoPill label="Original" value={`${activeDoc.width} x ${activeDoc.height}`} />
              <InfoPill label="Output" value={`${outW} x ${outH}`} />
              <InfoPill label="Estimate" value={estimate} />
            </div>
            {outputSizeError && (
              <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                {outputSizeError}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Panel title="Presets">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <select
                  value={selectedPresetId}
                  onChange={(event) => setSelectedPresetId(event.target.value)}
                  className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                >
                  <option value="">Current settings</option>
                  {exportPresets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selectedPresetId}
                  onClick={() => {
                    const asset = exportPresets.find((item) => item.id === selectedPresetId)
                    if (asset) applyPreset(asset)
                  }}
                >
                  Apply
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={savePreset}>
                  Save
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-[76px_1fr] items-center gap-2">
                <Label className="text-[11px] text-[var(--ps-text-dim)]">Preset name</Label>
                <Input
                  aria-label="Export preset name"
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") savePreset()
                  }}
                  className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                />
              </div>
            </Panel>

            <div className="grid grid-cols-6 gap-1">
              {(["png", "jpeg", "webp", "gif", "avif", "svg"] as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={cn(
                    "h-8 rounded-sm border text-[11px] uppercase flex items-center justify-center gap-1",
                    format === f
                      ? "bg-[var(--ps-accent)] border-[var(--ps-accent)] text-white"
                      : "bg-[var(--ps-panel-2)] border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]",
                  )}
                >
                  <FileImage className="w-3.5 h-3.5" />
                  {f === "jpeg" ? "JPG" : f}
                </button>
              ))}
            </div>

            <Panel title="Image Size">
              <div className="grid grid-cols-[1fr_72px] gap-3 items-center">
                <Slider
                  min={10}
                  max={400}
                  step={5}
                  value={[scale]}
                  onValueChange={(v) => setScale(v[0])}
                />
                <Input
                  type="number"
                  value={scale}
                  min={1}
                  max={800}
                  onChange={(e) => setScale(Math.max(1, Number(e.target.value) || 100))}
                  className="h-7 text-[11px]"
                />
              </div>
              <div className="mt-2 text-[10px] text-[var(--ps-text-dim)]">Scale percent, high quality bicubic resampling.</div>
            </Panel>

            {format !== "svg" ? (
              <Panel title="Format Options">
                {(format === "jpeg" || format === "webp" || format === "avif") && (
                  <div className="grid grid-cols-[1fr_54px] gap-3 items-center mb-3">
                    <Slider
                      min={1}
                      max={100}
                      step={1}
                      value={[quality]}
                      disabled={losslessWebp && format === "webp"}
                      onValueChange={(v) => setQuality(v[0])}
                    />
                    <span className="text-[11px] tabular-nums text-right">{quality}%</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <CheckRow label="Transparency" checked={transparent} onCheckedChange={setTransparent} disabled={format === "jpeg"} />
                  <CheckRow label="Dither" checked={dither} onCheckedChange={setDither} disabled={format === "jpeg" || format === "avif"} />
                  <CheckRow label="Interlaced PNG" checked={interlaced} onCheckedChange={setInterlaced} disabled={format !== "png"} />
                  <CheckRow label="Progressive JPG" checked={progressive} onCheckedChange={setProgressive} disabled={format !== "jpeg"} />
                  <CheckRow label="Lossless WebP" checked={losslessWebp} onCheckedChange={setLosslessWebp} disabled={format !== "webp"} />
                  <CheckRow label="Embed Metadata" checked={includeMetadata} onCheckedChange={setIncludeMetadata} />
                </div>
                <div className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
                  <div className="mb-1 font-medium text-[var(--ps-text)]">{limitationReport.summary}</div>
                  <div className="grid gap-1">
                    {visibleLimitations.map((item) => (
                      <div key={`${item.label}-${item.status}`} className="grid grid-cols-[92px_1fr] gap-2">
                        <span className="uppercase tracking-wide text-amber-300">{item.status}</span>
                        <span>{item.label}: {item.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {format === "gif" ? (
                  <div className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
                    GIF exports use a 256-color indexed palette with optional 1-bit transparency.
                  </div>
                ) : null}
                <div className="grid gap-1.5 mt-3">
                  <Label className="text-[11px]">Matte color</Label>
                  <Input
                    type="color"
                    value={matte}
                    onChange={(e) => setMatte(e.target.value)}
                    className="h-8 w-24 p-1"
                  />
                </div>
              </Panel>
            ) : (
              <Panel title="SVG Options">
                <div className="grid grid-cols-2 gap-2">
                  <CheckRow label="Transparent Viewport" checked={transparent} onCheckedChange={setTransparent} />
                  <CheckRow label="Include Metadata" checked={includeMetadata} onCheckedChange={setIncludeMetadata} />
                </div>
                <div className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
                  <div className="mb-1 font-medium text-[var(--ps-text)]">{limitationReport.summary}</div>
                  <div className="grid gap-1">
                    {visibleLimitations.map((item) => (
                      <div key={`${item.label}-${item.status}`} className="grid grid-cols-[92px_1fr] gap-2">
                        <span className="uppercase tracking-wide text-amber-300">{item.status}</span>
                        <span>{item.label}: {item.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="grid gap-1.5">
                    <Label className="text-[11px]">Coordinate precision</Label>
                    <Input
                      type="number"
                      value={precision}
                      min={0}
                      max={6}
                      onChange={(e) => setPrecision(Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
                      className="h-7 text-[11px]"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[11px]">Matte color</Label>
                    <Input
                      type="color"
                      value={matte}
                      onChange={(e) => setMatte(e.target.value)}
                      className="h-8 w-24 p-1"
                    />
                  </div>
                </div>
              </Panel>
            )}

            <Button variant="outline" size="sm" onClick={refreshPreview} className="w-full">
              <RefreshCw className="w-4 h-4" />
              Refresh Preview
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={exportFile} disabled={!!outputSizeError}>
            <Download className="w-4 h-4" />
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] rounded-sm px-2 py-1">
      <div className="uppercase text-[9px]">{label}</div>
      <div className="text-[var(--ps-text)] tabular-nums">{value}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--ps-divider)] rounded-sm">
      <div className="px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)] bg-[var(--ps-panel-2)] border-b border-[var(--ps-divider)]">
        {title}
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}

function CheckRow({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className={cn("flex items-center gap-2 text-[11px]", disabled && "opacity-45")}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="border-[var(--ps-divider)]"
      />
      {label}
    </label>
  )
}
