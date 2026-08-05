/**
 * Tool preview painters — the entry point for the looping demo animations shown
 * inside a {@link RichTooltip}.
 *
 * This module is only the kind -> renderer switch. The renderers themselves are
 * grouped by tool family in `preview-raster.ts`, `preview-vector.ts` and
 * `preview-viewport.ts`, over the shared vocabulary in `preview-primitives.ts`.
 * The React wrapper that owns the canvas and the rAF loop lives in
 * `components/photoshop/rich-tooltip.tsx`.
 */

import type { ToolPreviewKind } from "@/editor/tool/tooltip-content"
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, paintBackdrop } from "@/editor/tool/preview-primitives"
import {
  drawBlur,
  drawBrushStroke,
  drawBucket,
  drawClone,
  drawCount,
  drawCrop,
  drawEraser,
  drawEyedropper,
  drawGradient,
  drawHeal,
  drawHistory,
  drawLasso,
  drawMagicWand,
  drawMarquee,
  drawNote,
  drawPerspectiveCrop,
  drawPolygonLasso,
  drawRedEye,
  drawRuler,
  drawSingleAxisMarquee,
  drawSlice,
  drawTonal,
} from "@/editor/tool/preview-raster"
import {
  drawAnchorEdit,
  drawPathSelect,
  drawPen,
  drawShape,
  drawType,
} from "@/editor/tool/preview-vector"
import {
  drawHand,
  drawMove,
  drawQuickMask,
  drawRotateView,
  drawTransform,
  drawZoom,
} from "@/editor/tool/preview-viewport"

/**
 * Draw one frame of the looping demo for the given preview kind into the
 * supplied 2D context. The context is already DPR-scaled by the caller, so
 * renderers operate in CSS pixel coordinates (80x60).
 *
 * Each renderer is deterministic — the only input is the elapsed time in
 * seconds — so adding new kinds is just "compute geometry as a function of t".
 */
export function drawToolPreviewFrame(
  ctx: CanvasRenderingContext2D,
  kind: ToolPreviewKind,
  elapsed: number,
) {
  // Clear + paint the checker-like backdrop that every preview shares.
  ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  paintBackdrop(ctx)

  const t = elapsed % 2 // most loops fit into 2 seconds
  switch (kind) {
    case "brush":
    case "pencil":
    case "mixer-brush":
    case "color-replace":
      return drawBrushStroke(ctx, t, kind)
    case "selection-rect":
      return drawMarquee(ctx, t, "rect")
    case "selection-ellipse":
      return drawMarquee(ctx, t, "ellipse")
    case "selection-row":
      return drawSingleAxisMarquee(ctx, t, "row")
    case "selection-col":
      return drawSingleAxisMarquee(ctx, t, "col")
    case "lasso":
    case "lasso-magnetic":
    case "quick-selection":
    case "object-select":
    case "refine-edge":
    case "subject":
    case "sky":
    case "background":
      return drawLasso(ctx, t, kind)
    case "lasso-polygon":
      return drawPolygonLasso(ctx, t)
    case "magic-wand":
      return drawMagicWand(ctx, t)
    case "crop":
      return drawCrop(ctx, t)
    case "perspective-crop":
      return drawPerspectiveCrop(ctx, t)
    case "slice":
    case "frame":
      return drawSlice(ctx, t)
    case "eyedropper":
    case "color-sampler":
    case "material-eyedropper":
      return drawEyedropper(ctx, elapsed)
    case "ruler":
      return drawRuler(ctx, t)
    case "note":
      return drawNote(ctx, t)
    case "count":
      return drawCount(ctx, t)
    case "material-drop":
    case "paint-bucket":
      return drawBucket(ctx, t)
    case "spot-heal":
    case "heal":
    case "patch":
    case "remove":
    case "content-aware-move":
      return drawHeal(ctx, t)
    case "red-eye":
      return drawRedEye(ctx, t)
    case "clone":
    case "pattern-stamp":
      return drawClone(ctx, t)
    case "history":
    case "art-history":
      return drawHistory(ctx, elapsed, kind)
    case "eraser":
    case "background-eraser":
    case "magic-eraser":
      return drawEraser(ctx, elapsed)
    case "gradient":
      return drawGradient(ctx, elapsed)
    case "blur":
    case "sharpen":
    case "smudge":
      return drawBlur(ctx, elapsed, kind)
    case "dodge":
    case "burn":
    case "sponge":
      return drawTonal(ctx, elapsed, kind)
    case "pen":
    case "freeform-pen":
    case "curvature-pen":
      return drawPen(ctx, elapsed, kind)
    case "anchor-add":
    case "anchor-delete":
    case "anchor-convert":
      return drawAnchorEdit(ctx, elapsed, kind)
    case "path-select":
    case "direct-select":
      return drawPathSelect(ctx, elapsed, kind)
    case "type":
    case "type-vertical":
    case "type-mask":
      return drawType(ctx, elapsed, kind)
    case "shape-rect":
    case "shape-rounded-rect":
    case "shape-ellipse":
    case "shape-polygon":
    case "shape-star":
    case "shape-triangle":
    case "shape-line":
    case "custom-shape":
      return drawShape(ctx, elapsed, kind)
    case "hand":
      return drawHand(ctx, elapsed)
    case "rotate-view":
      return drawRotateView(ctx, elapsed)
    case "zoom":
      return drawZoom(ctx, elapsed)
    case "transform":
      return drawTransform(ctx, t)
    case "quick-mask":
      return drawQuickMask(ctx, t)
    case "move":
    case "artboard":
    default:
      return drawMove(ctx, t)
  }
}
