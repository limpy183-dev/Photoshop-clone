"use client"

import * as React from "react"
import { useEditor } from "./editor-context"
import { useMounted } from "./use-mounted"
import { requestCanvasZoom } from "./zoom-events"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Brush,
  Eraser,
  Pipette,
  MousePointer2,
  Square,
  Type,
  Hand,
  ZoomIn,
  Star,
  Heart,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Check,
  X,
  Zap,
  Hexagon,
  Triangle as TriangleIcon,
  Diamond,
  Frame as FrameIcon,
  Scissors,
  Hash,
  Ruler as RulerIcon,
  StickyNote,
  PaintbrushVertical,
  LayoutTemplate,
  PenTool,
  PenLine,
  Crosshair,
  RotateCw,
  Plus,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CustomShapeId, GradientStop, QuickMaskPaintMode, TextAntiAliasMode, ToolId } from "./types"
import { WORKSPACE_PRESET_OPTIONS, type WorkspacePresetId } from "./panel-registry"

const Divider = () => <div className="w-px h-5 bg-[var(--ps-divider)] mx-2" />

const labelClass = "text-[11px] text-[var(--ps-text-dim)]"
const numInputClass =
  "w-16 h-6 px-1.5 text-[11px] bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[var(--ps-text)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const SHAPE_LIBRARY: { id: CustomShapeId; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "star5", label: "5-Star", Icon: Star },
  { id: "star6", label: "6-Star", Icon: Star },
  { id: "heart", label: "Heart", Icon: Heart },
  { id: "arrow-right", label: "Arrow Right", Icon: ArrowRight },
  { id: "arrow-left", label: "Arrow Left", Icon: ArrowLeft },
  { id: "arrow-up", label: "Arrow Up", Icon: ArrowUp },
  { id: "arrow-down", label: "Arrow Down", Icon: ArrowDown },
  { id: "speech", label: "Speech", Icon: MessageSquare },
  { id: "check", label: "Check", Icon: Check },
  { id: "cross", label: "Cross", Icon: X },
  { id: "lightning", label: "Lightning", Icon: Zap },
  { id: "polygon-hex", label: "Hexagon", Icon: Hexagon },
  { id: "polygon-tri", label: "Triangle", Icon: TriangleIcon },
  { id: "diamond", label: "Diamond", Icon: Diamond },
]

