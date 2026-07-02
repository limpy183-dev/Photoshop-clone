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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { CLIENT_STORAGE_KEYS, readClientStorageJson } from "./client-storage"
import { makeCanvas, makeDocument, useEditorSelector } from "./editor-context"
import { canvasSizeError, clampCanvasSize } from "./canvas-limits"
import { createHighBitImageFromImageData, type HighBitImage } from "./color-pipeline"
import type { DocumentModeSettings, Layer, PsDocument } from "./types"
import {
  estimateDocumentMemoryMb,
  modeSettings,
  NEW_DOCUMENT_PRESET_GROUPS,
  NEW_DOCUMENT_PRESETS,
  pixelsToUnit,
  unitToPixels,
  type NewDocumentUnit,
} from "./new-document-presets"

type BackgroundChoice = "white" | "black" | "transparent" | "foreground" | "background" | "custom"
type DocumentWithHighBitSource = PsDocument & { __highBitImageData?: HighBitImage }

function readDefaultBackgroundPreference() {
  const prefs = readClientStorageJson(CLIENT_STORAGE_KEYS.preferences)
  if (prefs && typeof prefs === "object" && !Array.isArray(prefs)) {
    const defaultBackground = (prefs as { defaultBackground?: unknown }).defaultBackground
    if (typeof defaultBackground === "string" && defaultBackground !== "#ffffff") return defaultBackground
  }
  return null
}

