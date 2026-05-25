import type { ToolId } from "./types"

export type ToolPreviewKind =
  | "move"
  | "selection"
  | "crop"
  | "sample"
  | "retouch"
  | "brush"
  | "clone"
  | "history"
  | "erase"
  | "fill"
  | "blur"
  | "tonal"
  | "path"
  | "type"
  | "shape"
  | "view"
  | "transform"
  | "quick-mask"

export interface ToolRichHelp {
  description: string
  steps: string[]
  preview: ToolPreviewKind
  learningQuery: string
  learningCategory: string
  keywords: string[]
}

export interface ToolLearningSource {
  id: ToolId
  title: string
  category: string
  description: string
  keywords: string[]
}

export const TOOL_LABELS: Record<ToolId, string> = {
  move: "Move Tool",
  artboard: "Artboard Tool",
  "marquee-rect": "Rectangular Marquee",
  "marquee-ellipse": "Elliptical Marquee",
  "marquee-row": "Single Row Marquee",
  "marquee-col": "Single Column Marquee",
  lasso: "Lasso Tool",
  "lasso-polygon": "Polygonal Lasso",
  "lasso-magnetic": "Magnetic Lasso",
  "object-select": "Object Selection Tool",
  "quick-selection": "Quick Selection Tool",
  "magic-wand": "Magic Wand Tool",
  "refine-edge-brush": "Refine Edge Brush",
  "select-subject": "Select Subject",
  "select-sky": "Select Sky",
  "select-background": "Select Background",
  crop: "Crop Tool",
  "perspective-crop": "Perspective Crop",
  slice: "Slice Tool",
  "slice-select": "Slice Select Tool",
  frame: "Frame Tool",
  eyedropper: "Eyedropper",
  "color-sampler": "Color Sampler Tool",
  ruler: "Ruler Tool",
  note: "Note Tool",
  count: "Count Tool",
  "material-eyedropper": "3D Material Eyedropper",
  "material-drop": "3D Material Drop Tool",
  "spot-healing": "Spot Healing Brush",
  "red-eye": "Red Eye Tool",
  "healing-brush": "Healing Brush",
  "patch-tool": "Patch Tool",
  "content-aware-move": "Content-Aware Move Tool",
  "remove-tool": "Remove Tool",
  brush: "Brush Tool",
  pencil: "Pencil Tool",
  "mixer-brush": "Mixer Brush Tool",
  "color-replace": "Color Replacement Tool",
  "clone-stamp": "Clone Stamp Tool",
  "pattern-stamp": "Pattern Stamp Tool",
  "history-brush": "History Brush",
  "art-history-brush": "Art History Brush",
  eraser: "Eraser Tool",
  "background-eraser": "Background Eraser Tool",
  "magic-eraser": "Magic Eraser Tool",
  gradient: "Gradient Tool",
  "paint-bucket": "Paint Bucket Tool",
  blur: "Blur Tool",
  sharpen: "Sharpen Tool",
  smudge: "Smudge Tool",
  dodge: "Dodge Tool",
  burn: "Burn Tool",
  sponge: "Sponge Tool",
  pen: "Pen Tool",
  "freeform-pen": "Freeform Pen Tool",
  "curvature-pen": "Curvature Pen Tool",
  "add-anchor-point": "Add Anchor Point Tool",
  "delete-anchor-point": "Delete Anchor Point Tool",
  "convert-point": "Convert Point Tool",
  type: "Horizontal Type Tool",
  "type-vertical": "Vertical Type Tool",
  "type-mask-horizontal": "Horizontal Type Mask Tool",
  "type-mask-vertical": "Vertical Type Mask Tool",
  "path-select": "Path Selection",
  "direct-select": "Direct Selection",
  "shape-rect": "Rectangle Tool",
  "shape-rounded-rect": "Rounded Rectangle Tool",
  "shape-ellipse": "Ellipse Tool",
  "shape-polygon": "Polygon Tool",
  "shape-star": "Star Tool",
  "shape-triangle": "Triangle Tool",
  "shape-line": "Line Tool",
  "custom-shape": "Custom Shape Tool",
  hand: "Hand Tool",
  "rotate-view": "Rotate View Tool",
  zoom: "Zoom Tool",
  transform: "Transform Tool",
}

