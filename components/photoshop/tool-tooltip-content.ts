import type { ToolId } from "./types"

/**
 * Animated canvas preview kinds. Each kind corresponds to a renderer in
 * {@link drawToolPreviewFrame} (see `rich-tooltip.tsx`). Renderers are kept
 * intentionally tiny so the looping demo plays smoothly inside an ~80x60
 * tooltip canvas without blocking the main thread.
 */
export type ToolPreviewKind =
  | "move"
  | "selection-rect"
  | "selection-ellipse"
  | "selection-row"
  | "selection-col"
  | "lasso"
  | "lasso-polygon"
  | "lasso-magnetic"
  | "magic-wand"
  | "quick-selection"
  | "object-select"
  | "refine-edge"
  | "subject"
  | "sky"
  | "background"
  | "crop"
  | "perspective-crop"
  | "slice"
  | "frame"
  | "eyedropper"
  | "color-sampler"
  | "ruler"
  | "note"
  | "count"
  | "material-eyedropper"
  | "material-drop"
  | "spot-heal"
  | "red-eye"
  | "heal"
  | "patch"
  | "content-aware-move"
  | "remove"
  | "brush"
  | "pencil"
  | "mixer-brush"
  | "color-replace"
  | "clone"
  | "pattern-stamp"
  | "history"
  | "art-history"
  | "eraser"
  | "background-eraser"
  | "magic-eraser"
  | "gradient"
  | "paint-bucket"
  | "blur"
  | "sharpen"
  | "smudge"
  | "dodge"
  | "burn"
  | "sponge"
  | "pen"
  | "freeform-pen"
  | "curvature-pen"
  | "anchor-add"
  | "anchor-delete"
  | "anchor-convert"
  | "type"
  | "type-vertical"
  | "type-mask"
  | "path-select"
  | "direct-select"
  | "shape-rect"
  | "shape-rounded-rect"
  | "shape-ellipse"
  | "shape-polygon"
  | "shape-star"
  | "shape-triangle"
  | "shape-line"
  | "custom-shape"
  | "artboard"
  | "hand"
  | "rotate-view"
  | "zoom"
  | "transform"
  | "quick-mask"

export interface ToolTooltipEntry {
  /** Display title at the top of the tooltip. */
  title: string
  /** One-to-two sentence description shown beneath the title. */
  description: string
  /** Kind of animated canvas preview to play in the tooltip. */
  previewKind: ToolPreviewKind
}

/**
 * Real Photoshop-style copy for every tool surfaced in the tool palette.
 * Used by RichTooltip to render the title, description, and animated preview.
 */
