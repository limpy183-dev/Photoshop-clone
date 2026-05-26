"use client"

import * as React from "react"
import { AlertTriangle, Check, ChevronRight, CopyPlus, Info, Pipette, Plus, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEditor } from "./editor-context"
import {
  buildColorHarmony,
  cmykFieldsToRgb,
  describePickerColor,
  hsbToRgb,
  isOutOfSrgbGamut,
  isWebSafe,
  labFieldsToRgb,
  normalizeWebColor,
  snapToWebSafe,
  type ColorHarmonyRule,
  type HsbColor,
  type PickerColorDescription,
} from "./color-picker-model"
import { captureSwatch } from "./swatches-store"
import { loadRecentColors, pushRecentColor, RECENT_COLORS_UPDATED_EVENT } from "./recent-colors"
import { hexToRgb, rgbToHex, type Rgb } from "./color-utils"

export type ColorPickerTarget = "foreground" | "background"

const HARMONY_RULES: Array<{ id: ColorHarmonyRule; label: string }> = [
  { id: "complementary", label: "Complementary" },
  { id: "analogous", label: "Analogous" },
  { id: "triadic", label: "Triadic" },
  { id: "split-complementary", label: "Split complementary" },
  { id: "tetradic", label: "Tetradic" },
  { id: "monochrome", label: "Monochrome" },
]

type FieldMode = "hsb" | "rgb" | "lab" | "cmyk" | "hex"

const FIELD_MODES: Array<{ id: FieldMode; label: string; aria: string }> = [
  { id: "hsb", label: "HSB", aria: "Show HSB fields" },
  { id: "rgb", label: "RGB", aria: "Show RGB fields" },
  { id: "lab", label: "Lab", aria: "Show Lab fields" },
  { id: "cmyk", label: "CMYK", aria: "Show CMYK fields" },
  { id: "hex", label: "Hex", aria: "Show Hex field" },
]

function targetLabel(target: ColorPickerTarget) {
  return target === "foreground" ? "Foreground" : "Background"
}

function colorForTarget(target: ColorPickerTarget, foreground: string, background: string) {
  return target === "foreground" ? foreground : background
}

function actionForTarget(target: ColorPickerTarget, color: string) {
  return target === "foreground"
    ? ({ type: "set-foreground", color } as const)
    : ({ type: "set-background", color } as const)
}

function usePickerColor(target: ColorPickerTarget, open: boolean, live = false) {
  const { foreground, background, dispatch } = useEditor()
  const current = colorForTarget(target, foreground, background)
  const [hex, setHex] = React.useState(() => normalizeWebColor(current))
  const [webDraft, setWebDraft] = React.useState(() => normalizeWebColor(current))
  const [websafe, setWebsafe] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const next = normalizeWebColor(current)
    setHex(next)
    setWebDraft(next)
  }, [current, open])

  const setColor = React.useCallback(
    (next: string) => {
      let normalized = normalizeWebColor(next, hex)
      if (websafe) {
        const snapped = snapToWebSafe(hexToRgb(normalized))
        normalized = rgbToHex(snapped.r, snapped.g, snapped.b)
      }
      setHex(normalized)
      setWebDraft(normalized)
      if (live) dispatch(actionForTarget(target, normalized))
    },
    [dispatch, hex, live, target, websafe],
  )

  const setFromRgb = React.useCallback(
    (rgb: Rgb) => {
      setColor(describePickerColor(rgb).web)
    },
    [setColor],
  )

  const description = React.useMemo(() => describePickerColor(hex), [hex])

  const toggleWebsafe = React.useCallback(() => {
    setWebsafe((current) => {
      const next = !current
      if (next) {
        const snapped = snapToWebSafe(description.rgb)
        const snappedHex = rgbToHex(snapped.r, snapped.g, snapped.b)
        setHex(snappedHex)
        setWebDraft(snappedHex)
        if (live) dispatch(actionForTarget(target, snappedHex))
      }
      return next
    })
  }, [description.rgb, dispatch, live, target])

  return {
    hex,
    webDraft,
    setWebDraft,
    description,
    setColor,
    setFromRgb,
    websafe,
    toggleWebsafe,
    commit: () => dispatch(actionForTarget(target, hex)),
  }
}

function useRecentColors(open: boolean) {
  const [recents, setRecents] = React.useState<string[]>(() =>
    typeof window === "undefined" ? [] : loadRecentColors(),
  )

  React.useEffect(() => {
    if (!open) return
    setRecents(loadRecentColors())
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<string[]>).detail
      setRecents(Array.isArray(detail) ? detail : loadRecentColors())
    }
    window.addEventListener(RECENT_COLORS_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(RECENT_COLORS_UPDATED_EVENT, onUpdated)
  }, [open])

  return recents
}

