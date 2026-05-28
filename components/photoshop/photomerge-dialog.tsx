"use client"

import * as React from "react"
import { toast } from "sonner"
import { FileImage, FilePlus2, FolderOpen, ImagePlus, Layers, Trash2, WandSparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { makeCanvas, makeDocument, useEditor } from "./editor-context"
import { loadRasterCanvasFromFile, renderDocumentComposite } from "./document-io"
import { photomergeImageStack } from "./photo-workflow-engine"
import { contentAwareFill } from "./tool-helpers"
import {
  applyPhotomergeBoundaryWarp,
  buildPhotomergeEngineOptions,
  buildPhotomergePreviewLayout,
  findTransparentFillRegion,
  removePhotomergeVignette,
  type PhotomergeBlendMode,
  type PhotomergeLensModel,
  type PhotomergePreviewSource,
  type PhotomergeWorkspaceSettings,
} from "./photomerge-workspace"
import type { Layer } from "./types"
import type { PanoramaAlignmentModel, PanoramaProjection } from "./photo-workflow-engine"

interface PhotomergeSource extends PhotomergePreviewSource {
  file: File | null
  canvas: HTMLCanvasElement
  thumbnail: string
  warnings: string[]
  origin: "file" | "folder" | "document"
}

type PhotomergeLayoutId =
  | "auto"
  | "perspective"
  | "cylindrical"
  | "spherical"
  | "collage"
  | "reposition"

interface PhotomergeLayoutPreset {
  id: PhotomergeLayoutId
  label: string
  description: string
  alignment: PanoramaAlignmentModel
  projection: PanoramaProjection
}

const LAYOUT_PRESETS: PhotomergeLayoutPreset[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Analyze sources and choose a balanced layout.",
    alignment: "similarity",
    projection: "planar",
  },
  {
    id: "perspective",
    label: "Perspective",
    description: "Use a homography to warp images onto a planar canvas.",
    alignment: "homography",
    projection: "planar",
  },
  {
    id: "cylindrical",
    label: "Cylindrical",
    description: "Wrap onto a cylinder; best for wide horizontal pans.",
    alignment: "similarity",
    projection: "cylindrical",
  },
  {
    id: "spherical",
    label: "Spherical",
    description: "Wrap onto a sphere; best for full 360 captures.",
    alignment: "similarity",
    projection: "spherical",
  },
  {
    id: "collage",
    label: "Collage",
    description: "Affine alignment that keeps layered tiles editable.",
    alignment: "affine",
    projection: "planar",
  },
  {
    id: "reposition",
    label: "Reposition",
    description: "Translate-only alignment without rotation or warp.",
    alignment: "translation",
    projection: "planar",
  },
]

function layoutPresetForSettings(settings: PhotomergeWorkspaceSettings): PhotomergeLayoutId {
  const match = LAYOUT_PRESETS.find(
    (preset) => preset.alignment === settings.alignmentModel && preset.projection === settings.projection,
  )
  return match ? match.id : "auto"
}

const DEFAULT_SETTINGS: PhotomergeWorkspaceSettings = {
  alignmentModel: "similarity",
  projection: "planar",
  blendImages: true,
  blendMode: "multiband",
  vignetteRemoval: false,
  geometricCorrection: false,
  lensModel: "wide",
  focalLengthPx: 0,
  contentAwareFillTransparent: false,
  boundaryWarp: 0,
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px] text-[var(--ps-text-dim)]">{label}</Label>
      {children}
    </div>
  )
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-7 items-center gap-2 text-[11px] text-[var(--ps-text)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--ps-accent)]"
      />
      <span>{label}</span>
    </label>
  )
}

const selectClass = "h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
const inputClass = "h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"