const CUSTOM_TOOL_HELP: Partial<Record<ToolId, Partial<ToolRichHelp>>> = {
  brush: {
    description:
      "Paint soft-edged strokes with the active foreground color. Brush size, hardness, flow, smoothing, dynamics, and symmetry stay in sync with the options bar and Brush panel.",
    steps: [
      "Drag on the canvas to paint; use brackets or the size control for brush diameter.",
      "Tune hardness, flow, smoothing, and dynamics before long strokes.",
      "Hold Shift to cycle related paint tools.",
    ],
    learningQuery: "brush dynamics",
    keywords: ["brush", "paint", "dynamics", "smoothing", "foreground"],
  },
  "object-select": {
    description:
      "Draw a region around the subject you want to isolate. The browser-local selector builds an editable selection that can be refined in Selection Studio.",
    learningQuery: "selection mask",
    keywords: ["object", "selection", "mask", "subject"],
  },
  "quick-selection": {
    description:
      "Brush across nearby edges to grow or subtract a selection. It is best for cutouts that need fast cleanup before Select and Mask.",
    learningQuery: "selection mask",
    keywords: ["quick", "selection", "edge", "mask"],
  },
  "magic-wand": {
    description:
      "Sample a color range from the canvas and select matching pixels with tolerance, contiguous, and sample-all-layers controls.",
    learningQuery: "selection tolerance",
    keywords: ["wand", "selection", "tolerance", "color"],
  },
  "spot-healing": {
    description:
      "Paint over small blemishes, dust, and seams to blend them with neighboring pixels while preserving the surrounding tone.",
    learningQuery: "healing retouch",
    keywords: ["healing", "retouch", "blemish", "repair"],
  },
  "clone-stamp": {
    description:
      "Alt-click a source point, then paint sampled pixels elsewhere. Clone Source presets keep scale, rotation, and alignment ready for repeat retouching.",
    learningQuery: "clone source",
    keywords: ["clone", "stamp", "source", "retouch"],
  },
  type: {
    description:
      "Click to create point type or drag for an area text box. Character, paragraph, OpenType, warp, and editable text metadata stay live.",
    learningQuery: "type typography",
    keywords: ["type", "text", "typography", "character"],
  },
  pen: {
    description:
      "Place anchor points and Bezier handles to build precise vector paths for shapes, masks, and editable outlines.",
    learningQuery: "paths vector",
    keywords: ["pen", "path", "vector", "bezier"],
  },
  crop: {
    description:
      "Set a crop boundary, straighten composition, and confirm a non-destructive canvas crop using the options bar.",
    learningQuery: "crop slices",
    keywords: ["crop", "trim", "composition", "canvas"],
  },
  eyedropper: {
    description:
      "Sample foreground color from the document with point, 3x3, or 5x5 sampling and matching Info panel readouts.",
    learningQuery: "info sampler",
    keywords: ["eyedropper", "sample", "color", "info"],
  },
  transform: {
    description:
      "Scale, rotate, skew, or perspective-warp the active layer with handles while preserving an undoable transform state.",
    learningQuery: "transform properties",
    keywords: ["transform", "scale", "rotate", "warp"],
  },
}

export function getToolHelp(
  id: ToolId,
  name = TOOL_LABELS[id],
  _shortcut = "",
  hasRelatedTools = false,
): ToolRichHelp {
  const preview = previewForTool(id)
  const category = categoryForTool(id, preview)
  const learningQuery = learningQueryForTool(id, preview)
  const custom = CUSTOM_TOOL_HELP[id] ?? {}
  const description = custom.description ?? defaultDescription(name, preview)
  const keywords = [
    ...tokenizeWords(name),
    preview,
    ...tokenizeWords(category),
    ...tokenizeWords(custom.learningQuery ?? learningQuery),
    ...(custom.keywords ?? []),
  ].filter((keyword, index, list) => keyword && list.indexOf(keyword) === index)

  return {
    description,
    steps: custom.steps ?? defaultSteps(name, preview, hasRelatedTools),
    preview,
    learningQuery: custom.learningQuery ?? learningQuery,
    learningCategory: category,
    keywords,
  }
}

