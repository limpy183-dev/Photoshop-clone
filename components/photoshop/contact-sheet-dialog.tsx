"use client"

import * as React from "react"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, FileImage, Grid2X2, ImageDown, ImagePlus, LayoutTemplate, Save, Trash2 } from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { assertFileSize, canvasSizeError, MAX_RASTER_FILE_BYTES } from "./canvas-limits"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "./client-storage"
import {
  CONTACT_SHEET_PAGE_PRESETS,
  CONTACT_SHEET_TEMPLATES,
  buildContactSheetPages,
  buildPicturePackageLayout,
  exportContactSheetBlob,
  exportContactSheetPdfBlob,
  exportContactSheetZipBlob,
  renderContactSheetCanvas,
  type ContactSheetExportFormat,
  type ContactSheetFitMode,
  type ContactSheetImageFormat,
  type ContactSheetLayout,
  type ContactSheetRenderable,
} from "./contact-sheet"
import { downloadBlob } from "./document-io"
import { makeDocument, useEditorSelector } from "./editor-context"

type LayoutMode = "contact-sheet" | "picture-package"
type SortMode = "name" | "original"

interface ContactSheetPresetSettings {
  mode: LayoutMode
  sort: SortMode
  pagePresetId: string
  pageWidth: number
  pageHeight: number
  columns: number
  rows: number
  spacing: number
  margin: number
  includeLabels: boolean
  labelTemplate: string
  labelFontSize: number
  background: string
  labelColor: string
  fitMode: ContactSheetFitMode
  templateId: string
  format: ContactSheetExportFormat
  zipImageFormat: ContactSheetImageFormat
  quality: number
}

interface SavedContactSheetPreset {
  id: string
  name: string
  settings: ContactSheetPresetSettings
}

interface ImportedImage extends ContactSheetRenderable {
  id: string
  file: File
  order: number
}

const MAX_CONTACT_SHEET_PRESETS = 20

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "contact-sheet"
}

function isSavedContactSheetPreset(item: unknown): item is SavedContactSheetPreset {
  if (!item || typeof item !== "object") return false
  const preset = item as Partial<SavedContactSheetPreset>
  return Boolean(preset.id && preset.name && preset.settings)
}

function readSavedContactSheetPresets(): SavedContactSheetPreset[] {
  return readClientStorageJson(CLIENT_STORAGE_KEYS.contactSheetPresets)
    .filter(isSavedContactSheetPreset)
    .slice(0, MAX_CONTACT_SHEET_PRESETS)
}

function writeSavedContactSheetPresets(presets: readonly SavedContactSheetPreset[]) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.contactSheetPresets, presets.slice(0, MAX_CONTACT_SHEET_PRESETS))
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error(`Could not read ${file.name}`))
    }
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(src: string, name: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not decode ${name}`))
    image.src = src
  })
}

async function importImageFile(file: File, order: number): Promise<ImportedImage> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image file`)
  assertFileSize(file, MAX_RASTER_FILE_BYTES, "Image file")
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadImageElement(dataUrl, file.name)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) throw new Error(`${file.name} has no readable dimensions`)
  const sizeError = canvasSizeError(width, height, "Imported image")
  if (sizeError) throw new Error(sizeError)
  return {
    id: `${file.name}-${file.lastModified}-${order}`,
    file,
    order,
    name: file.name,
    width,
    height,
    image,
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="border-[var(--ps-divider)]"
      />
      {label}
    </label>
  )
}

function Select({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  ariaLabel?: string
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
    >
      {children}
    </select>
  )
}

function NumberInput({
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  value: number
  min: number
  max?: number
  onChange: (value: number) => void
  ariaLabel?: string
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      aria-label={ariaLabel}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (!Number.isFinite(next)) return
        onChange(Math.max(min, max ? Math.min(max, Math.round(next)) : Math.round(next)))
      }}
      className="h-8 text-[11px]"
    />
  )
}

