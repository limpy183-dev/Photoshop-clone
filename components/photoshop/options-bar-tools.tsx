"use client"

import * as React from "react"
import { useEditorSelector } from "@/components/photoshop/editor/context"
import { useMounted } from "@/editor/use-mounted"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MousePointer2, Square, Type } from "lucide-react"
import { GradientIcon } from "@/components/photoshop/tool/gradient-icon"
import { dispatchPhotoshopEvent } from "@/editor/events"
import type { BlendMode, CustomShapeId, GradientStop, PathHandleMode, TextAntiAliasMode, TextProps } from "@/editor/types"
import {
  DEFAULT_TYPE_FONT,
  DEFAULT_TYPE_SIZE,
  getDodgeBurnRuntimeOptions,
  getSpongeRuntimeOptions,
  getTypeRuntimeDefaults,
  setTypeRuntimeDefaults,
  type ToneRange,
  type TypeRuntimeDefaults,
} from "@/editor/canvas/view-runtime"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  ColorChip,
  Divider,
  GradientStopsEditor,
  SHAPE_LIBRARY,
  clampNumber,
  labelClass,
  numInputClass,
  PercentInput,
  rgbaCss,
  ScrubLabel,
} from "@/components/photoshop/options-bar-shared"

/** Font stacks offered by the type tool. Values are real CSS stacks. */
const TYPE_FONT_OPTIONS = [
  { label: "Geist", value: "Geist, system-ui, sans-serif" },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "System UI", value: "system-ui, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Times", value: "Times New Roman, Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier", value: "Courier New, Courier, monospace" },
]

/**
 * Type options.
 *
 * Every control edits the selected text layer when there is one, and always
 * records the value as the default for the next layer. Before this the whole
 * bar early-returned without a text layer, so nothing could be configured
 * ahead of placing type — you had to create it at the default 48pt and fix it
 * afterwards.
 */