export function OptionsBar() {
  const { tool, brush, dispatch, gradient, foreground, background, eraser, cloneSource, activeDoc } = useEditor()
  // brush.size is loaded from localStorage post-hydrate, so the Radix
  // Slider's internal `<SliderRange right="X%">` would mismatch between
  // SSR (defaults) and the first client render (persisted). We render a
  // same-width spacer until mount, then swap in the real slider — the
  // input field next to it stays mounted so the user can still edit
  // brush size before the slider appears (typically a few ms).
  const mounted = useMounted()
  const workspaceRef = React.useRef<HTMLSelectElement>(null)
  const [workspace, setWorkspace] = React.useState<WorkspacePresetId>("essentials")

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("ps-current-workspace-preset") as WorkspacePresetId | null
      if (saved && WORKSPACE_PRESET_OPTIONS.some((preset) => preset.id === saved)) {
        setWorkspace(saved)
        if (workspaceRef.current) workspaceRef.current.value = saved
      }
    } catch {}
    const handler = (event: Event) => {
      const preset = String((event as CustomEvent).detail?.preset ?? "") as WorkspacePresetId
      if (WORKSPACE_PRESET_OPTIONS.some((option) => option.id === preset)) {
        setWorkspace(preset)
        if (workspaceRef.current) workspaceRef.current.value = preset
      }
    }
    window.addEventListener("ps-workspace-preset-changed", handler)
    return () => window.removeEventListener("ps-workspace-preset-changed", handler)
  }, [])

  const applyWorkspace = React.useCallback((preset: WorkspacePresetId) => {
    setWorkspace(preset)
    window.dispatchEvent(new CustomEvent("ps-apply-workspace-preset", { detail: { preset } }))
  }, [])

  return (
    <div className="h-9 bg-[var(--ps-panel)] border-b border-[var(--ps-divider)] flex items-center px-2 gap-2 text-[11px]">
      <ToolBadge tool={tool} />
      <Divider />
      {tool === "brush" || tool === "pencil" || tool === "mixer-brush" || tool === "pattern-stamp" || tool === "art-history-brush" || tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser" || tool === "red-eye" ? (
        renderBrushOptions()
      ) : tool === "clone-stamp" || tool === "healing-brush" ? (
        <CloneSourceOptions />
      ) : tool === "move" || tool === "content-aware-move" ? (
        <MoveOptions />
      ) : tool === "marquee-rect" || tool === "marquee-ellipse" || tool === "marquee-row" || tool === "marquee-col" ? (
        <MarqueeOptions />
      ) : tool === "lasso" || tool === "lasso-polygon" || tool === "lasso-magnetic" || tool === "magic-wand" || tool === "quick-selection" || tool === "object-select" || tool === "refine-edge-brush" || tool === "select-subject" || tool === "select-sky" || tool === "select-background" || tool === "patch-tool" ? (
        <SelectionToolOptions />
      ) : tool === "type" || tool === "type-vertical" || tool === "type-mask-horizontal" || tool === "type-mask-vertical" ? (
        <TypeOptions />
      ) : tool === "eyedropper" || tool === "color-sampler" || tool === "material-eyedropper" || tool === "material-drop" ? (
        <EyedropperOptions />
      ) : tool === "zoom" ? (
        <ZoomOptions />
      ) : tool === "hand" ? (
        <HandOptions />
      ) : tool === "rotate-view" ? (
        <RotateViewOptions />
      ) : tool === "shape-rect" || tool === "shape-rounded-rect" || tool === "shape-ellipse" || tool === "shape-polygon" || tool === "shape-star" || tool === "shape-triangle" || tool === "shape-line" ? (
        <ShapeOptions />
      ) : tool === "custom-shape" ? (
        <CustomShapeOptions />
      ) : tool === "gradient" ? (
        <GradientOptions />
      ) : tool === "frame" ? (
        <FrameOptions />
      ) : tool === "slice" || tool === "slice-select" ? (
        <SliceOptions />
      ) : tool === "ruler" ? (
        <RulerOptions />
      ) : tool === "note" ? (
        <NoteOptions />
      ) : tool === "count" ? (
        <CountOptions />
      ) : tool === "perspective-crop" ? (
        <PerspectiveCropOptions />
      ) : tool === "artboard" ? (
        <ArtboardOptions />
      ) : tool === "direct-select" || tool === "add-anchor-point" || tool === "delete-anchor-point" || tool === "convert-point" ? (
        <DirectSelectOptions />
      ) : tool === "transform" ? (
        <TransformOptions />
      ) : (
        <span className={labelClass}>No options for this tool.</span>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <span className={labelClass}>Workspace:</span>
        <select
          ref={workspaceRef}
          aria-label="Workspace preset"
          defaultValue={workspace}
          onChange={(event) => applyWorkspace(event.currentTarget.value as WorkspacePresetId)}
          className="h-6 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[11px] px-1"
        >
          {WORKSPACE_PRESET_OPTIONS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      </div>
    </div>
  )

  function renderBrushOptions() {
    return (
      <>
        <div className="flex items-center gap-1.5">
          {tool === "brush" ? (
            <Brush className="w-3.5 h-3.5" />
          ) : tool === "eraser" ? (
            <Eraser className="w-3.5 h-3.5" />
          ) : null}
          <span className={labelClass}>Size:</span>
          <Input
            type="number"
            min={1}
            max={500}
            value={brush.size}
            onChange={(e) =>
              dispatch({ type: "set-brush", brush: { size: Number(e.target.value) || 1 } })
            }
            className={numInputClass}
          />
          {mounted ? (
            <Slider
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
        <Divider />
        <div className="flex items-center gap-1.5">
          <ScrubLabel label="Hardness:" value={brush.hardness} min={0} max={100} onChange={(v) => dispatch({ type: "set-brush", brush: { hardness: v } })} />
          <PercentInput
            value={brush.hardness}
            onChange={(v) => dispatch({ type: "set-brush", brush: { hardness: v } })}
          />
          <span className="text-[11px]">%</span>
        </div>
        <Divider />
        <div className="flex items-center gap-1.5">
          <ScrubLabel label="Opacity:" value={brush.opacity} min={0} max={100} onChange={(v) => dispatch({ type: "set-brush", brush: { opacity: v } })} />
          <PercentInput
            value={brush.opacity}
            onChange={(v) => dispatch({ type: "set-brush", brush: { opacity: v } })}
          />
          <span className="text-[11px]">%</span>
        </div>
        <Divider />
        <div className="flex items-center gap-1.5">
          <ScrubLabel label="Flow:" value={brush.flow} min={0} max={100} onChange={(v) => dispatch({ type: "set-brush", brush: { flow: v } })} />
          <PercentInput
            value={brush.flow}
            onChange={(v) => dispatch({ type: "set-brush", brush: { flow: v } })}
          />
          <span className="text-[11px]">%</span>
        </div>
        <Divider />
        <div className="flex items-center gap-1.5">
          <ScrubLabel label="Smoothing:" value={brush.smoothing} min={0} max={100} onChange={(v) => dispatch({ type: "set-brush", brush: { smoothing: v } })} />
          <PercentInput
            value={brush.smoothing}
            onChange={(v) => dispatch({ type: "set-brush", brush: { smoothing: v } })}
          />
          <span className="text-[11px]">%</span>
        </div>
        {activeDoc?.quickMask ? (
          <>
            <Divider />
            <div className="flex items-center gap-1.5">
              <span className={labelClass}>Quick Mask:</span>
              <Select
                value={activeDoc.quickMaskPaintMode ?? "auto"}
                onValueChange={(mode) =>
                  dispatch({ type: "set-quick-mask-paint-mode", mode: mode as QuickMaskPaintMode })
                }
              >
                <SelectTrigger className="h-6 w-[92px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="add">Add</SelectItem>
                  <SelectItem value="subtract">Subtract</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}
        {tool === "background-eraser" || tool === "magic-eraser" ? (
          <>
            <Divider />
            <span className={labelClass}>Sampling:</span>
            <select
              value={eraser.sampling}
              onChange={(e) => dispatch({ type: "set-eraser", eraser: { sampling: e.target.value as typeof eraser.sampling } })}
              className="h-6 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[11px] px-1"
            >
              <option value="continuous">Continuous</option>
              <option value="once">Once</option>
              <option value="background-swatch">Background Swatch</option>
            </select>
            <span className={labelClass}>Limits:</span>
            <select
              value={eraser.limits}
              onChange={(e) => dispatch({ type: "set-eraser", eraser: { limits: e.target.value as typeof eraser.limits } })}
              className="h-6 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[11px] px-1"
            >
              <option value="contiguous">Contiguous</option>
              <option value="discontiguous">Discontiguous</option>
              <option value="find-edges">Find Edges</option>
            </select>
            <span className={labelClass}>Tolerance:</span>
            <Input
              type="number"
              min={0}
              max={255}
              value={eraser.tolerance}
              onChange={(e) => dispatch({ type: "set-eraser", eraser: { tolerance: clampNumber(Number(e.target.value) || 0, 0, 255) } })}
              className={numInputClass}
            />
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={eraser.protectForeground}
                onChange={(e) => dispatch({ type: "set-eraser", eraser: { protectForeground: e.target.checked } })}
                className="accent-[var(--ps-accent)]"
              />
              <span>Protect FG</span>
            </label>
          </>
        ) : null}
      </>
    )
  }

  function CloneSourceOptions() {
    return (
      <>
        <Brush className="w-3.5 h-3.5" />
        <span className={labelClass}>Alt-click to sample.</span>
        <Divider />
        <span className={labelClass}>Sample:</span>
        <select
          value={cloneSource.sample}
          onChange={(e) => dispatch({ type: "set-clone-source", cloneSource: { sample: e.target.value as typeof cloneSource.sample } })}
          className="h-6 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[11px] px-1"
        >
          <option value="current-layer">Current Layer</option>
          <option value="current-below">Current & Below</option>
          <option value="all-layers">All Layers</option>
        </select>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={cloneSource.aligned}
            onChange={(e) => dispatch({ type: "set-clone-source", cloneSource: { aligned: e.target.checked } })}
            className="accent-[var(--ps-accent)]"
          />
          <span>Aligned</span>
        </label>
        <Divider />
        <span className={labelClass}>Scale:</span>
        <Input
          type="number"
          min={10}
          max={400}
          value={cloneSource.scale}
          onChange={(e) => dispatch({ type: "set-clone-source", cloneSource: { scale: clampNumber(Number(e.target.value) || 100, 10, 400) } })}
          className={numInputClass}
        />
        <span className="text-[11px]">%</span>
        <span className={labelClass}>Rotate:</span>
        <Input
          type="number"
          min={-180}
          max={180}
          value={cloneSource.rotation}
          onChange={(e) => dispatch({ type: "set-clone-source", cloneSource: { rotation: clampNumber(Number(e.target.value) || 0, -180, 180) } })}
          className={numInputClass}
        />
        <span className="text-[11px]">deg</span>
        <select
          aria-label="Clone source preset"
          value={cloneSource.activePresetId ?? "none"}
          onChange={(e) => dispatch({ type: "set-clone-source", cloneSource: { activePresetId: e.target.value === "none" ? null : e.target.value } })}
          className="h-6 min-w-32 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm text-[11px] px-1"
        >
          <option value="none">No source</option>
          {cloneSource.presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
      </>
    )
  }

  function MoveOptions() {
    const { activeLayer, activeDoc, selectedLayers, dispatch, commit } = useEditor()
    const selectedIds = selectedLayers.map((layer) => layer.id)
    const canAlign = selectedLayers.filter((layer) => layer.kind !== "group" && !layer.locked && !layer.lockMove && !layer.lockAll).length >= 2
    const canDistribute = selectedLayers.filter((layer) => layer.kind !== "group" && !layer.locked && !layer.lockMove && !layer.lockAll).length >= 3
    const align = (mode: "left" | "center-x" | "right" | "top" | "center-y" | "bottom") => {
      if (!activeDoc || !canAlign) return
      dispatch({ type: "align-layers", align: mode, ids: selectedIds })
      setTimeout(() => commit("Align Layers", selectedIds), 0)
    }
    const distribute = (axis: "horizontal" | "vertical") => {
      if (!activeDoc || !canDistribute) return
      dispatch({ type: "distribute-layers", axis, ids: selectedIds })
      setTimeout(() => commit("Distribute Layers", selectedIds), 0)
    }
    return (
      <>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" defaultChecked className="accent-[var(--ps-accent)]" />
          <span>Auto-Select</span>
        </label>
        <Select defaultValue="layer">
          <SelectTrigger className="h-6 w-20 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="layer">Layer</SelectItem>
            <SelectItem value="group">Group</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 ml-2">
          <input type="checkbox" className="accent-[var(--ps-accent)]" />
          <span>Show Transform Controls</span>
        </label>
        <Divider />
        <div className="flex items-center gap-1">
          <span className={labelClass}>Align:</span>
          {[
            ["left", "L", "Align left edges"],
            ["center-x", "HC", "Align horizontal centers"],
            ["right", "R", "Align right edges"],
            ["top", "T", "Align top edges"],
            ["center-y", "VC", "Align vertical centers"],
            ["bottom", "B", "Align bottom edges"],
          ].map(([mode, label, title]) => (
            <button
              key={mode}
              className="h-6 min-w-6 border border-[var(--ps-divider)] px-1 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
              title={title}
              disabled={!canAlign}
              onClick={() => align(mode as "left" | "center-x" | "right" | "top" | "center-y" | "bottom")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className={labelClass}>Distribute:</span>
          <button
            className="h-6 min-w-7 border border-[var(--ps-divider)] px-1 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
            title="Distribute horizontal centers"
            disabled={!canDistribute}
            onClick={() => distribute("horizontal")}
          >
            DH
          </button>
          <button
            className="h-6 min-w-7 border border-[var(--ps-divider)] px-1 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
            title="Distribute vertical centers"
            disabled={!canDistribute}
            onClick={() => distribute("vertical")}
          >
            DV
          </button>
        </div>
        <Divider />
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-free-transform"))}
          disabled={!activeLayer || activeLayer.locked}
        >
          Free Transform
        </button>
      </>
    )
  }

  function MarqueeOptions() {
    const { selectionOptions } = useEditor()
    return (
      <>
        <Square className="w-3.5 h-3.5" />
        <Select
          value={selectionOptions.mode}
          onValueChange={(v) => dispatch({ type: "set-selection-options", selectionOptions: { mode: v as typeof selectionOptions.mode } })}
        >
          <SelectTrigger className="h-6 w-28 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">New selection</SelectItem>
            <SelectItem value="add">Add to selection</SelectItem>
            <SelectItem value="subtract">Subtract from</SelectItem>
            <SelectItem value="intersect">Intersect with</SelectItem>
          </SelectContent>
        </Select>
        <Divider />
        <span className={labelClass}>Feather:</span>
        <Input
          type="number"
          min={0}
          value={selectionOptions.feather}
          onChange={(e) => dispatch({ type: "set-selection-options", selectionOptions: { feather: Math.max(0, Number(e.target.value) || 0) } })}
          className={numInputClass}
        />
        <span className="text-[11px]">px</span>
        <Divider />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={selectionOptions.antiAlias}
            onChange={(e) => dispatch({ type: "set-selection-options", selectionOptions: { antiAlias: e.target.checked } })}
            className="accent-[var(--ps-accent)]"
          />
          <span>Anti-alias</span>
        </label>
        <Divider />
        <label className="flex items-center gap-1.5">
          <span className={labelClass}>Style:</span>
          <Select defaultValue="rect">
            <SelectTrigger className="h-6 w-28 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rect">Rectangular Marquee</SelectItem>
              <SelectItem value="ellipse">Elliptical Marquee</SelectItem>
              <SelectItem value="row">Single Row Marquee</SelectItem>
              <SelectItem value="col">Single Column Marquee</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </>
    )
  }

  function SelectionToolOptions() {
    const { selectionOptions } = useEditor()
    const quickLike = tool === "quick-selection"
    const wandLike = tool === "magic-wand" || quickLike || tool === "object-select"
    const magneticLike = tool === "lasso-magnetic"
    const refineLike = tool === "refine-edge-brush"
    return (
      <>
        <Square className="w-3.5 h-3.5" />
        <Select
          value={selectionOptions.mode}
          onValueChange={(v) => dispatch({ type: "set-selection-options", selectionOptions: { mode: v as typeof selectionOptions.mode } })}
        >
          <SelectTrigger className="h-6 w-28 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">New selection</SelectItem>
            <SelectItem value="add">Add to selection</SelectItem>
            <SelectItem value="subtract">Subtract from</SelectItem>
            <SelectItem value="intersect">Intersect with</SelectItem>
          </SelectContent>
        </Select>
        <Divider />
        <span className={labelClass}>Feather:</span>
        <Input
          type="number"
          min={0}
          value={selectionOptions.feather}
          onChange={(e) => dispatch({ type: "set-selection-options", selectionOptions: { feather: Math.max(0, Number(e.target.value) || 0) } })}
          className={numInputClass}
        />
        <span className="text-[11px]">px</span>
        <Divider />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={selectionOptions.antiAlias}
            onChange={(e) => dispatch({ type: "set-selection-options", selectionOptions: { antiAlias: e.target.checked } })}
            className="accent-[var(--ps-accent)]"
          />
          <span>Anti-alias</span>
        </label>
        {wandLike ? (
          <>
            <Divider />
            <span className={labelClass}>Tolerance:</span>
            <Input
              type="number"
              min={0}
              max={255}
              value={selectionOptions.tolerance}
              onChange={(e) => dispatch({ type: "set-selection-options", selectionOptions: { tolerance: Math.max(0, Math.min(255, Number(e.target.value) || 0)) } })}
              className={numInputClass}
            />
            {quickLike ? (
              <Slider
                min={0}
                max={255}
                step={1}
                value={[selectionOptions.tolerance]}
                onValueChange={(value) => dispatch({ type: "set-selection-options", selectionOptions: { tolerance: value[0] } })}
                className="w-24"
              />
            ) : null}
            <label className="flex items-center gap-1.5 ml-1">
              <input
                type="checkbox"
                checked={selectionOptions.contiguous}
                onChange={(e) => dispatch({ type: "set-selection-options", selectionOptions: { contiguous: e.target.checked } })}
                className="accent-[var(--ps-accent)]"
              />
              <span>Contiguous</span>
            </label>
            <label className="flex items-center gap-1.5 ml-1">
              <input
                type="checkbox"
                checked={selectionOptions.sampleAllLayers ?? false}
                onChange={(e) => dispatch({ type: "set-selection-options", selectionOptions: { sampleAllLayers: e.target.checked } })}
                className="accent-[var(--ps-accent)]"
              />
              <span>Sample All Layers</span>
            </label>
            {quickLike ? (
              <>
                <Divider />
                <span className={labelClass}>Sample:</span>
                <Select
                  value={selectionOptions.sampleSize ?? "point"}
                  onValueChange={(value) => dispatch({ type: "set-selection-options", selectionOptions: { sampleSize: value as NonNullable<typeof selectionOptions.sampleSize> } })}
                >
                  <SelectTrigger className="h-6 w-28 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="point">Point</SelectItem>
                    <SelectItem value="3x3">3 x 3</SelectItem>
                    <SelectItem value="5x5">5 x 5</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  title="Grow selection"
                  className="h-6 w-7 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] inline-flex items-center justify-center"
                  onClick={() => dispatch({ type: "grow-selection", amount: 2 })}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Shrink selection"
                  className="h-6 w-7 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] inline-flex items-center justify-center"
                  onClick={() => dispatch({ type: "contract-selection", amount: 2 })}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
          </>
        ) : null}
        {magneticLike ? (
          <>
            <Divider />
            <span className={labelClass}>Width:</span>
            <Input
              type="number"
              min={2}
              max={64}
              value={selectionOptions.magneticWidth ?? 12}
              onChange={(event) => dispatch({ type: "set-selection-options", selectionOptions: { magneticWidth: Math.max(2, Math.min(64, Number(event.target.value) || 12)) } })}
              className={numInputClass}
            />
            <span className={labelClass}>Contrast:</span>
            <Input
              type="number"
              min={1}
              max={512}
              value={selectionOptions.magneticContrast ?? 24}
              onChange={(event) => dispatch({ type: "set-selection-options", selectionOptions: { magneticContrast: Math.max(1, Math.min(512, Number(event.target.value) || 24)) } })}
              className={numInputClass}
            />
          </>
        ) : null}
        {refineLike ? (
          <>
            <Divider />
            <span className={labelClass}>Brush:</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={brush.size}
              onChange={(e) => dispatch({ type: "set-brush", brush: { size: Math.max(1, Number(e.target.value) || 1) } })}
              className={numInputClass}
            />
            <span className="text-[11px]">px</span>
          </>
        ) : null}
      </>
    )
  }

  function TypeOptions() {
    const { activeLayer, dispatch, commit, requestRender } = useEditor()
    const t = activeLayer?.kind === "text" ? activeLayer.text : null
    return (
      <>
        <Type className="w-3.5 h-3.5" />
        <Select
          value={t?.font ?? "Geist"}
          onValueChange={(v) => {
            if (!activeLayer || !t) return
            const next = { ...t, font: v }
            dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
            requestRender()
            commit("Type Font", [activeLayer.id])
          }}
        >
          <SelectTrigger className="h-6 w-32 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Geist">Geist</SelectItem>
            <SelectItem value="Inter">Inter</SelectItem>
            <SelectItem value="Helvetica">Helvetica</SelectItem>
            <SelectItem value="Times">Times</SelectItem>
            <SelectItem value="Courier">Courier</SelectItem>
            <SelectItem value="Georgia">Georgia</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={t ? (t.weight === "bold" && t.italic ? "BoldItalic" : t.weight === "bold" ? "Bold" : t.italic ? "Italic" : "Regular") : "Regular"}
          onValueChange={(v) => {
            if (!activeLayer || !t) return
            const next = {
              ...t,
              weight: v.includes("Bold") ? ("bold" as const) : ("normal" as const),
              italic: v.includes("Italic"),
            }
            dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
            requestRender()
            commit("Type Style", [activeLayer.id])
          }}
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
        <Input
          type="number"
          value={t?.size ?? 48}
          onChange={(e) => {
            if (!activeLayer || !t) return
            const next = { ...t, size: Number(e.target.value) || t.size }
            dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
            requestRender()
          }}
          className={numInputClass}
        />
        <span className={labelClass}>pt</span>
        <Divider />
        <Select
          value={t ? (t.antiAlias === false ? "none" : t.antiAliasMode ?? "smooth") : "smooth"}
          onValueChange={(v) => {
            if (!activeLayer || !t) return
            const mode = v as TextAntiAliasMode
            const next = { ...t, antiAliasMode: mode, antiAlias: mode !== "none" }
            dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
            requestRender()
            commit("Type Anti-Alias", [activeLayer.id])
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
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-open-warp-text"))}
          disabled={!activeLayer || activeLayer.kind !== "text"}
        >
          Warp Text…
        </button>
      </>
    )
  }

  function EyedropperOptions() {
    const helper =
      tool === "color-sampler"
        ? "Click the canvas to place up to 4 persistent readouts."
        : tool === "material-eyedropper"
          ? "Click a 3D layer to sample its active material."
          : tool === "material-drop"
            ? "Click a 3D layer to apply the foreground color to its material."
            : "Click the canvas to sample foreground color."
    return (
      <>
        <Pipette className="w-3.5 h-3.5" />
        <span className={labelClass}>Sample Size:</span>
        <Select defaultValue="point">
          <SelectTrigger className="h-6 w-32 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="point">Point Sample</SelectItem>
            <SelectItem value="3x3">3 by 3 Average</SelectItem>
            <SelectItem value="5x5">5 by 5 Average</SelectItem>
          </SelectContent>
        </Select>
        <Divider />
        <span className={labelClass}>{helper}</span>
      </>
    )
  }

  function ZoomOptions() {
    const { activeDoc } = useEditor()
    return (
      <>
        <ZoomIn className="w-3.5 h-3.5" />
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm bg-[var(--ps-panel)] hover:bg-[var(--ps-tool-hover)]"
          onClick={() => requestCanvasZoom({ zoom: 1 })}
        >
          100%
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm bg-[var(--ps-panel)] hover:bg-[var(--ps-tool-hover)]"
          onClick={() => activeDoc && requestCanvasZoom({ zoom: 0.5 })}
        >
          Fit Screen
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm bg-[var(--ps-panel)] hover:bg-[var(--ps-tool-hover)]"
          onClick={() => requestCanvasZoom({ zoom: 2 })}
        >
          200%
        </button>
      </>
    )
  }

  function HandOptions() {
    return (
      <>
        <Hand className="w-3.5 h-3.5" />
        <span className={labelClass}>Drag the canvas to pan.</span>
      </>
    )
  }

  function RotateViewOptions() {
    const { activeDoc, dispatch } = useEditor()
    const rotation = activeDoc?.rotation ?? 0
    const setRotation = (value: 0 | 90 | 180 | 270) => dispatch({ type: "set-rotation", rotation: value })
    return (
      <>
        <RotateCw className="w-3.5 h-3.5" />
        <span className={labelClass}>View Rotation:</span>
        {[0, 90, 180, 270].map((value) => (
          <button
            key={value}
            className={cn(
              "h-6 min-w-9 rounded-sm border border-[var(--ps-divider)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]",
              rotation === value && "bg-[var(--ps-tool-active)] text-[var(--ps-accent-2)]",
            )}
            onClick={() => setRotation(value as 0 | 90 | 180 | 270)}
          >
            {value}
          </button>
        ))}
      </>
    )
  }

  function ShapeOptions() {
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
      radius: 18,
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

  function CustomShapeOptions() {
    const [shape, setShape] = React.useState<CustomShapeId>("star5")
    React.useEffect(() => {
      ; window.__psCustomShape = shape
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

  function GradientOptions() {
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
        <PaintbrushVertical className="w-3.5 h-3.5" />
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
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={gradient.reverse}
            onChange={(e) => dispatch({ type: "set-gradient", gradient: { reverse: e.target.checked } })}
            className="accent-[var(--ps-accent)]"
          />
          <span>Reverse</span>
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

  function FrameOptions() {
    return (
      <>
        <FrameIcon className="w-3.5 h-3.5" />
        <span className={labelClass}>Shape:</span>
        <Select defaultValue="rect">
          <SelectTrigger className="h-6 w-24 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rect">Rectangle</SelectItem>
            <SelectItem value="ellipse">Ellipse</SelectItem>
          </SelectContent>
        </Select>
        <span className={labelClass}>Drag to create a frame for image placement.</span>
      </>
    )
  }

  function SliceOptions() {
    return (
      <>
        <Scissors className="w-3.5 h-3.5" />
        <span className={labelClass}>Slice Type:</span>
        <Select defaultValue="user">
          <SelectTrigger className="h-6 w-28 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">User Slice</SelectItem>
            <SelectItem value="auto">Auto Slice</SelectItem>
            <SelectItem value="layer">Layer Slice</SelectItem>
          </SelectContent>
        </Select>
        <Divider />
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-clear-slices"))}
        >
          Clear Slices
        </button>
      </>
    )
  }

  function RulerOptions() {
    return (
      <>
        <RulerIcon className="w-3.5 h-3.5" />
        <span className={labelClass}>Drag a line to measure distance and angle.</span>
        <Divider />
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-clear-ruler"))}
        >
          Clear
        </button>
      </>
    )
  }

  function NoteOptions() {
    return (
      <>
        <StickyNote className="w-3.5 h-3.5" />
        <span className={labelClass}>Click to drop a note. Click an existing note to edit.</span>
      </>
    )
  }

  function CountOptions() {
    const { activeDoc, dispatch } = useEditor()
    return (
      <>
        <Hash className="w-3.5 h-3.5" />
        <span className={labelClass}>Group:</span>
        <Input
          value={activeDoc?.countGroup ?? "Group 1"}
          onChange={(e) => dispatch({ type: "set-count-group", group: e.target.value })}
          className="w-24 h-6 text-[11px]"
        />
        <span className="ml-2 text-[11px]">
          Count: <strong>{(activeDoc?.counts ?? []).filter((c) => c.group === (activeDoc?.countGroup ?? "Group 1")).length}</strong>
        </span>
        <Divider />
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => dispatch({ type: "clear-counts" })}
        >
          Clear Counts
        </button>
      </>
    )
  }

  function PerspectiveCropOptions() {
    return (
      <>
        <span className={labelClass}>Drag four corners then press Enter to apply.</span>
      </>
    )
  }

  function ArtboardOptions() {
    return (
      <>
        <LayoutTemplate className="w-3.5 h-3.5" />
        <span className={labelClass}>Drag to create a new artboard.</span>
      </>
    )
  }

  function DirectSelectOptions() {
    return (
      <>
        <span className={labelClass}>Click and drag path nodes or handles.</span>
      </>
    )
  }

  function TransformOptions() {
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

    const { activeLayer } = useEditor()
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
        window.dispatchEvent(new CustomEvent("ps-transform-set", { detail: next }))
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
            window.dispatchEvent(new CustomEvent("ps-free-transform"))
            window.dispatchEvent(new CustomEvent("ps-transform-set", { detail: draft }))
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
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-commit"))}
          disabled={!canTransform}
        >
          Apply
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-cancel"))}
          disabled={!canTransform}
        >
          Cancel
        </button>
        <Divider />
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-flip", { detail: "horizontal" }))}
          disabled={!canTransform}
        >
          Flip H
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-flip", { detail: "vertical" }))}
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

  function _TransformOptionsLegacy() {
    const { activeLayer, dispatch: _dispatch } = useEditor()
    return (
      <>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-flip", { detail: "horizontal" }))}
          disabled={!activeLayer || activeLayer.locked}
        >
          Flip Horizontal
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-flip", { detail: "vertical" }))}
          disabled={!activeLayer || activeLayer.locked}
        >
          Flip Vertical
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-rotate", { detail: 90 }))}
          disabled={!activeLayer || activeLayer.locked}
        >
          Rotate 90° CW
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-rotate", { detail: -90 }))}
          disabled={!activeLayer || activeLayer.locked}
        >
          Rotate 90° CCW
        </button>
        <button
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
          onClick={() => window.dispatchEvent(new CustomEvent("ps-transform-rotate", { detail: 180 }))}
          disabled={!activeLayer || activeLayer.locked}
        >
          Rotate 180°
        </button>
      </>
    )
  }
}

function ColorChip({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-5 h-5 rounded-sm border border-[var(--ps-divider)]"
      style={{ background: color }}
    />
  )
}

function rgbaCss(hex: string, opacity: number) {
  if (!hex.startsWith("#")) return hex
  const v = hex.slice(1)
  const n = v.length === 3 ? v.split("").map((c) => c + c).join("") : v
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${opacity})`
}

function GradientStopsEditor({
  stops,
  onChange,
}: {
  stops: GradientStop[]
  onChange: (next: GradientStop[]) => void
}) {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  const css = `linear-gradient(to right, ${sorted
    .map((s) => `${rgbaCss(s.color, s.opacity)} ${Math.round(s.offset * 100)}%`)
    .join(", ")})`
  const [activeIdx, setActiveIdx] = React.useState(0)
  const active = sorted[activeIdx] ?? sorted[0]

  const updateActive = (patch: Partial<GradientStop>) => {
    const next = sorted.map((s, i) => (i === activeIdx ? { ...s, ...patch } : s))
    onChange(next)
  }

  const addStop = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const offset = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const color = approximateColor(sorted, offset)
    const next = [...sorted, { offset, color, opacity: 1 }].sort((a, b) => a.offset - b.offset)
    onChange(next)
    setActiveIdx(next.findIndex((s) => s.offset === offset && s.color === color))
  }

  const removeStop = () => {
    if (sorted.length <= 2) return
    const next = sorted.filter((_, i) => i !== activeIdx)
    onChange(next)
    setActiveIdx(Math.max(0, activeIdx - 1))
  }

  return (
    <div className="space-y-3 text-xs">
      <div
        className="relative h-8 border border-[var(--ps-divider)] rounded-sm cursor-crosshair"
        style={{ background: css }}
        onDoubleClick={addStop}
      >
        {sorted.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            className={cn(
              "absolute top-full -translate-x-1/2 w-2.5 h-3 mt-0.5 rounded-b-sm border",
              i === activeIdx ? "border-[var(--ps-accent)]" : "border-[var(--ps-divider)]",
            )}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
            aria-label={`Stop ${i + 1}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-[80px_1fr] gap-2 items-center pt-3">
        <label>Color</label>
        <input
          type="color"
          value={active?.color ?? "#000000"}
          onChange={(e) => updateActive({ color: e.target.value })}
          className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-transparent"
        />
        <label>Opacity</label>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[active?.opacity ?? 1]}
          onValueChange={(v) => updateActive({ opacity: v[0] })}
        />
        <label>Position</label>
        <Slider
          min={0}
          max={1}
          step={0.001}
          value={[active?.offset ?? 0]}
          onValueChange={(v) => updateActive({ offset: v[0] })}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Double-click bar to add a stop</span>
        <button
          onClick={removeStop}
          disabled={sorted.length <= 2}
          className="h-6 px-2 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function approximateColor(stops: GradientStop[], offset: number) {
  let prev = stops[0]
  let _next = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i].offset <= offset && stops[i + 1].offset >= offset) {
      prev = stops[i]
      _next = stops[i + 1]
      break
    }
  }
  return prev.color
}

function ToolBadge({ tool }: { tool: ToolId }) {
  const map: Partial<Record<ToolId, { Icon: React.ComponentType<{ className?: string }>; name: string }>> =
  {
    brush: { Icon: Brush, name: "Brush" },
    pencil: { Icon: Brush, name: "Pencil" },
    "mixer-brush": { Icon: Brush, name: "Mixer Brush" },
    "pattern-stamp": { Icon: Brush, name: "Pattern Stamp" },
    eraser: { Icon: Eraser, name: "Eraser" },
    "background-eraser": { Icon: Eraser, name: "Background Eraser" },
    "magic-eraser": { Icon: Eraser, name: "Magic Eraser" },
    "clone-stamp": { Icon: Brush, name: "Clone Stamp" },
    "healing-brush": { Icon: Brush, name: "Healing Brush" },
    "art-history-brush": { Icon: Brush, name: "Art History Brush" },
    "red-eye": { Icon: Brush, name: "Red Eye" },
    move: { Icon: MousePointer2, name: "Move" },
    "content-aware-move": { Icon: MousePointer2, name: "Content-Aware Move" },
    "marquee-rect": { Icon: Square, name: "Marquee" },
    "marquee-ellipse": { Icon: Square, name: "Marquee" },
    "magic-wand": { Icon: Square, name: "Magic Wand" },
    "quick-selection": { Icon: Square, name: "Quick Selection" },
    "object-select": { Icon: Square, name: "Object Selection" },
    "refine-edge-brush": { Icon: Brush, name: "Refine Edge Brush" },
    "select-subject": { Icon: Square, name: "Select Subject" },
    "select-sky": { Icon: Square, name: "Select Sky" },
    "select-background": { Icon: Square, name: "Select Background" },
    "patch-tool": { Icon: Scissors, name: "Patch Tool" },
    type: { Icon: Type, name: "Type" },
    "type-vertical": { Icon: Type, name: "Vertical Type" },
    "type-mask-horizontal": { Icon: Type, name: "Horizontal Type Mask" },
    "type-mask-vertical": { Icon: Type, name: "Vertical Type Mask" },
    eyedropper: { Icon: Pipette, name: "Eyedropper" },
    "color-sampler": { Icon: Crosshair, name: "Color Sampler" },
    "material-eyedropper": { Icon: Pipette, name: "3D Material Eyedropper" },
    "material-drop": { Icon: Pipette, name: "3D Material Drop" },
    zoom: { Icon: ZoomIn, name: "Zoom" },
    hand: { Icon: Hand, name: "Hand" },
    "rotate-view": { Icon: RotateCw, name: "Rotate View" },
    "shape-rect": { Icon: Square, name: "Rectangle" },
    "shape-rounded-rect": { Icon: Square, name: "Rounded Rectangle" },
    "shape-ellipse": { Icon: Square, name: "Ellipse" },
    "shape-polygon": { Icon: TriangleIcon, name: "Polygon" },
    "shape-star": { Icon: Star, name: "Star" },
    "shape-triangle": { Icon: TriangleIcon, name: "Triangle" },
    "shape-line": { Icon: Square, name: "Line" },
    "custom-shape": { Icon: Star, name: "Custom Shape" },
    gradient: { Icon: PaintbrushVertical, name: "Gradient" },
    frame: { Icon: FrameIcon, name: "Frame" },
    slice: { Icon: Scissors, name: "Slice" },
    "slice-select": { Icon: MousePointer2, name: "Slice Select" },
    ruler: { Icon: RulerIcon, name: "Ruler" },
    note: { Icon: StickyNote, name: "Note" },
    count: { Icon: Hash, name: "Count" },
    "perspective-crop": { Icon: Square, name: "Perspective Crop" },
    artboard: { Icon: LayoutTemplate, name: "Artboard" },
    "direct-select": { Icon: MousePointer2, name: "Direct Select" },
    pen: { Icon: PenTool, name: "Pen" },
    "freeform-pen": { Icon: PenLine, name: "Freeform Pen" },
    "curvature-pen": { Icon: PenLine, name: "Curvature Pen" },
    "add-anchor-point": { Icon: PenLine, name: "Add Anchor Point" },
    "delete-anchor-point": { Icon: PenLine, name: "Delete Anchor Point" },
    "convert-point": { Icon: PenLine, name: "Convert Point" },
  }
  const cur = map[tool] ?? { Icon: MousePointer2, name: tool }
  return (
    <div className="flex items-center gap-1.5 pr-1">
      <div className="w-6 h-6 rounded-sm bg-[var(--ps-panel-2)] flex items-center justify-center">
        <cur.Icon className="w-3.5 h-3.5" />
      </div>
      <span className="text-[11px] font-medium">{cur.name}</span>
    </div>
  )
}

/* ---------- ScrubLabel: drag-to-adjust label for number inputs ---------- */

function PercentInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = React.useState(String(value))
  const focusedRef = React.useRef(false)

  React.useEffect(() => {
    if (!focusedRef.current) setDraft(String(value))
  }, [value])

  const updateDraft = (raw: string) => {
    setDraft(raw)
    if (raw.trim() === "") return
    const numeric = Number(raw)
    if (!Number.isFinite(numeric)) return
    onChange(clampNumber(Math.round(numeric), 0, 100))
  }

  const normalize = () => {
    focusedRef.current = false
    const numeric = Number(draft)
    const next = clampNumber(Number.isFinite(numeric) ? Math.round(numeric) : value, 0, 100)
    setDraft(String(next))
    onChange(next)
  }

  return (
    <Input
      type="number"
      min={0}
      max={100}
      step={1}
      value={draft}
      onFocus={(event) => {
        focusedRef.current = true
        setDraft(String(value))
        event.currentTarget.select()
      }}
      onClick={(event) => event.currentTarget.select()}
      onMouseUp={(event) => event.preventDefault()}
      onChange={(event) => updateDraft(event.target.value)}
      onBlur={normalize}
      onWheel={(event) => {
        event.preventDefault()
        const delta = event.deltaY < 0 ? 1 : -1
        const next = clampNumber(value + delta, 0, 100)
        setDraft(String(next))
        onChange(next)
      }}
      className={numInputClass}
    />
  )
}

function ScrubLabel({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const dragRef = React.useRef<{ startX: number; startValue: number } | null>(null)
  const elRef = React.useRef<HTMLSpanElement>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = elRef.current
    if (el) el.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startValue: value }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const sensitivity = e.shiftKey ? 0.5 : 2
    const delta = Math.round(dx / sensitivity)
    const next = Math.max(min, Math.min(max, drag.startValue + delta))
    if (next !== value) onChange(next)
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  return (
    <span
      ref={elRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={labelClass}
      style={{ cursor: "ew-resize", userSelect: "none" }}
    >
      {label}
    </span>
  )
}
