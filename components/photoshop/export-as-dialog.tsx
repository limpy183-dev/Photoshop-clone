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
import { AlertTriangle, Download, FileImage, RefreshCw } from "lucide-react"
import { useEditor } from "./editor-context"
import {
  buildRasterExportCanvas,
  createDocumentReport,
  createExportCompatibilityManifest,
  createExportLimitationReport,
  dataUrlBytes,
  downloadBlob,
  downloadDataUrl,
  downloadText,
  exportAnimationDataUrl,
  exportMetadataSidecarDataUrl,
  exportRasterBlob,
  exportRasterDataUrl,
  exportSvgDataUrl,
  formatBytes,
  rasterMime,
  type BrowserRasterExportFormat,
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

const EXPORT_FORMATS: Array<{ format: ExportFormat; label: string }> = [
  { format: "png", label: "PNG" },
  { format: "jpeg", label: "JPG" },
  { format: "webp", label: "WebP" },
  { format: "gif", label: "GIF" },
  { format: "avif", label: "AVIF" },
  { format: "svg", label: "SVG" },
  { format: "tga", label: "TGA" },
  { format: "ppm", label: "PPM" },
  { format: "pgm", label: "PGM" },
  { format: "pbm", label: "PBM" },
  { format: "apng", label: "APNG" },
  { format: "animated-webp", label: "Anim WebP" },
  { format: "metadata-json", label: "Sidecar" },
]

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  svg: "svg",
  tga: "tga",
  ppm: "ppm",
  pgm: "pgm",
  pbm: "pbm",
  apng: "png",
  "animated-webp": "webp",
  "metadata-json": "metadata.json",
}