export function ColorPickerDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ColorPickerTarget
}) {
  const { activeDoc } = useEditor()
  const picker = usePickerColor(target, open)
  const recents = useRecentColors(open)
  const [harmonyRule, setHarmonyRule] = React.useState<ColorHarmonyRule>("complementary")
  const [fieldMode, setFieldMode] = React.useState<FieldMode>("hsb")
  const [captureOpen, setCaptureOpen] = React.useState(false)
  const [swatchName, setSwatchName] = React.useState("")
  const [swatchGroup, setSwatchGroup] = React.useState("Captured")
  const [statusMessage, setStatusMessage] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setCaptureOpen(false)
    setSwatchName("")
    setSwatchGroup("Captured")
    setStatusMessage("")
  }, [open, target])

  const saveSwatch = () => {
    const name = swatchName.trim()
    const group = swatchGroup.trim()
    captureSwatch(
      {
        color: picker.description.web,
        name: name || undefined,
        group: group || "Captured",
      },
      activeDoc?.id,
    )
    setStatusMessage(`Captured ${name || picker.description.web}.`)
    setCaptureOpen(false)
  }

  const applyAndClose = () => {
    pushRecentColor(picker.hex)
    picker.commit()
    onOpenChange(false)
  }

  const pickViaEyedropper = async () => {
    if (typeof window === "undefined" || !window.EyeDropper) {
      setStatusMessage(
        "Browser eyedropper not available — pick on the canvas with the Eyedropper tool instead.",
      )
      return
    }
    try {
      const ed = new window.EyeDropper()
      const result = await ed.open()
      picker.setColor(result.sRGBHex)
      setStatusMessage(`Picked ${result.sRGBHex.toUpperCase()} from the screen.`)
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return
      setStatusMessage("Eyedropper cancelled.")
    }
  }

  const outOfGamut = isOutOfSrgbGamut(picker.description.rgb)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(820px,calc(100vh-32px))] max-w-[920px] overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)] shadow-2xl">
        <DialogHeader className="border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold">
            <Pipette className="h-4 w-4 text-[var(--ps-accent)]" />
            Color Picker
          </DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            {targetLabel(target)} color
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[minmax(280px,1fr)_360px] gap-4 overflow-y-auto p-4 max-md:grid-cols-1">
          <div className="min-w-0 space-y-3">
            <ColorSpectrum
              description={picker.description}
              onChange={picker.setFromRgb}
              squareLabel="Saturation and value"
            />
            <PreviewStrip target={target} description={picker.description} outOfGamut={outOfGamut} />
            <div className="flex items-center justify-between gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5">
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  aria-label="Only web safe colors"
                  checked={picker.websafe}
                  onChange={picker.toggleWebsafe}
                  className="h-3.5 w-3.5"
                />
                Only web colors
                <span
                  className="ml-1 text-[10px] text-[var(--ps-text-dim)]"
                  title="Snap to the 216-color web-safe palette."
                >
                  216
                </span>
              </label>
              <button
                type="button"
                onClick={pickViaEyedropper}
                aria-label="Pick color from screen"
                title="Pick color from the screen (EyeDropper API)"
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[11px] hover:bg-[var(--ps-tool-hover)]"
              >
                <Pipette className="h-3.5 w-3.5" />
                Eyedropper
              </button>
            </div>
            <HarmonyPicker
              value={harmonyRule}
              onChange={setHarmonyRule}
              color={picker.description.web}
              onPick={picker.setColor}
            />
            <RecentColorsStrip recents={recents} onPick={picker.setColor} />
          </div>

          <div className="min-w-0 space-y-3">
            <ModeTabs value={fieldMode} onChange={setFieldMode} />

            <FieldGroup title="HSB" active={fieldMode === "hsb"}>
              <NumberField label="HSB hue" shortLabel="H" suffix="°" value={picker.description.hsb.h} min={0} max={360} onChange={(value) => picker.setFromRgb(hsbToRgb({ ...picker.description.hsb, h: value }))} />
              <NumberField label="HSB saturation" shortLabel="S" suffix="%" value={picker.description.hsb.s} min={0} max={100} onChange={(value) => picker.setFromRgb(hsbToRgb({ ...picker.description.hsb, s: value }))} />
              <NumberField label="HSB brightness" shortLabel="B" suffix="%" value={picker.description.hsb.b} min={0} max={100} onChange={(value) => picker.setFromRgb(hsbToRgb({ ...picker.description.hsb, b: value }))} />
            </FieldGroup>

            <FieldGroup title="RGB" active={fieldMode === "rgb"} hint={<span className="text-[10px] text-[var(--ps-text-dim)]">sRGB</span>}>
              <NumberField label="RGB red" shortLabel="R" value={picker.description.rgb.r} min={0} max={255} onChange={(value) => picker.setFromRgb({ ...picker.description.rgb, r: value })} />
              <NumberField label="RGB green" shortLabel="G" value={picker.description.rgb.g} min={0} max={255} onChange={(value) => picker.setFromRgb({ ...picker.description.rgb, g: value })} />
              <NumberField label="RGB blue" shortLabel="B" value={picker.description.rgb.b} min={0} max={255} onChange={(value) => picker.setFromRgb({ ...picker.description.rgb, b: value })} />
            </FieldGroup>

            <FieldGroup title="Lab" active={fieldMode === "lab"} hint={<span className="text-[10px] text-[var(--ps-text-dim)]">D50 reference</span>}>
              <NumberField label="Lab lightness" shortLabel="L" value={picker.description.lab.l} min={0} max={100} onChange={(value) => picker.setFromRgb(labFieldsToRgb({ ...picker.description.lab, l: value }))} />
              <NumberField label="Lab a" shortLabel="a" value={picker.description.lab.a} min={-128} max={127} onChange={(value) => picker.setFromRgb(labFieldsToRgb({ ...picker.description.lab, a: value }))} />
              <NumberField label="Lab b" shortLabel="b" value={picker.description.lab.b} min={-128} max={127} onChange={(value) => picker.setFromRgb(labFieldsToRgb({ ...picker.description.lab, b: value }))} />
            </FieldGroup>

            <FieldGroup
              title="CMYK"
              active={fieldMode === "cmyk"}
              hint={
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)]"
                  title="Informational only. The browser color picker is not a certified CMM — see BOUNDARIES.md."
                >
                  <Info className="h-3 w-3" />
                  Not color-managed
                </span>
              }
            >
              <NumberField label="CMYK cyan" shortLabel="C" suffix="%" value={picker.description.cmyk.c} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, c: value }))} />
              <NumberField label="CMYK magenta" shortLabel="M" suffix="%" value={picker.description.cmyk.m} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, m: value }))} />
              <NumberField label="CMYK yellow" shortLabel="Y" suffix="%" value={picker.description.cmyk.y} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, y: value }))} />
              <NumberField label="CMYK black" shortLabel="K" suffix="%" value={picker.description.cmyk.k} min={0} max={100} onChange={(value) => picker.setFromRgb(cmykFieldsToRgb({ ...picker.description.cmyk, k: value }))} />
            </FieldGroup>

            {fieldMode === "hex" ? (
              <FieldGroup title="Hex">
                <HexField
                  draft={picker.webDraft}
                  onDraft={picker.setWebDraft}
                  onCommit={picker.setColor}
                  swatch={picker.description.web}
                />
              </FieldGroup>
            ) : (
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                <label className="mb-1 block text-[10px] font-medium uppercase text-[var(--ps-text-dim)]" htmlFor="web-color-field">
                  Hex
                </label>
                <HexField
                  draft={picker.webDraft}
                  onDraft={picker.setWebDraft}
                  onCommit={picker.setColor}
                  swatch={picker.description.web}
                />
              </div>
            )}

            {outOfGamut ? (
              <div className="flex items-start gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 p-2 text-[10.5px] leading-4 text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Out of typical print gamut (sRGB extremes). Heuristic only — the browser cannot run a certified CMM gamut check.
                </span>
              </div>
            ) : null}

            {picker.websafe && !isWebSafe(picker.description.rgb) ? (
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[10.5px] text-[var(--ps-text-dim)]">
                Snapped to nearest web-safe color.
              </div>
            ) : null}

            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium">Add to swatches</div>
                  <div className="text-[10px] text-[var(--ps-text-dim)]">Save the current color into the Swatches panel.</div>
                </div>
                <button
                  type="button"
                  aria-label="Capture swatch"
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[11px] hover:bg-[var(--ps-tool-hover)]"
                  onClick={() => setCaptureOpen((value) => !value)}
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  Add to swatches
                </button>
              </div>
              {captureOpen ? (
                <div className="grid gap-2">
                  <input
                    aria-label="Swatch name"
                    value={swatchName}
                    onChange={(event) => setSwatchName(event.currentTarget.value)}
                    placeholder={picker.description.web.toUpperCase()}
                    className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px] outline-none focus:border-[var(--ps-accent)]"
                  />
                  <div className="flex gap-2">
                    <input
                      aria-label="Swatch group"
                      value={swatchGroup}
                      onChange={(event) => setSwatchGroup(event.currentTarget.value)}
                      className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px] outline-none focus:border-[var(--ps-accent)]"
                    />
                    <button
                      type="button"
                      aria-label="Save swatch"
                      className="inline-flex h-7 items-center gap-1 rounded-sm bg-[var(--ps-accent)] px-2 text-[11px] text-white hover:brightness-110"
                      onClick={saveSwatch}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save
                    </button>
                  </div>
                </div>
              ) : null}
              {statusMessage ? <div className="mt-2 text-[10px] text-[var(--ps-accent-2)]">{statusMessage}</div> : null}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={applyAndClose}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ColorPickerHud({
  open,
  onOpenChange,
  onOpenFull,
  target,
  position,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenFull: () => void
  target: ColorPickerTarget
  position: { x: number; y: number }
}) {
  const { activeDoc } = useEditor()
  const picker = usePickerColor(target, open, true)
  const wrapperRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onOpenChange, open])

  React.useEffect(() => {
    if (!open) return
    return () => {
      // Persist the final HUD color into recents when the HUD closes — the
      // caller has already committed it to the editor, but the recents strip
      // shouldn't depend on Dialog OK being clicked.
      pushRecentColor(picker.hex)
    }
  // We intentionally read picker.hex only on cleanup; including it would
  // re-run the cleanup on every drag tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const size = 248
  const left = Math.max(8, Math.min(position.x - size / 2, typeof window === "undefined" ? position.x : window.innerWidth - size - 8))
  const top = Math.max(44, Math.min(position.y - size / 2, typeof window === "undefined" ? position.y : window.innerHeight - size - 60))

  return (
    <div
      ref={wrapperRef}
      role="dialog"
      aria-label="HUD Color Picker"
      aria-modal="false"
      className="fixed z-[1100] rounded-md border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)] shadow-2xl"
      style={{ left, top, width: size, padding: 8 }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Pipette className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
        <div className="flex-1 text-[11px] font-medium">
          HUD Color Picker
          <span className="ml-1 text-[10px] font-normal text-[var(--ps-text-dim)]">{targetLabel(target)}</span>
        </div>
        <button
          type="button"
          aria-label="Close HUD color picker"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <HudColorWheel description={picker.description} onChange={picker.setFromRgb} size={size - 16} />

      <div className="mt-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1.5">
        <div className="mb-1 text-[10px] font-medium uppercase text-[var(--ps-text-dim)]">Harmony</div>
        <div className="grid grid-cols-3 gap-1">
          {buildColorHarmony(picker.description.web, "triadic").map((swatch) => (
            <button
              key={`${swatch.role}-${swatch.color}`}
              type="button"
              aria-label={`Use HUD harmony ${swatch.role} ${swatch.color}`}
              title={`${swatch.role} ${swatch.color}`}
              onClick={() => picker.setColor(swatch.color)}
              className="h-5 rounded-[2px] border border-[var(--ps-divider)] hover:border-[var(--ps-accent)]"
              style={{ background: swatch.color }}
            />
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
        <div className="flex items-center gap-2">
          <div
            className="h-5 w-5 rounded-sm border border-[var(--ps-divider)]"
            style={{ background: picker.description.web }}
          />
          <span className="font-mono uppercase text-[var(--ps-text-dim)]">{picker.description.web}</span>
        </div>
        <button
          type="button"
          aria-label="Add HUD color to swatches"
          title="Add to swatches"
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]"
          onClick={() => captureSwatch({ color: picker.description.web, group: "HUD" }, activeDoc?.id)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--ps-divider)] pt-2">
        <button
          type="button"
          aria-label="Open full color picker"
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[11px] hover:bg-[var(--ps-tool-hover)]"
          onClick={onOpenFull}
        >
          Open full picker
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="h-7 rounded-sm bg-[var(--ps-accent)] px-3 text-[11px] text-white hover:brightness-110"
          onClick={() => onOpenChange(false)}
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Canvas-backed saturation/value square + 20px hue bar
// ---------------------------------------------------------------------------

function ColorSpectrum({
  description,
  onChange,
  squareLabel,
}: {
  description: PickerColorDescription
  onChange: (rgb: Rgb) => void
  squareLabel: string
}) {
  const squareRef = React.useRef<HTMLCanvasElement>(null)
  const hueRef = React.useRef<HTMLCanvasElement>(null)
  const squareSize = 256
  const hueWidth = 256
  const hueHeight = 20

  // Repaint the SV square whenever the hue changes — the hue bar itself is
  // a static gradient and only needs to be painted once.
  React.useEffect(() => {
    const canvas = squareRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height

    const hueColor = `hsl(${description.hsb.h}, 100%, 50%)`
    // Saturation gradient left→right: white to pure hue at 100% V
    const sat = ctx.createLinearGradient(0, 0, w, 0)
    sat.addColorStop(0, "#ffffff")
    sat.addColorStop(1, hueColor)
    ctx.fillStyle = sat
    ctx.fillRect(0, 0, w, h)
    // Value overlay top→bottom: transparent to black
    const val = ctx.createLinearGradient(0, 0, 0, h)
    val.addColorStop(0, "rgba(0,0,0,0)")
    val.addColorStop(1, "rgba(0,0,0,1)")
    ctx.fillStyle = val
    ctx.fillRect(0, 0, w, h)
  }, [description.hsb.h])

  React.useEffect(() => {
    const canvas = hueRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const grad = ctx.createLinearGradient(0, 0, w, 0)
    for (let i = 0; i <= 6; i++) {
      grad.addColorStop(i / 6, `hsl(${(i / 6) * 360}, 100%, 50%)`)
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }, [])

  const updateHsb = React.useCallback(
    (patch: Partial<HsbColor>) => {
      onChange(hsbToRgb({ ...description.hsb, ...patch }))
    },
    [description.hsb, onChange],
  )

  const startSquareDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const element = squareRef.current
    if (!element) return
    element.setPointerCapture(event.pointerId)
    event.preventDefault()
    const update = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      updateHsb({ s: Math.round(x * 100), b: Math.round((1 - y) * 100) })
    }
    update(event.clientX, event.clientY)
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX, moveEvent.clientY)
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  const startHueDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const element = hueRef.current
    if (!element) return
    element.setPointerCapture(event.pointerId)
    event.preventDefault()
    const update = (clientX: number) => {
      const rect = element.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      updateHsb({ h: Math.round(x * 360) })
    }
    update(event.clientX)
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  return (
    <div className="space-y-2">
      <div className="relative w-full" style={{ aspectRatio: "1 / 1", maxWidth: squareSize }}>
        <canvas
          ref={squareRef}
          width={squareSize}
          height={squareSize}
          aria-label={squareLabel}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={description.hsb.s}
          tabIndex={0}
          onPointerDown={startSquareDrag}
          className="block h-auto w-full cursor-crosshair touch-none rounded-sm border border-[var(--ps-divider)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white"
          style={{
            left: `calc(${description.hsb.s}% - 8px)`,
            top: `calc(${100 - description.hsb.b}% - 8px)`,
            background: description.web,
            boxShadow: "0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 1px rgba(0,0,0,.55)",
          }}
        />
      </div>
      <div className="relative" style={{ width: "100%", maxWidth: squareSize }}>
        <canvas
          ref={hueRef}
          width={hueWidth}
          height={hueHeight}
          aria-label="Hue"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={description.hsb.h}
          onPointerDown={startHueDrag}
          className="block h-5 w-full cursor-pointer touch-none rounded-sm border border-[var(--ps-divider)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-2 rounded-sm border border-black bg-white"
          style={{ left: `calc(${(description.hsb.h / 360) * 100}% - 4px)` }}
        />
      </div>
    </div>
  )
}

function PreviewStrip({
  target,
  description,
  outOfGamut,
}: {
  target: ColorPickerTarget
  description: PickerColorDescription
  outOfGamut: boolean
}) {
  const { foreground, background } = useEditor()
  const previous = target === "foreground" ? foreground : background
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-[var(--ps-divider)] text-[10px]">
      <div className="flex items-center gap-2 bg-[var(--ps-panel-2)] p-2">
        <div className="h-8 w-12 rounded-sm border border-[var(--ps-divider)]" style={{ background: previous }} />
        <div>
          <div className="text-[var(--ps-text-dim)]">Current</div>
          <div className="font-mono uppercase">{previous}</div>
        </div>
      </div>
      <div className="relative flex items-center gap-2 bg-[var(--ps-panel-2)] p-2">
        <div className="h-8 w-12 rounded-sm border border-[var(--ps-divider)]" style={{ background: description.web }} />
        <div>
          <div className="text-[var(--ps-text-dim)]">New</div>
          <div className="font-mono uppercase">{description.web}</div>
        </div>
        {outOfGamut ? (
          <span
            className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-sm bg-amber-500/80 px-1 text-[9px] uppercase tracking-wide text-black"
            title="Out of sRGB gamut (heuristic)"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Gamut
          </span>
        ) : null}
      </div>
    </div>
  )
}

function HarmonyPicker({
  value,
  onChange,
  color,
  onPick,
}: {
  value: ColorHarmonyRule
  onChange: (rule: ColorHarmonyRule) => void
  color: string
  onPick: (color: string) => void
}) {
  const harmony = React.useMemo(() => buildColorHarmony(color, value), [color, value])
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <div className="mb-2 flex items-center gap-2">
        <label className="text-[10px] font-medium uppercase text-[var(--ps-text-dim)]" htmlFor="dialog-harmony-rule">
          Harmony
        </label>
        <select
          id="dialog-harmony-rule"
          aria-label="Harmony rule"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value as ColorHarmonyRule)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[11px]"
        >
          {HARMONY_RULES.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {harmony.map((swatch) => (
          <button
            type="button"
            key={`${swatch.role}-${swatch.color}`}
            aria-label={`Use harmony ${swatch.role} ${swatch.color}`}
            title={`${swatch.role} ${swatch.color}`}
            onClick={() => onPick(swatch.color)}
            className="group min-w-0 overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-left hover:border-[var(--ps-accent)]"
          >
            <span className="block h-7" style={{ background: swatch.color }} />
            <span className="block truncate px-1.5 py-1 text-[10px] text-[var(--ps-text-dim)] group-hover:text-[var(--ps-text)]">
              {swatch.role}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function RecentColorsStrip({
  recents,
  onPick,
}: {
  recents: string[]
  onPick: (color: string) => void
}) {
  if (!recents.length) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[10.5px] text-[var(--ps-text-dim)]">
        Recent colors will appear here after you confirm a picker selection.
      </div>
    )
  }
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <div className="mb-1.5 text-[10px] font-medium uppercase text-[var(--ps-text-dim)]">Recent</div>
      <div className="grid grid-cols-12 gap-1">
        {recents.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Use recent color ${color}`}
            title={color}
            onClick={() => onPick(color)}
            className="h-5 w-full rounded-[2px] border border-[var(--ps-divider)] transition-transform hover:scale-105 hover:border-[var(--ps-accent)]"
            style={{ background: color }}
          />
        ))}
      </div>
    </div>
  )
}

function ModeTabs({
  value,
  onChange,
}: {
  value: FieldMode
  onChange: (mode: FieldMode) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Numeric color fields mode"
      className="flex items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1"
    >
      {FIELD_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          role="tab"
          aria-selected={mode.id === value}
          aria-label={mode.aria}
          onClick={() => onChange(mode.id)}
          className={
            mode.id === value
              ? "flex-1 rounded-sm bg-[var(--ps-accent)] px-2 py-1 text-[11px] font-medium text-white"
              : "flex-1 rounded-sm px-2 py-1 text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          }
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}

function FieldGroup({
  title,
  hint,
  active = false,
  children,
}: {
  title: string
  hint?: React.ReactNode
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <fieldset className={`rounded-sm border bg-[var(--ps-panel-2)] p-2 ${active ? "border-[var(--ps-accent)]" : "border-[var(--ps-divider)]"}`}>
      <legend className="px-1 text-[10px] font-medium uppercase text-[var(--ps-text-dim)]">{title}</legend>
      {hint ? <div className="mb-1.5">{hint}</div> : null}
      <div className="grid gap-1.5">{children}</div>
    </fieldset>
  )
}

function NumberField({
  label,
  shortLabel,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  shortLabel: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const commit = (input: string) => {
    const next = Number(input)
    if (!Number.isFinite(next)) return
    onChange(Math.max(min, Math.min(max, Math.round(next))))
  }

  return (
    <label className="grid grid-cols-[18px_1fr_auto] items-center gap-1 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{shortLabel}</span>
      <input
        aria-label={label}
        value={value}
        onChange={(event) => commit(event.currentTarget.value)}
        className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 text-right font-mono text-[11px] outline-none focus:border-[var(--ps-accent)]"
        inputMode="numeric"
      />
      <span className="w-5 text-[10px] text-[var(--ps-text-dim)]">{suffix}</span>
    </label>
  )
}

function HexField({
  draft,
  onDraft,
  onCommit,
  swatch,
}: {
  draft: string
  onDraft: (next: string) => void
  onCommit: (next: string) => void
  swatch: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id="web-color-field"
        aria-label="Web color"
        value={draft}
        onChange={(event) => {
          const value = event.currentTarget.value
          onDraft(value)
          if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim())) {
            onCommit(value)
          }
        }}
        onBlur={() => onCommit(draft)}
        className="h-8 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 font-mono text-[12px] uppercase outline-none focus:border-[var(--ps-accent)]"
      />
      <div
        aria-hidden="true"
        className="h-8 w-12 rounded-sm border border-[var(--ps-divider)]"
        style={{ background: swatch }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// HUD circular hue ring + saturation/value triangle
// ---------------------------------------------------------------------------

function HudColorWheel({
  description,
  onChange,
  size,
}: {
  description: PickerColorDescription
  onChange: (rgb: Rgb) => void
  size: number
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const dragModeRef = React.useRef<"ring" | "triangle" | null>(null)

  const ringOuter = size / 2
  const ringInner = size / 2 - 24
  const triangleRadius = ringInner - 4
  const cx = size / 2
  const cy = size / 2

  // Paint the wheel: hue ring + SV triangle rotated to the current hue.
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Hue ring — paint a 1° conic by sweeping arcs to keep this portable
    // (some legacy browsers lack createConicGradient).
    for (let deg = 0; deg < 360; deg++) {
      const start = ((deg - 0.6) * Math.PI) / 180
      const end = ((deg + 0.6) * Math.PI) / 180
      ctx.beginPath()
      ctx.arc(cx, cy, (ringOuter + ringInner) / 2, start, end)
      ctx.strokeStyle = `hsl(${deg}, 100%, 50%)`
      ctx.lineWidth = ringOuter - ringInner
      ctx.stroke()
    }

    // SV triangle. Vertices at angles (90, 210, 330) deg from the wheel center
    // in canvas space, with the "pure hue" vertex rotated to the active hue.
    const hueRad = (description.hsb.h * Math.PI) / 180
    const v1 = polar(cx, cy, triangleRadius, hueRad) // hue
    const v2 = polar(cx, cy, triangleRadius, hueRad + (2 * Math.PI) / 3) // white
    const v3 = polar(cx, cy, triangleRadius, hueRad + (4 * Math.PI) / 3) // black

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(v1.x, v1.y)
    ctx.lineTo(v2.x, v2.y)
    ctx.lineTo(v3.x, v3.y)
    ctx.closePath()
    ctx.clip()

    // Paint triangle gradient: hue vertex → opposite edge (white→black).
    const hueColor = `hsl(${description.hsb.h}, 100%, 50%)`
    const grad1 = ctx.createLinearGradient(v1.x, v1.y, (v2.x + v3.x) / 2, (v2.y + v3.y) / 2)
    grad1.addColorStop(0, hueColor)
    grad1.addColorStop(1, "rgba(128,128,128,1)")
    ctx.fillStyle = grad1
    ctx.fillRect(0, 0, w, h)

    const grad2 = ctx.createLinearGradient(v2.x, v2.y, v3.x, v3.y)
    grad2.addColorStop(0, "rgba(255,255,255,1)")
    grad2.addColorStop(0.5, "rgba(255,255,255,0)")
    ctx.fillStyle = grad2
    ctx.fillRect(0, 0, w, h)

    const grad3 = ctx.createLinearGradient(v3.x, v3.y, v2.x, v2.y)
    grad3.addColorStop(0, "rgba(0,0,0,1)")
    grad3.addColorStop(0.5, "rgba(0,0,0,0)")
    ctx.fillStyle = grad3
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // Triangle outline so it reads as the SV chooser even when V≈0.5.
    ctx.beginPath()
    ctx.moveTo(v1.x, v1.y)
    ctx.lineTo(v2.x, v2.y)
    ctx.lineTo(v3.x, v3.y)
    ctx.closePath()
    ctx.strokeStyle = "rgba(0,0,0,0.4)"
    ctx.lineWidth = 1
    ctx.stroke()
  }, [cx, cy, description.hsb.h, ringInner, ringOuter, triangleRadius])

  // The HUD picker re-uses the canvas's pointer events for both rings.
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(event.pointerId)
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const point = (clientX: number, clientY: number) => ({
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    })
    const initial = point(event.clientX, event.clientY)
    const distance = Math.hypot(initial.x - cx, initial.y - cy)
    dragModeRef.current = distance > triangleRadius - 6 ? "ring" : "triangle"

    const sample = (p: { x: number; y: number }) => {
      if (dragModeRef.current === "ring") {
        const angle = Math.atan2(p.y - cy, p.x - cx)
        const deg = (angle * 180) / Math.PI
        const h = ((deg + 360) % 360)
        onChange(hsbToRgb({ h: Math.round(h), s: description.hsb.s, b: description.hsb.b }))
      } else {
        const hueRad = (description.hsb.h * Math.PI) / 180
        const v1 = polar(cx, cy, triangleRadius, hueRad)
        const v2 = polar(cx, cy, triangleRadius, hueRad + (2 * Math.PI) / 3)
        const v3 = polar(cx, cy, triangleRadius, hueRad + (4 * Math.PI) / 3)
        const bary = barycentric(p, v1, v2, v3)
        // Clamp barycentric coords to inside the triangle.
        const clamped = clampBary(bary)
        // v1 = pure hue (S=100, V=100), v2 = white (S=0, V=100), v3 = black (V=0).
        const s = Math.max(0, Math.min(100, Math.round(((clamped[0]) / (clamped[0] + clamped[1] || 1)) * 100)))
        const v = Math.max(0, Math.min(100, Math.round((1 - clamped[2]) * 100)))
        onChange(hsbToRgb({ h: description.hsb.h, s, b: v }))
      }
    }
    sample(initial)
    const move = (moveEvent: PointerEvent) => sample(point(moveEvent.clientX, moveEvent.clientY))
    const up = () => {
      dragModeRef.current = null
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  // Indicator dots — hue ring marker + SV triangle marker, both updated to the
  // current description. We position them relative to the canvas's CSS size.
  const hueRad = (description.hsb.h * Math.PI) / 180
  const ringMid = (ringOuter + ringInner) / 2
  const ringMarker = polar(cx, cy, ringMid, hueRad)
  const v1 = polar(cx, cy, triangleRadius, hueRad)
  const v2 = polar(cx, cy, triangleRadius, hueRad + (2 * Math.PI) / 3)
  const v3 = polar(cx, cy, triangleRadius, hueRad + (4 * Math.PI) / 3)
  const triPoint = svToTrianglePoint(description.hsb, v1, v2, v3)

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        aria-label="HUD saturation and brightness"
        role="application"
        onPointerDown={onPointerDown}
        className="block cursor-crosshair touch-none rounded-full"
        style={{ width: size, height: size }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-white"
        style={{
          left: ringMarker.x - 7,
          top: ringMarker.y - 7,
          background: `hsl(${description.hsb.h}, 100%, 50%)`,
          boxShadow: "0 0 0 1px rgba(0,0,0,.7)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-3 w-3 rounded-full border-2 border-white"
        style={{
          left: triPoint.x - 6,
          top: triPoint.y - 6,
          background: description.web,
          boxShadow: "0 0 0 1px rgba(0,0,0,.7)",
        }}
      />
    </div>
  )
}

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
}

function barycentric(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): [number, number, number] {
  const v0x = b.x - a.x
  const v0y = b.y - a.y
  const v1x = c.x - a.x
  const v1y = c.y - a.y
  const v2x = p.x - a.x
  const v2y = p.y - a.y
  const d00 = v0x * v0x + v0y * v0y
  const d01 = v0x * v1x + v0y * v1y
  const d11 = v1x * v1x + v1y * v1y
  const d20 = v2x * v0x + v2y * v0y
  const d21 = v2x * v1x + v2y * v1y
  const denom = d00 * d11 - d01 * d01 || 1
  const v = (d11 * d20 - d01 * d21) / denom
  const w = (d00 * d21 - d01 * d20) / denom
  const u = 1 - v - w
  return [u, v, w]
}

function clampBary(b: [number, number, number]): [number, number, number] {
  // Project onto the triangle by clamping to non-negative and renormalising.
  const u = Math.max(0, b[0])
  const v = Math.max(0, b[1])
  const w = Math.max(0, b[2])
  const sum = u + v + w || 1
  return [u / sum, v / sum, w / sum]
}

function svToTrianglePoint(
  hsb: HsbColor,
  hueVertex: { x: number; y: number },
  whiteVertex: { x: number; y: number },
  blackVertex: { x: number; y: number },
) {
  const s = hsb.s / 100
  const v = hsb.b / 100
  // Inverse of the mapping used in the drag handler.
  const w3 = 1 - v // black weight
  const remaining = 1 - w3
  const w1 = remaining * s // hue weight
  const w2 = remaining * (1 - s) // white weight
  return {
    x: hueVertex.x * w1 + whiteVertex.x * w2 + blackVertex.x * w3,
    y: hueVertex.y * w1 + whiteVertex.y * w2 + blackVertex.y * w3,
  }
}
