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
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useEditor } from "./editor-context"
import type { ToolId } from "./types"
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
                <TooltipContent side="right" className="text-xs">
                  {activeName}{" "}
                  <span className="text-[var(--ps-text-dim)] ml-1">{activeShortcut}</span>
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
          onClickFg={() => {
            const i = document.createElement("input")
            i.type = "color"
            i.value = foreground
            i.oninput = () => dispatch({ type: "set-foreground", color: i.value })
            i.click()
          }}
          onClickBg={() => {
            const i = document.createElement("input")
            i.type = "color"
            i.value = background
            i.oninput = () => dispatch({ type: "set-background", color: i.value })
            i.click()
          }}
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
          <TooltipContent side="right">Edit in Quick Mask (Q)</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
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