export function PhotomergeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { createDocument, documents, activeDocId } = useEditor()
  const [sources, setSources] = React.useState<PhotomergeSource[]>([])
  const [settings, setSettings] = React.useState<PhotomergeWorkspaceSettings>(DEFAULT_SETTINGS)
  const [busy, setBusy] = React.useState(false)
  const [dragActive, setDragActive] = React.useState(false)
  const [selectedSourceIds, setSelectedSourceIds] = React.useState<string[]>([])
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const folderInputRef = React.useRef<HTMLInputElement | null>(null)
  const previewRef = React.useRef<HTMLCanvasElement | null>(null)
  const activeLayoutPreset = layoutPresetForSettings(settings)

  const updateSetting = React.useCallback(<K extends keyof PhotomergeWorkspaceSettings>(
    key: K,
    value: PhotomergeWorkspaceSettings[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }, [])

  const importFiles = React.useCallback(async (
    files: FileList | File[],
    origin: PhotomergeSource["origin"] = "file",
  ) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name))
    if (!imageFiles.length) {
      toast.error("Choose one or more image files")
      return
    }

    setBusy(true)
    try {
      const imported: PhotomergeSource[] = []
      const stamp = Date.now()
      for (let index = 0; index < imageFiles.length; index++) {
        const file = imageFiles[index]
        const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
        imported.push({
          id: `${file.name}-${file.lastModified}-${stamp}-${index}`,
          file,
          name: file.name,
          width: raster.canvas.width,
          height: raster.canvas.height,
          canvas: raster.canvas,
          thumbnail: thumbnailForCanvas(raster.canvas),
          warnings: raster.warnings ?? [],
          origin,
        })
      }
      setSources((current) => [...current, ...imported])
      toast.success(`Imported ${imported.length} source file${imported.length === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import Photomerge sources")
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
      if (folderInputRef.current) folderInputRef.current.value = ""
    }
  }, [])

  const addOpenFiles = React.useCallback(() => {
    if (!documents.length) {
      toast.error("No open documents to add")
      return
    }
    setBusy(true)
    try {
      const stamp = Date.now()
      const imported: PhotomergeSource[] = []
      let skipped = 0
      documents.forEach((doc, index) => {
        try {
          const composite = renderDocumentComposite(doc, { matte: doc.background ?? "#ffffff" })
          imported.push({
            id: `doc-${doc.id}-${stamp}-${index}`,
            file: null,
            name: doc.name || `Document ${index + 1}`,
            width: composite.width,
            height: composite.height,
            canvas: composite,
            thumbnail: thumbnailForCanvas(composite),
            warnings: [],
            origin: "document",
          })
        } catch {
          skipped++
        }
      })
      if (!imported.length) {
        toast.error("Could not read open documents")
        return
      }
      setSources((current) => {
        const known = new Set(current.map((source) => source.name + ":" + source.width + "x" + source.height))
        const additions = imported.filter((source) => !known.has(source.name + ":" + source.width + "x" + source.height))
        if (!additions.length) {
          toast.info("All open documents are already in the source list")
          return current
        }
        return [...current, ...additions]
      })
      const added = imported.length - skipped
      if (added > 0) toast.success(`Added ${added} open document${added === 1 ? "" : "s"}`)
      if (skipped > 0) toast.warning(`Skipped ${skipped} document${skipped === 1 ? "" : "s"} that could not be composed`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add open documents")
    } finally {
      setBusy(false)
    }
  }, [documents])

  const applyLayoutPreset = React.useCallback((presetId: PhotomergeLayoutId) => {
    const preset = LAYOUT_PRESETS.find((candidate) => candidate.id === presetId)
    if (!preset) return
    setSettings((current) => ({
      ...current,
      alignmentModel: preset.alignment,
      projection: preset.projection,
    }))
  }, [])

  const toggleSourceSelection = React.useCallback((id: string, additive: boolean) => {
    setSelectedSourceIds((current) => {
      if (additive) {
        return current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
      }
      return current.length === 1 && current[0] === id ? [] : [id]
    })
  }, [])

  React.useEffect(() => {
    setSelectedSourceIds((current) => current.filter((id) => sources.some((source) => source.id === id)))
  }, [sources])

  React.useEffect(() => {
    if (!open) {
      setSelectedSourceIds([])
    }
  }, [open])

  // activeDocId is read only to keep Add Open Files responsive when the
  // editor switches documents; the effect intentionally re-evaluates the
  // memoized handler when the active doc id changes.
  React.useEffect(() => {
    void activeDocId
  }, [activeDocId])

  React.useEffect(() => {
    drawPreview(previewRef.current, sources, settings.projection)
  }, [sources, settings.projection])

  const removeSource = (id: string) => {
    setSources((current) => current.filter((source) => source.id !== id))
    setSelectedSourceIds((current) => current.filter((value) => value !== id))
  }

  const removeSelectedSources = () => {
    if (!selectedSourceIds.length) {
      toast.error("Select at least one source to remove")
      return
    }
    const ids = new Set(selectedSourceIds)
    setSources((current) => current.filter((source) => !ids.has(source.id)))
    setSelectedSourceIds([])
  }

  const clearSources = () => {
    setSources([])
    setSelectedSourceIds([])
  }

  const createPanorama = async () => {
    if (!sources.length) return
    setBusy(true)
    try {
      const images = sources.map((source) => {
        const image = canvasImageData(source.canvas)
        return settings.vignetteRemoval ? removePhotomergeVignette(image) : image
      })
      const result = photomergeImageStack(
        images,
        buildPhotomergeEngineOptions(settings, photomergeSearchRadius(sources)),
      )
      const warped = settings.boundaryWarp > 0
        ? applyPhotomergeBoundaryWarp(result.image, settings.boundaryWarp)
        : result.image
      const canvas = imageDataCanvas(warped)

      if (settings.contentAwareFillTransparent) {
        const fill = findTransparentFillRegion(result.image)
        if (fill) {
          contentAwareFill(canvas, fill.bounds, fill.mask, {
            sampling: { mode: "all-except-fill" },
            adaptation: { color: 0.54, rotation: "low", scale: "low", mirror: false },
            patch: {
              fillOrder: "edge-first",
              patchRadius: 2,
              searchRadius: Math.min(96, Math.max(12, Math.round(Math.max(fill.bounds.w, fill.bounds.h) * 1.5))),
              candidateBudget: 28,
              boundaryCandidateBudget: 18,
              refinementPasses: 1,
              seamRelaxPasses: 1,
              coherence: 0.68,
            },
          })
        }
      }

      const doc = makeDocument("Photomerge Panorama", canvas.width, canvas.height, "transparent")
      const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId) as Layer | undefined
      if (layer) {
        layer.name = "Photomerge Panorama"
        layer.canvas.getContext("2d")?.drawImage(canvas, 0, 0)
      }
      if (doc.metadata) doc.metadata.description = [
        `Photomerge from ${sources.length} source file${sources.length === 1 ? "" : "s"}.`,
        `Projection: ${settings.projection}.`,
        `Alignment: ${settings.alignmentModel}.`,
        `Blend: ${settings.blendImages ? settings.blendMode : "off"}.`,
        settings.vignetteRemoval ? "Vignette removal applied." : "",
        settings.geometricCorrection ? `Geometric correction: ${settings.lensModel}.` : "",
        settings.boundaryWarp > 0 ? `Boundary warp: ${settings.boundaryWarp}%.` : "",
        settings.contentAwareFillTransparent ? "Transparent areas filled with content-aware synthesis." : "",
      ].filter(Boolean).join(" ")
      createDocument(doc, "Photomerge")
      onOpenChange(false)
      toast.success("Photomerge panorama created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Photomerge failed")
    } finally {
      setBusy(false)
    }
  }

  const handleDrop = async (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    await importFiles(event.dataTransfer.files)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="photomerge-dialog"
        className="max-h-[calc(100vh-32px)] overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)] sm:max-w-[1040px]"
      >
        <DialogHeader>
          <DialogTitle>Photomerge</DialogTitle>
          <DialogDescription className="sr-only">
            Select source images, preview the panorama layout, configure projection and correction options, then create a merged document.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-[420px] grid-cols-[300px_minmax(320px,1fr)_260px] gap-4">
          <section className="flex min-h-0 flex-col gap-3">
            <div className="flex h-7 items-center justify-between">
              <h3 className="text-[12px] font-semibold">Source Files</h3>
              <span className="text-[11px] text-[var(--ps-text-dim)]">
                {sources.length === 0 ? "No sources" : `${sources.length} source file${sources.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                data-testid="photomerge-add-files"
              >
                <FilePlus2 className="mr-1 h-3.5 w-3.5" /> Add Files
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={addOpenFiles}
                disabled={busy || documents.length === 0}
                data-testid="photomerge-add-open-files"
              >
                <Layers className="mr-1 h-3.5 w-3.5" /> Add Open Files
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => folderInputRef.current?.click()}
                disabled={busy}
                data-testid="photomerge-browse-folder"
              >
                <FolderOpen className="mr-1 h-3.5 w-3.5" /> Browse Folder
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={removeSelectedSources}
                disabled={busy || selectedSourceIds.length === 0}
                data-testid="photomerge-remove-selected"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            </div>
            <label
              onDragEnter={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={cn(
                "flex h-20 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed bg-[var(--ps-panel-2)] text-[11px] text-[var(--ps-text-dim)] transition-colors",
                dragActive ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)] text-[var(--ps-text)]" : "border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]",
              )}
            >
              <ImagePlus className="mb-1 h-5 w-5" />
              <span>{sources.length ? "Add more images" : "Drop images or choose files"}</span>
              <span className="mt-1 text-[10px]">PNG, JPEG, WebP, GIF, BMP</span>
              <input
                ref={fileInputRef}
                data-testid="photomerge-file-input"
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void importFiles(event.target.files, "file")
                }}
              />
              <input
                ref={folderInputRef}
                data-testid="photomerge-folder-input"
                type="file"
                multiple
                accept="image/*"
                // webkitdirectory is non-standard but widely supported in
                // Chromium/WebKit browsers; ignored in browsers that lack it,
                // which is the safe fallback for a browser-local editor.
                {...{ webkitdirectory: "", directory: "" }}
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void importFiles(event.target.files, "folder")
                }}
              />
            </label>

            <div
              data-testid="photomerge-source-list"
              className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
            >
              {sources.length ? (
                <div className="divide-y divide-[var(--ps-divider)]">
                  {sources.map((source, index) => {
                    const selected = selectedSourceIds.includes(source.id)
                    return (
                      <div
                        key={source.id}
                        role="option"
                        aria-selected={selected}
                        onClick={(event) => toggleSourceSelection(source.id, event.metaKey || event.ctrlKey || event.shiftKey)}
                        className={cn(
                          "grid cursor-pointer grid-cols-[52px_1fr_28px] items-center gap-2 p-2 transition-colors",
                          selected ? "bg-[var(--ps-tool-active)]" : "hover:bg-[var(--ps-tool-hover)]",
                        )}
                      >
                        <div className="flex h-10 w-12 items-center justify-center overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-chrome)]">
                          {source.thumbnail ? (
                            <img src={source.thumbnail} alt="" className="max-h-full max-w-full" />
                          ) : (
                            <FileImage className="h-4 w-4 text-[var(--ps-text-dim)]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[11px]">{source.name}</div>
                          <div className="text-[10px] text-[var(--ps-text-dim)]">
                            {index + 1} - {source.width} x {source.height}px - {originLabel(source.origin)}
                          </div>
                          {source.warnings[0] ? (
                            <div className="truncate text-[10px] text-[#eab308]">{source.warnings[0]}</div>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Remove ${source.name}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            removeSource(source.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="grid h-full min-h-36 place-items-center p-4 text-center text-[11px] text-[var(--ps-text-dim)]">
                  Source images appear here in merge order.
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col gap-3">
            <div className="flex h-7 items-center justify-between">
              <h3 className="text-[12px] font-semibold">Layout Preview</h3>
              <span className="text-[11px] text-[var(--ps-text-dim)]">{projectionLabel(settings.projection)}</span>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-3">
              <canvas
                ref={previewRef}
                width={600}
                height={260}
                aria-label="Photomerge layout preview"
                className="h-full max-h-[360px] w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] object-contain"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-[10px] text-[var(--ps-text-dim)]">
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5">
                Alignment <span className="block text-[var(--ps-text)]">{alignmentLabel(settings.alignmentModel)}</span>
              </div>
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5">
                Blend <span className="block text-[var(--ps-text)]">{settings.blendImages ? blendLabel(settings.blendMode) : "Off"}</span>
              </div>
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5">
                Corrections <span className="block text-[var(--ps-text)]">{correctionCount(settings)} enabled</span>
              </div>
            </div>
          </section>

          <section className="min-h-0 overflow-y-auto pr-1">
            <div className="grid gap-3">
              <h3 className="text-[12px] font-semibold">Layout</h3>
              <div
                role="radiogroup"
                aria-label="Layout preset"
                data-testid="photomerge-layout-presets"
                className="grid grid-cols-2 gap-1.5"
              >
                {LAYOUT_PRESETS.map((preset) => {
                  const selected = preset.id === activeLayoutPreset
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`Layout: ${preset.label}`}
                      title={preset.description}
                      data-testid={`photomerge-layout-${preset.id}`}
                      onClick={() => applyLayoutPreset(preset.id)}
                      className={cn(
                        "flex flex-col items-stretch gap-1 rounded-sm border bg-[var(--ps-panel-2)] p-1.5 text-left text-[10px] transition-colors",
                        selected
                          ? "border-[var(--ps-accent)] ring-1 ring-[var(--ps-accent)]"
                          : "border-[var(--ps-divider)] hover:border-[var(--ps-text-dim)]",
                      )}
                    >
                      <LayoutPresetPreview presetId={preset.id} />
                      <span className="text-[11px] font-semibold text-[var(--ps-text)]">{preset.label}</span>
                    </button>
                  )
                })}
              </div>
              <h3 className="text-[12px] font-semibold">Merge Options</h3>
              <Field label="Layout model">
                <select
                  aria-label="Layout model"
                  value={settings.alignmentModel}
                  onChange={(event) => updateSetting("alignmentModel", event.target.value as PanoramaAlignmentModel)}
                  className={selectClass}
                >
                  <option value="translation">Reposition</option>
                  <option value="similarity">Similarity</option>
                  <option value="affine">Collage / Affine</option>
                  <option value="homography">Perspective / Homography</option>
                </select>
              </Field>
              <Field label="Projection">
                <select
                  aria-label="Projection"
                  value={settings.projection}
                  onChange={(event) => updateSetting("projection", event.target.value as PanoramaProjection)}
                  className={selectClass}
                >
                  <option value="planar">Planar</option>
                  <option value="cylindrical">Cylindrical</option>
                  <option value="spherical">Spherical</option>
                </select>
              </Field>
              <CheckRow
                label="Blend images together"
                checked={settings.blendImages}
                onChange={(checked) => updateSetting("blendImages", checked)}
              />
              <Field label="Blend mode">
                <select
                  aria-label="Blend mode"
                  value={settings.blendMode}
                  disabled={!settings.blendImages}
                  onChange={(event) => updateSetting("blendMode", event.target.value as PhotomergeBlendMode)}
                  className={cn(selectClass, !settings.blendImages && "opacity-50")}
                >
                  <option value="multiband">Multiband</option>
                  <option value="feather">Feather</option>
                </select>
              </Field>
              <div className="h-px bg-[var(--ps-divider)]" />
              <CheckRow
                label="Vignette removal"
                checked={settings.vignetteRemoval}
                onChange={(checked) => updateSetting("vignetteRemoval", checked)}
              />
              <CheckRow
                label="Geometric distortion correction"
                checked={settings.geometricCorrection}
                onChange={(checked) => updateSetting("geometricCorrection", checked)}
              />
              <Field label="Lens profile">
                <select
                  aria-label="Lens profile"
                  value={settings.lensModel}
                  disabled={!settings.geometricCorrection}
                  onChange={(event) => updateSetting("lensModel", event.target.value as PhotomergeLensModel)}
                  className={cn(selectClass, !settings.geometricCorrection && "opacity-50")}
                >
                  <option value="none">None</option>
                  <option value="wide">Wide rectilinear</option>
                  <option value="phone">Phone wide</option>
                </select>
              </Field>
              <Field label="Focal length px">
                <input
                  aria-label="Focal length px"
                  type="number"
                  min={0}
                  step={1}
                  value={settings.focalLengthPx}
                  onChange={(event) => updateSetting("focalLengthPx", Math.max(0, Math.round(Number(event.target.value) || 0)))}
                  className={inputClass}
                />
              </Field>
              <Field label={`Boundary warp: ${settings.boundaryWarp}`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={settings.boundaryWarp}
                  onChange={(event) => updateSetting("boundaryWarp", Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))}
                  aria-label="Boundary warp"
                  data-testid="photomerge-boundary-warp"
                  className="h-2 w-full accent-[var(--ps-accent)]"
                />
              </Field>
              <CheckRow
                label="Content-aware fill transparent areas"
                checked={settings.contentAwareFillTransparent}
                onChange={(checked) => updateSetting("contentAwareFillTransparent", checked)}
              />
            </div>
          </section>
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <div className="flex items-center gap-2 text-[11px] text-[var(--ps-text-dim)]">
            <WandSparkles className="h-3.5 w-3.5" />
            Local browser merge uses decoded pixels and browser canvas limits.
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={clearSources} disabled={!sources.length || busy}>
              Clear
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void createPanorama()} disabled={busy || sources.length < 2}>
              {busy ? "Creating..." : "Create Panorama"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function thumbnailForCanvas(canvas: HTMLCanvasElement) {
  try {
    const maxSide = 96
    const scale = Math.min(maxSide / canvas.width, maxSide / canvas.height, 1)
    const thumb = makeCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)))
    thumb.getContext("2d")?.drawImage(canvas, 0, 0, thumb.width, thumb.height)
    return thumb.toDataURL("image/png")
  } catch {
    return ""
  }
}

function drawPreview(
  canvas: HTMLCanvasElement | null,
  sources: readonly PhotomergeSource[],
  projection: PanoramaProjection,
) {
  if (!canvas) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const width = 600
  const height = 260
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height

  ctx.clearRect(0, 0, width, height)
  drawCheckerboard(ctx, width, height)
  const layout = buildPhotomergePreviewLayout(sources, { width, height, projection })

  ctx.save()
  ctx.strokeStyle = "rgba(120,180,255,0.72)"
  ctx.lineWidth = 1.5
  drawProjectionCurve(ctx, width, height, projection)
  ctx.restore()

  if (!sources.length) {
    ctx.fillStyle = "rgba(220,226,235,0.72)"
    ctx.font = "12px sans-serif"
    ctx.textAlign = "center"
    ctx.fillText("Choose source files to preview the panorama layout", width / 2, height / 2)
    return
  }

  for (const item of layout.items) {
    const source = sources.find((candidate) => candidate.id === item.id)
    ctx.save()
    ctx.translate(item.x + item.width / 2, item.y + item.height / 2)
    ctx.rotate((item.rotation * Math.PI) / 180)
    ctx.fillStyle = "rgba(22,26,33,0.9)"
    ctx.fillRect(-item.width / 2 - 5, -item.height / 2 - 5, item.width + 10, item.height + 10)
    ctx.strokeStyle = "rgba(255,255,255,0.42)"
    ctx.lineWidth = 1
    ctx.strokeRect(-item.width / 2 - 5, -item.height / 2 - 5, item.width + 10, item.height + 10)
    if (source) ctx.drawImage(source.canvas, -item.width / 2, -item.height / 2, item.width, item.height)
    ctx.fillStyle = "rgba(8,11,15,0.72)"
    ctx.fillRect(-item.width / 2, item.height / 2 - 18, item.width, 18)
    ctx.fillStyle = "rgba(238,242,247,0.92)"
    ctx.font = "10px sans-serif"
    ctx.textAlign = "left"
    ctx.fillText(item.name.slice(0, 32), -item.width / 2 + 6, item.height / 2 - 6)
    ctx.restore()
  }
}

function drawCheckerboard(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#151920"
  ctx.fillRect(0, 0, width, height)
  const size = 16
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      ctx.fillStyle = (x / size + y / size) % 2 === 0 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.12)"
      ctx.fillRect(x, y, size, size)
    }
  }
}

function drawProjectionCurve(ctx: CanvasRenderingContext2D, width: number, height: number, projection: PanoramaProjection) {
  const mid = height / 2
  ctx.beginPath()
  ctx.moveTo(18, mid)
  if (projection === "planar") {
    ctx.lineTo(width - 18, mid)
  } else {
    const curve = projection === "spherical" ? height * 0.24 : height * 0.14
    ctx.bezierCurveTo(width * 0.28, mid - curve, width * 0.72, mid + curve, width - 18, mid)
  }
  ctx.stroke()
}

function canvasImageData(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
}

function imageDataCanvas(image: ImageData) {
  const canvas = makeCanvas(image.width, image.height)
  canvas.getContext("2d")!.putImageData(image, 0, 0)
  return canvas
}

function photomergeSearchRadius(sources: readonly PhotomergeSource[]) {
  const longest = Math.max(...sources.map((source) => Math.max(source.width, source.height)), 1)
  return Math.max(8, Math.min(96, Math.round(longest * 0.12)))
}

function projectionLabel(projection: PanoramaProjection) {
  if (projection === "cylindrical") return "Cylindrical projection"
  if (projection === "spherical") return "Spherical projection"
  return "Planar projection"
}

function alignmentLabel(alignment: PanoramaAlignmentModel) {
  if (alignment === "translation") return "Reposition"
  if (alignment === "affine") return "Affine"
  if (alignment === "homography") return "Perspective"
  return "Similarity"
}

function blendLabel(mode: PhotomergeBlendMode) {
  return mode === "multiband" ? "Multiband" : "Feather"
}

function correctionCount(settings: PhotomergeWorkspaceSettings) {
  return [
    settings.vignetteRemoval,
    settings.geometricCorrection,
    settings.contentAwareFillTransparent,
  ].filter(Boolean).length
}

function originLabel(origin: PhotomergeSource["origin"]) {
  if (origin === "document") return "Open document"
  if (origin === "folder") return "From folder"
  return "From disk"
}

function LayoutPresetPreview({ presetId }: { presetId: PhotomergeLayoutId }) {
  const W = 84
  const H = 40
  const tiles: Array<{ x: number; y: number; w: number; h: number; rotation: number; skew: number }> = (() => {
    switch (presetId) {
      case "perspective":
        return [
          { x: 10, y: 10, w: 28, h: 22, rotation: -4, skew: -8 },
          { x: 28, y: 8, w: 30, h: 24, rotation: 0, skew: 0 },
          { x: 50, y: 10, w: 28, h: 22, rotation: 4, skew: 8 },
        ]
      case "cylindrical":
        return [
          { x: 6, y: 14, w: 24, h: 18, rotation: -6, skew: 0 },
          { x: 28, y: 10, w: 28, h: 22, rotation: 0, skew: 0 },
          { x: 54, y: 14, w: 24, h: 18, rotation: 6, skew: 0 },
        ]
      case "spherical":
        return [
          { x: 6, y: 18, w: 24, h: 16, rotation: -10, skew: 0 },
          { x: 30, y: 8, w: 26, h: 22, rotation: 0, skew: 0 },
          { x: 54, y: 18, w: 24, h: 16, rotation: 10, skew: 0 },
        ]
      case "collage":
        return [
          { x: 6, y: 6, w: 26, h: 18, rotation: -8, skew: 0 },
          { x: 30, y: 14, w: 26, h: 20, rotation: 4, skew: 0 },
          { x: 52, y: 6, w: 26, h: 22, rotation: -2, skew: 0 },
        ]
      case "reposition":
        return [
          { x: 6, y: 12, w: 24, h: 18, rotation: 0, skew: 0 },
          { x: 30, y: 12, w: 24, h: 18, rotation: 0, skew: 0 },
          { x: 54, y: 12, w: 24, h: 18, rotation: 0, skew: 0 },
        ]
      case "auto":
      default:
        return [
          { x: 8, y: 12, w: 24, h: 18, rotation: -2, skew: 0 },
          { x: 30, y: 10, w: 26, h: 22, rotation: 0, skew: 0 },
          { x: 54, y: 12, w: 24, h: 18, rotation: 2, skew: 0 },
        ]
    }
  })()

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="block h-9 w-full rounded-sm bg-[var(--ps-chrome)]"
    >
      {tiles.map((tile, index) => (
        <g
          key={index}
          transform={`translate(${tile.x + tile.w / 2}, ${tile.y + tile.h / 2}) rotate(${tile.rotation}) skewX(${tile.skew}) translate(${-tile.w / 2}, ${-tile.h / 2})`}
        >
          <rect
            x={0}
            y={0}
            width={tile.w}
            height={tile.h}
            rx={1}
            fill="rgba(120,180,255,0.18)"
            stroke="rgba(180,210,255,0.7)"
            strokeWidth={0.7}
          />
        </g>
      ))}
    </svg>
  )
}
