/**
 * Everything the canvas pointer handlers are allowed to reach.
 *
 * `view.tsx` assembles one of these per render and hands it to
 * `pointer-down` / `pointer-move` / `pointer-up`. It is deliberately a plain
 * bag rather than a class: the handlers are a dispatch over ~40 tools, and the
 * honest description of what they touch is a list of what the editor exposes.
 * Anything a gesture *does* belongs on one of the controllers below, not here.
 */

import type * as React from "react"

import type { ChangedLayerIds } from "@/editor/history-geometry"
import type { RafCoalescer } from "@/editor/raf-coalescer"
import type { RenderChange } from "@/editor/render-bus"
import type { Action } from "@/editor/reducer"
import type { CanvasDocumentOps } from "@/editor/canvas/document-operations"
import type { CanvasDragRef } from "@/editor/canvas/drag-state"
import type { CanvasOverlayPreviews, PatchDraft } from "@/editor/canvas/overlay-preview-bindings"
import type { CanvasPaintSession } from "@/editor/canvas/paint-session"
import type { CanvasPathEditing } from "@/editor/canvas/path-editing-controller"
import type { CanvasSelectionOps } from "@/editor/canvas/selection-commit"
import type { CanvasTransformController } from "@/editor/canvas/transform-controller"
import type { MoveFloat } from "@/editor/canvas/selection-helpers"
import type { ViewportPan } from "@/editor/canvas/viewport-controller"
import type {
  BrushSettings,
  CloneSourceSettings,
  EraserSettings,
  GradientSettings,
  Layer,
  PaintBucketSettings,
  PsDocument,
  SelectionOptions,
  TextProps,
  ToolId,
} from "@/editor/types"

export interface ColorPickerHudState {
  screenX: number
  screenY: number
  hsv: { h: number; s: number; v: number }
  pointerId: number
}

export interface CanvasPointerContext {
  /* ---- editor state ---- */
  activeDoc: PsDocument | null
  activeLayer: Layer | null
  tool: ToolId
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  paintBucket: PaintBucketSettings
  eraser: EraserSettings
  cloneSource: CloneSourceSettings
  selectionOptions: SelectionOptions
  dispatch: React.Dispatch<Action>
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  requestRender: (change?: RenderChange) => void
  editSmartObject: (layer: Layer) => void

  /* ---- DOM + gesture refs ---- */
  compositeRef: React.RefObject<HTMLCanvasElement | null>
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  cursorRef: React.RefObject<HTMLDivElement | null>
  drawingRef: CanvasDragRef
  removeRef: React.RefObject<{ points: { x: number; y: number }[] } | null>
  patchRef: React.RefObject<PatchDraft | null>
  brushResizeRef: React.RefObject<{ startClientX: number; startSize: number } | null>
  moveFloatRef: React.RefObject<MoveFloat | null>
  mouseMoveCoalescerRef: React.RefObject<RafCoalescer<{ x: number; y: number; inside: boolean }> | null>

  /* ---- subsystem controllers ---- */
  paint: CanvasPaintSession
  vectors: CanvasPathEditing
  xform: CanvasTransformController
  selections: CanvasSelectionOps
  docOps: CanvasDocumentOps
  previews: CanvasOverlayPreviews

  /* ---- viewport ---- */
  panRef: React.RefObject<ViewportPan>
  visualZoomRef: React.RefObject<number>
  applyStageTransform: () => void
  /** One zoom-tool click: steps by 1.5× toward or away from the cursor. */
  applyZoomToolStep: (clientX: number, clientY: number, out: boolean) => void

  /* ---- on-canvas filter widgets ---- */
  handleBlurGalleryPointerDown: (pt: { x: number; y: number }, e: React.PointerEvent<HTMLDivElement>) => boolean
  handleBlurGalleryPointerMove: (pt: { x: number; y: number }) => boolean
  handleBlurGalleryPointerUp: () => boolean
  handleLightingEffectsPointerDown: (pt: { x: number; y: number }, e: React.PointerEvent<HTMLDivElement>) => boolean
  handleLightingEffectsPointerMove: (pt: { x: number; y: number }) => boolean
  handleLightingEffectsPointerUp: () => boolean

  /* ---- type tool ---- */
  editingTextRef: React.RefObject<unknown>
  beginTextEdit: (layer: Layer, isNew: boolean) => void
  commitTextEdit: () => void
  activeTextDefaults: () => TextProps

  /* ---- misc ---- */
  getCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number }
  /** Read the composited colour under `pt` into the fore/background swatch. */
  sampleEyedropperAt: (pt: { x: number; y: number }, toBackground: boolean) => void
  showBrushCursor: boolean
  setColorHud: React.Dispatch<React.SetStateAction<ColorPickerHudState | null>>
}