export function TypeOptions() {
  const { activeLayer, foreground, dispatch, commit, requestRender } = useEditorSelector((editor) => editor)
  const t = activeLayer?.kind === "text" ? activeLayer.text : null
  const [defaults, setDefaults] = React.useState<TypeRuntimeDefaults>(() => ({
    font: DEFAULT_TYPE_FONT,
    size: DEFAULT_TYPE_SIZE,
    weight: "bold",
    italic: false,
    align: "left",
  }))
  React.useEffect(() => setDefaults(getTypeRuntimeDefaults()), [])

  // What the controls display: the selected layer wins, else the defaults.
  const shown = {
    font: t?.font ?? defaults.font,
    size: t?.size ?? defaults.size,
    weight: t?.weight ?? defaults.weight,
    italic: t?.italic ?? defaults.italic,
    align: t?.align ?? defaults.align,
    leading: t?.leading,
    tracking: t?.tracking ?? 0,
    color: t?.color ?? foreground,
  }

  function apply(patch: Partial<TextProps>, label: string, historic = true) {
    const forDefaults: Partial<TypeRuntimeDefaults> = {}
    if (patch.font !== undefined) forDefaults.font = patch.font
    if (patch.size !== undefined) forDefaults.size = patch.size
    if (patch.weight !== undefined) forDefaults.weight = patch.weight
    if (patch.italic !== undefined) forDefaults.italic = patch.italic
    if (patch.align !== undefined) forDefaults.align = patch.align as TypeRuntimeDefaults["align"]
    if (patch.leading !== undefined) forDefaults.leading = patch.leading
    if (patch.tracking !== undefined) forDefaults.tracking = patch.tracking
    if (Object.keys(forDefaults).length) {
      setTypeRuntimeDefaults(forDefaults)
      setDefaults(getTypeRuntimeDefaults())
    }
    if (!activeLayer || !t) return
    dispatch({ type: "set-layer-text", id: activeLayer.id, text: { ...t, ...patch } })
    requestRender()
    if (historic) commit(label, [activeLayer.id])
  }

  const styleValue = shown.weight === "bold" && shown.italic
    ? "BoldItalic"
    : shown.weight === "bold"
      ? "Bold"
      : shown.italic
        ? "Italic"
        : "Regular"

  return (
    <>
      <Type className="w-3.5 h-3.5" />
      <Select value={shown.font} onValueChange={(v) => apply({ font: v }, "Type Font")}>
        <SelectTrigger className="h-6 w-32 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TYPE_FONT_OPTIONS.map((font) => (
            <SelectItem key={font.value} value={font.value}>{font.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={styleValue}
        onValueChange={(v) =>
          apply(
            { weight: v.includes("Bold") ? "bold" : "normal", italic: v.includes("Italic") },
            "Type Style",
          )
        }
      >
        <SelectTrigger className="h-6 w-24 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Regular">Regular</SelectItem>
          <SelectItem value="Bold">Bold</SelectItem>
          <SelectItem value="Italic">Italic</SelectItem>
          <SelectItem value="BoldItalic">Bold Italic</SelectItem>
        </SelectContent>
      </Select>
      <Divider />
      <div className="flex items-center gap-1.5">
        <ScrubLabel
          label="Size:"
          value={shown.size}
          min={1}
          max={400}
          onChange={(v) => apply({ size: Math.max(1, v) }, "Type Size", false)}
        />
        <Input
          aria-label="Type size"
          type="number"
          min={1}
          max={1296}
          value={shown.size}
          onChange={(e) => apply({ size: clampNumber(Number(e.target.value) || shown.size, 1, 1296) }, "Type Size", false)}
          className={numInputClass}
        />
        <span className={labelClass}>pt</span>
      </div>
      <Divider />
      <div className="flex items-center gap-1.5">
        <ScrubLabel
          label="Leading:"
          value={shown.leading ?? Math.round(shown.size * 1.2)}
          min={0}
          max={2000}
          onChange={(v) => apply({ leading: v }, "Type Leading", false)}
        />
        <Input
          aria-label="Type leading"
          type="number"
          min={0}
          max={2000}
          placeholder="Auto"
          value={shown.leading ?? ""}
          onChange={(e) => {
            const raw = e.target.value
            apply({ leading: raw === "" ? undefined : clampNumber(Number(raw) || 0, 0, 2000) }, "Type Leading", false)
          }}
          className={numInputClass}
        />
      </div>
      <Divider />
      <div className="flex items-center gap-1.5">
        <ScrubLabel
          label="Tracking:"
          value={shown.tracking}
          min={-200}
          max={800}
          onChange={(v) => apply({ tracking: v }, "Type Tracking", false)}
        />
        <Input
          aria-label="Type tracking"
          type="number"
          min={-200}
          max={800}
          value={shown.tracking}
          onChange={(e) => apply({ tracking: clampNumber(Number(e.target.value) || 0, -200, 800) }, "Type Tracking", false)}
          className={numInputClass}
        />
      </div>
      <Divider />
      <span className={labelClass}>Align:</span>
      <Select value={shown.align} onValueChange={(v) => apply({ align: v as TextProps["align"] }, "Type Align")}>
        <SelectTrigger className="h-6 w-20 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="left">Left</SelectItem>
          <SelectItem value="center">Center</SelectItem>
          <SelectItem value="right">Right</SelectItem>
        </SelectContent>
      </Select>
      <Divider />
      <span className={labelClass}>Anti-alias:</span>
      <Select
        value={t ? (t.antiAlias === false ? "none" : t.antiAliasMode ?? "smooth") : "smooth"}
        onValueChange={(v) => {
          const mode = v as TextAntiAliasMode
          apply({ antiAliasMode: mode, antiAlias: mode !== "none" }, "Type Anti-Alias")
        }}
      >
        <SelectTrigger className="h-6 w-24 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="sharp">Sharp</SelectItem>
          <SelectItem value="crisp">Crisp</SelectItem>
          <SelectItem value="strong">Strong</SelectItem>
          <SelectItem value="smooth">Smooth</SelectItem>
        </SelectContent>
      </Select>
      <Divider />
      <label className="flex items-center gap-1.5" title="Type colour (foreground when no layer is selected)">
        <span className={labelClass}>Color:</span>
        {/* Sized and bordered like ColorChip, which is what every other tool
            shows for a colour — the native control's own chrome was the one
            control in this bar that did not match. */}
        <input
          type="color"
          aria-label="Type color"
          value={shown.color}
          onChange={(e) => {
            const color = e.target.value
            if (t) apply({ color }, "Type Color")
            else dispatch({ type: "set-foreground", color })
          }}
          className="w-5 h-5 cursor-pointer rounded-sm border border-[var(--ps-divider)] bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-sm"
        />
      </label>
      <Divider />
      <button
        className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        onClick={() => dispatchPhotoshopEvent("ps-open-warp-text")}
        disabled={!activeLayer || activeLayer.kind !== "text"}
      >
        Warp Text…
      </button>
    </>
  )
}

/**
 * Options for the retouch brushes, which previously showed "No options for
 * this tool." Size is shared by all of them; the tone controls only apply to
 * dodge/burn and the mode toggle only to sponge.
 */
export function RetouchOptions() {
  const { tool, brush, dispatch } = useEditorSelector((editor) => editor)
  const mounted = useMounted()
  const [dodgeBurn, setDodgeBurn] = React.useState(() => ({ range: "midtones" as ToneRange, exposure: 50, protectTones: true }))
  const [sponge, setSponge] = React.useState(() => ({ mode: "desaturate" as "desaturate" | "saturate", flow: 50 }))

  // Runtime options live on `window` (same channel as the shape/move tools)
  // so the canvas can read them without a render-triggering context read.
  React.useEffect(() => {
    setDodgeBurn(getDodgeBurnRuntimeOptions())
    setSponge(getSpongeRuntimeOptions())
  }, [])

  const patchDodgeBurn = (patch: Partial<typeof dodgeBurn>) => {
    const next = { ...dodgeBurn, ...patch }
    setDodgeBurn(next)
    window.__psDodgeBurnOptions = next
  }
  const patchSponge = (patch: Partial<typeof sponge>) => {
    const next = { ...sponge, ...patch }
    setSponge(next)
    window.__psSpongeOptions = next
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className={labelClass}>Size:</span>
        <Input
          aria-label="Brush size"
          type="number"
          min={1}
          max={500}
          value={brush.size}
          onChange={(e) => dispatch({ type: "set-brush", brush: { size: Number(e.target.value) || 1 } })}
          className={numInputClass}
        />
        {mounted ? (
          <Slider
            aria-label="Brush size"
            min={1}
            max={300}
            step={1}
            value={[brush.size]}
            onValueChange={(v) => dispatch({ type: "set-brush", brush: { size: v[0] } })}
            className="w-24"
          />
        ) : (
          <div className="w-24" aria-hidden />
        )}
      </div>
      {tool === "dodge" || tool === "burn" ? (
        <>
          <Divider />
          {/* Dodge and burn are brushes, so they get the brush's soft edge too —
              without it every dab landed as a hard-rimmed disc. */}
          <div className="flex items-center gap-1.5">
            <ScrubLabel
              label="Hardness:"
              value={brush.hardness}
              min={0}
              max={100}
              onChange={(v) => dispatch({ type: "set-brush", brush: { hardness: v } })}
            />
            <PercentInput
              label="Hardness"
              value={brush.hardness}
              onChange={(v) => dispatch({ type: "set-brush", brush: { hardness: v } })}
            />
            <span className="text-[11px]">%</span>
          </div>
          <Divider />
          <span className={labelClass}>Range:</span>
          <Select value={dodgeBurn.range} onValueChange={(v) => patchDodgeBurn({ range: v as ToneRange })}>
            <SelectTrigger className="h-6 w-24 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shadows">Shadows</SelectItem>
              <SelectItem value="midtones">Midtones</SelectItem>
              <SelectItem value="highlights">Highlights</SelectItem>
            </SelectContent>
          </Select>
          <Divider />
          <div className="flex items-center gap-1.5">
            <ScrubLabel
              label="Exposure:"
              value={dodgeBurn.exposure}
              min={1}
              max={100}
              onChange={(v) => patchDodgeBurn({ exposure: v })}
            />
            <PercentInput
              label="Exposure"
              value={dodgeBurn.exposure}
              onChange={(v) => patchDodgeBurn({ exposure: Math.max(1, v) })}
            />
            <span className="text-[11px]">%</span>
          </div>
          <label className="flex items-center gap-1.5" title="Adjust brightness without shifting hue or saturation">
            <input
              type="checkbox"
              checked={dodgeBurn.protectTones}
              onChange={(e) => patchDodgeBurn({ protectTones: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            <span>Protect Tones</span>
          </label>
        </>
      ) : null}
      {tool === "sponge" ? (
        <>
          <Divider />
          <span className={labelClass}>Mode:</span>
          <Select
            value={sponge.mode}
            onValueChange={(v) => patchSponge({ mode: v as "desaturate" | "saturate" })}
          >
            <SelectTrigger className="h-6 w-28 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desaturate">Desaturate</SelectItem>
              <SelectItem value="saturate">Saturate</SelectItem>
            </SelectContent>
          </Select>
          <Divider />
          <div className="flex items-center gap-1.5">
            <ScrubLabel label="Flow:" value={sponge.flow} min={1} max={100} onChange={(v) => patchSponge({ flow: v })} />
            <PercentInput label="Sponge flow" value={sponge.flow} onChange={(v) => patchSponge({ flow: Math.max(1, v) })} />
            <span className="text-[11px]">%</span>
          </div>
        </>
      ) : null}
      {tool === "blur" || tool === "sharpen" || tool === "smudge" || tool === "spot-healing" || tool === "history-brush" ? (
        <>
          <Divider />
          <div className="flex items-center gap-1.5">
            <ScrubLabel label="Strength:" value={brush.flow} min={1} max={100} onChange={(v) => dispatch({ type: "set-brush", brush: { flow: v } })} />
            <PercentInput
              label="Strength"
              value={brush.flow}
              onChange={(v) => dispatch({ type: "set-brush", brush: { flow: Math.max(1, v) } })}
            />
            <span className="text-[11px]">%</span>
          </div>
        </>
      ) : null}
    </>
  )
}


/**
 * Path Selection / Direct Selection options.
 *
 * Path Selection moves whole sub-paths, so the handle mode does not apply to it
 * — it used to fall through to "No options for this tool.", which read as a dead
 * tool rather than a tool with nothing to configure.
 */
export function DirectSelectOptions() {
  const tool = useEditorSelector((editor) => editor.tool)
  const [handleMode, setHandleMode] = React.useState<PathHandleMode>("symmetric")
  React.useEffect(() => {
    window.__psPathOptions = { handleMode }
  }, [handleMode])
  if (tool === "path-select") {
    return (
      <>
        <MousePointer2 className="w-3.5 h-3.5" />
        <span className={labelClass}>Click a shape, path or type layer to select it, then drag to move it.</span>
        <Divider />
        <span className={labelClass}>Alt-drag duplicates the sub-path. Ctrl switches to Direct Selection.</span>
      </>
    )
  }
  return (
    <>
      <MousePointer2 className="w-3.5 h-3.5" />
      <span className={labelClass}>Handle:</span>
      <Select value={handleMode} onValueChange={(value) => setHandleMode(value as PathHandleMode)}>
        <SelectTrigger className="h-6 w-[118px] text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="symmetric">Symmetric</SelectItem>
          <SelectItem value="broken">Broken</SelectItem>
        </SelectContent>
      </Select>
      <span className={labelClass}>Alt temporarily breaks handles.</span>
    </>
  )
}

/** Blend modes Canvas can composite natively — the ones the gradient honours. */
const GRADIENT_BLEND_MODES: BlendMode[] = [
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

/*
 * These option groups live at module scope on purpose. Declared inside
 * OptionsBar they were a new function identity every render, so React remounted
 * the subtree and everything they held died with it — an open Popover snapped
 * shut and local state reset the instant any control dispatched.
 */

export function ShapeOptions() {
  const { tool, foreground, background } = useEditorSelector((editor) => editor)
  type ShapeNumberOptionKey =
    | "strokeWidth"
    | "radius"
    | "sides"
    | "innerRadiusRatio"
    | "vertexRoundness"
    | "rotation"
    | "cornerRadiusTL"
    | "cornerRadiusTR"
    | "cornerRadiusBR"
    | "cornerRadiusBL"
  type ShapeBooleanOptionKey = "polygonStarMode" | "smoothCorners" | "smoothIndent"
  const [opts, setOpts] = React.useState({
    strokeWidth: 0,
    // Square corners by default; the Rounded Rectangle tool substitutes its
    // own minimum. Photoshop's Rectangle tool starts at 0 too.
    radius: tool === "shape-rounded-rect" ? 18 : 0,
    sides: tool === "shape-triangle" ? 3 : 6,
    innerRadiusRatio: 0.45,
    vertexRoundness: 0,
    polygonStarMode: false,
    smoothCorners: false,
    smoothIndent: false,
    rotation: 0,
    cornerRadiusTL: 18,
    cornerRadiusTR: 18,
    cornerRadiusBR: 18,
    cornerRadiusBL: 18,
  })
  React.useEffect(() => {
    window.__psShapeOptions = opts
  }, [opts])
  const update = (key: ShapeNumberOptionKey, value: number) => {
    setOpts((current) => ({ ...current, [key]: value }))
  }
  const updateBool = (key: ShapeBooleanOptionKey, value: boolean) => {
    setOpts((current) => ({ ...current, [key]: value }))
  }
  const number = (label: string, key: ShapeNumberOptionKey, min: number, max: number, step = 1, title?: string) => (
    <label className="flex items-center gap-1" title={title}>
      <span className={labelClass}>{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={opts[key]}
        onChange={(event) => update(key, clampNumber(Number(event.target.value) || 0, min, max))}
        className={numInputClass}
      />
    </label>
  )
  const checkbox = (label: string, key: ShapeBooleanOptionKey, title?: string) => (
    <label className="flex items-center gap-1.5" title={title}>
      <input
        type="checkbox"
        checked={opts[key]}
        onChange={(event) => updateBool(key, event.target.checked)}
        className="accent-[var(--ps-accent)]"
      />
      <span className={labelClass}>{label}</span>
    </label>
  )
  const showCorners = tool === "shape-rounded-rect"
  const showPolygon = tool === "shape-polygon" || tool === "shape-star"
  const starControls = tool === "shape-star" || (tool === "shape-polygon" && opts.polygonStarMode)
  return (
    <>
      <Square className="w-3.5 h-3.5" />
      <span className={labelClass}>Fill:</span>
      <ColorChip color={foreground} />
      <Divider />
      <span className={labelClass}>Stroke:</span>
      <ColorChip color={background} />
      <Input
        type="number"
        min={0}
        max={200}
        value={opts.strokeWidth}
        onChange={(event) => update("strokeWidth", clampNumber(Number(event.target.value) || 0, 0, 200))}
        className={numInputClass}
        title="Stroke width"
      />
      <span className={labelClass}>px</span>
      <Divider />
      {showPolygon ? (
        <>
          {tool === "shape-polygon" ? checkbox("Star", "polygonStarMode", "Create a star from the Polygon Tool") : null}
          {number(tool === "shape-star" ? "Points:" : "Sides:", "sides", 3, 64, 1)}
          {starControls ? number("Inset:", "innerRadiusRatio", 0.05, 0.95, 0.01, "Inner radius ratio") : null}
          {number("Round:", "vertexRoundness", 0, 1, 0.01, "Vertex roundness")}
          {checkbox("Smooth corners", "smoothCorners")}
          {starControls ? checkbox("Smooth indent", "smoothIndent") : null}
        </>
      ) : showCorners ? (
        <>
          {number("TL:", "cornerRadiusTL", 0, 999)}
          {number("TR:", "cornerRadiusTR", 0, 999)}
          {number("BR:", "cornerRadiusBR", 0, 999)}
          {number("BL:", "cornerRadiusBL", 0, 999)}
        </>
      ) : (
        <>
          <span className={labelClass}>Radius:</span>
          <Input
            type="number"
            min={0}
            max={999}
            value={opts.radius}
            onChange={(event) => update("radius", clampNumber(Number(event.target.value) || 0, 0, 999))}
            className={numInputClass}
          />
        </>
      )}
      {number("Rot:", "rotation", -360, 360, 1)}
    </>
  )
}

export function CustomShapeOptions() {
  const { foreground } = useEditorSelector((editor) => editor)
  const [shape, setShape] = React.useState<CustomShapeId>("star5")
  React.useEffect(() => {
    ; window.__psCustomShape = shape
    ; window.__psCustomShapePreset = undefined
  }, [shape])
  const cur = SHAPE_LIBRARY.find((s) => s.id === shape) ?? SHAPE_LIBRARY[0]
  return (
    <>
      <cur.Icon className="w-3.5 h-3.5" />
      <span className={labelClass}>Shape:</span>
      <Popover>
        <PopoverTrigger asChild>
          <button className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] flex items-center gap-1.5">
            <cur.Icon className="w-3.5 h-3.5" />
            <span>{cur.label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-2 w-auto" align="start">
          <div className="grid grid-cols-7 gap-1">
            {SHAPE_LIBRARY.map((s) => (
              <button
                key={s.id}
                title={s.label}
                onClick={() => setShape(s.id)}
                className={cn(
                  "w-8 h-8 rounded-sm border flex items-center justify-center hover:bg-[var(--ps-tool-hover)]",
                  s.id === shape ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]" : "border-[var(--ps-divider)]",
                )}
              >
                <s.Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Divider />
      <span className={labelClass}>Fill:</span>
      <ColorChip color={foreground} />
    </>
  )
}

export function GradientOptions() {
  const { gradient, foreground, background, dispatch } = useEditorSelector((editor) => editor)
  const stops: GradientStop[] = gradient.stops ?? [
    { offset: 0, color: foreground, opacity: 1 },
    { offset: 1, color: background, opacity: 1 },
  ]
  const css = `linear-gradient(to right, ${stops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${rgbaCss(s.color, s.opacity)} ${Math.round(s.offset * 100)}%`)
    .join(", ")})`
  return (
    <>
      <GradientIcon className="w-3.5 h-3.5" />
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="h-6 w-44 border border-[var(--ps-divider)] rounded-sm overflow-hidden"
            title="Edit gradient stops"
            style={{ background: css }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <GradientStopsEditor
            stops={stops}
            onChange={(next) => dispatch({ type: "set-gradient-stops", stops: next })}
          />
        </PopoverContent>
      </Popover>
      <Select
        value={gradient.type}
        onValueChange={(v) =>
          dispatch({ type: "set-gradient", gradient: { type: v as typeof gradient.type } })
        }
      >
        <SelectTrigger className="h-6 w-24 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="linear">Linear</SelectItem>
          <SelectItem value="radial">Radial</SelectItem>
          <SelectItem value="angular">Angular</SelectItem>
          <SelectItem value="reflected">Reflected</SelectItem>
          <SelectItem value="diamond">Diamond</SelectItem>
        </SelectContent>
      </Select>
      <Divider />
      <span className={labelClass}>Mode:</span>
      <Select
        value={gradient.blendMode ?? "normal"}
        onValueChange={(v) =>
          dispatch({ type: "set-gradient", gradient: { blendMode: v as BlendMode } })
        }
      >
        <SelectTrigger className="h-6 w-28 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GRADIENT_BLEND_MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {mode.replace(/(^|-)([a-z])/g, (_, sep, ch) => (sep ? " " : "") + ch.toUpperCase())}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Divider />
      <div className="flex items-center gap-1.5">
        <ScrubLabel
          label="Opacity:"
          value={Math.round((gradient.opacity ?? 1) * 100)}
          min={0}
          max={100}
          onChange={(v) => dispatch({ type: "set-gradient", gradient: { opacity: v / 100 } })}
        />
        <PercentInput
          label="Gradient opacity"
          value={Math.round((gradient.opacity ?? 1) * 100)}
          onChange={(v) => dispatch({ type: "set-gradient", gradient: { opacity: v / 100 } })}
        />
        <span className="text-[11px]">%</span>
      </div>
      <Divider />
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={gradient.reverse}
          onChange={(e) => dispatch({ type: "set-gradient", gradient: { reverse: e.target.checked } })}
          className="accent-[var(--ps-accent)]"
        />
        <span>Reverse</span>
      </label>
      <label className="flex items-center gap-1.5" title="Paint only where the layer already has pixels">
        <input
          type="checkbox"
          checked={gradient.preserveTransparency ?? false}
          onChange={(e) =>
            dispatch({ type: "set-gradient", gradient: { preserveTransparency: e.target.checked } })
          }
          className="accent-[var(--ps-accent)]"
        />
        <span>Transparency</span>
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={gradient.dither ?? false}
          onChange={(e) => dispatch({ type: "set-gradient", gradient: { dither: e.target.checked } })}
          className="accent-[var(--ps-accent)]"
        />
        <span>Dither</span>
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={gradient.cycle ?? false}
          onChange={(e) => dispatch({ type: "set-gradient", gradient: { cycle: e.target.checked } })}
          className="accent-[var(--ps-accent)]"
        />
        <span>Cycle</span>
      </label>
    </>
  )
}

export function TransformOptions() {
  type ReferencePoint = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br"
  type Interpolation = "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper"
  type TransformDraft = {
    tx: number
    ty: number
    widthPct: number
    heightPct: number
    rotation: number
    skewX: number
    skewY: number
    referencePoint: ReferencePoint
    constrainProportions: boolean
    interpolation: Interpolation
  }
  type NumericKey = "tx" | "ty" | "widthPct" | "heightPct" | "rotation" | "skewX" | "skewY"

  const { activeLayer } = useEditorSelector((editor) => editor)
  const canTransform = Boolean(activeLayer && !activeLayer.locked)
  const [draft, setDraft] = React.useState<TransformDraft>({
    tx: 0,
    ty: 0,
    widthPct: 100,
    heightPct: 100,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    referencePoint: "mc",
    constrainProportions: true,
    interpolation: "bicubic",
  })

  React.useEffect(() => {
    setDraft({
      tx: 0,
      ty: 0,
      widthPct: 100,
      heightPct: 100,
      rotation: 0,
      skewX: 0,
      skewY: 0,
      referencePoint: "mc",
      constrainProportions: true,
      interpolation: "bicubic",
    })
  }, [activeLayer?.id])

  const send = (patch: Partial<TransformDraft>) => {
    let next = { ...draft, ...patch }
    if (next.constrainProportions) {
      if (patch.widthPct !== undefined && patch.heightPct === undefined) next = { ...next, heightPct: patch.widthPct }
      if (patch.heightPct !== undefined && patch.widthPct === undefined) next = { ...next, widthPct: patch.heightPct }
    }
    setDraft(next)
    if (canTransform) {
      dispatchPhotoshopEvent("ps-transform-set", next)
    }
  }

  const numberField = (label: string, key: NumericKey, min: number, max: number, step = 1, suffix = "") => (
    <label className="flex items-center gap-1">
      <span className={labelClass}>{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(draft[key]).toFixed(step < 1 ? 1 : 0)}
        onChange={(event) => send({ [key]: clampNumber(Number(event.target.value) || 0, min, max) } as Partial<TransformDraft>)}
        disabled={!canTransform}
        className={numInputClass}
      />
      {suffix ? <span className={labelClass}>{suffix}</span> : null}
    </label>
  )

  return (
    <>
      <button
        className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        onClick={() => {
          if (!canTransform) return
          dispatchPhotoshopEvent("ps-free-transform")
          dispatchPhotoshopEvent("ps-transform-set", draft)
        }}
        disabled={!canTransform}
      >
        Start
      </button>
      <Divider />
      {numberField("X:", "tx", -9999, 9999, 1, "px")}
      {numberField("Y:", "ty", -9999, 9999, 1, "px")}
      {numberField("W:", "widthPct", -1000, 1000, 0.1, "%")}
      {numberField("H:", "heightPct", -1000, 1000, 0.1, "%")}
      <label className="flex items-center gap-1.5" title="Constrain proportions">
        <input
          type="checkbox"
          checked={draft.constrainProportions}
          onChange={(event) => send({ constrainProportions: event.target.checked })}
          disabled={!canTransform}
          className="accent-[var(--ps-accent)]"
        />
        <span className={labelClass}>Link</span>
      </label>
      {numberField("A:", "rotation", -360, 360, 0.1, "deg")}
      {numberField("Skew X:", "skewX", -89, 89, 0.1, "deg")}
      {numberField("Skew Y:", "skewY", -89, 89, 0.1, "deg")}
      <select
        aria-label="Reference point"
        value={draft.referencePoint}
        onChange={(event) => send({ referencePoint: event.target.value as ReferencePoint })}
        disabled={!canTransform}
        className="h-6 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[11px] px-1"
      >
        <option value="tl">Top left</option>
        <option value="tc">Top center</option>
        <option value="tr">Top right</option>
        <option value="ml">Middle left</option>
        <option value="mc">Center</option>
        <option value="mr">Middle right</option>
        <option value="bl">Bottom left</option>
        <option value="bc">Bottom center</option>
        <option value="br">Bottom right</option>
      </select>
      <select
        aria-label="Interpolation"
        value={draft.interpolation}
        onChange={(event) => send({ interpolation: event.target.value as Interpolation })}
        disabled={!canTransform}
        className="h-6 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[11px] px-1"
      >
        <option value="nearest">Nearest</option>
        <option value="bilinear">Bilinear</option>
        <option value="bicubic">Bicubic</option>
        <option value="bicubic-smoother">Bicubic smoother</option>
        <option value="bicubic-sharper">Bicubic sharper</option>
      </select>
      <Divider />
      <span className={labelClass}>Perspective: Alt-drag corners</span>
      <Divider />
      <button
        className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        onClick={() => dispatchPhotoshopEvent("ps-transform-commit")}
        disabled={!canTransform}
      >
        Apply
      </button>
      <button
        className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        onClick={() => dispatchPhotoshopEvent("ps-transform-cancel")}
        disabled={!canTransform}
      >
        Cancel
      </button>
      <Divider />
      <button
        className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        onClick={() => dispatchPhotoshopEvent("ps-transform-flip", "horizontal")}
        disabled={!canTransform}
      >
        Flip H
      </button>
      <button
        className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        onClick={() => dispatchPhotoshopEvent("ps-transform-flip", "vertical")}
        disabled={!canTransform}
      >
        Flip V
      </button>
      <button
        className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        onClick={() => send({ rotation: draft.rotation + 90 })}
        disabled={!canTransform}
      >
        +90
      </button>
    </>
  )
}
