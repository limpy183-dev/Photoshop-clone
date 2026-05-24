"use client"

import * as React from "react"
import { toast } from "sonner"
import { FileImage, Grid2X2, ImageDown, ImagePlus, LayoutTemplate, Trash2 } from "lucide-react"
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
import {
  CONTACT_SHEET_TEMPLATES,
  buildContactSheetLayout,
  buildPicturePackageLayout,
  exportContactSheetBlob,
  renderContactSheetCanvas,
  type ContactSheetExportFormat,
  type ContactSheetFitMode,
  type ContactSheetLayout,
  type ContactSheetRenderable,
} from "./contact-sheet"
import { downloadBlob } from "./document-io"
import { makeDocument, useEditor } from "./editor-context"

type LayoutMode = "contact-sheet" | "picture-package"
type SortMode = "name" | "original"

interface ImportedImage extends ContactSheetRenderable {
  id: string
  file: File
  order: number
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "contact-sheet"
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
}: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
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
}: {
  value: number
  min: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
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
  const { createDocument } = useEditor()
  const [mode, setMode] = React.useState<LayoutMode>("contact-sheet")
  const [images, setImages] = React.useState<ImportedImage[]>([])
  const [dragActive, setDragActive] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [sort, setSort] = React.useState<SortMode>("name")
  const [pageWidth, setPageWidth] = React.useState(1600)
  const [pageHeight, setPageHeight] = React.useState(1200)
  const [columns, setColumns] = React.useState(4)
  const [rows, setRows] = React.useState(3)
  const [spacing, setSpacing] = React.useState(18)
  const [margin, setMargin] = React.useState(32)
  const [includeLabels, setIncludeLabels] = React.useState(true)
  const [labelFontSize, setLabelFontSize] = React.useState(12)
  const [background, setBackground] = React.useState("#ffffff")
  const [labelColor, setLabelColor] = React.useState("#111111")
  const [fitMode, setFitMode] = React.useState<ContactSheetFitMode>("contain")
  const [templateId, setTemplateId] = React.useState("package-2x2")
  const [format, setFormat] = React.useState<ContactSheetExportFormat>("png")
  const [quality, setQuality] = React.useState(0.92)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const previewRef = React.useRef<HTMLCanvasElement | null>(null)
  const compositeRef = React.useRef<HTMLCanvasElement | null>(null)

  const orderedImages = React.useMemo(() => {
    const next = [...images]
    if (sort === "name") next.sort((a, b) => a.name.localeCompare(b.name))
    else next.sort((a, b) => a.order - b.order)
    return next
  }, [images, sort])

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
  }), [background, fitMode, includeLabels, labelColor, labelFontSize, margin, pageHeight, pageWidth, spacing])

  const layout: ContactSheetLayout<ImportedImage> = React.useMemo(() => {
    if (mode === "picture-package") {
      return buildPicturePackageLayout(orderedImages, { ...baseOptions, templateId })
    }
    return buildContactSheetLayout(orderedImages, { ...baseOptions, columns, rows })
  }, [baseOptions, columns, mode, orderedImages, rows, templateId])

  const outputSizeError = canvasSizeError(pageWidth, pageHeight, "Contact sheet")

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

  const currentCanvas = () => {
    if (outputSizeError) throw new Error(outputSizeError)
    const canvas = compositeRef.current
    if (!canvas) throw new Error("Import images before exporting")
    return canvas
  }

  const exportComposite = async () => {
    setBusy(true)
    try {
      const canvas = currentCanvas()
      const blob = await exportContactSheetBlob(canvas, format, quality)
      const ext = format === "jpeg" ? "jpg" : "png"
      downloadBlob(blob, `${safeName(mode === "picture-package" ? "picture-package" : "contact-sheet")}.${ext}`)
      toast.success(`Exported ${format.toUpperCase()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contact sheet export failed")
    } finally {
      setBusy(false)
    }
  }

  const createCompositeDocument = () => {
    try {
      const canvas = currentCanvas()
      const docName = mode === "picture-package" ? "Picture Package" : "Contact Sheet"
      const doc = makeDocument(docName, canvas.width, canvas.height, background)
      const layer = doc.layers[1]
      layer.name = docName
      layer.canvas.getContext("2d")?.drawImage(canvas, 0, 0)
      doc.activeLayerId = layer.id
      doc.selectedLayerIds = [layer.id]
      createDocument(doc, docName)
      toast.success(`Created ${docName}`)
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
            Import images, compose a contact sheet or picture package, preview it on canvas, and export PNG or JPEG.
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

              <div className="grid grid-cols-2 gap-2">
                <Field label="Page W">
                  <NumberInput value={pageWidth} min={64} max={8192} onChange={setPageWidth} />
                </Field>
                <Field label="Page H">
                  <NumberInput value={pageHeight} min={64} max={8192} onChange={setPageHeight} />
                </Field>
              </div>

              <TabsContent value="contact-sheet" className="mt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Columns">
                    <NumberInput value={columns} min={1} max={24} onChange={setColumns} />
                  </Field>
                  <Field label="Rows">
                    <NumberInput value={rows} min={1} max={24} onChange={setRows} />
                  </Field>
                </div>
              </TabsContent>

              <TabsContent value="picture-package" className="mt-0 space-y-3">
                <Field label="Template">
                  <Select value={templateId} onChange={setTemplateId}>
                    {CONTACT_SHEET_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </Select>
                </Field>
              </TabsContent>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Margin">
                  <NumberInput value={margin} min={0} max={1000} onChange={setMargin} />
                </Field>
                <Field label="Spacing">
                  <NumberInput value={spacing} min={0} max={400} onChange={setSpacing} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Sort">
                  <Select value={sort} onChange={(value) => setSort(value as SortMode)}>
                    <option value="name">By name</option>
                    <option value="original">Original order</option>
                  </Select>
                </Field>
                <Field label="Fit">
                  <Select value={fitMode} onChange={(value) => setFitMode(value as ContactSheetFitMode)}>
                    <option value="contain">Fit inside</option>
                    <option value="cover">Fill slot</option>
                  </Select>
                </Field>
              </div>

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
                <NumberInput value={labelFontSize} min={6} max={72} onChange={setLabelFontSize} />
              </div>

              <CheckRow label="Filename labels" checked={includeLabels} onCheckedChange={setIncludeLabels} />

              <div className="grid grid-cols-[1fr_80px] items-end gap-2">
                <Field label="Export format">
                  <Select value={format} onChange={(value) => setFormat(value as ContactSheetExportFormat)}>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                  </Select>
                </Field>
                <Field label="Quality">
                  <Input
                    type="number"
                    value={Math.round(quality * 100)}
                    min={1}
                    max={100}
                    disabled={format === "png"}
                    onChange={(event) => setQuality(Math.max(0.01, Math.min(1, (Number(event.target.value) || 92) / 100)))}
                    className="h-8 text-[11px]"
                  />
                </Field>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between text-[11px] text-[var(--ps-text-dim)]">
                <div>
                  {layout.width} x {layout.height}px, {layout.placements.length} slot{layout.placements.length === 1 ? "" : "s"}
                  {layout.rows > rows && mode === "contact-sheet" ? `, rows expanded to ${layout.rows}` : ""}
                </div>
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
            Create Document
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
