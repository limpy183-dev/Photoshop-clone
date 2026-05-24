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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Grid2X2, ImagePlus, LayoutGrid, Plus } from "lucide-react"
import { makeCanvas, makeDocument, useEditor } from "./editor-context"
import { loadImageFromFile } from "./document-io"
import type { Guide, Layer } from "./types"
import { cn } from "@/lib/utils"
import { uid } from "./uid"

function pxFromUnit(value: number, unit: string, docSize: number) {
  if (unit === "%") return (value / 100) * docSize
  if (unit === "in") return value * 96
  if (unit === "cm") return (value / 2.54) * 96
  if (unit === "mm") return (value / 25.4) * 96
  return value
}

function CheckRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="border-[var(--ps-divider)]"
      />
      {label}
    </label>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  )
}

export function GridSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, dispatch } = useEditor()
  const [enabled, setEnabled] = React.useState(false)
  const [size, setSize] = React.useState(50)
  const [subdivisions, setSubdivisions] = React.useState(1)
  const [opacity, setOpacity] = React.useState(42)
  const [color, setColor] = React.useState("#78b4ff")
  const [pixelGrid, setPixelGrid] = React.useState(false)
  const [snap, setSnap] = React.useState(true)
  const [snapGrid, setSnapGrid] = React.useState(false)
  const [snapGuides, setSnapGuides] = React.useState(true)

  React.useEffect(() => {
    if (!open || !activeDoc) return
    setEnabled(!!activeDoc.showGrid)
    setSize(activeDoc.gridSize ?? 50)
    setSubdivisions(activeDoc.gridSubdivisions ?? 1)
    setOpacity(Math.round((activeDoc.gridOpacity ?? 0.42) * 100))
    setColor(activeDoc.gridColor ?? "#78b4ff")
    setPixelGrid(!!activeDoc.showPixelGrid)
    setSnap(!!activeDoc.snap)
    setSnapGrid(!!activeDoc.snapToGrid)
    setSnapGuides(!!activeDoc.snapToGuides)
  }, [activeDoc, open])

  if (!activeDoc) return null

  const apply = () => {
    if (!!activeDoc.showGrid !== enabled) dispatch({ type: "toggle-grid" })
    if (!!activeDoc.showPixelGrid !== pixelGrid) dispatch({ type: "toggle-pixel-grid" })
    if (!!activeDoc.snap !== snap) dispatch({ type: "toggle-snap" })
    if (!!activeDoc.snapToGrid !== snapGrid) dispatch({ type: "toggle-snap-grid" })
    if (!!activeDoc.snapToGuides !== snapGuides) dispatch({ type: "toggle-snap-guides" })
    dispatch({ type: "set-grid-size", size })
    dispatch({ type: "set-grid-color", color })
    dispatch({ type: "set-grid-subdivisions", subdivisions })
    dispatch({ type: "set-grid-opacity", opacity: Math.max(5, Math.min(100, opacity)) / 100 })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Grid Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure document grid display, snapping, color, subdivisions, and pixel grid visibility.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <CheckRow label="Show grid" checked={enabled} onCheckedChange={setEnabled} />
            <CheckRow label="Pixel grid above 600%" checked={pixelGrid} onCheckedChange={setPixelGrid} />
            <CheckRow label="Snap" checked={snap} onCheckedChange={setSnap} />
            <CheckRow label="Snap to grid" checked={snapGrid} onCheckedChange={setSnapGrid} />
            <CheckRow label="Snap to guides" checked={snapGuides} onCheckedChange={setSnapGuides} />
          </div>
          <div className="grid grid-cols-[1fr_76px] gap-3 items-center">
            <Slider min={2} max={400} step={1} value={[size]} onValueChange={(v) => setSize(v[0])} />
            <Input type="number" value={size} min={2} onChange={(e) => setSize(Math.max(2, Number(e.target.value) || 50))} className="h-8 text-[11px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subdivisions">
              <Input
                type="number"
                value={subdivisions}
                min={1}
                max={16}
                onChange={(e) => setSubdivisions(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                className="h-8 text-[11px]"
              />
            </Field>
            <Field label="Opacity %">
              <Input
                type="number"
                value={opacity}
                min={5}
                max={100}
                onChange={(e) => setOpacity(Math.max(5, Math.min(100, Number(e.target.value) || 42)))}
                className="h-8 text-[11px]"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Grid color">
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-24 p-1" />
            </Field>
          </div>
          <div className="h-16 border border-[var(--ps-divider)] rounded-sm overflow-hidden" style={{
            backgroundColor: "#1f1f1f",
            backgroundImage: `linear-gradient(${color}${Math.round((opacity / 100) * 255).toString(16).padStart(2, "0")} 1px, transparent 1px), linear-gradient(90deg, ${color}${Math.round((opacity / 100) * 255).toString(16).padStart(2, "0")} 1px, transparent 1px)`,
            backgroundSize: `${Math.max(8, size / Math.max(1, subdivisions))}px ${Math.max(8, size / Math.max(1, subdivisions))}px`,
          }} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NewGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, dispatch } = useEditor()
  const [orientation, setOrientation] = React.useState<"horizontal" | "vertical">("horizontal")
  const [position, setPosition] = React.useState(50)
  const [unit, setUnit] = React.useState("%")
  const [color, setColor] = React.useState("#06b6d4")

  if (!activeDoc) return null

  const addGuide = () => {
    const docSize = orientation === "horizontal" ? activeDoc.height : activeDoc.width
    const px = Math.max(0, Math.min(docSize, pxFromUnit(position, unit, docSize)))
    dispatch({
      type: "add-guide",
      guide: { id: uid("g"), orientation, position: px, color },
    })
    onOpenChange(false)
  }

  const setPreset = (nextOrientation: "horizontal" | "vertical", percent: number) => {
    setOrientation(nextOrientation)
    setUnit("%")
    setPosition(percent)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>New Guide</DialogTitle>
          <DialogDescription className="sr-only">
            Add a single horizontal or vertical guide using pixels, percent, or print units.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1">
            {(["horizontal", "vertical"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrientation(o)}
                className={cn(
                  "h-8 border rounded-sm text-[11px] capitalize",
                  orientation === o ? "bg-[var(--ps-accent)] border-[var(--ps-accent)] text-white" : "bg-[var(--ps-panel-2)] border-[var(--ps-divider)]",
                )}
              >
                {o}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_90px_80px] gap-3">
            <Field label="Position">
              <Input type="number" value={position} onChange={(e) => setPosition(Number(e.target.value) || 0)} className="h-8 text-[11px]" />
            </Field>
            <Field label="Unit">
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-2 text-[11px]">
                <option value="%">Percent</option>
                <option value="px">Pixels</option>
                <option value="in">Inches</option>
                <option value="cm">Centimeters</option>
                <option value="mm">Millimeters</option>
              </select>
            </Field>
            <Field label="Color">
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-20 p-1" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <Button variant="outline" size="sm" onClick={() => setPreset("vertical", 50)}>V Center</Button>
            <Button variant="outline" size="sm" onClick={() => setPreset("horizontal", 50)}>H Center</Button>
            <Button variant="outline" size="sm" onClick={() => setPreset("vertical", 33.333)}>Thirds</Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={addGuide}>
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GuideLayoutDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, dispatch } = useEditor()
  const [columns, setColumns] = React.useState(3)
  const [rows, setRows] = React.useState(3)
  const [gutter, setGutter] = React.useState(24)
  const [marginTop, setMarginTop] = React.useState(0)
  const [marginRight, setMarginRight] = React.useState(0)
  const [marginBottom, setMarginBottom] = React.useState(0)
  const [marginLeft, setMarginLeft] = React.useState(0)
  const [color, setColor] = React.useState("#06b6d4")
  const [clearExisting, setClearExisting] = React.useState(false)

  if (!activeDoc) return null

  const addUniqueGuide = (guides: Guide[], orientation: "horizontal" | "vertical", position: number) => {
    const max = orientation === "horizontal" ? activeDoc.height : activeDoc.width
    const p = Math.max(0, Math.min(max, position))
    const key = `${orientation}:${Math.round(p)}`
    if (guides.some((g) => `${g.orientation}:${Math.round(g.position)}` === key)) return
    guides.push({ id: uid("g"), orientation, position: p, color })
  }

  const apply = () => {
    if (clearExisting) dispatch({ type: "clear-guides" })
    const guides: Guide[] = []
    addUniqueGuide(guides, "vertical", marginLeft)
    addUniqueGuide(guides, "vertical", activeDoc.width - marginRight)
    addUniqueGuide(guides, "horizontal", marginTop)
    addUniqueGuide(guides, "horizontal", activeDoc.height - marginBottom)

    const usableW = Math.max(1, activeDoc.width - marginLeft - marginRight)
    const usableH = Math.max(1, activeDoc.height - marginTop - marginBottom)
    const colW = Math.max(1, (usableW - gutter * Math.max(0, columns - 1)) / Math.max(1, columns))
    const rowH = Math.max(1, (usableH - gutter * Math.max(0, rows - 1)) / Math.max(1, rows))

    for (let i = 1; i < columns; i++) {
      const gutterStart = marginLeft + i * colW + (i - 1) * gutter
      addUniqueGuide(guides, "vertical", gutterStart)
      addUniqueGuide(guides, "vertical", gutterStart + gutter)
    }
    for (let i = 1; i < rows; i++) {
      const gutterStart = marginTop + i * rowH + (i - 1) * gutter
      addUniqueGuide(guides, "horizontal", gutterStart)
      addUniqueGuide(guides, "horizontal", gutterStart + gutter)
    }
    guides.forEach((guide) => dispatch({ type: "add-guide", guide }))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>New Guide Layout</DialogTitle>
          <DialogDescription className="sr-only">
            Create column, row, gutter, and margin guide sets for the active document.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_190px] gap-4">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Columns"><Input type="number" min={0} max={24} value={columns} onChange={(e) => setColumns(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
              <Field label="Rows"><Input type="number" min={0} max={24} value={rows} onChange={(e) => setRows(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
              <Field label="Gutter px"><Input type="number" min={0} value={gutter} onChange={(e) => setGutter(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <Field label="Top"><Input type="number" min={0} value={marginTop} onChange={(e) => setMarginTop(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
              <Field label="Right"><Input type="number" min={0} value={marginRight} onChange={(e) => setMarginRight(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
              <Field label="Bottom"><Input type="number" min={0} value={marginBottom} onChange={(e) => setMarginBottom(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
              <Field label="Left"><Input type="number" min={0} value={marginLeft} onChange={(e) => setMarginLeft(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Guide color"><Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-24 p-1" /></Field>
              <div className="pt-6"><CheckRow label="Clear existing guides" checked={clearExisting} onCheckedChange={setClearExisting} /></div>
            </div>
          </div>
          <div className="border border-[var(--ps-divider)] rounded-sm bg-[#1f1f1f] p-3 flex items-center justify-center">
            <div className="relative bg-[#2c2c2c]" style={{ width: 160, height: 110 }}>
              {Array.from({ length: Math.max(0, columns - 1) * 2 + 2 }).map((_, i) => (
                <div key={`v${i}`} className="absolute top-0 bottom-0 w-px" style={{ left: `${((i + 1) / (Math.max(2, columns * 2 + 1))) * 100}%`, background: color }} />
              ))}
              {Array.from({ length: Math.max(0, rows - 1) * 2 + 2 }).map((_, i) => (
                <div key={`h${i}`} className="absolute left-0 right-0 h-px" style={{ top: `${((i + 1) / (Math.max(2, rows * 2 + 1))) * 100}%`, background: color }} />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>
            <LayoutGrid className="w-4 h-4" />
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ContactSheetDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { createDocument } = useEditor()
  const [files, setFiles] = React.useState<File[]>([])
  const [columns, setColumns] = React.useState(4)
  const [thumbW, setThumbW] = React.useState(220)
  const [thumbH, setThumbH] = React.useState(160)
  const [padding, setPadding] = React.useState(32)
  const [gutter, setGutter] = React.useState(18)
  const [showNames, setShowNames] = React.useState(true)
  const [fontSize, setFontSize] = React.useState(12)
  const [background, setBackground] = React.useState("#ffffff")
  const [sort, setSort] = React.useState<"name" | "original">("name")
  const [busy, setBusy] = React.useState(false)

  const build = async () => {
    if (!files.length) return
    setBusy(true)
    try {
      const ordered = sort === "name" ? [...files].sort((a, b) => a.name.localeCompare(b.name)) : files
      const images = await Promise.all(ordered.map(async (file) => ({ file, img: await loadImageFromFile(file) })))
      const cols = Math.max(1, columns)
      const rows = Math.ceil(images.length / cols)
      const labelH = showNames ? fontSize + 12 : 0
      const cellW = thumbW + gutter
      const cellH = thumbH + labelH + gutter
      const width = padding * 2 + cols * thumbW + (cols - 1) * gutter
      const height = padding * 2 + rows * (thumbH + labelH) + (rows - 1) * gutter
      const doc = makeDocument("Contact Sheet", width, height, background)
      doc.layers = [doc.layers[0]]
      doc.activeLayerId = doc.layers[0].id
      doc.selectedLayerIds = [doc.layers[0].id]
      doc.guides = []

      images.forEach(({ file, img }, index) => {
        const col = index % cols
        const row = Math.floor(index / cols)
        const x = padding + col * cellW
        const y = padding + row * cellH
        const scale = Math.min(thumbW / img.naturalWidth, thumbH / img.naturalHeight)
        const dw = Math.max(1, img.naturalWidth * scale)
        const dh = Math.max(1, img.naturalHeight * scale)
        const dx = x + (thumbW - dw) / 2
        const dy = y + (thumbH - dh) / 2
        const canvas = makeCanvas(width, height)
        const ctx = canvas.getContext("2d")!
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, dx, dy, dw, dh)
        if (showNames) {
          ctx.fillStyle = "#111111"
          ctx.font = `${fontSize}px Arial, sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "top"
          const label = file.name.length > 36 ? `${file.name.slice(0, 33)}...` : file.name
          ctx.fillText(label, x + thumbW / 2, y + thumbH + 8, thumbW)
        }
        const layer: Layer = {
          id: uid("layer"),
          name: file.name,
          kind: "raster",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          canvas,
        }
        doc.layers.push(layer)
        doc.activeLayerId = layer.id
        doc.selectedLayerIds = [layer.id]
      })

      for (let c = 1; c < cols; c++) {
        doc.guides.push({ id: uid("g"), orientation: "vertical", position: padding + c * thumbW + (c - 0.5) * gutter, color: "#60a5fa" })
      }
      for (let r = 1; r < rows; r++) {
        doc.guides.push({ id: uid("g"), orientation: "horizontal", position: padding + r * (thumbH + labelH) + (r - 0.5) * gutter, color: "#60a5fa" })
      }
      createDocument(doc, "Contact Sheet")
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Contact Sheet II</DialogTitle>
          <DialogDescription className="sr-only">
            Build a new document containing imported images arranged as a customizable contact sheet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)]">
            <ImagePlus className="mb-1 h-5 w-5" />
            {files.length ? `${files.length} image files selected` : "Choose images"}
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Columns"><Input type="number" min={1} max={12} value={columns} onChange={(e) => setColumns(Math.max(1, Number(e.target.value) || 1))} className="h-8 text-[11px]" /></Field>
            <Field label="Thumb W"><Input type="number" min={24} value={thumbW} onChange={(e) => setThumbW(Math.max(24, Number(e.target.value) || 220))} className="h-8 text-[11px]" /></Field>
            <Field label="Thumb H"><Input type="number" min={24} value={thumbH} onChange={(e) => setThumbH(Math.max(24, Number(e.target.value) || 160))} className="h-8 text-[11px]" /></Field>
            <Field label="Gutter"><Input type="number" min={0} value={gutter} onChange={(e) => setGutter(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Padding"><Input type="number" min={0} value={padding} onChange={(e) => setPadding(Math.max(0, Number(e.target.value) || 0))} className="h-8 text-[11px]" /></Field>
            <Field label="Font size"><Input type="number" min={8} value={fontSize} onChange={(e) => setFontSize(Math.max(8, Number(e.target.value) || 12))} className="h-8 text-[11px]" /></Field>
            <Field label="Background"><Input type="color" value={background} onChange={(e) => setBackground(e.target.value)} className="h-8 w-20 p-1" /></Field>
            <Field label="Sort">
              <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "original")} className="h-8 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-2 text-[11px]">
                <option value="name">By name</option>
                <option value="original">Original order</option>
              </select>
            </Field>
          </div>
          <CheckRow label="Use filenames as captions" checked={showNames} onCheckedChange={setShowNames} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!files.length || busy} onClick={build}>
            <Grid2X2 className="w-4 h-4" />
            {busy ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