function previewRasterFormat(format: ExportFormat): BrowserRasterExportFormat {
  if (
    format === "svg" ||
    format === "metadata-json" ||
    format === "apng" ||
    format === "animated-webp" ||
    format === "tga" ||
    format === "ppm" ||
    format === "pgm" ||
    format === "pbm"
  ) {
    return "png"
  }
  return format
}

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
    const rasterFormat = previewRasterFormat(format)
    const canvas =
      format === "svg" || format === "metadata-json"
        ? buildRasterExportCanvas(activeDoc, {
            format: "png",
            scale: scaleRatio,
            quality: 1,
            transparent,
            matte,
          })
        : buildRasterExportCanvas(activeDoc, {
            format: rasterFormat,
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

    if (format === "gif" || format === "apng" || format === "animated-webp") {
      const frameCount = Math.max(1, activeDoc.timelineFrames?.length ?? 1)
      const perFrame = dataUrlBytes(canvas.toDataURL("image/png"))
      setEstimate(`~${formatBytes(perFrame * frameCount)} (${frameCount} fr)`)
      return
    }
    const dataUrl =
      format === "metadata-json"
        ? exportMetadataSidecarDataUrl(activeDoc, createDocumentReport(activeDoc, "Project Export"))
        : format === "svg"
        ? exportSvgDataUrl(activeDoc, {
            scale: scaleRatio,
            transparent,
            matte,
            includeMetadata,
            precision,
          })
        : format === "tga" || format === "ppm" || format === "pgm" || format === "pbm"
          ? exportRasterDataUrl(activeDoc, {
              format,
              scale: scaleRatio,
              quality: quality / 100,
              transparent,
              matte,
              dither,
            })
          : canvas.toDataURL(rasterMime(rasterFormat), losslessWebp && rasterFormat === "webp" ? 1 : quality / 100)
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
  const compatibilityManifest = createExportCompatibilityManifest(activeDoc, {
    format,
    includeMetadata,
    interlaced,
    progressive,
    transparent,
    quality,
  })
  const visibleLimitations = limitationReport.items.filter((item) => item.status !== "info").slice(0, 6)
  const visibleManifestItems = compatibilityManifest.entries
    .filter((item) => item.status === "unsupported" || item.status === "flattened" || item.status === "approximated")
    .slice(0, 4)
  const safeName = activeDoc.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_")

  const exportCompatibilityManifest = () => {
    downloadText(
      JSON.stringify(compatibilityManifest, null, 2),
      `${safeName}-${format}-compatibility-manifest.json`,
    )
  }

  const exportFile = async () => {
    if (outputSizeError) {
      toast.error(outputSizeError)
      return
    }
    if (format === "svg") {
      downloadDataUrl(
        exportSvgDataUrl(activeDoc, { scale: scaleRatio, transparent, matte, includeMetadata, precision }),
        `${safeName}.svg`,
      )
    } else if (format === "metadata-json") {
      downloadDataUrl(
        exportMetadataSidecarDataUrl(activeDoc, createDocumentReport(activeDoc, "Project Export")),
        `${safeName}.metadata.json`,
      )
    } else if (format === "gif" || format === "apng" || format === "animated-webp") {
      try {
        const dataUrl = await exportAnimationDataUrl(activeDoc, format, { transparent, matte, scale: scaleRatio })
        downloadDataUrl(dataUrl, `${safeName}.${EXPORT_EXTENSIONS[format]}`)
      } catch (err) {
        toast.error(`Animation export failed: ${(err as Error).message}`)
        return
      }
    } else {
      const blob = await exportRasterBlob(activeDoc, {
          format,
          scale: scaleRatio,
          quality: losslessWebp && format === "webp" ? 1 : quality / 100,
          transparent,
          matte,
          dither,
        })
      downloadBlob(blob, `${safeName}.${EXPORT_EXTENSIONS[format]}`)
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
              {EXPORT_FORMATS.map(({ format: f, label }) => (
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
                  {label}
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

            {format !== "svg" && format !== "metadata-json" ? (
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
                {format === "apng" || format === "animated-webp" ? (
                  <div className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
                    Timeline frames are exported when present; otherwise the current composite becomes one frame.
                  </div>
                ) : null}
                {format === "tga" || format === "ppm" || format === "pgm" || format === "pbm" ? (
                  <div className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
                    This format is encoded by the app from canvas pixels, bypassing browser MIME encoder support.
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
            ) : format === "metadata-json" ? (
              <Panel title="Sidecar Options">
                <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
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

            <Panel title="Compatibility Manifest">
              <div className="space-y-2 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "rounded-sm border px-2 py-1 uppercase tracking-wide",
                    compatibilityManifest.riskLevel === "high"
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : compatibilityManifest.riskLevel === "medium"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
                  )}>
                    {compatibilityManifest.riskLevel} risk
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--ps-text-dim)]">
                    {compatibilityManifest.summary}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-center">
                  <ManifestCount label="Flat" value={compatibilityManifest.totals.flattened} className="text-orange-300" />
                  <ManifestCount label="Approx" value={compatibilityManifest.totals.approximated} className="text-amber-300" />
                  <ManifestCount label="Unsupported" value={compatibilityManifest.totals.unsupported} className="text-red-300" />
                  <ManifestCount label="Preserved" value={compatibilityManifest.totals.preserved} className="text-emerald-300" />
                </div>
                {compatibilityManifest.warnings.length ? (
                  <div className="space-y-1 rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-amber-100">
                    {compatibilityManifest.warnings.slice(0, 4).map((warning) => (
                      <div key={warning} className="flex gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {visibleManifestItems.length ? (
                  <div className="grid gap-1 text-[var(--ps-text-dim)]">
                    {visibleManifestItems.map((item) => (
                      <div key={`${item.label}-${item.status}`} className="grid grid-cols-[84px_1fr] gap-2">
                        <span className="uppercase tracking-wide text-[var(--ps-text)]">{item.status}</span>
                        <span>{item.label}: {item.detail}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Panel>

            <Button variant="outline" size="sm" onClick={refreshPreview} className="w-full">
              <RefreshCw className="w-4 h-4" />
              Refresh Preview
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={exportCompatibilityManifest}>
            <Download className="w-4 h-4" />
            Manifest
          </Button>
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

function ManifestCount({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 py-1">
      <div className="uppercase text-[9px] text-[var(--ps-text-dim)]">{label}</div>
      <div className={`tabular-nums ${className}`}>{value}</div>
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
