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
import { AlertTriangle, Copy, Download, FileImage, FileJson, RefreshCw, Save, Trash2, Upload } from "lucide-react"
import { useEditor } from "./editor-context"
import {
  buildRasterExportCanvas,
  createDocumentReport,
  createExportCompatibilityManifest,
  createExportLimitationReport,
  dataUrlBytes,
  diagnoseBrowserRasterEncoders,
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
  type BrowserRasterEncoderDiagnostic,
  type BrowserRasterExportFormat,
  type CompatibilityManifestEntry,
  type ExportFormat,
} from "./document-io"
import { dispatchPhotoshopEvent } from "./events"
import type { RasterExportMetadata, TiffCompression } from "./raster-codecs"
import { canvasSizeError } from "./canvas-limits"
import { cn } from "@/lib/utils"
import type { AssetLibraryItem, ColorManagementSettings } from "./types"
import {
  deleteExportPresetAsset,
  duplicateExportPresetAsset,
  exportPresetAssets,
  parseExportPresetLibrary,
  serializeExportPresetLibrary,
  upsertExportPresetAsset,
  type ExportPresetPayload,
} from "./export-presets"
import { supportedIccProfileNames } from "./color-pipeline"
import {
  alternativesForLimitation,
  alternativesForWarning,
  type ExportAlternative,
} from "./export-alternatives"

