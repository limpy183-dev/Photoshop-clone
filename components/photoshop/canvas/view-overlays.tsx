"use client"

/**
 * The DOM layers stacked on top of the two canvases: marching ants, guides,
 * grids, the type editor, and the on-canvas HUDs.
 *
 * These are siblings of the composite and overlay canvases, positioned in the
 * same document space by the stage. None of them paints pixels — anything that
 * draws into a canvas belongs in `editor/canvas/overlay-previews.ts` instead.
 */

import * as React from "react"

import { buildRetouchingFeedbackModel } from "@/editor/retouch-feedback"
import type { TextEditState } from "@/editor/canvas/text-edit-controller"
import { SmartGuidesOverlay } from "@/components/photoshop/canvas/smart-guides"
import { MaskSelectionOverlay, SelectionOverlay, TextEditOverlay } from "@/components/photoshop/canvas/selection-overlays"
import {
  GridOverlay,
  GuidesOverlay,
  MagneticLassoIndicator,
  PixelGridOverlay,
  RetouchFeedbackOverlay,
} from "@/components/photoshop/canvas/overlays"
import { SelectionTransformOverlay } from "@/components/photoshop/selection-transform-overlay"
import type { Action } from "@/editor/reducer"
import type { BrushSettings, CloneSourceSettings, PsDocument, SelectionOptions, ToolId } from "@/editor/types"

/** Tools whose status HUD reports brush/retouch settings while they are active. */
const RETOUCH_FEEDBACK_TOOLS = new Set<ToolId>([
  "brush",
  "pencil",
  "mixer-brush",
  "clone-stamp",
  "healing-brush",
  "spot-healing",
  "patch-tool",
  "smudge",
  "blur",
  "sharpen",
  "dodge",
  "burn",
  "sponge",
  "history-brush",
  "art-history-brush",
])

export interface CanvasStageOverlaysProps {
  activeDoc: PsDocument
  tool: ToolId
  brush: BrushSettings
  cloneSource: CloneSourceSettings
  selectionOptions: SelectionOptions
  viewZoom: number
  showToolStatusHud: boolean
  selectionTransformActive: boolean
  setSelectionTransformActive: (active: boolean) => void
  editingText: TextEditState | null
  setEditingText: React.Dispatch<React.SetStateAction<TextEditState | null>>
  commitTextEdit: () => void
  cancelTextEdit: () => void
  dispatch: React.Dispatch<Action>
}

export function CanvasStageOverlays({
  activeDoc,
  tool,
  brush,
  cloneSource,
  selectionOptions,
  viewZoom,
  showToolStatusHud,
  selectionTransformActive,
  setSelectionTransformActive,
  editingText,
  setEditingText,
  commitTextEdit,
  cancelTextEdit,
  dispatch,
}: CanvasStageOverlaysProps) {
  return (
    <>
      {tool === "lasso-magnetic" ? (
        <MagneticLassoIndicator
          width={selectionOptions.magneticWidth ?? 12}
          frequency={selectionOptions.magneticFrequency ?? 57}
        />
      ) : null}
      {showToolStatusHud && RETOUCH_FEEDBACK_TOOLS.has(tool) ? (
        <RetouchFeedbackOverlay
          tool={tool}
          model={buildRetouchingFeedbackModel({ tool, brush, cloneSource })}
          brushSize={brush.size}
          opacity={brush.opacity}
          flow={brush.flow}
        />
      ) : null}
      {activeDoc.selection.bounds && activeDoc.selection.mask ? (
        <MaskSelectionOverlay
          mask={activeDoc.selection.mask}
          docW={activeDoc.width}
          docH={activeDoc.height}
        />
      ) : activeDoc.selection.bounds ? (
        <SelectionOverlay
          bounds={activeDoc.selection.bounds}
          shape={activeDoc.selection.shape === "ellipse" ? "ellipse" : "rect"}
          docW={activeDoc.width}
          docH={activeDoc.height}
        />
      ) : null}
      {selectionTransformActive && activeDoc.selection.bounds ? (
        <SelectionTransformOverlay
          bounds={activeDoc.selection.bounds}
          docW={activeDoc.width}
          docH={activeDoc.height}
          zoom={viewZoom}
          onCommit={(t) => {
            dispatch({
              type: "transform-selection",
              scale: 1,
              scaleX: t.scaleX,
              scaleY: t.scaleY,
              rotationDeg: t.rotationDeg,
              translateX: t.translateX,
              translateY: t.translateY,
              smoothing: true,
            })
            setSelectionTransformActive(false)
          }}
          onCancel={() => setSelectionTransformActive(false)}
        />
      ) : null}
      {activeDoc.guides && activeDoc.guides.length ? (
        <GuidesOverlay
          guides={activeDoc.guides}
          docW={activeDoc.width}
          docH={activeDoc.height}
          onMove={(id, pos) => dispatch({ type: "move-guide", id, position: pos })}
          onRemove={(id) => dispatch({ type: "remove-guide", id })}
        />
      ) : null}
      {activeDoc.showSmartGuides !== false && tool === "move" && (
        <SmartGuidesOverlay
          layers={activeDoc.layers}
          activeLayerId={activeDoc.activeLayerId}
          docW={activeDoc.width}
          docH={activeDoc.height}
        />
      )}
      {activeDoc.showGrid && activeDoc.gridSize ? (
        <GridOverlay
          docW={activeDoc.width}
          docH={activeDoc.height}
          size={activeDoc.gridSize}
          color={activeDoc.gridColor ?? "#78b4ff"}
          subdivisions={activeDoc.gridSubdivisions ?? 1}
          opacity={activeDoc.gridOpacity ?? 0.42}
        />
      ) : null}
      {activeDoc.showPixelGrid && viewZoom >= 6 ? (
        <PixelGridOverlay zoom={viewZoom} />
      ) : null}
      {editingText ? (
        <TextEditOverlay
          doc={activeDoc}
          zoom={viewZoom}
          state={editingText}
          setState={setEditingText}
          commit={commitTextEdit}
          cancel={cancelTextEdit}
        />
      ) : null}
    </>
  )
}

export interface SmartFilterMaskBannerProps {
  info: { layerName: string; filterName: string; density: number; feather: number }
  onExit: () => void
}

/** Tells the user that painting now lands on a smart filter's mask, not the layer. */
export function SmartFilterMaskBanner({ info, onExit }: SmartFilterMaskBannerProps) {
  return (
    <div
      data-testid="smart-filter-mask-edit-banner"
      className="absolute left-1/2 top-7 z-40 flex max-w-[min(520px,calc(100%-32px))] -translate-x-1/2 items-center gap-2 rounded-sm border border-cyan-300/40 bg-[rgba(12,18,24,0.94)] px-2.5 py-1.5 text-[11px] text-[var(--ps-text)] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_0_2px_rgba(103,232,249,0.18)]" />
      <span className="min-w-0 truncate">
        Editing {info.filterName} mask on {info.layerName}
      </span>
      <span className="shrink-0 text-[var(--ps-text-dim)]">
        Density {info.density}%
      </span>
      <span className="shrink-0 text-[var(--ps-text-dim)]">
        Feather {info.feather} px
      </span>
      <button
        type="button"
        aria-label="Exit smart filter mask edit mode"
        className="ml-1 shrink-0 rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onExit()
        }}
      >
        Exit
      </button>
    </div>
  )
}