export const TOOL_LEARNING_SOURCES: ToolLearningSource[] = (Object.keys(TOOL_LABELS) as ToolId[]).map((id) => {
  const title = TOOL_LABELS[id]
  const help = getToolHelp(id, title)
  return {
    id,
    title,
    category: help.learningCategory,
    description: help.description,
    keywords: help.keywords,
  }
})

function previewForTool(id: ToolId): ToolPreviewKind {
  if (id === "move" || id === "artboard") return "move"
  if (id.startsWith("marquee") || id.includes("lasso") || id.includes("select")) return "selection"
  if (id.includes("crop") || id === "slice" || id === "slice-select" || id === "frame") return "crop"
  if (id.includes("eyedropper") || id === "color-sampler" || id === "ruler" || id === "note" || id === "count") return "sample"
  if (id.includes("healing") || id === "red-eye" || id === "patch-tool" || id === "content-aware-move" || id === "remove-tool") return "retouch"
  if (id === "brush" || id === "pencil" || id === "mixer-brush" || id === "color-replace") return "brush"
  if (id.includes("stamp")) return "clone"
  if (id.includes("history-brush")) return "history"
  if (id.includes("eraser")) return "erase"
  if (id === "gradient" || id === "paint-bucket" || id === "material-drop") return "fill"
  if (id === "blur" || id === "sharpen" || id === "smudge") return "blur"
  if (id === "dodge" || id === "burn" || id === "sponge") return "tonal"
  if (id.includes("pen") || id.includes("point") || id.includes("path") || id === "direct-select") return "path"
  if (id.includes("type")) return "type"
  if (id.includes("shape")) return "shape"
  if (id === "hand" || id === "rotate-view" || id === "zoom") return "view"
  if (id === "transform") return "transform"
  return "move"
}

function categoryForTool(id: ToolId, preview: ToolPreviewKind) {
  if (preview === "selection") return "Selection"
  if (preview === "crop") return "Crop and Layout"
  if (preview === "sample" || preview === "view") return "Inspection and Guides"
  if (preview === "retouch" || preview === "clone" || preview === "blur" || preview === "tonal") return "Retouching"
  if (preview === "path" || preview === "type" || preview === "shape") return "Type and Vector"
  if (id.includes("material")) return "3D and Materials"
  return "Core"
}

function learningQueryForTool(id: ToolId, preview: ToolPreviewKind) {
  if (id === "brush") return "brush dynamics"
  switch (preview) {
    case "selection":
      return "selection mask"
    case "crop":
      return "crop slices"
    case "sample":
      return "info sampler"
    case "retouch":
      return "healing retouch"
    case "brush":
      return "brush panel"
    case "clone":
      return "clone source"
    case "history":
      return "history snapshots"
    case "erase":
      return "eraser background"
    case "fill":
      return "gradient swatches"
    case "blur":
      return "blur sharpen smudge"
    case "tonal":
      return "dodge burn sponge"
    case "path":
      return "paths vector"
    case "type":
      return "type typography"
    case "shape":
      return "shapes vector"
    case "view":
      return "navigator zoom"
    case "transform":
      return "transform properties"
    case "move":
    default:
      return "layers properties"
  }
}

