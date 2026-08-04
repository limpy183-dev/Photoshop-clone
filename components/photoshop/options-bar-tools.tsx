"use client"

import * as React from "react"
import { useEditorSelector } from "@/components/photoshop/editor/context"
import { useMounted } from "@/editor/use-mounted"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MousePointer2, Type } from "lucide-react"
import { dispatchPhotoshopEvent } from "@/editor/events"
import type { PathHandleMode, TextAntiAliasMode, TextProps } from "@/editor/types"
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
import {
  Divider,
  labelClass,
  numInputClass,
  clampNumber,
  PercentInput,
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
