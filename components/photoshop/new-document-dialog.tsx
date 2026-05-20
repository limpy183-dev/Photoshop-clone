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
import { useEditor, makeDocument, makeCanvas } from "./editor-context"
import { canvasSizeError, clampCanvasSize } from "./canvas-limits"
import type { DocumentModeSettings, Layer } from "./types"

type Unit = "px" | "in" | "cm" | "mm"
type BackgroundChoice = "white" | "black" | "transparent" | "foreground" | "background" | "custom"

interface Preset {
  name: string
  group: "Recent" | "Photo" | "Print" | "Web" | "Mobile" | "Icon" | "Social" | "Film"
  w: number
  h: number
  dpi: number
  mode: DocumentModeSettings["mode"]
  bitDepth: 8 | 16 | 32
}

const PRESETS: Preset[] = [
  { group: "Recent", name: "Default Canvas", w: 1200, h: 800, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Photo", name: "Photo 6 x 4 in", w: 1800, h: 1200, dpi: 300, mode: "RGB", bitDepth: 16 },
  { group: "Photo", name: "Photo 5 x 7 in", w: 1500, h: 2100, dpi: 300, mode: "RGB", bitDepth: 16 },
  { group: "Photo", name: "Photo 8 x 10 in", w: 2400, h: 3000, dpi: 300, mode: "RGB", bitDepth: 16 },
  { group: "Print", name: "US Letter", w: 2550, h: 3300, dpi: 300, mode: "CMYK", bitDepth: 8 },
  { group: "Print", name: "A4", w: 2480, h: 3508, dpi: 300, mode: "CMYK", bitDepth: 8 },
  { group: "Print", name: "Poster 18 x 24 in", w: 5400, h: 7200, dpi: 300, mode: "CMYK", bitDepth: 8 },
  { group: "Web", name: "HD 1920 x 1080", w: 1920, h: 1080, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Web", name: "Desktop 1440 x 900", w: 1440, h: 900, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Mobile", name: "Phone Portrait", w: 1080, h: 1920, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Mobile", name: "Tablet Portrait", w: 1536, h: 2048, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Icon", name: "App Icon 1024", w: 1024, h: 1024, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Icon", name: "Favicon 512", w: 512, h: 512, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Social", name: "Square Social", w: 1080, h: 1080, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Social", name: "Story / Reel", w: 1080, h: 1920, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Film", name: "4K UHD", w: 3840, h: 2160, dpi: 72, mode: "RGB", bitDepth: 16 },
]

function unitToPixels(value: number, unit: Unit, dpi: number) {
  if (unit === "px") return value
  if (unit === "in") return value * dpi
  if (unit === "cm") return (value / 2.54) * dpi
  return (value / 25.4) * dpi
}

function pixelsToUnit(value: number, unit: Unit, dpi: number) {
  if (unit === "px") return value
  if (unit === "in") return value / dpi
  if (unit === "cm") return (value / dpi) * 2.54
  return (value / dpi) * 25.4
}

function modeSettings(mode: DocumentModeSettings["mode"]): DocumentModeSettings {
  if (mode === "Indexed") return { mode, indexed: { colors: 256, dither: true } }
  if (mode === "Bitmap") return { mode, bitmap: { method: "halftone", threshold: 128, frequency: 45, angle: 45 } }
  if (mode === "Multichannel") return { mode, multichannel: { channels: { r: true, g: true, b: true, c: true, m: true, y: true, k: true } } }
  if (mode === "Duotone") return { mode, duotone: { ink1: "#111111", ink2: "#4d78aa", curve: 50 } }
  return { mode }
}

function readDefaultBackgroundPreference() {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("ps-preferences") : null
    if (raw) {
      const p = JSON.parse(raw)
      if (typeof p?.defaultBackground === "string" && p.defaultBackground !== "#ffffff") return p.defaultBackground as string
    }
  } catch {}
  return null
}

export function NewDocumentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { createDocument, foreground, background } = useEditor()
  const [name, setName] = React.useState("Untitled-1")
  const [width, setWidth] = React.useState(1200)
  const [height, setHeight] = React.useState(800)
  const [unit, setUnit] = React.useState<Unit>("px")
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
  const memoryMb = (pixelWidth * pixelHeight * 4 * (bitDepth === 32 ? 4 : bitDepth === 16 ? 2 : 1)) / 1024 / 1024

  const setPresetByName = (value: string) => {
    setPreset(value)
    const p = PRESETS.find((item) => item.name === value)
    if (!p) return
    const size = clampCanvasSize(p.w, p.h)
    setUnit("px")
    setWidth(size.width)
    setHeight(size.height)
    setDpi(p.dpi)
    setColorMode(p.mode)
    setBitDepth(p.bitDepth)
  }

  const setUnitPreservingPixels = (nextUnit: Unit) => {
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

        <div className="grid grid-cols-[240px_1fr] gap-4">
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Presets</div>
            <div className="max-h-[380px] overflow-y-auto">
              {(["Recent", "Photo", "Print", "Web", "Mobile", "Icon", "Social", "Film"] as const).map((group) => (
                <div key={group} className="mb-2">
                  <div className="px-1 py-1 text-[10px] text-[var(--ps-text-dim)]">{group}</div>
                  {PRESETS.filter((item) => item.group === group).map((item) => (
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
              <Label className="text-[11px]">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]">Width ({unit})</Label>
              <Input type="number" value={width} min={unit === "px" ? 1 : 0.01} step={unit === "px" ? 1 : 0.1} onChange={(e) => setWidth(Math.max(0.01, Number(e.target.value) || 1))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Height ({unit})</Label>
              <Input type="number" value={height} min={unit === "px" ? 1 : 0.01} step={unit === "px" ? 1 : 0.1} onChange={(e) => setHeight(Math.max(0.01, Number(e.target.value) || 1))} />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]">Units</Label>
              <Select value={unit} onValueChange={(value) => setUnitPreservingPixels(value as Unit)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="px">Pixels</SelectItem>
                  <SelectItem value="in">Inches</SelectItem>
                  <SelectItem value="cm">Centimeters</SelectItem>
                  <SelectItem value="mm">Millimeters</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px]">Resolution (ppi)</Label>
              <Input type="number" value={dpi} min={1} max={2400} onChange={(e) => setDpi(Math.max(1, Math.min(2400, Number(e.target.value) || 72)))} />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]">Color Mode</Label>
              <Select value={colorMode} onValueChange={(value) => setColorMode(value as DocumentModeSettings["mode"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
              <Label className="text-[11px]">Bit Depth</Label>
              <Select value={String(bitDepth)} onValueChange={(value) => setBitDepth(Number(value) as 8 | 16 | 32)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8 bit</SelectItem>
                  <SelectItem value="16">16 bit</SelectItem>
                  <SelectItem value="32">32 bit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[11px]">Background Contents</Label>
              <Select value={bg} onValueChange={(value) => setBg(value as BackgroundChoice)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
              <Label className="text-[11px]">Custom Background</Label>
              <div className="flex items-center gap-2">
                <Input type="color" value={customBg} disabled={bg !== "custom"} onChange={(e) => setCustomBg(e.target.value)} className="h-9 w-12 p-1" />
                <Input value={customBg} disabled={bg !== "custom"} onChange={(e) => setCustomBg(e.target.value)} />
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