export function ContactSheetDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createDocument = useEditorSelector((editor) => editor.createDocument)
  const [mode, setMode] = React.useState<LayoutMode>("contact-sheet")
  const [images, setImages] = React.useState<ImportedImage[]>([])
  const [dragActive, setDragActive] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [sort, setSort] = React.useState<SortMode>("name")
  const [pagePresetId, setPagePresetId] = React.useState("screen-4x3")
  const [pageWidth, setPageWidth] = React.useState(1600)
  const [pageHeight, setPageHeight] = React.useState(1200)
  const [columns, setColumns] = React.useState(4)
  const [rows, setRows] = React.useState(3)
  const [spacing, setSpacing] = React.useState(18)
  const [margin, setMargin] = React.useState(32)
  const [includeLabels, setIncludeLabels] = React.useState(true)
  const [labelTemplate, setLabelTemplate] = React.useState("{filename}")
  const [labelFontSize, setLabelFontSize] = React.useState(12)
  const [background, setBackground] = React.useState("#ffffff")
  const [labelColor, setLabelColor] = React.useState("#111111")
  const [fitMode, setFitMode] = React.useState<ContactSheetFitMode>("contain")
  const [templateId, setTemplateId] = React.useState("package-2x2")
  const [format, setFormat] = React.useState<ContactSheetExportFormat>("png")
  const [zipImageFormat, setZipImageFormat] = React.useState<ContactSheetImageFormat>("png")
  const [quality, setQuality] = React.useState(0.92)
  const [previewPageIndex, setPreviewPageIndex] = React.useState(0)
  const [selectedImageId, setSelectedImageId] = React.useState("")
  const [savedPresets, setSavedPresets] = React.useState<SavedContactSheetPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = React.useState("")
  const [presetName, setPresetName] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const previewRef = React.useRef<HTMLCanvasElement | null>(null)
  const compositeRef = React.useRef<HTMLCanvasElement | null>(null)

  const orderedImages = React.useMemo(() => {
    const next = [...images]
    if (sort === "name") next.sort((a, b) => a.name.localeCompare(b.name))
    else next.sort((a, b) => a.order - b.order)
    return next
  }, [images, sort])

  const selectedImage = React.useMemo(
    () => images.find((image) => image.id === selectedImageId) ?? null,
    [images, selectedImageId],
  )

  const baseOptions = React.useMemo(() => ({
    pageWidth,
    pageHeight,
    margin,
    spacing,
    includeLabels,
    labelFontSize,
    labelColor,
    background,
    fitMode,
    labelTemplate,
  }), [background, fitMode, includeLabels, labelColor, labelFontSize, labelTemplate, margin, pageHeight, pageWidth, spacing])

  const layouts: ContactSheetLayout<ImportedImage>[] = React.useMemo(() => {
    if (mode === "picture-package") {
      return [buildPicturePackageLayout(orderedImages, { ...baseOptions, templateId })]
    }
    return buildContactSheetPages(orderedImages, { ...baseOptions, columns, rows })
  }, [baseOptions, columns, mode, orderedImages, rows, templateId])

  const layout = layouts[Math.min(previewPageIndex, Math.max(0, layouts.length - 1))] ?? layouts[0]
  const outputSizeError = canvasSizeError(pageWidth, pageHeight, "Contact sheet")
  const effectiveJpegQuality = format === "jpeg" || (format === "zip" && zipImageFormat === "jpeg")

  React.useEffect(() => {
    if (open) setSavedPresets(readSavedContactSheetPresets())
  }, [open])

  React.useEffect(() => {
    if (!images.length) {
      setSelectedImageId("")
      return
    }
    if (!images.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(images[0].id)
    }
  }, [images, selectedImageId])

  React.useEffect(() => {
    setPreviewPageIndex((current) => Math.min(current, Math.max(0, layouts.length - 1)))
  }, [layouts.length])

  const importFiles = React.useCallback(async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((file) => file.type.startsWith("image/"))
    if (!incoming.length) {
      toast.error("Choose one or more image files")
      return
    }
    setBusy(true)
    try {
      const start = Date.now()
      const imported = await Promise.all(incoming.map((file, index) => importImageFile(file, start + index)))
      setImages((current) => [...current, ...imported])
      toast.success(`Imported ${imported.length} image${imported.length === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import images")
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [])

  const applyPagePreset = React.useCallback((id: string) => {
    const preset = CONTACT_SHEET_PAGE_PRESETS.find((item) => item.id === id)
    if (!preset) {
      setPagePresetId("custom")
      return
    }
    setPagePresetId(preset.id)
    setPageWidth(preset.width)
    setPageHeight(preset.height)
  }, [])

  const updateSelectedImage = React.useCallback((updater: (image: ImportedImage) => ImportedImage) => {
    if (!selectedImageId) return
    setImages((current) => current.map((image) => image.id === selectedImageId ? updater(image) : image))
  }, [selectedImageId])

  const selectedCrop = selectedImage?.crop ?? { x: 0, y: 0, width: 1, height: 1 }
  const setSelectedCropPercent = React.useCallback((field: keyof NonNullable<ImportedImage["crop"]>, value: number) => {
    const normalized = Math.max(field === "width" || field === "height" ? 1 : 0, Math.min(100, value)) / 100
    updateSelectedImage((image) => ({
      ...image,
      crop: {
        ...(image.crop ?? { x: 0, y: 0, width: 1, height: 1 }),
        [field]: normalized,
      },
    }))
  }, [updateSelectedImage])

  const setSelectedFitOverride = React.useCallback((value: string) => {
    updateSelectedImage((image) => {
      const next = { ...image }
      if (value === "global") delete next.fitMode
      else next.fitMode = value as ContactSheetFitMode
      return next
    })
  }, [updateSelectedImage])

  const resetSelectedOverrides = React.useCallback(() => {
    updateSelectedImage((image) => {
      const next = { ...image }
      delete next.fitMode
      delete next.crop
      return next
    })
  }, [updateSelectedImage])

  const presetSnapshot = React.useCallback((): ContactSheetPresetSettings => ({
    mode,
    sort,
    pagePresetId,
    pageWidth,
    pageHeight,
    columns,
    rows,
    spacing,
    margin,
    includeLabels,
    labelTemplate,
    labelFontSize,
    background,
    labelColor,
    fitMode,
    templateId,
    format,
    zipImageFormat,
    quality,
  }), [background, columns, fitMode, format, includeLabels, labelColor, labelFontSize, labelTemplate, margin, mode, pageHeight, pagePresetId, pageWidth, quality, rows, sort, spacing, templateId, zipImageFormat])

  const applyPresetSettings = React.useCallback((settings: ContactSheetPresetSettings) => {
    setMode(settings.mode)
    setSort(settings.sort)
    setPagePresetId(settings.pagePresetId || "custom")
    setPageWidth(settings.pageWidth)
    setPageHeight(settings.pageHeight)
    setColumns(settings.columns)
    setRows(settings.rows)
    setSpacing(settings.spacing)
    setMargin(settings.margin)
    setIncludeLabels(settings.includeLabels)
    setLabelTemplate(settings.labelTemplate || "{filename}")
    setLabelFontSize(settings.labelFontSize)
    setBackground(settings.background)
    setLabelColor(settings.labelColor)
    setFitMode(settings.fitMode)
    setTemplateId(settings.templateId)
    setFormat(settings.format)
    setZipImageFormat(settings.zipImageFormat ?? "png")
    setQuality(settings.quality)
    setPreviewPageIndex(0)
  }, [])

  const savePreset = React.useCallback(() => {
    const name = presetName.trim()
    if (!name) {
      toast.error("Name the preset before saving")
      return
    }
    const settings = presetSnapshot()
    const existing = savedPresets.find((preset) => preset.id === selectedPresetId || preset.name.toLowerCase() === name.toLowerCase())
    const preset: SavedContactSheetPreset = {
      id: existing?.id ?? `contact-sheet-${Date.now()}`,
      name,
      settings,
    }
    const next = [preset, ...savedPresets.filter((item) => item.id !== preset.id)].slice(0, MAX_CONTACT_SHEET_PRESETS)
    setSavedPresets(next)
    setSelectedPresetId(preset.id)
    writeSavedContactSheetPresets(next)
    toast.success("Contact sheet preset saved")
  }, [presetName, presetSnapshot, savedPresets, selectedPresetId])

  const deletePreset = React.useCallback(() => {
    if (!selectedPresetId) return
    const next = savedPresets.filter((preset) => preset.id !== selectedPresetId)
    setSavedPresets(next)
    setSelectedPresetId("")
    writeSavedContactSheetPresets(next)
    toast.success("Contact sheet preset deleted")
  }, [savedPresets, selectedPresetId])

  React.useEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    if (!orderedImages.length || outputSizeError) {
      compositeRef.current = null
      preview.width = 1
      preview.height = 1
      preview.getContext("2d")?.clearRect(0, 0, 1, 1)
      return
    }
    const canvas = renderContactSheetCanvas(orderedImages, layout, baseOptions)
    compositeRef.current = canvas
    preview.width = canvas.width
    preview.height = canvas.height
    const ctx = preview.getContext("2d")
    if (ctx) {
      ctx.clearRect(0, 0, preview.width, preview.height)
      ctx.drawImage(canvas, 0, 0)
    }
  }, [baseOptions, layout, orderedImages, outputSizeError])

  const handleDrop = async (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    await importFiles(event.dataTransfer.files)
  }

  const removeImage = (id: string) => {
    setImages((current) => current.filter((image) => image.id !== id))
  }

  const currentCanvases = () => {
    if (outputSizeError) throw new Error(outputSizeError)
    if (!orderedImages.length) throw new Error("Import images before exporting")
    return layouts.map((pageLayout) => renderContactSheetCanvas(orderedImages, pageLayout, baseOptions))
  }

  const exportComposite = async () => {
    setBusy(true)
    try {
      const canvases = currentCanvases()
      const base = safeName(mode === "picture-package" ? "picture-package" : "contact-sheet")
      if (format === "pdf") {
        const blob = await exportContactSheetPdfBlob(canvases, base)
        downloadBlob(blob, `${base}.pdf`)
        toast.success(canvases.length > 1 ? `Exported ${canvases.length}-page PDF` : "Exported PDF")
      } else if (format === "zip" || canvases.length > 1) {
        const imageFormat = format === "zip" ? zipImageFormat : format
        const blob = await exportContactSheetZipBlob(canvases, { format: imageFormat, quality, filenamePrefix: base })
        downloadBlob(blob, `${base}.zip`)
        toast.success(`Exported ${canvases.length} page image${canvases.length === 1 ? "" : "s"} as ZIP`)
      } else {
        const blob = await exportContactSheetBlob(canvases[0], format, quality)
        const ext = format === "jpeg" ? "jpg" : "png"
        downloadBlob(blob, `${base}.${ext}`)
        toast.success(`Exported ${format.toUpperCase()}`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contact sheet export failed")
    } finally {
      setBusy(false)
    }
  }

  const createCompositeDocument = () => {
    try {
      const canvases = currentCanvases()
      const docName = mode === "picture-package" ? "Picture Package" : "Contact Sheet"
      canvases.forEach((canvas, index) => {
        const pageName = canvases.length > 1 ? `${docName} Page ${index + 1}` : docName
        const doc = makeDocument(pageName, canvas.width, canvas.height, background)
        const layer = doc.layers[1]
        layer.name = pageName
        layer.canvas.getContext("2d")?.drawImage(canvas, 0, 0)
        doc.activeLayerId = layer.id
        doc.selectedLayerIds = [layer.id]
        createDocument(doc, pageName)
      })
      toast.success(canvases.length > 1 ? `Created ${canvases.length} documents` : `Created ${docName}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create document")
    }
  }

  const canRender = images.length > 0 && !outputSizeError && !busy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="contact-sheet-dialog"
        className="max-h-[calc(100vh-32px)] overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)] sm:max-w-[900px]"
      >
        <DialogHeader>
          <DialogTitle>Contact Sheet / Picture Package</DialogTitle>
          <DialogDescription className="sr-only">
            Import images, compose a contact sheet or picture package, preview it on canvas, and export PNG, JPEG, PDF, or ZIP.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as LayoutMode)} className="min-h-0 gap-4">
          <TabsList className="h-8 rounded-sm bg-[var(--ps-panel-2)] p-0">
            <TabsTrigger value="contact-sheet" className="h-8 rounded-sm px-3 text-[11px]">
              <Grid2X2 className="h-3.5 w-3.5" />
              Contact Sheet
            </TabsTrigger>
            <TabsTrigger value="picture-package" className="h-8 rounded-sm px-3 text-[11px]">
              <LayoutTemplate className="h-3.5 w-3.5" />
              Picture Package
            </TabsTrigger>
          </TabsList>

          <div className="grid h-[calc(100vh-220px)] min-h-[360px] max-h-[520px] grid-cols-[280px_1fr] gap-4">
            <div className="space-y-3 overflow-y-auto pr-1">
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
                  "flex h-24 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed bg-[var(--ps-panel-2)] text-[11px] text-[var(--ps-text-dim)] transition-colors",
                  dragActive ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)] text-[var(--ps-text)]" : "border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]",
                )}
              >
                <ImagePlus className="mb-1 h-5 w-5" />
                {images.length ? `${images.length} image${images.length === 1 ? "" : "s"} imported` : "Drop images or choose files"}
                <span className="mt-1 text-[10px]">PNG, JPEG, WebP, GIF, BMP</span>
                <input
                  ref={fileInputRef}
                  data-testid="contact-sheet-file-input"
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void importFiles(event.target.files)
                  }}
                />
              </label>

              <div className="grid gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                <Field label="Saved preset">
                  <Select
                    ariaLabel="Saved contact sheet preset"
                    value={selectedPresetId}
                    onChange={(value) => {
                      setSelectedPresetId(value)
                      const preset = savedPresets.find((item) => item.id === value)
                      if (preset) {
                        setPresetName(preset.name)
                        applyPresetSettings(preset.settings)
                      }
                    }}
                  >
                    <option value="">Custom</option>
                    {savedPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.name}</option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                  <Input
                    aria-label="Contact sheet preset name"
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    placeholder="Preset name"
                    className="h-8 text-[11px]"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={savePreset} className="h-8 px-2 text-[11px]">
                    <Save className="h-3.5 w-3.5" />
                    Save Preset
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={!selectedPresetId} onClick={deletePreset} className="h-8 px-2 text-[11px]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <Field label="Print size">
                <Select ariaLabel="Print size preset" value={pagePresetId} onChange={applyPagePreset}>
                  <option value="custom">Custom</option>
                  {CONTACT_SHEET_PAGE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Page W">
                  <NumberInput
                    ariaLabel="Page W"
                    value={pageWidth}
                    min={64}
                    max={8192}
                    onChange={(value) => {
                      setPagePresetId("custom")
                      setPageWidth(value)
                    }}
                  />
                </Field>
                <Field label="Page H">
                  <NumberInput
                    ariaLabel="Page H"
                    value={pageHeight}
                    min={64}
                    max={8192}
                    onChange={(value) => {
                      setPagePresetId("custom")
                      setPageHeight(value)
                    }}
                  />
                </Field>
              </div>

              <TabsContent value="contact-sheet" className="mt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Columns">
                    <NumberInput ariaLabel="Columns" value={columns} min={1} max={24} onChange={setColumns} />
                  </Field>
                  <Field label="Rows">
                    <NumberInput ariaLabel="Rows" value={rows} min={1} max={24} onChange={setRows} />
                  </Field>
                </div>
              </TabsContent>

              <TabsContent value="picture-package" className="mt-0 space-y-3">
                <Field label="Template">
                  <Select ariaLabel="Picture package template" value={templateId} onChange={setTemplateId}>
                    {CONTACT_SHEET_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </Select>
                </Field>
              </TabsContent>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Margin">
                  <NumberInput ariaLabel="Margin" value={margin} min={0} max={1000} onChange={setMargin} />
                </Field>
                <Field label="Spacing">
                  <NumberInput ariaLabel="Spacing" value={spacing} min={0} max={400} onChange={setSpacing} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Sort">
                  <Select ariaLabel="Sort" value={sort} onChange={(value) => setSort(value as SortMode)}>
                    <option value="name">By name</option>
                    <option value="original">Original order</option>
                  </Select>
                </Field>
                <Field label="Fit">
                  <Select ariaLabel="Fit" value={fitMode} onChange={(value) => setFitMode(value as ContactSheetFitMode)}>
                    <option value="contain">Fit inside</option>
                    <option value="cover">Fill slot</option>
                  </Select>
                </Field>
              </div>

              {images.length ? (
                <div className="grid gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                  <div className="grid grid-cols-[1fr_100px] gap-2">
                    <Field label="Image">
                      <Select ariaLabel="Image override target" value={selectedImageId} onChange={setSelectedImageId}>
                        {images.map((image) => (
                          <option key={image.id} value={image.id}>{image.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Image fit">
                      <Select ariaLabel="Image fit override" value={selectedImage?.fitMode ?? "global"} onChange={setSelectedFitOverride}>
                        <option value="global">Global</option>
                        <option value="contain">Fit</option>
                        <option value="cover">Fill</option>
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <Field label="Crop X%">
                      <NumberInput ariaLabel="Crop X percent" value={Math.round(selectedCrop.x * 100)} min={0} max={99} onChange={(value) => setSelectedCropPercent("x", value)} />
                    </Field>
                    <Field label="Crop Y%">
                      <NumberInput ariaLabel="Crop Y percent" value={Math.round(selectedCrop.y * 100)} min={0} max={99} onChange={(value) => setSelectedCropPercent("y", value)} />
                    </Field>
                    <Field label="Crop W%">
                      <NumberInput ariaLabel="Crop width percent" value={Math.round(selectedCrop.width * 100)} min={1} max={100} onChange={(value) => setSelectedCropPercent("width", value)} />
                    </Field>
                    <Field label="Crop H%">
                      <NumberInput ariaLabel="Crop height percent" value={Math.round(selectedCrop.height * 100)} min={1} max={100} onChange={(value) => setSelectedCropPercent("height", value)} />
                    </Field>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={resetSelectedOverrides} className="h-7 justify-self-start text-[11px]">
                    Reset Overrides
                  </Button>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <Field label="Background">
                  <Input type="color" value={background} onChange={(event) => setBackground(event.target.value)} className="h-8 w-20 p-1" />
                </Field>
                <Field label="Label color">
                  <Input type="color" value={labelColor} onChange={(event) => setLabelColor(event.target.value)} className="h-8 w-20 p-1" />
                </Field>
              </div>

              <div className="grid grid-cols-[1fr_68px] items-end gap-2">
                <Field label="Label size">
                  <Slider min={6} max={32} step={1} value={[labelFontSize]} onValueChange={(value) => setLabelFontSize(value[0])} />
                </Field>
                <NumberInput ariaLabel="Label size" value={labelFontSize} min={6} max={72} onChange={setLabelFontSize} />
              </div>

              <CheckRow label="Filename labels" checked={includeLabels} onCheckedChange={setIncludeLabels} />

              <Field label="Label template">
                <Input
                  aria-label="Label template"
                  value={labelTemplate}
                  disabled={!includeLabels}
                  onChange={(event) => setLabelTemplate(event.target.value)}
                  className="h-8 text-[11px]"
                />
              </Field>

              <div className="grid grid-cols-[1fr_80px] items-end gap-2">
                <Field label="Export format">
                  <Select ariaLabel="Export format" value={format} onChange={(value) => setFormat(value as ContactSheetExportFormat)}>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="pdf">PDF</option>
                    <option value="zip">ZIP</option>
                  </Select>
                </Field>
                <Field label="Quality">
                  <Input
                    type="number"
                    value={Math.round(quality * 100)}
                    min={1}
                    max={100}
                    aria-label="Quality"
                    disabled={!effectiveJpegQuality}
                    onChange={(event) => setQuality(Math.max(0.01, Math.min(1, (Number(event.target.value) || 92) / 100)))}
                    className="h-8 text-[11px]"
                  />
                </Field>
              </div>

              {format === "zip" ? (
                <Field label="ZIP images">
                  <Select ariaLabel="ZIP image format" value={zipImageFormat} onChange={(value) => setZipImageFormat(value as ContactSheetImageFormat)}>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                  </Select>
                </Field>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between text-[11px] text-[var(--ps-text-dim)]">
                <div>
                  {layout.width} x {layout.height}px, Page {layout.pageIndex + 1} of {layout.pageCount}, {layout.placements.length} slot{layout.placements.length === 1 ? "" : "s"}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Previous page"
                    disabled={previewPageIndex <= 0}
                    onClick={() => setPreviewPageIndex((current) => Math.max(0, current - 1))}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Next page"
                    disabled={previewPageIndex >= layout.pageCount - 1}
                    onClick={() => setPreviewPageIndex((current) => Math.min(layout.pageCount - 1, current + 1))}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!images.length}
                    onClick={() => setImages([])}
                    className="h-7 text-[11px]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[#111] p-3">
                {outputSizeError ? (
                  <div className="flex h-full items-center justify-center text-center text-[12px] text-red-300">{outputSizeError}</div>
                ) : images.length ? (
                  <div className="flex h-full items-center justify-center overflow-auto">
                    <canvas
                      ref={previewRef}
                      aria-label="Contact sheet preview"
                      className="max-h-full max-w-full border border-black/50 bg-white shadow-lg"
                    />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-[var(--ps-text-dim)]">
                    <FileImage className="h-8 w-8" />
                    Import images to preview the composite canvas
                  </div>
                )}
              </div>

              <div className="max-h-24 overflow-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]">
                {orderedImages.length ? (
                  orderedImages.map((image) => (
                    <div key={image.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-1.5 text-[11px] last:border-b-0">
                      <span className="truncate">{image.name}</span>
                      <span className="text-[var(--ps-text-dim)]">{image.width} x {image.height}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${image.name}`}
                        onClick={() => removeImage(image.id)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="px-2 py-3 text-center text-[11px] text-[var(--ps-text-dim)]">No imported images</div>
                )}
              </div>
            </div>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" disabled={!canRender} onClick={createCompositeDocument}>
            <Grid2X2 className="h-4 w-4" />
            {layout.pageCount > 1 ? "Create Documents" : "Create Document"}
          </Button>
          <Button disabled={!canRender} onClick={exportComposite}>
            <ImageDown className="h-4 w-4" />
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