export const TOOL_TOOLTIP_CONTENT: Record<ToolId, ToolTooltipEntry> = {
  move: {
    title: "Move Tool",
    description:
      "Drag layers, guides, or selections to reposition content. Hold Shift to constrain to 45-degree increments.",
    previewKind: "move",
  },
  artboard: {
    title: "Artboard Tool",
    description:
      "Create, resize, and reorder artboards inside the document. Drag the plus handles to add a new artboard.",
    previewKind: "artboard",
  },
  "marquee-rect": {
    title: "Rectangular Marquee",
    description:
      "Drag to make a rectangular selection. Hold Shift to constrain to a square, Alt/Option to draw from center.",
    previewKind: "selection-rect",
  },
  "marquee-ellipse": {
    title: "Elliptical Marquee",
    description:
      "Drag to make an elliptical selection. Hold Shift to constrain to a circle, Alt/Option to draw from center.",
    previewKind: "selection-ellipse",
  },
  "marquee-row": {
    title: "Single Row Marquee",
    description:
      "Click anywhere on the canvas to select a 1px-tall horizontal row of pixels across the entire document.",
    previewKind: "selection-row",
  },
  "marquee-col": {
    title: "Single Column Marquee",
    description:
      "Click anywhere on the canvas to select a 1px-wide vertical column of pixels across the entire document.",
    previewKind: "selection-col",
  },
  lasso: {
    title: "Lasso Tool",
    description:
      "Drag a freehand path around an area to make a selection. Hold Alt/Option to draw straight-segment fallbacks.",
    previewKind: "lasso",
  },
  "lasso-polygon": {
    title: "Polygonal Lasso",
    description:
      "Click to set straight-line anchor points around the selection edge. Double-click or return to start to close the path.",
    previewKind: "lasso-polygon",
  },
  "lasso-magnetic": {
    title: "Magnetic Lasso",
    description:
      "Trace near a high-contrast edge and the lasso snaps to it automatically. Adjust width and frequency in the options bar.",
    previewKind: "lasso-magnetic",
  },
  "object-select": {
    title: "Object Selection Tool",
    description:
      "Draw a rectangle or lasso around an object and the browser-local detector builds an editable selection mask.",
    previewKind: "object-select",
  },
  "quick-selection": {
    title: "Quick Selection Tool",
    description:
      "Paint over nearby edges to grow or subtract a selection that snaps to color and contrast boundaries.",
    previewKind: "quick-selection",
  },
  "magic-wand": {
    title: "Magic Wand Tool",
    description:
      "Click pixels to select matching colors. Tolerance, contiguous, and sample-all-layers refine the match.",
    previewKind: "magic-wand",
  },
  "refine-edge-brush": {
    title: "Refine Edge Brush",
    description:
      "Paint along soft edges (hair, fur) inside Select and Mask to tell the engine which pixels belong to the foreground.",
    previewKind: "refine-edge",
  },
  "select-subject": {
    title: "Select Subject",
    description:
      "One-click selection of the most prominent subject using browser-local edge analysis. Refine afterwards in Selection Studio.",
    previewKind: "subject",
  },
  "select-sky": {
    title: "Select Sky",
    description:
      "Build a selection of bright high-luminance sky regions. Combine with a mask to perform replacements.",
    previewKind: "sky",
  },
  "select-background": {
    title: "Select Background",
    description:
      "Invert subject detection to build a selection of the surrounding background ready for adjustment or removal.",
    previewKind: "background",
  },
  crop: {
    title: "Crop Tool",
    description:
      "Drag the boundary to set a crop region, then commit. Non-destructive mode preserves the original pixels.",
    previewKind: "crop",
  },
  "perspective-crop": {
    title: "Perspective Crop",
    description:
      "Draw a four-corner trapezoid to crop and rectify perspective in a single step. Great for straightening photos of documents.",
    previewKind: "perspective-crop",
  },
  slice: {
    title: "Slice Tool",
    description:
      "Carve the canvas into export regions. Each slice can have its own format, scale, and output preset.",
    previewKind: "slice",
  },
  "slice-select": {
    title: "Slice Select Tool",
    description:
      "Pick existing slices to resize, reorder, link, or assign per-slice export settings.",
    previewKind: "slice",
  },
  frame: {
    title: "Frame Tool",
    description:
      "Draw rectangular or elliptical frames that act as placeholder containers. Drop images inside to mask them.",
    previewKind: "frame",
  },
  eyedropper: {
    title: "Eyedropper",
    description:
      "Click the canvas to sample foreground color. Choose point, 3x3, or 5x5 sample size in the options bar.",
    previewKind: "eyedropper",
  },
  "color-sampler": {
    title: "Color Sampler Tool",
    description:
      "Drop up to four persistent sample points and read RGB, HSB, Lab, and CMYK values in the Info panel.",
    previewKind: "color-sampler",
  },
  ruler: {
    title: "Ruler Tool",
    description:
      "Drag to measure distance, angle, and color difference between two points. The result appears in the Info panel.",
    previewKind: "ruler",
  },
  note: {
    title: "Note Tool",
    description:
      "Drop sticky annotations on the canvas for review comments. Notes are preserved in the project file.",
    previewKind: "note",
  },
  count: {
    title: "Count Tool",
    description:
      "Tap items on the canvas to tally counts. Useful for inspection workflows and measurement logs.",
    previewKind: "count",
  },
  "material-eyedropper": {
    title: "3D Material Eyedropper",
    description:
      "Sample a 3D material from a face of a 3D layer so it can be applied elsewhere with the Material Drop tool.",
    previewKind: "material-eyedropper",
  },
  "material-drop": {
    title: "3D Material Drop Tool",
    description:
      "Drop the previously sampled material onto another 3D face to apply matching shading and textures.",
    previewKind: "material-drop",
  },
  "spot-healing": {
    title: "Spot Healing Brush",
    description:
      "Paint over blemishes and the brush blends them with surrounding texture and tone automatically.",
    previewKind: "spot-heal",
  },
  "red-eye": {
    title: "Red Eye Tool",
    description:
      "Click on red-eye pupils to neutralize the flash glare while preserving iris detail.",
    previewKind: "red-eye",
  },
  "healing-brush": {
    title: "Healing Brush",
    description:
      "Alt/Option-click a clean source, then paint over a defect to blend sampled texture into the destination.",
    previewKind: "heal",
  },
  "patch-tool": {
    title: "Patch Tool",
    description:
      "Drag a selection to a clean area to replace the original region with blended pixels from the destination.",
    previewKind: "patch",
  },
  "content-aware-move": {
    title: "Content-Aware Move Tool",
    description:
      "Select an object and drag it to a new spot. The original location is filled in using surrounding content.",
    previewKind: "content-aware-move",
  },
  "remove-tool": {
    title: "Remove Tool",
    description:
      "Paint over an unwanted element and the deterministic browser-local engine fills it from neighboring pixels.",
    previewKind: "remove",
  },
  brush: {
    title: "Brush Tool",
    description:
      "Paint soft-edged strokes with the active foreground color. Size, hardness, flow, and smoothing live in the options bar.",
    previewKind: "brush",
  },
  pencil: {
    title: "Pencil Tool",
    description:
      "Paint hard-edged aliased pixels at the brush size. Ideal for pixel art and crisp 1px detailing.",
    previewKind: "pencil",
  },
  "mixer-brush": {
    title: "Mixer Brush Tool",
    description:
      "Blend foreground paint with canvas pixels using wet/load/mix sliders to simulate oils and watercolor.",
    previewKind: "mixer-brush",
  },
  "color-replace": {
    title: "Color Replacement Tool",
    description:
      "Paint over an existing color to swap it for the foreground while preserving texture, luminance, and saturation.",
    previewKind: "color-replace",
  },
  "clone-stamp": {
    title: "Clone Stamp Tool",
    description:
      "Alt/Option-click a source point, then paint sampled pixels elsewhere with optional aligned source presets.",
    previewKind: "clone",
  },
  "pattern-stamp": {
    title: "Pattern Stamp Tool",
    description:
      "Paint repeating pattern tiles across the canvas with optional impressionist and aligned modes.",
    previewKind: "pattern-stamp",
  },
  "history-brush": {
    title: "History Brush",
    description:
      "Paint pixels back from a chosen history state or snapshot, restoring selected regions without rolling back the file.",
    previewKind: "history",
  },
  "art-history-brush": {
    title: "Art History Brush",
    description:
      "Paint stylized strokes that blend a history state through painterly, tight curl, and loose curl simulations.",
    previewKind: "art-history",
  },
  eraser: {
    title: "Eraser Tool",
    description:
      "Erase pixels back to transparency, or to the background color on the locked background layer.",
    previewKind: "eraser",
  },
  "background-eraser": {
    title: "Background Eraser Tool",
    description:
      "Paint along subject edges to erase only matching background pixels while protecting foreground colors.",
    previewKind: "background-eraser",
  },
  "magic-eraser": {
    title: "Magic Eraser Tool",
    description:
      "Click a color and the tool erases connected matching pixels in a single step. Tolerance controls the range.",
    previewKind: "magic-eraser",
  },
  gradient: {
    title: "Gradient Tool",
    description:
      "Drag to lay down a linear, radial, angle, reflected, or diamond gradient using the active preset.",
    previewKind: "gradient",
  },
  "paint-bucket": {
    title: "Paint Bucket Tool",
    description:
      "Click a region to flood-fill matching pixels with the foreground color or a chosen pattern.",
    previewKind: "paint-bucket",
  },
  blur: {
    title: "Blur Tool",
    description:
      "Paint to locally soften image detail. Strength and brush dynamics control how aggressive each pass is.",
    previewKind: "blur",
  },
  sharpen: {
    title: "Sharpen Tool",
    description:
      "Paint to locally enhance edge contrast. Use Protect Detail to avoid amplifying noise.",
    previewKind: "sharpen",
  },
  smudge: {
    title: "Smudge Tool",
    description:
      "Drag to push pixels along the stroke direction as if smearing wet paint.",
    previewKind: "smudge",
  },
  dodge: {
    title: "Dodge Tool",
    description:
      "Paint to lighten shadows, midtones, or highlights with range-specific exposure boosts.",
    previewKind: "dodge",
  },
  burn: {
    title: "Burn Tool",
    description:
      "Paint to darken shadows, midtones, or highlights with range-specific exposure reductions.",
    previewKind: "burn",
  },
  sponge: {
    title: "Sponge Tool",
    description:
      "Paint to saturate or desaturate pixels locally. Vibrance mode protects skin tones from over-saturation.",
    previewKind: "sponge",
  },
  pen: {
    title: "Pen Tool",
    description:
      "Click to place anchor points or drag for Bezier handles, producing precise editable vector paths.",
    previewKind: "pen",
  },
  "freeform-pen": {
    title: "Freeform Pen Tool",
    description:
      "Draw a freehand path and the tool fits Bezier curves automatically. Switch on Magnetic to snap to edges.",
    previewKind: "freeform-pen",
  },
  "curvature-pen": {
    title: "Curvature Pen Tool",
    description:
      "Click to drop points and the path auto-curves through them. Double-click a point to convert it to a corner.",
    previewKind: "curvature-pen",
  },
  "add-anchor-point": {
    title: "Add Anchor Point Tool",
    description:
      "Click an existing path segment to insert a new anchor point, ready for handle adjustments.",
    previewKind: "anchor-add",
  },
  "delete-anchor-point": {
    title: "Delete Anchor Point Tool",
    description:
      "Click an anchor point to remove it. Neighboring segments are rejoined and smoothed automatically.",
    previewKind: "anchor-delete",
  },
  "convert-point": {
    title: "Convert Point Tool",
    description:
      "Click corner points to make them smooth, or drag handles independently to break smooth points into corners.",
    previewKind: "anchor-convert",
  },
  type: {
    title: "Horizontal Type Tool",
    description:
      "Click to create point type or drag a text box. Character, paragraph, OpenType, and warp panels stay live.",
    previewKind: "type",
  },
  "type-vertical": {
    title: "Vertical Type Tool",
    description:
      "Create vertical type that flows top-to-bottom. Useful for CJK typography and labels along narrow elements.",
    previewKind: "type-vertical",
  },
  "type-mask-horizontal": {
    title: "Horizontal Type Mask Tool",
    description:
      "Type a shape that becomes a selection rather than rasterized text, ready for fills, masks, or strokes.",
    previewKind: "type-mask",
  },
  "type-mask-vertical": {
    title: "Vertical Type Mask Tool",
    description:
      "Type a vertical shape that becomes a selection rather than rasterized text.",
    previewKind: "type-mask",
  },
  "path-select": {
    title: "Path Selection",
    description:
      "Click a path to select the entire path or shape so it can be moved, duplicated, or combined.",
    previewKind: "path-select",
  },
  "direct-select": {
    title: "Direct Selection",
    description:
      "Click individual anchor points or handles to reshape a single path segment without moving the whole path.",
    previewKind: "direct-select",
  },
  "shape-rect": {
    title: "Rectangle Tool",
    description:
      "Drag to draw an editable rectangle shape layer with live fill, stroke, and corner radius controls.",
    previewKind: "shape-rect",
  },
  "shape-rounded-rect": {
    title: "Rounded Rectangle Tool",
    description:
      "Drag to draw a rounded rectangle shape layer. Set the corner radius before or after drawing.",
    previewKind: "shape-rounded-rect",
  },
  "shape-ellipse": {
    title: "Ellipse Tool",
    description:
      "Drag to draw an editable ellipse shape layer. Hold Shift to constrain to a perfect circle.",
    previewKind: "shape-ellipse",
  },
  "shape-polygon": {
    title: "Polygon Tool",
    description:
      "Draw an editable n-sided polygon shape layer. Tune side count, smooth corners, and indent in the options bar.",
    previewKind: "shape-polygon",
  },
  "shape-star": {
    title: "Star Tool",
    description:
      "Draw an editable star shape with adjustable point count, inset, and corner smoothing.",
    previewKind: "shape-star",
  },
  "shape-triangle": {
    title: "Triangle Tool",
    description:
      "Drag to draw an editable triangle shape layer. Combine with transforms to produce any 3-sided polygon.",
    previewKind: "shape-triangle",
  },
  "shape-line": {
    title: "Line Tool",
    description:
      "Drag to draw an editable line shape layer with adjustable weight and end arrowheads.",
    previewKind: "shape-line",
  },
  "custom-shape": {
    title: "Custom Shape Tool",
    description:
      "Pick a preset glyph from the library and drag to draw it as an editable vector shape layer.",
    previewKind: "custom-shape",
  },
  hand: {
    title: "Hand Tool",
    description:
      "Drag to pan the document inside the canvas window. Hold Space with any tool to temporarily access the hand tool.",
    previewKind: "hand",
  },
  "rotate-view": {
    title: "Rotate View Tool",
    description:
      "Drag to rotate the canvas display non-destructively for more natural painting angles. Press R to reset.",
    previewKind: "rotate-view",
  },
  zoom: {
    title: "Zoom Tool",
    description:
      "Click to zoom in, Alt/Option-click to zoom out, or drag a marquee to fit a region to the window.",
    previewKind: "zoom",
  },
  transform: {
    title: "Transform Tool",
    description:
      "Scale, rotate, skew, and perspective-warp the active layer with bounding-box handles. Commit to bake the change.",
    previewKind: "transform",
  },
}

/** Optional generic content (not tied to a ToolId) for reuse elsewhere. */
export interface GenericTooltipEntry extends ToolTooltipEntry {
  /** Topic id used by `ps-open-learn` when the user clicks Learn more. */
  learnTopic?: string
}

export const GENERIC_TOOLTIP_CONTENT = {
  "quick-mask": {
    title: "Quick Mask Mode",
    description:
      "Paint a temporary red mask overlay. Toggle off Quick Mask to convert the painted area into a selection.",
    previewKind: "quick-mask",
    learnTopic: "quick-mask",
  },
} satisfies Record<string, GenericTooltipEntry>

export function getToolTooltipEntry(id: ToolId): ToolTooltipEntry {
  return (
    TOOL_TOOLTIP_CONTENT[id] ?? {
      title: id,
      description: "",
      previewKind: "move",
    }
  )
}