export function NewDocumentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const createDocument = useEditorSelector((editor) => editor.createDocument)
  const foreground = useEditorSelector((editor) => editor.foreground)
  const background = useEditorSelector((editor) => editor.background)
  const uid = React.useId()
  const [name, setName] = React.useState("Untitled-1")
  const [width, setWidth] = React.useState(1200)
  const [height, setHeight] = React.useState(800)
  const [unit, setUnit] = React.useState<NewDocumentUnit>("px")
  const [dpi, setDpi] = React.useState(72)

  const [prefBg, setPrefBg] = React.useState<string | null>(() => readDefaultBackgroundPreference())

  const [bg, setBg] = React.useState<BackgroundChoice>(prefBg ? "custom" : "white")
  const [customBg, setCustomBg] = React.useState(prefBg ?? "#ffffff")

  // Reset when dialog opens with new pref
  React.useEffect(() => {
    if (open) setPrefBg(readDefaultBackgroundPreference())
  }, [open])

  React.useEffect(() => {
    if (open && prefBg) {
      setBg("custom")
      setCustomBg(prefBg)
    } else if (open) {
      setBg("white")
      setCustomBg("#ffffff")
    }
  }, [open, prefBg])

  const [preset, setPreset] = React.useState("Default Canvas")
  const [colorMode, setColorMode] = React.useState<DocumentModeSettings["mode"]>("RGB")
  const [bitDepth, setBitDepth] = React.useState<8 | 16 | 32>(8)
  const [artboards, setArtboards] = React.useState(false)

  const pixelWidth = Math.round(unitToPixels(width, unit, dpi))
  const pixelHeight = Math.round(unitToPixels(height, unit, dpi))
  const sizeError = canvasSizeError(pixelWidth, pixelHeight, "Document")
  const memoryMb = estimateDocumentMemoryMb(pixelWidth, pixelHeight, bitDepth)

  const setPresetByName = (value: string) => {
    setPreset(value)
    const p = NEW_DOCUMENT_PRESETS.find((item) => item.name === value)
    if (!p) return
    const size = clampCanvasSize(p.w, p.h)
    setUnit("px")
    setWidth(size.width)
    setHeight(size.height)
    setDpi(p.dpi)
    setColorMode(p.mode)
    setBitDepth(p.bitDepth)
  }

  const setUnitPreservingPixels = (nextUnit: NewDocumentUnit) => {
    const currentW = pixelWidth
    const currentH = pixelHeight
    setUnit(nextUnit)
    setWidth(Number(pixelsToUnit(currentW, nextUnit, dpi).toFixed(nextUnit === "px" ? 0 : 2)))
    setHeight(Number(pixelsToUnit(currentH, nextUnit, dpi).toFixed(nextUnit === "px" ? 0 : 2)))
  }

  const backgroundFill = () => {
    if (bg === "white") return "#ffffff"
    if (bg === "black") return "#000000"
    if (bg === "foreground") return foreground
    if (bg === "background") return background
    if (bg === "custom") return customBg
    return "transparent"
  }

  const submit = () => {
    if (sizeError) return
    const fill = backgroundFill()
    const doc = makeDocument(name || "Untitled", Math.max(1, pixelWidth), Math.max(1, pixelHeight), fill === "transparent" ? "#ffffff" : fill)
    doc.dpi = dpi
    doc.colorMode = colorMode
    doc.bitDepth = bitDepth
    doc.modeSettings = modeSettings(colorMode)
    if (fill === "transparent") {
      doc.background = "transparent"
      doc.layers[0].canvas.getContext("2d")!.clearRect(0, 0, doc.width, doc.height)
    } else {
      doc.background = fill
    }
    if (artboards) {
      const artboard: Layer = {
        id: `artboard_${Math.random().toString(36).slice(2, 9)}`,
        name: "Artboard 1",
        kind: "artboard",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: makeCanvas(doc.width, doc.height),
        artboard: { x: 0, y: 0, w: doc.width, h: doc.height, background: fill },
        expanded: true,
      }
      doc.layers = [doc.layers[0], artboard, ...doc.layers.slice(1).map((layer) => ({ ...layer, parentId: artboard.id }))]
    }
    if (bitDepth > 8) {
      const sourceCanvas = makeCanvas(doc.width, doc.height)
      const sourceCtx = sourceCanvas.getContext("2d")!
      for (const layer of doc.layers) {
        if (layer.visible === false || layer.kind === "group") continue
        sourceCtx.drawImage(layer.canvas, 0, 0)
      }
      const sourcePixels = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
      ;(doc as DocumentWithHighBitSource).__highBitImageData = createHighBitImageFromImageData(sourcePixels, {
        bitDepth,
        colorMode,
        profile: doc.colorManagement?.assignedProfile,
      })
    }
    createDocument(doc, "New Document")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>New Document</DialogTitle>
          <DialogDescription>Choose a preset, resolution, color mode, and background for the new canvas.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-4">
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Presets</div>
            <div className="max-h-[200px] sm:max-h-[380px] overflow-y-auto">
              {NEW_DOCUMENT_PRESET_GROUPS.map((group) => (
                <div key={group} className="mb-2">
                  <div className="px-1 py-1 text-[10px] text-[var(--ps-text-dim)]">{group}</div>
                  {NEW_DOCUMENT_PRESETS.filter((item) => item.group === group).map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setPresetByName(item.name)}
                      className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[11px] ${
                        preset === item.name ? "bg-[var(--ps-tool-active)] text-white" : "hover:bg-[var(--ps-tool-hover)]"
                      }`}
                    >
                      <span>{item.name}</span>
                      <span className="text-[10px] opacity-70">{item.w}x{item.h}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-name`}>Name</Label>
              <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-width`}>Width ({unit})</Label>
              <Input id={`${uid}-width`} type="number" value={width} min={unit === "px" ? 1 : 0.01} step={unit === "px" ? 1 : 0.1} onChange={(e) => setWidth(Math.max(0.01, Number(e.target.value) || 1))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-height`}>Height ({unit})</Label>
              <Input id={`${uid}-height`} type="number" value={height} min={unit === "px" ? 1 : 0.01} step={unit === "px" ? 1 : 0.1} onChange={(e) => setHeight(Math.max(0.01, Number(e.target.value) || 1))} />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-unit`}>Units</Label>
              <Select value={unit} onValueChange={(value) => setUnitPreservingPixels(value as NewDocumentUnit)}>
                <SelectTrigger id={`${uid}-unit`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="px">Pixels</SelectItem>
                  <SelectItem value="in">Inches</SelectItem>
                  <SelectItem value="cm">Centimeters</SelectItem>
                  <SelectItem value="mm">Millimeters</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-dpi`}>Resolution (ppi)</Label>
              <Input id={`${uid}-dpi`} type="number" value={dpi} min={1} max={2400} onChange={(e) => setDpi(Math.max(1, Math.min(2400, Number(e.target.value) || 72)))} />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-color-mode`}>Color Mode</Label>
              <Select value={colorMode} onValueChange={(value) => setColorMode(value as DocumentModeSettings["mode"])}>
                <SelectTrigger id={`${uid}-color-mode`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RGB">RGB Color</SelectItem>
                  <SelectItem value="CMYK">CMYK Color</SelectItem>
                  <SelectItem value="Grayscale">Grayscale</SelectItem>
                  <SelectItem value="Indexed">Indexed Color</SelectItem>
                  <SelectItem value="Bitmap">Bitmap</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-bit-depth`}>Bit Depth</Label>
              <Select value={String(bitDepth)} onValueChange={(value) => setBitDepth(Number(value) as 8 | 16 | 32)}>
                <SelectTrigger id={`${uid}-bit-depth`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8 bit</SelectItem>
                  <SelectItem value="16">16 bit</SelectItem>
                  <SelectItem value="32">32 bit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-bg`}>Background Contents</Label>
              <Select value={bg} onValueChange={(value) => setBg(value as BackgroundChoice)}>
                <SelectTrigger id={`${uid}-bg`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="white">White</SelectItem>
                  <SelectItem value="black">Black</SelectItem>
                  <SelectItem value="transparent">Transparent</SelectItem>
                  <SelectItem value="foreground">Foreground Color</SelectItem>
                  <SelectItem value="background">Background Color</SelectItem>
                  <SelectItem value="custom">Custom Color</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]" htmlFor={`${uid}-custom-bg`}>Custom Background</Label>
              <div className="flex items-center gap-2">
                <Input type="color" aria-label="Custom background color swatch" value={customBg} disabled={bg !== "custom"} onChange={(e) => setCustomBg(e.target.value)} className="h-9 w-12 p-1" />
                <Input id={`${uid}-custom-bg`} value={customBg} disabled={bg !== "custom"} onChange={(e) => setCustomBg(e.target.value)} />
              </div>
            </div>

            <label className="col-span-2 flex cursor-pointer items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2 text-[11px]">
              <Checkbox checked={artboards} onCheckedChange={(value) => setArtboards(value === true)} />
              Create as artboard
            </label>

            <div className="col-span-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2 text-[11px] text-[var(--ps-text-dim)]">
              Final size: <span className="text-[var(--ps-text)]">{pixelWidth}x{pixelHeight}px</span>
              <span className="mx-2">|</span>
              Estimated memory: <span className="text-[var(--ps-text)]">{memoryMb.toFixed(1)} MB</span>
            </div>

            {sizeError && (
              <div className="col-span-2 rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                {sizeError}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!!sizeError}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