const EXPORT_FORMATS: Array<{ format: ExportFormat; label: string }> = [
  { format: "png", label: "PNG" },
  { format: "tiff", label: "TIFF" },
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

type ExportDecisionId = "web" | "app" | "photoshop" | "print"

// Task-based export decision cards: pick the goal, get a recommended format plus
// an honest "what's preserved vs. flattened" breakdown before committing.
const EXPORT_DECISIONS: Array<{
  id: ExportDecisionId
  label: string
  format: ExportFormat
  blurb: string
  preserved: string[]
  flattened: string[]
}> = [
  {
    id: "web",
    label: "Best for web",
    format: "webp",
    blurb: "Small, sRGB, broadly supported.",
    preserved: ["Flattened composite appearance", "sRGB color for browsers", "Smallest practical file size"],
    flattened: ["Layers flattened to a single raster image", "Browser-encoded 8-bit color only"],
  },
  {
    id: "app",
    label: "Best for this app",
    format: "metadata-json",
    blurb: "Re-open here with the most fidelity.",
    preserved: ["Document and layer metadata", "Layer names, blend, and opacity"],
    flattened: ["Pixel data exported as a raster sidecar", "Browser 8-bit RGBA working space"],
  },
  {
    id: "photoshop",
    label: "Best for Photoshop handoff",
    format: "metadata-json",
    blurb: "Carry structure and metadata downstream.",
    preserved: ["Layer names and metadata", "Document metadata and intent"],
    flattened: ["Effects and smart filters rasterized", "Browser cannot write native PSD private data"],
  },
  {
    id: "print",
    label: "Best for print preview",
    format: "png",
    blurb: "Full-resolution, lossless raster.",
    preserved: ["Full resolution", "Embedded export metadata"],
    flattened: ["Flattened raster output", "Browser color management approximation only"],
  },
]

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  png: "png",
  tiff: "tiff",
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

const DEFAULT_COLOR_MANAGEMENT: ColorManagementSettings = {
  assignedProfile: "sRGB IEC61966-2.1",
  workingSpace: "sRGB IEC61966-2.1",
  renderingIntent: "relative-colorimetric",
  blackPointCompensation: true,
  proofProfile: "None",
  proofColors: false,
  gamutWarning: false,
  proofChannels: [],
  proofPlateView: "composite",
}

function previewRasterFormat(format: ExportFormat): BrowserRasterExportFormat {
  if (
    format === "svg" ||
    format === "metadata-json" ||
    format === "apng" ||
    format === "animated-webp" ||
    format === "tiff" ||
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

type WebpAlphaFilter = NonNullable<RasterExportMetadata["webp"]>["alphaFilter"]

function splitMetadataCommentLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
}

function cleanOptionalText(value: string) {
  const clean = value.trim()
  return clean || undefined
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
  const presetImportRef = React.useRef<HTMLInputElement | null>(null)
  const [format, setFormat] = React.useState<ExportFormat>("png")
  const [scale, setScale] = React.useState(100)
  const [quality, setQuality] = React.useState(92)
  const [transparent, setTransparent] = React.useState(true)
  const [matte, setMatte] = React.useState("#ffffff")
  const [dither, setDither] = React.useState(false)
  const [interlaced, setInterlaced] = React.useState(false)
  const [progressive, setProgressive] = React.useState(true)
  const [tiffCompression, setTiffCompression] = React.useState<TiffCompression>("none")
  const [tgaRle, setTgaRle] = React.useState(true)
  const [losslessWebp, setLosslessWebp] = React.useState(false)
  const [webpNearLossless, setWebpNearLossless] = React.useState(100)
  const [webpMethod, setWebpMethod] = React.useState(4)
  const [webpExactAlpha, setWebpExactAlpha] = React.useState(true)
  const [webpAlphaQuality, setWebpAlphaQuality] = React.useState(100)
  const [webpAlphaFilter, setWebpAlphaFilter] = React.useState<WebpAlphaFilter>("none")
  const [avifLossless, setAvifLossless] = React.useState(false)
  const [avifSpeed, setAvifSpeed] = React.useState(6)
  const [avifBitDepth, setAvifBitDepth] = React.useState(8)
  const [avifChromaSubsampling, setAvifChromaSubsampling] = React.useState("4:2:0")
  const [avifTileRowsLog2, setAvifTileRowsLog2] = React.useState(0)
  const [avifTileColsLog2, setAvifTileColsLog2] = React.useState(0)
  const [tgaJobName, setTgaJobName] = React.useState("")
  const [tgaSoftwareId, setTgaSoftwareId] = React.useState("Photoshop Web")
  const [tgaAspectRatioNumerator, setTgaAspectRatioNumerator] = React.useState(1)
  const [tgaAspectRatioDenominator, setTgaAspectRatioDenominator] = React.useState(1)
  const [tgaGamma, setTgaGamma] = React.useState(2.2)
  const [netpbmComments, setNetpbmComments] = React.useState("")
  const [netpbmSourceMaxValue, setNetpbmSourceMaxValue] = React.useState(255)
  const [includeMetadata, setIncludeMetadata] = React.useState(false)
  const [metadataAuthor, setMetadataAuthor] = React.useState("")
  const [metadataCopyright, setMetadataCopyright] = React.useState("")
  const [metadataDescription, setMetadataDescription] = React.useState("")
  const [metadataCreationDate, setMetadataCreationDate] = React.useState("")
  const [precision, setPrecision] = React.useState(2)
  const [estimate, setEstimate] = React.useState("0 KB")
  const [selectedPresetId, setSelectedPresetId] = React.useState("")
  const [presetName, setPresetName] = React.useState("")
  const [encoderDiagnostics, setEncoderDiagnostics] = React.useState<BrowserRasterEncoderDiagnostic[]>([])
  const [decisionTarget, setDecisionTarget] = React.useState<ExportDecisionId | null>(null)

  const scaleRatio = Math.max(0.01, scale / 100)
  const metadataPayload = React.useCallback((): RasterExportMetadata => ({
    author: metadataAuthor.trim() || undefined,
    copyright: metadataCopyright.trim() || undefined,
    description: metadataDescription.trim() || undefined,
    creationDate: metadataCreationDate.trim() || undefined,
  }), [metadataAuthor, metadataCopyright, metadataCreationDate, metadataDescription])

  const encoderMetadataOptions = React.useCallback(() => {
    const isNetpbm = format === "ppm" || format === "pgm" || format === "pbm"
    const comments = splitMetadataCommentLines(netpbmComments)
    return {
      webpAlphaQuality: format === "webp" ? webpAlphaQuality : undefined,
      webpAlphaFilter: format === "webp" ? webpAlphaFilter : undefined,
      tgaJobName: format === "tga" ? cleanOptionalText(tgaJobName) : undefined,
      tgaSoftwareId: format === "tga" ? cleanOptionalText(tgaSoftwareId) : undefined,
      tgaAspectRatioNumerator: format === "tga" ? tgaAspectRatioNumerator : undefined,
      tgaAspectRatioDenominator: format === "tga" ? tgaAspectRatioDenominator : undefined,
      tgaGamma: format === "tga" ? tgaGamma : undefined,
      netpbmComments: isNetpbm && comments.length ? comments : undefined,
      netpbmSourceMaxValue: isNetpbm ? netpbmSourceMaxValue : undefined,
    }
  }, [
    format,
    netpbmComments,
    netpbmSourceMaxValue,
    tgaAspectRatioDenominator,
    tgaAspectRatioNumerator,
    tgaGamma,
    tgaJobName,
    tgaSoftwareId,
    webpAlphaFilter,
    webpAlphaQuality,
  ])

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
        : format === "tiff" || format === "tga" || format === "ppm" || format === "pgm" || format === "pbm"
          ? exportRasterDataUrl(activeDoc, {
              format,
              scale: scaleRatio,
              quality: quality / 100,
              transparent,
              matte,
              dither,
              tiffCompression,
              tgaRle,
              ...encoderMetadataOptions(),
              includeMetadata,
              metadata: metadataPayload(),
            })
          : canvas.toDataURL(rasterMime(rasterFormat), losslessWebp && rasterFormat === "webp" ? 1 : quality / 100)
    setEstimate(formatBytes(dataUrlBytes(dataUrl)))
  }, [
    activeDoc,
    dither,
    encoderMetadataOptions,
    format,
    includeMetadata,
    losslessWebp,
    matte,
    metadataPayload,
    precision,
    quality,
    scaleRatio,
    tgaRle,
    tiffCompression,
    transparent,
  ])

  React.useEffect(() => {
    if (open) refreshPreview()
  }, [open, refreshPreview])

  React.useEffect(() => {
    if (!open) return
    let disposed = false
    void diagnoseBrowserRasterEncoders(["webp", "avif"]).then((diagnostics) => {
      if (!disposed) setEncoderDiagnostics(diagnostics)
    })
    return () => {
      disposed = true
    }
  }, [open])

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
    if (typeof initial.webpNearLossless === "number") setWebpNearLossless(Math.max(0, Math.min(100, Math.round(initial.webpNearLossless))))
    if (typeof initial.webpMethod === "number") setWebpMethod(Math.max(0, Math.min(6, Math.round(initial.webpMethod))))
    if (typeof initial.webpExactAlpha === "boolean") setWebpExactAlpha(initial.webpExactAlpha)
    if (typeof initial.webpAlphaQuality === "number") setWebpAlphaQuality(Math.max(0, Math.min(100, Math.round(initial.webpAlphaQuality))))
    if (initial.webpAlphaFilter === "none" || initial.webpAlphaFilter === "fast" || initial.webpAlphaFilter === "best") setWebpAlphaFilter(initial.webpAlphaFilter)
    if (typeof initial.avifLossless === "boolean") setAvifLossless(initial.avifLossless)
    if (typeof initial.avifSpeed === "number") setAvifSpeed(Math.max(0, Math.min(10, Math.round(initial.avifSpeed))))
    if (typeof initial.avifBitDepth === "number") setAvifBitDepth(initial.avifBitDepth >= 10 ? 10 : 8)
    if (typeof initial.avifChromaSubsampling === "string") setAvifChromaSubsampling(initial.avifChromaSubsampling)
    if (typeof initial.avifTileRowsLog2 === "number") setAvifTileRowsLog2(Math.max(0, Math.min(4, Math.round(initial.avifTileRowsLog2))))
    if (typeof initial.avifTileColsLog2 === "number") setAvifTileColsLog2(Math.max(0, Math.min(4, Math.round(initial.avifTileColsLog2))))
    if (typeof initial.tgaJobName === "string") setTgaJobName(initial.tgaJobName)
    if (typeof initial.tgaSoftwareId === "string") setTgaSoftwareId(initial.tgaSoftwareId)
    if (typeof initial.tgaAspectRatioNumerator === "number") setTgaAspectRatioNumerator(Math.max(1, Math.min(65535, Math.round(initial.tgaAspectRatioNumerator))))
    if (typeof initial.tgaAspectRatioDenominator === "number") setTgaAspectRatioDenominator(Math.max(1, Math.min(65535, Math.round(initial.tgaAspectRatioDenominator))))
    if (typeof initial.tgaGamma === "number") setTgaGamma(Math.max(0.01, Math.min(65.535, initial.tgaGamma)))
    if (typeof initial.netpbmComments === "string") setNetpbmComments(initial.netpbmComments)
    if (typeof initial.netpbmSourceMaxValue === "number") setNetpbmSourceMaxValue(Math.max(1, Math.min(65535, Math.round(initial.netpbmSourceMaxValue))))
    if (typeof initial.includeMetadata === "boolean") setIncludeMetadata(initial.includeMetadata)
    if (initial.tiffCompression) setTiffCompression(initial.tiffCompression)
    if (typeof initial.tgaRle === "boolean") setTgaRle(initial.tgaRle)
    if (typeof initial.metadataAuthor === "string") setMetadataAuthor(initial.metadataAuthor)
    if (typeof initial.metadataCopyright === "string") setMetadataCopyright(initial.metadataCopyright)
    if (typeof initial.metadataDescription === "string") setMetadataDescription(initial.metadataDescription)
    if (typeof initial.metadataCreationDate === "string") setMetadataCreationDate(initial.metadataCreationDate)
    if (typeof initial.precision === "number") setPrecision(Math.max(0, Math.min(6, initial.precision)))
  }, [open, initial])

  React.useEffect(() => {
    if (!open || !activeDoc || initial) return
    setMetadataAuthor(activeDoc.metadata?.author ?? "")
    setMetadataCopyright(activeDoc.metadata?.copyright ?? "")
    setMetadataDescription(activeDoc.metadata?.description ?? "")
    setMetadataCreationDate(activeDoc.metadata?.createdAt ?? new Date().toISOString())
  }, [activeDoc, initial, open])

  React.useEffect(() => {
    if (!open) return
    setPresetName(`${format.toUpperCase()} ${scale}%`)
  }, [format, open, scale])

  // Broadcast active export-target so the status bar can surface compatibility
  // warnings (e.g. "JPEG cannot carry alpha", "GIF flattens 24-bit color") in
  // real time while the user picks a format. We emit on dialog open + every
  // format change, and clear the override on close.
  React.useEffect(() => {
    if (!open) return
    dispatchPhotoshopEvent("ps-active-export-format", { format, source: "export-as" })
  }, [format, open])
  React.useEffect(() => {
    if (open) return
    dispatchPhotoshopEvent("ps-active-export-format", { format: null, source: "export-as" })
  }, [open])

  if (!activeDoc) return null

  const selectedDecision = EXPORT_DECISIONS.find((decision) => decision.id === decisionTarget) ?? null

  const exportPresets = exportPresetAssets(activeDoc.assetLibrary).filter(
    (asset) => ((asset.payload as ExportPresetPayload)?.dialog ?? "export-as") === "export-as",
  )
  const selectedPreset = exportPresets.find((asset) => asset.id === selectedPresetId)
  const metadataCapable = format === "png" || format === "jpeg" || format === "tiff" || format === "webp" || format === "avif" || format === "svg" || format === "tga" || format === "ppm" || format === "pgm" || format === "pbm"
  const browserEncoderDiagnostic = encoderDiagnostics.find((item) => item.format === format)

  const outW = Math.max(1, Math.round(activeDoc.width * scaleRatio))
  const outH = Math.max(1, Math.round(activeDoc.height * scaleRatio))
  const outputSizeError = canvasSizeError(outW, outH, "Export")
  const limitationReport = createExportLimitationReport(activeDoc, {
    format,
    includeMetadata,
    interlaced,
    progressive,
    tiffCompression,
    tgaRle,
    transparent,
    quality,
  })
  const compatibilityManifest = createExportCompatibilityManifest(activeDoc, {
    format,
    includeMetadata,
    interlaced,
    progressive,
    tiffCompression,
    tgaRle,
    transparent,
    quality,
  })
  const visibleLimitations = limitationReport.items.filter((item) =>
    item.status === "flattened" || item.status === "approximated" || item.status === "unsupported",
  )
  const visibleManifestItems = compatibilityManifest.entries
    .filter((item) => item.label !== "Layer structure" && (item.status === "unsupported" || item.status === "flattened" || item.status === "approximated"))
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
    try {
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
        const dataUrl = await exportAnimationDataUrl(activeDoc, format, { transparent, matte, scale: scaleRatio })
        downloadDataUrl(dataUrl, `${safeName}.${EXPORT_EXTENSIONS[format]}`)
      } else {
        const blob = await exportRasterBlob(activeDoc, {
          format,
          scale: scaleRatio,
          quality: losslessWebp && format === "webp" ? 1 : quality / 100,
          transparent,
          matte,
          dither,
          interlaced,
          progressive,
          tiffCompression,
          tgaRle,
          webpLossless: losslessWebp && format === "webp",
          webpNearLossless: format === "webp" ? webpNearLossless : undefined,
          webpMethod: format === "webp" ? webpMethod : undefined,
          webpExactAlpha: format === "webp" ? webpExactAlpha : undefined,
          ...encoderMetadataOptions(),
          avifLossless: avifLossless && format === "avif",
          avifSpeed: format === "avif" ? avifSpeed : undefined,
          avifBitDepth: format === "avif" ? avifBitDepth : undefined,
          avifChromaSubsampling: format === "avif" ? avifChromaSubsampling : undefined,
          avifTileRowsLog2: format === "avif" ? avifTileRowsLog2 : undefined,
          avifTileColsLog2: format === "avif" ? avifTileColsLog2 : undefined,
          includeMetadata,
          metadata: metadataPayload(),
        })
        downloadBlob(blob, `${safeName}.${EXPORT_EXTENSIONS[format]}`)
      }
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`)
      return
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
    webpNearLossless,
    webpMethod,
    webpExactAlpha,
    webpAlphaQuality,
    webpAlphaFilter,
    avifLossless,
    avifSpeed,
    avifBitDepth,
    avifChromaSubsampling,
    avifTileRowsLog2,
    avifTileColsLog2,
    tgaJobName,
    tgaSoftwareId,
    tgaAspectRatioNumerator,
    tgaAspectRatioDenominator,
    tgaGamma,
    netpbmComments,
    netpbmSourceMaxValue,
    includeMetadata,
    precision,
    tiffCompression,
    tgaRle,
    metadataAuthor,
    metadataCopyright,
    metadataDescription,
    metadataCreationDate,
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
    if (typeof payload.webpNearLossless === "number") setWebpNearLossless(Math.max(0, Math.min(100, Math.round(payload.webpNearLossless))))
    if (typeof payload.webpMethod === "number") setWebpMethod(Math.max(0, Math.min(6, Math.round(payload.webpMethod))))
    if (typeof payload.webpExactAlpha === "boolean") setWebpExactAlpha(payload.webpExactAlpha)
    if (typeof payload.webpAlphaQuality === "number") setWebpAlphaQuality(Math.max(0, Math.min(100, Math.round(payload.webpAlphaQuality))))
    if (payload.webpAlphaFilter === "none" || payload.webpAlphaFilter === "fast" || payload.webpAlphaFilter === "best") setWebpAlphaFilter(payload.webpAlphaFilter)
    if (typeof payload.avifLossless === "boolean") setAvifLossless(payload.avifLossless)
    if (typeof payload.avifSpeed === "number") setAvifSpeed(Math.max(0, Math.min(10, Math.round(payload.avifSpeed))))
    if (typeof payload.avifBitDepth === "number") setAvifBitDepth(payload.avifBitDepth >= 10 ? 10 : 8)
    if (typeof payload.avifChromaSubsampling === "string") setAvifChromaSubsampling(payload.avifChromaSubsampling)
    if (typeof payload.avifTileRowsLog2 === "number") setAvifTileRowsLog2(Math.max(0, Math.min(4, Math.round(payload.avifTileRowsLog2))))
    if (typeof payload.avifTileColsLog2 === "number") setAvifTileColsLog2(Math.max(0, Math.min(4, Math.round(payload.avifTileColsLog2))))
    if (typeof payload.tgaJobName === "string") setTgaJobName(payload.tgaJobName)
    if (typeof payload.tgaSoftwareId === "string") setTgaSoftwareId(payload.tgaSoftwareId)
    if (typeof payload.tgaAspectRatioNumerator === "number") setTgaAspectRatioNumerator(Math.max(1, Math.min(65535, Math.round(payload.tgaAspectRatioNumerator))))
    if (typeof payload.tgaAspectRatioDenominator === "number") setTgaAspectRatioDenominator(Math.max(1, Math.min(65535, Math.round(payload.tgaAspectRatioDenominator))))
    if (typeof payload.tgaGamma === "number") setTgaGamma(Math.max(0.01, Math.min(65.535, payload.tgaGamma)))
    if (typeof payload.netpbmComments === "string") setNetpbmComments(payload.netpbmComments)
    if (typeof payload.netpbmSourceMaxValue === "number") setNetpbmSourceMaxValue(Math.max(1, Math.min(65535, Math.round(payload.netpbmSourceMaxValue))))
    if (typeof payload.includeMetadata === "boolean") setIncludeMetadata(payload.includeMetadata)
    if (payload.tiffCompression) setTiffCompression(payload.tiffCompression)
    if (typeof payload.tgaRle === "boolean") setTgaRle(payload.tgaRle)
    if (typeof payload.metadataAuthor === "string") setMetadataAuthor(payload.metadataAuthor)
    if (typeof payload.metadataCopyright === "string") setMetadataCopyright(payload.metadataCopyright)
    if (typeof payload.metadataDescription === "string") setMetadataDescription(payload.metadataDescription)
    if (typeof payload.metadataCreationDate === "string") setMetadataCreationDate(payload.metadataCreationDate)
    if (typeof payload.precision === "number") setPrecision(Math.max(0, Math.min(6, payload.precision)))
  }

  const setAssetLibrary = (assets: AssetLibraryItem[], label: string) => {
    dispatch({ type: "set-asset-library", assets })
    window.setTimeout(() => commit(label, []), 0)
  }

  const savePreset = () => {
    const trimmed = presetName.trim()
    if (!trimmed) return
    const next = upsertExportPresetAsset(activeDoc.assetLibrary ?? [], {
      name: trimmed,
      payload: currentPresetPayload(),
    })
    setAssetLibrary(next, "Save Export Preset")
    setSelectedPresetId(next[0]?.id ?? "")
    toast.success("Export preset saved")
  }

  const updatePreset = () => {
    if (!selectedPresetId) return
    const trimmed = presetName.trim() || selectedPreset?.name || "Export Preset"
    const next = upsertExportPresetAsset(activeDoc.assetLibrary ?? [], {
      id: selectedPresetId,
      name: trimmed,
      payload: currentPresetPayload(),
    })
    setAssetLibrary(next, "Update Export Preset")
    toast.success("Export preset updated")
  }

  const duplicatePreset = () => {
    if (!selectedPresetId) return
    const next = duplicateExportPresetAsset(activeDoc.assetLibrary ?? [], selectedPresetId)
    setAssetLibrary(next, "Duplicate Export Preset")
    setSelectedPresetId(next[0]?.id ?? "")
    setPresetName(next[0]?.name ?? "")
    toast.success("Export preset duplicated")
  }

  const deletePreset = () => {
    if (!selectedPresetId) return
    const next = deleteExportPresetAsset(activeDoc.assetLibrary ?? [], selectedPresetId)
    setAssetLibrary(next, "Delete Export Preset")
    setSelectedPresetId("")
    toast.success("Export preset deleted")
  }

  const exportPresetLibrary = () => {
    downloadText(serializeExportPresetLibrary(exportPresets), "export-presets.json")
  }

  const importPresetLibrary = async (file: File | undefined) => {
    if (!file) return
    try {
      const imported = parseExportPresetLibrary(await file.text())
      if (!imported.length) throw new Error("No export presets found in this file")
      const existing = activeDoc.assetLibrary ?? []
      const importedIds = new Set(imported.map((asset) => asset.id))
      const next = [...imported, ...existing.filter((asset) => !importedIds.has(asset.id))]
      setAssetLibrary(next, "Import Export Presets")
      setSelectedPresetId(imported[0].id)
      setPresetName(imported[0].name)
      toast.success(`Imported ${imported.length} export preset${imported.length === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import export presets")
    } finally {
      if (presetImportRef.current) presetImportRef.current.value = ""
    }
  }
  const colorSettings: ColorManagementSettings = {
    ...DEFAULT_COLOR_MANAGEMENT,
    ...(activeDoc.colorManagement ?? {}),
  }
  const updateColorSettings = (patch: Partial<ColorManagementSettings>, label: string) => {
    dispatch({ type: "set-color-management", settings: { ...colorSettings, ...patch } })
    window.setTimeout(() => {
      commit(label, "all")
      refreshPreview()
    }, 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-32px)] overflow-y-auto sm:max-w-[760px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Export As</DialogTitle>
          <DialogDescription className="sr-only">
            Configure document export format, scale, transparency, quality, and metadata.
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="export-decision-wizard"
          className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2"
        >
          <div className="mb-1.5 text-[11px] font-medium text-[var(--ps-text)]">What is this export for?</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {EXPORT_DECISIONS.map((decision) => {
              const isActive = decisionTarget === decision.id
              return (
                <button
                  key={decision.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setDecisionTarget(decision.id)
                    setFormat(decision.format)
                  }}
                  className={cn(
                    "rounded-sm border px-2 py-1.5 text-left text-[11px] leading-tight",
                    isActive
                      ? "border-[var(--ps-accent)] bg-[var(--ps-accent)]/15 text-[var(--ps-text)]"
                      : "border-[var(--ps-divider)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]",
                  )}
                >
                  {decision.label}
                </button>
              )
            })}
          </div>
          {selectedDecision ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-300">Preserved</div>
                <ul data-testid="export-preserved-list" className="grid list-disc gap-0.5 pl-3.5 text-[10px] text-[var(--ps-text-dim)]">
                  {selectedDecision.preserved.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-amber-300">Flattened / lost</div>
                <ul data-testid="export-flattened-list" className="grid list-disc gap-0.5 pl-3.5 text-[10px] text-[var(--ps-text-dim)]">
                  {selectedDecision.flattened.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-between gap-2 sm:col-span-2">
                <span className="min-w-0 flex-1 text-[10px] text-[var(--ps-text-dim)]">
                  {selectedDecision.blurb} Recommended format: {selectedDecision.format.toUpperCase()}.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-[11px]"
                  onClick={() => {
                    dispatchPhotoshopEvent("ps-open-preflight")
                    onOpenChange(false)
                  }}
                >
                  Run Preflight
                </Button>
              </div>
            </div>
          ) : null}
        </div>
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
              <input
                ref={presetImportRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  void importPresetLibrary(event.target.files?.[0])
                }}
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={selectedPresetId}
                  aria-label="Saved export preset"
                  onChange={(event) => {
                    const id = event.target.value
                    setSelectedPresetId(id)
                    const asset = exportPresets.find((item) => item.id === id)
                    if (asset) setPresetName(asset.name)
                  }}
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
              <div className="mt-2 grid grid-cols-3 gap-1">
                <Button type="button" variant="outline" size="sm" onClick={savePreset}>
                  <Save className="h-3.5 w-3.5" />
                  Save New
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!selectedPresetId} onClick={updatePreset}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Update
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!selectedPresetId} onClick={duplicatePreset}>
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!selectedPresetId} onClick={deletePreset}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!exportPresets.length} onClick={exportPresetLibrary}>
                  <FileJson className="h-3.5 w-3.5" />
                  Export JSON
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => presetImportRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />
                  Import JSON
                </Button>
              </div>
              {selectedPreset ? (
                <div className="mt-2 truncate text-[10px] text-[var(--ps-text-dim)]">
                  Selected: {selectedPreset.name}
                </div>
              ) : null}
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

            <Panel title="Color Pipeline">
              <div className="grid gap-2 text-[11px]">
                <label className="grid gap-1">
                  <span className="text-[var(--ps-text-dim)]">Assigned profile</span>
                  <select
                    value={colorSettings.assignedProfile}
                    onChange={(event) => updateColorSettings({ assignedProfile: event.target.value as ColorManagementSettings["assignedProfile"] }, "Export Assigned Profile")}
                    className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2"
                    aria-label="Export assigned profile"
                  >
                    {supportedIccProfileNames().map((profile) => (
                      <option key={profile} value={profile}>{profile}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[var(--ps-text-dim)]">Working / export profile</span>
                  <select
                    value={colorSettings.workingSpace}
                    onChange={(event) => updateColorSettings({ workingSpace: event.target.value as ColorManagementSettings["workingSpace"] }, "Export Working Profile")}
                    className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2"
                    aria-label="Export working profile"
                  >
                    {supportedIccProfileNames().map((profile) => (
                      <option key={profile} value={profile}>{profile}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[var(--ps-text-dim)]">Rendering intent</span>
                  <select
                    value={colorSettings.renderingIntent}
                    onChange={(event) => updateColorSettings({ renderingIntent: event.target.value as ColorManagementSettings["renderingIntent"] }, "Export Rendering Intent")}
                    className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2"
                    aria-label="Export rendering intent"
                  >
                    {(["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"] as const).map((intent) => (
                      <option key={intent} value={intent}>{intent}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <CheckRow
                    label="Use proof profile"
                    checked={colorSettings.proofColors && colorSettings.proofProfile !== "None"}
                    onCheckedChange={(checked) => updateColorSettings({
                      proofColors: checked,
                      proofProfile: checked && colorSettings.proofProfile === "None" ? "Working CMYK" : colorSettings.proofProfile,
                    }, checked ? "Export Proof Profile On" : "Export Proof Profile Off")}
                  />
                  <CheckRow
                    label="Gamut overlay"
                    checked={colorSettings.gamutWarning}
                    onCheckedChange={(checked) => updateColorSettings({ gamutWarning: checked }, checked ? "Export Gamut Warning On" : "Export Gamut Warning Off")}
                  />
                </div>
                <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
                  Source {colorSettings.assignedProfile}; export {colorSettings.proofColors && colorSettings.proofProfile !== "None" ? colorSettings.proofProfile : colorSettings.workingSpace}; intent {colorSettings.renderingIntent}; plate view {(colorSettings.proofChannels?.length ?? 0) ? colorSettings.proofChannels!.join(", ") : "composite"}.
                </div>
              </div>
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
                  <CheckRow label="TGA RLE" checked={tgaRle} onCheckedChange={setTgaRle} disabled={format !== "tga"} />
                  <CheckRow label="Lossless WebP" checked={losslessWebp} onCheckedChange={setLosslessWebp} disabled={format !== "webp"} />
                  <CheckRow label="Embed Metadata" checked={includeMetadata} onCheckedChange={setIncludeMetadata} disabled={!metadataCapable} />
                </div>
                {(format === "webp" || format === "avif") && browserEncoderDiagnostic ? (
                  <div
                    className={cn(
                      "mt-3 rounded-sm border px-2 py-1.5 text-[10px]",
                      browserEncoderDiagnostic.supported
                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
                        : "border-red-500/35 bg-red-500/10 text-red-100",
                    )}
                  >
                    <div className="font-medium">{format.toUpperCase()} browser encoder</div>
                    <div>{browserEncoderDiagnostic.message}</div>
                    {includeMetadata ? (
                      <div className="mt-1 text-[var(--ps-text-dim)]">
                        Metadata post-processing requires the browser to return a real {browserEncoderDiagnostic.requestedMime} blob.
                      </div>
                    ) : null}
                    {!browserEncoderDiagnostic.supported ? (
                      <AlternativesRow
                        alternatives={[
                          { format: "png", label: "Use PNG", reason: "PNG is universally supported by the browser canvas encoder." },
                          { format: "jpeg", label: "Use JPEG", reason: "JPEG is universally supported by the browser canvas encoder (no alpha)." },
                        ]}
                        onPick={setFormat}
                        testId="export-encoder-alt"
                      />
                    ) : null}
                  </div>
                ) : null}
                {format === "webp" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Near-lossless</Label>
                      <Input
                        aria-label="WebP near-lossless"
                        type="number"
                        min={0}
                        max={100}
                        value={webpNearLossless}
                        onChange={(event) => setWebpNearLossless(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Method</Label>
                      <select
                        aria-label="WebP method"
                        value={webpMethod}
                        onChange={(event) => setWebpMethod(Math.max(0, Math.min(6, Number(event.target.value) || 0)))}
                        className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                      >
                        {[0, 1, 2, 3, 4, 5, 6].map((method) => (
                          <option key={method} value={method}>{method}</option>
                        ))}
                      </select>
                    </div>
                    <CheckRow label="Exact alpha" checked={webpExactAlpha} onCheckedChange={setWebpExactAlpha} />
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Alpha quality</Label>
                      <Input
                        aria-label="WebP alpha quality"
                        type="number"
                        min={0}
                        max={100}
                        value={webpAlphaQuality}
                        onChange={(event) => setWebpAlphaQuality(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Alpha filter</Label>
                      <select
                        aria-label="WebP alpha filter"
                        value={webpAlphaFilter}
                        onChange={(event) => setWebpAlphaFilter(event.target.value as WebpAlphaFilter)}
                        className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                      >
                        <option value="none">None</option>
                        <option value="fast">Fast</option>
                        <option value="best">Best</option>
                      </select>
                    </div>
                  </div>
                ) : null}
                {format === "avif" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <CheckRow label="AVIF lossless" checked={avifLossless} onCheckedChange={setAvifLossless} />
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Speed</Label>
                      <Input
                        aria-label="AVIF speed"
                        type="number"
                        min={0}
                        max={10}
                        value={avifSpeed}
                        onChange={(event) => setAvifSpeed(Math.max(0, Math.min(10, Math.round(Number(event.target.value) || 0))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Bit depth</Label>
                      <select
                        aria-label="AVIF bit depth"
                        value={avifBitDepth}
                        onChange={(event) => setAvifBitDepth(Number(event.target.value))}
                        className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                      >
                        <option value={8}>8-bit</option>
                        <option value={10}>10-bit</option>
                      </select>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Chroma</Label>
                      <select
                        aria-label="AVIF chroma"
                        value={avifChromaSubsampling}
                        onChange={(event) => setAvifChromaSubsampling(event.target.value)}
                        className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                      >
                        <option value="4:2:0">4:2:0</option>
                        <option value="4:2:2">4:2:2</option>
                        <option value="4:4:4">4:4:4</option>
                      </select>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Tile rows</Label>
                      <Input
                        aria-label="AVIF tile rows"
                        type="number"
                        min={0}
                        max={4}
                        value={avifTileRowsLog2}
                        onChange={(event) => setAvifTileRowsLog2(Math.max(0, Math.min(4, Math.round(Number(event.target.value) || 0))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Tile cols</Label>
                      <Input
                        aria-label="AVIF tile cols"
                        type="number"
                        min={0}
                        max={4}
                        value={avifTileColsLog2}
                        onChange={(event) => setAvifTileColsLog2(Math.max(0, Math.min(4, Math.round(Number(event.target.value) || 0))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                  </div>
                ) : null}
                {format === "tiff" ? (
                  <div className="mt-3 grid grid-cols-[110px_1fr] items-center gap-2">
                    <Label className="text-[11px] text-[var(--ps-text-dim)]">TIFF compression</Label>
                    <select
                      value={tiffCompression}
                      onChange={(event) => setTiffCompression(event.target.value as TiffCompression)}
                      className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
                    >
                      <option value="none">None</option>
                      <option value="lzw">LZW</option>
                      <option value="deflate">Deflate</option>
                    </select>
                  </div>
                ) : null}
                {format === "tga" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <Input
                      aria-label="TGA job name"
                      placeholder="Job name"
                      value={tgaJobName}
                      onChange={(event) => setTgaJobName(event.target.value)}
                      className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                    />
                    <Input
                      aria-label="TGA software ID"
                      placeholder="Software ID"
                      value={tgaSoftwareId}
                      onChange={(event) => setTgaSoftwareId(event.target.value)}
                      className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                    />
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Aspect X</Label>
                      <Input
                        aria-label="TGA aspect numerator"
                        type="number"
                        min={1}
                        max={65535}
                        value={tgaAspectRatioNumerator}
                        onChange={(event) => setTgaAspectRatioNumerator(Math.max(1, Math.min(65535, Math.round(Number(event.target.value) || 1))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Aspect Y</Label>
                      <Input
                        aria-label="TGA aspect denominator"
                        type="number"
                        min={1}
                        max={65535}
                        value={tgaAspectRatioDenominator}
                        onChange={(event) => setTgaAspectRatioDenominator(Math.max(1, Math.min(65535, Math.round(Number(event.target.value) || 1))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Gamma</Label>
                      <Input
                        aria-label="TGA gamma"
                        type="number"
                        min={0.01}
                        max={65.535}
                        step={0.01}
                        value={tgaGamma}
                        onChange={(event) => setTgaGamma(Math.max(0.01, Math.min(65.535, Number(event.target.value) || 2.2)))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                  </div>
                ) : null}
                {format === "ppm" || format === "pgm" || format === "pbm" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Source max</Label>
                      <Input
                        aria-label="Netpbm source max value"
                        type="number"
                        min={1}
                        max={65535}
                        value={netpbmSourceMaxValue}
                        onChange={(event) => setNetpbmSourceMaxValue(Math.max(1, Math.min(65535, Math.round(Number(event.target.value) || 255))))}
                        className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-[var(--ps-text-dim)]">Comments</Label>
                      <textarea
                        aria-label="Netpbm comments"
                        value={netpbmComments}
                        onChange={(event) => setNetpbmComments(event.target.value)}
                        className="min-h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[11px]"
                      />
                    </div>
                  </div>
                ) : null}
                {includeMetadata && metadataCapable ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Input
                      aria-label="Metadata author"
                      placeholder="Author"
                      value={metadataAuthor}
                      onChange={(event) => setMetadataAuthor(event.target.value)}
                      className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                    />
                    <Input
                      aria-label="Metadata copyright"
                      placeholder="Copyright"
                      value={metadataCopyright}
                      onChange={(event) => setMetadataCopyright(event.target.value)}
                      className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                    />
                    <Input
                      aria-label="Metadata description"
                      placeholder="Description"
                      value={metadataDescription}
                      onChange={(event) => setMetadataDescription(event.target.value)}
                      className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                    />
                    <Input
                      aria-label="Metadata creation date"
                      placeholder="Creation date"
                      value={metadataCreationDate}
                      onChange={(event) => setMetadataCreationDate(event.target.value)}
                      className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                    />
                  </div>
                ) : null}
                <LimitationsBlock
                  summary={limitationReport.summary}
                  items={visibleLimitations}
                  currentFormat={format}
                  onPickFormat={setFormat}
                />
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
                {format === "tiff" || format === "tga" || format === "ppm" || format === "pgm" || format === "pbm" ? (
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
                <LimitationsBlock
                  summary={limitationReport.summary}
                  items={visibleLimitations}
                  currentFormat={format}
                  onPickFormat={setFormat}
                />
              </Panel>
            ) : (
              <Panel title="SVG Options">
                <div className="grid grid-cols-2 gap-2">
                  <CheckRow label="Transparent Viewport" checked={transparent} onCheckedChange={setTransparent} />
                  <CheckRow label="Include Metadata" checked={includeMetadata} onCheckedChange={setIncludeMetadata} />
                </div>
                <LimitationsBlock
                  summary={limitationReport.summary}
                  items={visibleLimitations}
                  currentFormat={format}
                  onPickFormat={setFormat}
                />
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
                <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="uppercase tracking-wide text-[var(--ps-text-dim)]">Compatibility score</span>
                    <span className={cn(
                      "tabular-nums",
                      compatibilityManifest.score.overall >= 85
                        ? "text-emerald-300"
                        : compatibilityManifest.score.overall >= 60
                          ? "text-amber-300"
                          : "text-red-300",
                    )}>
                      {compatibilityManifest.score.overall}/100
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {compatibilityManifest.score.categories.map((category) => (
                      <div key={category.id} title={category.detail} className="flex items-center justify-between gap-2 rounded-sm bg-[var(--ps-panel)] px-1.5 py-1">
                        <span className="truncate">{category.label}</span>
                        <span className={cn(
                          "tabular-nums",
                          category.status === "strong"
                            ? "text-emerald-300"
                            : category.status === "mixed"
                              ? "text-amber-300"
                              : "text-red-300",
                        )}>
                          {category.score}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {compatibilityManifest.fixActions.length ? (
                  <div className="space-y-1.5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5">
                    <div className="uppercase tracking-wide text-[var(--ps-text-dim)]">Fix before export</div>
                    {compatibilityManifest.fixActions.slice(0, 4).map((action) => (
                      <div key={action.id} className="grid grid-cols-[1fr_auto] items-start gap-2">
                        <div>
                          <div className="text-[var(--ps-text)]">{action.label}</div>
                          <div className="text-[var(--ps-text-dim)]">{action.detail}</div>
                        </div>
                        {action.primaryFormat && action.primaryFormat !== format ? (
                          <button
                            type="button"
                            onClick={() => setFormat(action.primaryFormat!)}
                            className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)] hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-100"
                          >
                            Use {action.primaryFormat.toUpperCase()}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-sm border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5">
                    <div className="mb-1 uppercase tracking-wide text-emerald-200">Preserved</div>
                    {compatibilityManifest.preservationSummary.preserved.slice(0, 3).map((item) => (
                      <div key={`${item.label}-${item.status}`} className="truncate text-[var(--ps-text-dim)]" title={item.detail}>{item.label}</div>
                    ))}
                  </div>
                  <div className="rounded-sm border border-amber-500/25 bg-amber-500/5 px-2 py-1.5">
                    <div className="mb-1 uppercase tracking-wide text-amber-200">Changed</div>
                    {compatibilityManifest.preservationSummary.changed.slice(0, 3).map((item) => (
                      <div key={`${item.label}-${item.status}`} className="truncate text-[var(--ps-text-dim)]" title={item.detail}>{item.label}</div>
                    ))}
                  </div>
                </div>
                {compatibilityManifest.warnings.length ? (
                  <div className="space-y-1.5 rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-amber-100" data-testid="export-warnings">
                    {compatibilityManifest.warnings.slice(0, 4).map((warning) => {
                      const alts = alternativesForWarning(format, warning)
                      return (
                        <div key={warning} className="flex flex-col gap-1">
                          <div className="flex gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{warning}</span>
                          </div>
                          {alts.length ? (
                            <AlternativesRow
                              alternatives={alts}
                              onPick={setFormat}
                              testId={`export-warning-alt-${warning.slice(0, 32).replace(/\s+/g, "-").toLowerCase()}`}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
                {visibleManifestItems.length ? (
                  <div className="grid gap-1.5 text-[var(--ps-text-dim)]">
                    {visibleManifestItems.map((item) => {
                      const alts = alternativesForLimitation(format, item)
                      return (
                        <div key={`${item.label}-${item.status}`} className="grid grid-cols-[84px_1fr] gap-2">
                          <span className="uppercase tracking-wide text-[var(--ps-text)]">{item.status}</span>
                          <div>
                            <div>{item.label}: {item.detail}</div>
                            {alts.length ? (
                              <AlternativesRow
                                alternatives={alts}
                                onPick={setFormat}
                                testId={`export-manifest-alt-${item.label.replace(/\s+/g, "-").toLowerCase()}`}
                              />
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
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

function AlternativesRow({
  alternatives,
  onPick,
  testId,
}: {
  alternatives: ExportAlternative[]
  onPick: (format: ExportFormat) => void
  testId?: string
}) {
  if (!alternatives.length) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid={testId}>
      <span className="text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">Try:</span>
      {alternatives.map((alt) => (
        <button
          key={alt.format}
          type="button"
          title={alt.reason}
          onClick={() => onPick(alt.format as ExportFormat)}
          className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)] hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-100"
        >
          {alt.label}
        </button>
      ))}
    </div>
  )
}

function LimitationsBlock({
  summary,
  items,
  currentFormat,
  onPickFormat,
}: {
  summary: string
  items: CompatibilityManifestEntry[]
  currentFormat: ExportFormat
  onPickFormat: (format: ExportFormat) => void
}) {
  return (
    <div
      className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]"
      data-testid="export-limitations"
    >
      <div className="mb-1 font-medium text-[var(--ps-text)]">{summary}</div>
      <div className="grid gap-1.5">
        {items.map((item) => {
          const alternatives = alternativesForLimitation(currentFormat, item)
          return (
            <div key={`${item.label}-${item.status}`} className="grid grid-cols-[92px_1fr] gap-2">
              <span className="uppercase tracking-wide text-amber-300">{item.status}</span>
              <div>
                <div>{item.label}: {item.detail}</div>
                <AlternativesRow
                  alternatives={alternatives}
                  onPick={onPickFormat}
                  testId={`export-limitation-alt-${item.label.replace(/\s+/g, "-").toLowerCase()}`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
