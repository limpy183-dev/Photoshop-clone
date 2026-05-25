"use client"

import * as React from "react"
import {
  MousePointer2,
  Square,
  Circle,
  Lasso,
  Wand2,
  Crop,
  Pipette,
  Bandage,
  Brush,
  Pencil,
  Stamp,
  History,
  Eraser,
  PaintBucket,
  Droplet,
  SunMedium,
  PenTool,
  Type,
  MousePointerClick,
  Hand,
  ZoomIn,
  ChevronRight,
  PaintbrushVertical,
  Palette,
  Star,
  Frame,
  StickyNote,
  Hash,
  Ruler,
  Scissors,
  PenLine,
  LayoutTemplate,
  Triangle,
  RotateCw,
  Crosshair,
  BookOpen,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useEditor } from "./editor-context"
import type { ToolId } from "./types"
import { dispatchPhotoshopEvent } from "./events"
import { getToolHelp, type ToolPreviewKind } from "./tool-help"
import { cn } from "@/lib/utils"

interface ToolDef {
  id: ToolId
  name: string
  shortcut: string
  icon: React.ComponentType<{ className?: string }>
}

interface ToolGroup {
  primary: ToolDef
  others?: ToolDef[]
}

const TOOL_GROUPS: ToolGroup[] = [
  { primary: { id: "move", name: "Move Tool", shortcut: "V", icon: MousePointer2 },
    others: [{ id: "artboard", name: "Artboard Tool", shortcut: "V", icon: LayoutTemplate }] },
  {
    primary: { id: "marquee-rect", name: "Rectangular Marquee", shortcut: "M", icon: Square },
    others: [
      { id: "marquee-ellipse", name: "Elliptical Marquee", shortcut: "M", icon: Circle },
      { id: "marquee-row", name: "Single Row Marquee", shortcut: "M", icon: Square },
      { id: "marquee-col", name: "Single Column Marquee", shortcut: "M", icon: Square },
    ],
  },
  {
    primary: { id: "lasso", name: "Lasso Tool", shortcut: "L", icon: Lasso },
    others: [
      { id: "lasso-polygon", name: "Polygonal Lasso", shortcut: "L", icon: Lasso },
      { id: "lasso-magnetic", name: "Magnetic Lasso", shortcut: "L", icon: Lasso },
    ],
  },
  {
    primary: { id: "object-select", name: "Object Selection Tool", shortcut: "W", icon: Wand2 },
    others: [
      { id: "quick-selection", name: "Quick Selection Tool", shortcut: "W", icon: Wand2 },
      { id: "magic-wand", name: "Magic Wand Tool", shortcut: "W", icon: Wand2 },
      { id: "refine-edge-brush", name: "Refine Edge Brush", shortcut: "W", icon: Brush },
      { id: "select-subject", name: "Select Subject", shortcut: "W", icon: Wand2 },
      { id: "select-sky", name: "Select Sky", shortcut: "W", icon: Wand2 },
      { id: "select-background", name: "Select Background", shortcut: "W", icon: Wand2 },
    ],
  },
  {
    primary: { id: "crop", name: "Crop Tool", shortcut: "C", icon: Crop },
    others: [
      { id: "perspective-crop", name: "Perspective Crop", shortcut: "C", icon: Crop },
      { id: "slice", name: "Slice Tool", shortcut: "C", icon: Scissors },
      { id: "slice-select", name: "Slice Select Tool", shortcut: "C", icon: MousePointerClick },
      { id: "frame", name: "Frame Tool", shortcut: "K", icon: Frame },
    ],
  },
  {
    primary: { id: "eyedropper", name: "Eyedropper", shortcut: "I", icon: Pipette },
    others: [
      { id: "color-sampler", name: "Color Sampler Tool", shortcut: "I", icon: Crosshair },
      { id: "ruler", name: "Ruler Tool", shortcut: "I", icon: Ruler },
      { id: "note", name: "Note Tool", shortcut: "I", icon: StickyNote },
      { id: "count", name: "Count Tool", shortcut: "I", icon: Hash },
      { id: "material-eyedropper", name: "3D Material Eyedropper", shortcut: "I", icon: Pipette },
      { id: "material-drop", name: "3D Material Drop Tool", shortcut: "I", icon: PaintBucket },
    ],
  },
  {
    primary: { id: "spot-healing", name: "Spot Healing Brush", shortcut: "J", icon: Bandage },
    others: [
      { id: "red-eye", name: "Red Eye Tool", shortcut: "J", icon: Bandage },
      { id: "healing-brush", name: "Healing Brush", shortcut: "J", icon: Bandage },
      { id: "patch-tool", name: "Patch Tool", shortcut: "J", icon: Scissors },
      { id: "content-aware-move", name: "Content-Aware Move Tool", shortcut: "J", icon: MousePointer2 },
      { id: "remove-tool", name: "Remove Tool", shortcut: "J", icon: Bandage },
    ],
  },
  {
    primary: { id: "brush", name: "Brush Tool", shortcut: "B", icon: Brush },
    others: [
      { id: "pencil", name: "Pencil Tool", shortcut: "B", icon: Pencil },
      { id: "mixer-brush", name: "Mixer Brush Tool", shortcut: "B", icon: Palette },
      { id: "color-replace", name: "Color Replacement Tool", shortcut: "B", icon: Brush },
    ],
  },
  {
    primary: { id: "clone-stamp", name: "Clone Stamp Tool", shortcut: "S", icon: Stamp },
    others: [{ id: "pattern-stamp", name: "Pattern Stamp Tool", shortcut: "S", icon: Stamp }],
  },
  {
    primary: { id: "history-brush", name: "History Brush", shortcut: "Y", icon: History },
    others: [{ id: "art-history-brush", name: "Art History Brush", shortcut: "Y", icon: PaintbrushVertical }],
  },
  {
    primary: { id: "eraser", name: "Eraser Tool", shortcut: "E", icon: Eraser },
    others: [
      { id: "background-eraser", name: "Background Eraser Tool", shortcut: "E", icon: Eraser },
      { id: "magic-eraser", name: "Magic Eraser Tool", shortcut: "E", icon: Eraser },
    ],
  },
  {
    primary: { id: "gradient", name: "Gradient Tool", shortcut: "G", icon: PaintbrushVertical },
    others: [{ id: "paint-bucket", name: "Paint Bucket Tool", shortcut: "G", icon: PaintBucket }],
  },
  {
    primary: { id: "blur", name: "Blur Tool", shortcut: "R", icon: Droplet },
    others: [
      { id: "sharpen", name: "Sharpen Tool", shortcut: "R", icon: Droplet },
      { id: "smudge", name: "Smudge Tool", shortcut: "R", icon: Droplet },
    ],
  },
  {
    primary: { id: "dodge", name: "Dodge Tool", shortcut: "O", icon: SunMedium },
    others: [
      { id: "burn", name: "Burn Tool", shortcut: "O", icon: SunMedium },
      { id: "sponge", name: "Sponge Tool", shortcut: "O", icon: SunMedium },
    ],
  },
  {
    primary: { id: "pen", name: "Pen Tool", shortcut: "P", icon: PenTool },
    others: [
      { id: "freeform-pen", name: "Freeform Pen Tool", shortcut: "P", icon: PenLine },
      { id: "curvature-pen", name: "Curvature Pen Tool", shortcut: "P", icon: PenLine },
      { id: "add-anchor-point", name: "Add Anchor Point Tool", shortcut: "P", icon: PenLine },
      { id: "delete-anchor-point", name: "Delete Anchor Point Tool", shortcut: "P", icon: PenLine },
      { id: "convert-point", name: "Convert Point Tool", shortcut: "P", icon: PenLine },
    ],
  },
  {
    primary: { id: "type", name: "Horizontal Type Tool", shortcut: "T", icon: Type },
    others: [
      { id: "type-vertical", name: "Vertical Type Tool", shortcut: "T", icon: Type },
      { id: "type-mask-horizontal", name: "Horizontal Type Mask Tool", shortcut: "T", icon: Type },
      { id: "type-mask-vertical", name: "Vertical Type Mask Tool", shortcut: "T", icon: Type },
    ],
  },
  {
    primary: { id: "path-select", name: "Path Selection", shortcut: "A", icon: MousePointerClick },
    others: [{ id: "direct-select", name: "Direct Selection", shortcut: "A", icon: PenLine }],
  },
  {
    primary: { id: "shape-rect", name: "Rectangle Tool", shortcut: "U", icon: Square },
    others: [
      { id: "shape-rounded-rect", name: "Rounded Rectangle Tool", shortcut: "U", icon: Square },
      { id: "shape-ellipse", name: "Ellipse Tool", shortcut: "U", icon: Circle },
      { id: "shape-polygon", name: "Polygon Tool", shortcut: "U", icon: Triangle },
      { id: "shape-star", name: "Star Tool", shortcut: "U", icon: Star },
      { id: "shape-triangle", name: "Triangle Tool", shortcut: "U", icon: Triangle },
      { id: "shape-line", name: "Line Tool", shortcut: "U", icon: Triangle },
      { id: "custom-shape", name: "Custom Shape Tool", shortcut: "U", icon: Star },
    ],
  },
  { primary: { id: "hand", name: "Hand Tool", shortcut: "H", icon: Hand } },
  { primary: { id: "rotate-view", name: "Rotate View Tool", shortcut: "R", icon: RotateCw } },
  { primary: { id: "zoom", name: "Zoom Tool", shortcut: "Z", icon: ZoomIn } },
  { primary: { id: "transform", name: "Transform Tool", shortcut: "F", icon: MousePointer2 } },
]

