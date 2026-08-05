/**
 * The one in-progress pointer gesture on the canvas.
 *
 * There is exactly one of these at a time, held in a ref so a drag never
 * re-renders. `type` selects which fields are meaningful; the pointer handlers
 * narrow on it and nothing else reads the fields belonging to another kind.
 */

import type { PathAnchorRef } from "@/editor/vector-path-operations"
import type { DirectShapeHandleId } from "@/editor/canvas/shape-helpers"
import type { TransformHandleId } from "@/editor/canvas/transform-geometry"
import type { CanvasDirtyRect } from "@/editor/canvas/view-helpers"

export type CanvasDragKind =
  | "stroke"
  | "marquee"
  | "lasso"
  | "polylasso"
  | "shape"
  | "gradient"
  | "pan"
  | "move"
  | "crop"
  | "pcrop"
  | "object-select"
  | "refine-edge"
  | "transform"
  | "rotate-view"
  | "path-direct"
  | "path-marquee"
  | "freeform-path"
  | "guide"
  | "ruler"
  | "remove"
  | "patch-lasso"
  | "patch-drag"
  | "brush-resize"
  | "text-box"
  | "eyedropper"
  | "pen-handle"

export interface CanvasDragState {
  type: CanvasDragKind | null
  last?: { x: number; y: number }
  start?: { x: number; y: number }
  smooth?: { x: number; y: number }
  points?: { x: number; y: number }[]
  panStart?: { x: number; y: number }
  moveLayerId?: string
  moveStart?: { x: number; y: number }
  moveOrigin?: { x: number; y: number }
  /** Snapped delta actually applied by the last move frame, read on commit. */
  moveDelta?: { x: number; y: number }
  handle?: TransformHandleId
  guideOrient?: "horizontal" | "vertical"
  refineMode?: "expand" | "subtract"
  /** Whole-stroke bounds, accumulated to pointer-up for the history commit. */
  dirty?: CanvasDirtyRect
  /** Bounds touched since the last render, cleared each frame. Repainting
   *  `dirty` instead makes a long stroke quadratic in its own length. */
  frameDirty?: CanvasDirtyRect
  rotateStartAngle?: number
  rotateStartValue?: number
  directLayerId?: string
  directSubpathIndex?: number
  directPointIndex?: number
  directPathHandle?: "in" | "out"
  directShapeHandle?: DirectShapeHandleId
  directSelectedAnchors?: PathAnchorRef[]
  sliceDraftId?: string
  /** Eyedropper started with Alt: samples the background swatch. */
  sampleToBackground?: boolean
}

export type CanvasDragRef = { current: CanvasDragState }