function defaultDescription(name: string, preview: ToolPreviewKind) {
  switch (preview) {
    case "selection":
      return `${name} creates an editable selection boundary so later edits, masks, fills, and filters affect only the intended pixels.`
    case "crop":
      return `${name} defines document regions, frames, slices, or perspective bounds before export or composition cleanup.`
    case "sample":
      return `${name} inspects the canvas and records color, measurement, count, or annotation details without changing pixels.`
    case "retouch":
      return `${name} repairs local image defects by blending sampled texture, color, and tone into the surrounding area.`
    case "brush":
      return `${name} paints with the active color or brush behavior while respecting size, flow, opacity, and smoothing controls.`
    case "clone":
      return `${name} reuses sampled pixels or patterns with aligned source controls for repeatable cleanup and texture work.`
    case "history":
      return `${name} paints from previous document states so selected areas can be restored without rolling back the whole file.`
    case "erase":
      return `${name} removes or isolates pixels with brush-like controls, background sampling, and edge-aware modes.`
    case "fill":
      return `${name} lays down color, gradients, materials, or patterns across selections and layer regions.`
    case "blur":
      return `${name} locally softens, sharpens, or smears image detail with brush-based strength controls.`
    case "tonal":
      return `${name} locally changes exposure, saturation, or tonal emphasis while leaving the rest of the layer untouched.`
    case "path":
      return `${name} edits vector geometry, anchor points, handles, and paths for masks, shapes, and type outlines.`
    case "type":
      return `${name} creates editable text layers with live character, paragraph, vertical type, mask, and warp controls.`
    case "shape":
      return `${name} draws editable vector shapes with live fill, stroke, radius, polygon, and custom-shape settings.`
    case "view":
      return `${name} changes canvas navigation, zoom, pan, or rotation without changing the document pixels.`
    case "transform":
      return `${name} adjusts active layer geometry with scale, rotate, skew, and perspective controls.`
    case "move":
    default:
      return `${name} repositions layers, selections, artboards, or framed content while preserving document history.`
  }
}

function defaultSteps(name: string, preview: ToolPreviewKind, hasRelatedTools: boolean) {
  const action = (() => {
    switch (preview) {
      case "selection":
        return "Drag around the target area, then refine the edge or change the selection mode."
      case "crop":
        return "Drag a boundary, adjust handles, then confirm or switch tools to cancel."
      case "sample":
        return "Click the canvas to sample or record the current point in the matching panel."
      case "brush":
      case "retouch":
      case "clone":
      case "erase":
      case "blur":
      case "tonal":
      case "history":
        return "Drag on the canvas with a brush-sized cursor and tune strength in the options bar."
      case "path":
      case "shape":
      case "type":
        return "Click or drag on the canvas to place editable vector or text content."
      case "view":
        return "Drag or click the canvas to navigate the view while the document remains unchanged."
      case "transform":
        return "Use the bounding handles to change layer geometry, then commit the transform."
      case "fill":
        return "Click or drag through the selection or active layer to apply the fill behavior."
      case "move":
      default:
        return "Drag the active content, selection, or layer target on the canvas."
    }
  })()

  const options = (() => {
    switch (preview) {
      case "selection":
        return "Use add, subtract, intersect, feather, anti-alias, and tolerance options for tighter masks."
      case "brush":
        return "Use size, hardness, opacity, flow, smoothing, and Brush panel dynamics for the stroke feel."
      case "type":
        return "Use Character and Paragraph panels for live type, OpenType, spacing, and alignment."
      case "shape":
        return "Use fill, stroke, geometry, radius, and custom shape options before drawing."
      default:
        return "Use the options bar and matching panel for the current mode, strength, and constraints."
    }
  })()

  return [
    action,
    options,
    hasRelatedTools ? `Hold Shift to cycle related ${toolFamilyLabel(preview)} tools.` : `${name} is available from the left tool rail and command palette.`,
  ]
}

function toolFamilyLabel(preview: ToolPreviewKind) {
  switch (preview) {
    case "brush":
      return "paint"
    case "selection":
      return "selection"
    case "path":
      return "path"
    case "shape":
      return "shape"
    case "type":
      return "type"
    default:
      return "grouped"
  }
}

function tokenizeWords(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}