const LEARNING_QUERY_KEY = "ps-learning-index-query"

export function ToolPalette() {
  const { tool, dispatch, foreground, background, activeDoc, toggleQuickMask } = useEditor()
  const [openGroup, setOpenGroup] = React.useState<string | null>(null)

  /* ---- showTooltips preference ---- */
  const [showTooltips, setShowTooltips] = React.useState(true)
  React.useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem("ps-preferences")
        if (raw) {
          const p = JSON.parse(raw)
          if (typeof p?.showTooltips === "boolean") { setShowTooltips(p.showTooltips); return }
        }
      } catch {}
      setShowTooltips(true)
    }
    read()
    window.addEventListener("ps-preferences-changed", read)
    window.addEventListener("storage", read)
    return () => {
      window.removeEventListener("ps-preferences-changed", read)
      window.removeEventListener("storage", read)
    }
  }, [])

  return (
    <TooltipProvider delayDuration={showTooltips ? 300 : 86400000}>
      <div className="w-[44px] shrink-0 bg-[var(--ps-chrome)] border-r border-[var(--ps-divider)] flex flex-col items-center py-1 gap-0.5 select-none overflow-y-auto">
        {TOOL_GROUPS.map((group, i) => {
          const isActive = group.primary.id === tool || group.others?.some((o) => o.id === tool)
          const ActiveIcon =
            group.others?.find((o) => o.id === tool)?.icon ?? group.primary.icon
          const activeName =
            group.others?.find((o) => o.id === tool)?.name ?? group.primary.name
          const activeShortcut =
            group.others?.find((o) => o.id === tool)?.shortcut ?? group.primary.shortcut
          const groupKey = `g${i}`
          return (
            <div key={groupKey} className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      const target = group.others?.find((o) => o.id === tool) ?? group.primary
                      dispatch({ type: "set-tool", tool: target.id })
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      if (group.others?.length) {
                        setOpenGroup(openGroup === groupKey ? null : groupKey)
                      }
                    }}
                    className={cn(
                      "relative w-9 h-9 rounded-sm flex items-center justify-center transition-colors",
                      isActive
                        ? "bg-[var(--ps-tool-active)] text-[var(--ps-accent-2)]"
                        : "text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]",
                    )}
                    aria-label={activeName}
                  >
                    <ActiveIcon className="w-4 h-4" />
                    {group.others?.length ? (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenGroup(openGroup === groupKey ? null : groupKey)
                        }}
                        className="absolute right-0.5 bottom-0.5 cursor-pointer"
                        aria-label="More tools"
                      >
                        <span className="block w-0 h-0 border-l-[4px] border-l-transparent border-t-[4px] border-t-[var(--ps-text-dim)]" />
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  className="w-[308px] max-w-[calc(100vw-76px)] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[11px] text-[var(--ps-text)] shadow-2xl"
                >
                  <RichToolTooltip
                    tool={{ id: group.others?.find((o) => o.id === tool)?.id ?? group.primary.id, name: activeName, shortcut: activeShortcut }}
                    hasRelatedTools={!!group.others?.length}
                  />
                </TooltipContent>
              </Tooltip>

              {openGroup === groupKey && group.others ? (
                <div
                  className="absolute left-[42px] top-0 z-50 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm shadow-lg py-1 min-w-[220px]"
                  onMouseLeave={() => setOpenGroup(null)}
                >
                  {[group.primary, ...group.others].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        dispatch({ type: "set-tool", tool: t.id })
                        setOpenGroup(null)
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1 text-left text-xs",
                        t.id === tool
                          ? "bg-[var(--ps-accent)] text-white"
                          : "hover:bg-[var(--ps-tool-hover)]",
                      )}
                    >
                      <t.icon className="w-4 h-4" />
                      <span className="flex-1">{t.name}</span>
                      <span className="opacity-70">{t.shortcut}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}

        <div className="my-1 w-7 h-px bg-[var(--ps-divider)]" />

        {/* Foreground / Background swatches */}
        <ForegroundBackgroundSwatch
          foreground={foreground}
          background={background}
          onSwap={() => dispatch({ type: "swap-colors" })}
          onReset={() => dispatch({ type: "reset-colors" })}
          onClickFg={() => dispatchPhotoshopEvent("ps-open-color-picker", { target: "foreground", surface: "dialog" })}
          onClickBg={() => dispatchPhotoshopEvent("ps-open-color-picker", { target: "background", surface: "dialog" })}
        />

        <div className="my-1 w-7 h-px bg-[var(--ps-divider)]" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleQuickMask}
              className={cn(
                "w-9 h-9 rounded-sm flex items-center justify-center",
                activeDoc?.quickMask
                  ? "bg-[var(--ps-accent)] text-white"
                  : "hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text-dim)]",
              )}
              aria-label="Quick Mask Mode"
            >
              <Palette className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-[308px] max-w-[calc(100vw-76px)] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[11px] text-[var(--ps-text)] shadow-2xl"
          >
            <QuickMaskTooltip />
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

function RichToolTooltip({
  tool,
  hasRelatedTools,
}: {
  tool: Pick<ToolDef, "id" | "name" | "shortcut">
  hasRelatedTools: boolean
}) {
  const help = getToolHelp(tool.id, tool.name, tool.shortcut, hasRelatedTools)
  return (
    <div className="overflow-hidden rounded-sm">
      <div className="grid grid-cols-[72px_1fr] gap-3 border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-3">
        <ToolUsagePreview kind={help.preview} />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-[var(--ps-text)]">{tool.name}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">
                {help.learningCategory}
              </div>
            </div>
            <kbd className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)]">
              {tool.shortcut}
            </kbd>
          </div>
          <p className="mt-2 leading-4 text-[var(--ps-text-dim)]">{help.description}</p>
        </div>
      </div>
      <div className="space-y-1.5 p-3">
        {help.steps.map((step, index) => (
          <div key={step} className="grid grid-cols-[18px_1fr] gap-2 text-[10.5px] leading-4">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-[var(--ps-panel-2)] text-[9px] text-[var(--ps-accent-2)]">
              {index + 1}
            </span>
            <span className="text-[var(--ps-text)]">{step}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-2">
        <button
          type="button"
          aria-label={`Learn ${tool.name} in Discover`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openLearningQuery(help.learningQuery)
          }}
          className="flex h-7 w-full items-center justify-between gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-left text-[10px] text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-tool-hover)]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent-2)]" />
            <span className="truncate">Learn in Discover</span>
          </span>
          <span className="truncate text-[var(--ps-text-dim)]">{help.learningQuery}</span>
        </button>
      </div>
    </div>
  )
}

function QuickMaskTooltip() {
  const help = {
    description:
      "Paint a temporary red mask overlay that converts brush strokes into selection edits when Quick Mask is toggled off.",
    steps: [
      "Toggle Quick Mask, then paint black to protect or white to reveal selected regions.",
      "Use Brush, Eraser, and selection tools while the overlay previews mask density.",
      "Open Discover for selection mask workflows and refinement panels.",
    ],
  }
  return (
    <div className="overflow-hidden rounded-sm">
      <div className="grid grid-cols-[72px_1fr] gap-3 border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-3">
        <ToolUsagePreview kind="quick-mask" />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[12px] font-medium text-[var(--ps-text)]">Quick Mask Mode</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">Selection</div>
            </div>
            <kbd className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)]">
              Q
            </kbd>
          </div>
          <p className="mt-2 leading-4 text-[var(--ps-text-dim)]">{help.description}</p>
        </div>
      </div>
      <div className="space-y-1.5 p-3">
        {help.steps.map((step, index) => (
          <div key={step} className="grid grid-cols-[18px_1fr] gap-2 text-[10.5px] leading-4">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-[var(--ps-panel-2)] text-[9px] text-[var(--ps-accent-2)]">
              {index + 1}
            </span>
            <span className="text-[var(--ps-text)]">{step}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-2">
        <button
          type="button"
          aria-label="Learn Quick Mask Mode in Discover"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openLearningQuery("selection mask")
          }}
          className="flex h-7 w-full items-center justify-between gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-left text-[10px] text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-tool-hover)]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent-2)]" />
            <span className="truncate">Learn in Discover</span>
          </span>
          <span className="truncate text-[var(--ps-text-dim)]">selection mask</span>
        </button>
      </div>
    </div>
  )
}

function ToolUsagePreview({ kind }: { kind: ToolPreviewKind }) {
  return (
    <div
      data-testid={`tool-preview-${kind}`}
      data-preview={kind}
      className="ps-tool-preview relative h-[64px] w-[64px] overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
      aria-hidden="true"
    >
      <div className="ps-tool-preview-grid" />
      {kind === "brush" ? <BrushPreview /> : null}
      {kind === "selection" ? <SelectionPreview /> : null}
      {kind === "crop" ? <CropPreview /> : null}
      {kind === "sample" ? <SamplePreview /> : null}
      {kind === "retouch" ? <RetouchPreview /> : null}
      {kind === "clone" ? <ClonePreview /> : null}
      {kind === "history" ? <HistoryPreview /> : null}
      {kind === "erase" ? <ErasePreview /> : null}
      {kind === "fill" ? <FillPreview /> : null}
      {kind === "blur" ? <BlurPreview /> : null}
      {kind === "tonal" ? <TonalPreview /> : null}
      {kind === "path" ? <PathPreview /> : null}
      {kind === "type" ? <TypePreview /> : null}
      {kind === "shape" ? <ShapePreview /> : null}
      {kind === "view" ? <ViewPreview /> : null}
      {kind === "transform" ? <TransformPreview /> : null}
      {kind === "quick-mask" ? <QuickMaskPreview /> : null}
      {kind === "move" ? <MovePreview /> : null}
    </div>
  )
}

function BrushPreview() {
  return (
    <>
      <svg className="absolute inset-0" viewBox="0 0 64 64">
        <path className="ps-preview-stroke" d="M10 44 C20 16 34 50 52 20" />
      </svg>
      <span className="ps-preview-cursor" />
    </>
  )
}

function SelectionPreview() {
  return (
    <>
      <span className="ps-preview-selection" />
      <span className="ps-preview-cursor" />
    </>
  )
}

function CropPreview() {
  return (
    <>
      <span className="ps-preview-crop" />
      <span className="ps-preview-crop-line ps-preview-crop-line-a" />
      <span className="ps-preview-crop-line ps-preview-crop-line-b" />
    </>
  )
}

function SamplePreview() {
  return (
    <>
      <span className="ps-preview-swatch ps-preview-swatch-a" />
      <span className="ps-preview-swatch ps-preview-swatch-b" />
      <span className="ps-preview-sampler" />
    </>
  )
}

function RetouchPreview() {
  return (
    <>
      <span className="ps-preview-blemish" />
      <span className="ps-preview-heal" />
      <span className="ps-preview-cursor" />
    </>
  )
}

function ClonePreview() {
  return (
    <>
      <span className="ps-preview-clone-source" />
      <span className="ps-preview-clone-target" />
      <span className="ps-preview-clone-line" />
    </>
  )
}

function HistoryPreview() {
  return (
    <>
      <span className="ps-preview-history-before" />
      <span className="ps-preview-history-after" />
    </>
  )
}

function ErasePreview() {
  return (
    <>
      <span className="ps-preview-paint-block" />
      <span className="ps-preview-erase-path" />
    </>
  )
}

function FillPreview() {
  return (
    <>
      <span className="ps-preview-fill-band" />
      <span className="ps-preview-fill-drop" />
    </>
  )
}

function BlurPreview() {
  return (
    <>
      <span className="ps-preview-detail ps-preview-detail-a" />
      <span className="ps-preview-detail ps-preview-detail-b" />
      <span className="ps-preview-blur-pass" />
    </>
  )
}

function TonalPreview() {
  return (
    <>
      <span className="ps-preview-tonal-base" />
      <span className="ps-preview-tonal-light" />
    </>
  )
}

function PathPreview() {
  return (
    <svg className="absolute inset-0" viewBox="0 0 64 64">
      <path className="ps-preview-path" d="M9 47 C18 12 44 10 55 38" />
      <circle className="ps-preview-anchor" cx="9" cy="47" r="2" />
      <circle className="ps-preview-anchor" cx="55" cy="38" r="2" />
    </svg>
  )
}

function TypePreview() {
  return (
    <>
      <span className="ps-preview-type-glyph">T</span>
      <span className="ps-preview-type-caret" />
    </>
  )
}

function ShapePreview() {
  return (
    <>
      <span className="ps-preview-shape-base" />
      <span className="ps-preview-shape-next" />
    </>
  )
}

function ViewPreview() {
  return (
    <>
      <span className="ps-preview-view-frame" />
      <span className="ps-preview-view-lens" />
    </>
  )
}

function TransformPreview() {
  return (
    <>
      <span className="ps-preview-transform-box" />
      <span className="ps-preview-transform-handle ps-preview-transform-handle-a" />
      <span className="ps-preview-transform-handle ps-preview-transform-handle-b" />
    </>
  )
}

function QuickMaskPreview() {
  return (
    <>
      <span className="ps-preview-mask-overlay" />
      <span className="ps-preview-mask-brush" />
    </>
  )
}

function MovePreview() {
  return (
    <>
      <span className="ps-preview-layer ps-preview-layer-a" />
      <span className="ps-preview-layer ps-preview-layer-b" />
      <span className="ps-preview-move-arrow" />
    </>
  )
}

function openLearningQuery(query: string) {
  try {
    sessionStorage.setItem(LEARNING_QUERY_KEY, query)
  } catch {}
  dispatchPhotoshopEvent("ps-open-panel", "discover")
  window.setTimeout(() => dispatchPhotoshopEvent("ps-set-learning-query", query), 0)
}

function ForegroundBackgroundSwatch({
  foreground,
  background,
  onClickFg,
  onClickBg,
  onSwap,
  onReset,
}: {
  foreground: string
  background: string
  onClickFg: () => void
  onClickBg: () => void
  onSwap: () => void
  onReset: () => void
}) {
  return (
    <div className="relative w-9 h-9">
      <button
        type="button"
        aria-label="Background color"
        onClick={onClickBg}
        className="absolute right-0 bottom-0 w-5 h-5 border border-[var(--ps-text)] shadow-sm"
        style={{ background }}
      />
      <button
        type="button"
        aria-label="Foreground color"
        onClick={onClickFg}
        className="absolute left-0 top-0 w-5 h-5 border border-[var(--ps-text)] shadow-sm z-10"
        style={{ background: foreground }}
      />
      <button
        type="button"
        aria-label="Swap colors (X)"
        onClick={onSwap}
        title="Swap colors (X)"
        className="absolute top-0 right-0 w-3 h-3 text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
      >
        <ChevronRight className="w-3 h-3 rotate-[-45deg]" />
      </button>
      <button
        type="button"
        aria-label="Default colors (D)"
        onClick={onReset}
        title="Default colors (D)"
        className="absolute bottom-0 left-0 w-3 h-3"
      >
        <span className="block w-2 h-2 border border-[var(--ps-text-dim)] bg-white" />
      </button>
    </div>
  )
}
