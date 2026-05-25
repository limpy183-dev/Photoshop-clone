/**
 * Contextual help content for the Learn and Discover panels.
 *
 * The shape is intentionally simple — a per-tool array of tips. We seed
 * it with practical Photoshop-style guidance for every tool already in
 * the editor's registry, so that selecting a tool surfaces relevant
 * suggestions in the Learn panel and biases Discover search results
 * toward what the user is currently doing.
 */

import type { ToolId, Selection, PsDocument } from "./types"

export interface HelpTip {
  id: string
  title: string
  body: string
  /** Short tag used to group tips on the panel (e.g. "Tip", "Shortcut"). */
  variant?: "tip" | "shortcut" | "depth" | "selection"
  /** Optional related panel id the Learn panel will link to. */
  relatedPanel?: string
  /** Optional shortcut hint (e.g. "Shift+B"). */
  shortcut?: string
}

const FALLBACK_TIPS: HelpTip[] = [
  {
    id: "fallback-shortcut-search",
    title: "Find any command",
    body: "Open the Command Palette with Cmd/Ctrl+K to search every panel, tool, filter, and recent action.",
    variant: "shortcut",
    shortcut: "⌘K / Ctrl+K",
  },
  {
    id: "fallback-shortcut-undo",
    title: "Step through history",
    body: "Cmd/Ctrl+Z undoes the last action; Cmd/Ctrl+Shift+Z redoes. Use the History panel to jump to any state.",
    variant: "shortcut",
    relatedPanel: "history",
    shortcut: "⌘Z / ⌘⇧Z",
  },
  {
    id: "fallback-tip-workspace",
    title: "Customise your workspace",
    body: "Right-click any panel tab or pick a workspace preset to focus the dock on the task you’re doing.",
    variant: "tip",
  },
]

const TOOL_TIPS: Partial<Record<ToolId, HelpTip[]>> = {
  move: [
    { id: "move-1", title: "Auto-select layer", body: "Toggle ‘Auto-Select’ in the options bar so a click on the canvas activates the underlying layer instead of dragging the active one.", variant: "tip" },
    { id: "move-2", title: "Arrow nudges", body: "Press arrow keys to nudge one pixel; hold Shift for ten-pixel steps. The transform commits with Return.", variant: "shortcut", shortcut: "Arrow / Shift+Arrow" },
    { id: "move-3", title: "Drag with constraint", body: "Hold Shift while dragging to lock motion to horizontal or vertical axes.", variant: "tip" },
  ],
  "marquee-rect": [
    { id: "marq-rect-1", title: "Snap to integer pixels", body: "Hold Shift to constrain the rectangle to a square; hold Alt/Option to draw from the centre.", variant: "tip" },
    { id: "marq-rect-2", title: "Refine the boundary", body: "Open the Selection panel after marking a rough box to feather, smooth, or grow the marquee.", variant: "selection", relatedPanel: "selection-studio" },
  ],
  "marquee-ellipse": [
    { id: "marq-ell-1", title: "Anti-aliased edges", body: "Enable anti-aliasing in the options bar before drawing to avoid jagged ellipses when the selection is later filled or masked.", variant: "tip" },
  ],
  lasso: [
    { id: "lasso-1", title: "Magnetic Lasso for edges", body: "Switch to the Magnetic Lasso when the subject sits against a high-contrast background — it snaps to detected edges automatically.", variant: "tip" },
    { id: "lasso-2", title: "Close with double-click", body: "Double-click to close a freehand selection at the current cursor position; press Esc to abandon the partial outline.", variant: "shortcut" },
  ],
  "magic-wand": [
    { id: "wand-1", title: "Tune tolerance", body: "Raise tolerance to pick a wider colour range; lower it for tight, accurate selections inside flat areas.", variant: "tip" },
    { id: "wand-2", title: "Contiguous off", body: "Disable ‘Contiguous’ to pick every same-colour pixel in the document, not just the connected region under the cursor.", variant: "tip" },
  ],
  "object-select": [
    { id: "obj-1", title: "Drag once around the subject", body: "A loose rectangle is enough — the browser-local selector finds the strongest edges inside the rectangle.", variant: "tip" },
    { id: "obj-2", title: "Refine in Selection Studio", body: "After the initial selection, open the Selection panel to feather, smooth, or grow the mask before masking.", variant: "selection", relatedPanel: "selection-studio" },
  ],
  "quick-selection": [
    { id: "quick-1", title: "Paint, don’t click", body: "Drag short strokes across the subject; the brush grows the selection along similar pixels, so build up the mask in passes.", variant: "tip" },
    { id: "quick-2", title: "Subtract with Alt", body: "Hold Alt/Option to switch the brush to subtract mode and remove regions from the active selection.", variant: "shortcut" },
  ],
  crop: [
    { id: "crop-1", title: "Straighten reference", body: "Click and drag inside the crop bounds with the Straighten tool to set a reference horizon — the canvas rotates to match.", variant: "tip" },
    { id: "crop-2", title: "Delete cropped pixels", body: "Disable ‘Delete Cropped Pixels’ in the options bar so the layer keeps the original boundaries and crops non-destructively.", variant: "tip" },
  ],
  brush: [
    { id: "brush-1", title: "Hardness + flow", body: "Use brackets to resize and Shift+brackets to adjust hardness. Lower flow gives smooth tonal build-up over multiple passes.", variant: "shortcut", shortcut: "[ / ] / Shift+[ / Shift+]" },
    { id: "brush-2", title: "Brush dynamics", body: "Open the Brush panel to enable shape, scattering, transfer, and texture dynamics for handmade strokes.", variant: "tip", relatedPanel: "brush" },
    { id: "brush-3", title: "Smoothing", body: "Raise Smoothing in the options bar to let the brush stabilise jittery hand motion at the cost of stroke latency.", variant: "tip" },
  ],
  pencil: [
    { id: "pencil-1", title: "Pixel-perfect strokes", body: "The pencil draws aliased strokes — useful for pixel art. Pair with the Pixel Grid (View menu) and a hard-edged brush size.", variant: "tip" },
  ],
  "mixer-brush": [
    { id: "mixer-1", title: "Wet vs dry", body: "Increase ‘Wet’ to pick up more underlying colour, ‘Mix’ to blend the brush reservoir with sampled pixels.", variant: "tip" },
    { id: "mixer-2", title: "Load reservoir", body: "Alt-click on the canvas to load the brush with the sampled colour for the next strokes.", variant: "shortcut" },
  ],
  "clone-stamp": [
    { id: "clone-1", title: "Set the source", body: "Alt/Option-click to set the clone source point, then paint elsewhere to lay down sampled pixels.", variant: "shortcut" },
    { id: "clone-2", title: "Aligned vs unaligned", body: "Enable ‘Aligned’ in the options bar to keep the source offset relative to the brush, even across strokes.", variant: "tip", relatedPanel: "clone-source" },
  ],
  "spot-healing": [
    { id: "spot-1", title: "Quick blemish removal", body: "Click directly on small defects; the tool samples nearby texture and blends it in without picking a source point.", variant: "tip" },
    { id: "spot-2", title: "Content-aware mode", body: "Enable Content-Aware in the options bar for larger areas — the heal tool reconstructs texture from a wider neighbourhood.", variant: "tip" },
  ],
  eraser: [
    { id: "eraser-1", title: "Background eraser", body: "Use the Background Eraser to remove only similar pixels under the brush — handy for clean cutouts against busy backgrounds.", variant: "tip" },
  ],
  gradient: [
    { id: "grad-1", title: "Edit live gradient", body: "After dragging, drag the on-canvas gradient widget to adjust colour stops without re-drawing.", variant: "tip", relatedPanel: "gradients" },
    { id: "grad-2", title: "Hold Shift to constrain", body: "Hold Shift while drawing to lock the gradient to 45° increments.", variant: "shortcut" },
  ],
  "paint-bucket": [
    { id: "bucket-1", title: "Pattern fill", body: "Switch to ‘Pattern’ in the options bar to fill with a pattern preset instead of the foreground colour.", variant: "tip", relatedPanel: "patterns" },
  ],
  pen: [
    { id: "pen-1", title: "Curves with handles", body: "Click and drag to extend the new anchor with bezier handles; click only for a corner point.", variant: "tip", relatedPanel: "paths" },
    { id: "pen-2", title: "Close the path", body: "Hover over the first anchor until the cursor shows a circle, then click to close the path cleanly.", variant: "tip" },
  ],
  "curvature-pen": [
    { id: "curvature-1", title: "Smooth by default", body: "Each click adds a smoothly curved anchor — double-click to convert to a corner.", variant: "tip" },
  ],
  type: [
    { id: "type-1", title: "Point vs paragraph", body: "Click for point type, click-and-drag for a paragraph text frame. Switch later from the Properties panel.", variant: "tip", relatedPanel: "character" },
    { id: "type-2", title: "Insert glyphs", body: "Open the Glyphs panel to insert special characters, ligatures, and currency symbols into the active text layer.", variant: "tip", relatedPanel: "glyphs" },
    { id: "type-3", title: "Commit text edit", body: "Press the Enter/Return key on the numeric keypad (or Esc to cancel) to commit a text edit and re-rasterise the layer.", variant: "shortcut" },
  ],
  "type-vertical": [
    { id: "type-v-1", title: "Vertical writing mode", body: "Use the Character panel to switch between right-to-left and left-to-right vertical columns for CJK typography.", variant: "tip", relatedPanel: "character" },
  ],
  "shape-rect": [
    { id: "shape-1", title: "Rounded corners", body: "Set corner radius in the options bar; hold Alt while dragging a corner handle to round one side only.", variant: "tip" },
    { id: "shape-2", title: "Live shape properties", body: "Open the Properties panel after drawing to update geometry without losing fill/stroke.", variant: "tip", relatedPanel: "properties" },
  ],
  "custom-shape": [
    { id: "custom-1", title: "Custom shape library", body: "Open the Shapes panel to select bundled vector shapes or load your own JSON shape libraries.", variant: "tip", relatedPanel: "shapes" },
  ],
  eyedropper: [
    { id: "eye-1", title: "Sample size", body: "Choose Point, 3x3, or 5x5 in the options bar so the sampler averages a small region for noisy sources.", variant: "tip", relatedPanel: "color" },
  ],
  ruler: [
    { id: "ruler-1", title: "Measure angles", body: "Click and drag a baseline; hold Alt and drag from a handle to draw a protractor between two segments.", variant: "tip", relatedPanel: "measurement-log" },
    { id: "ruler-2", title: "Log measurements", body: "Open the Measurement Log panel to record the current ruler measurement and export the log as CSV/JSON.", variant: "tip", relatedPanel: "measurement-log" },
  ],
  note: [
    { id: "note-1", title: "Floating notes", body: "Click anywhere on the canvas to drop a sticky note. Open the Notes panel to manage replies, authors, and timestamps.", variant: "tip", relatedPanel: "notes" },
  ],
  count: [
    { id: "count-1", title: "Group counts", body: "Switch count groups from the options bar to tag overlapping subjects with different colours.", variant: "tip" },
  ],
  hand: [
    { id: "hand-1", title: "Spacebar pan", body: "Hold Space with any tool to temporarily switch to Hand and pan the document.", variant: "shortcut", shortcut: "Space" },
  ],
  zoom: [
    { id: "zoom-1", title: "Fit on screen", body: "Double-click the Zoom tool icon to fit the document into the viewport, or use Cmd/Ctrl+0.", variant: "shortcut", shortcut: "⌘0 / Ctrl+0" },
  ],
  transform: [
    { id: "transform-1", title: "Constrain proportions", body: "Hold Shift to keep aspect ratio while scaling. Use the reference point widget to change the pivot.", variant: "tip", relatedPanel: "properties" },
    { id: "transform-2", title: "Skew with Ctrl", body: "Hold Cmd/Ctrl while dragging a side handle to skew, or hold Cmd+Alt+Shift on a corner for perspective.", variant: "shortcut" },
  ],
}

export interface ContextualHelpInput {
  toolId: ToolId
  selection: Selection | null
  doc: PsDocument | null
}

export interface ContextualHelpResult {
  toolTips: HelpTip[]
  selectionTips: HelpTip[]
  documentTips: HelpTip[]
  fallback: HelpTip[]
}

function selectionTipsFor(selection: Selection | null): HelpTip[] {
  if (!selection?.bounds) {
    return [
      {
        id: "selection-empty",
        title: "No active selection",
        body: "Selections constrain painting, fills, filters, and the next paste. Start a selection with the marquee or lasso to confine edits.",
        variant: "selection",
        relatedPanel: "selection-studio",
      },
    ]
  }
  const { w, h } = selection.bounds
  const tips: HelpTip[] = []
  if (w * h < 32 * 32) {
    tips.push({
      id: "selection-small",
      title: "Small selection",
      body: "Tiny selections often benefit from feathering or growing the mask before applying filters — try Selection → Modify → Expand.",
      variant: "selection",
      relatedPanel: "selection-studio",
    })
  } else {
    tips.push({
      id: "selection-active",
      title: "Selection active",
      body: "Use ⌘D (Ctrl+D) to deselect, ⌘H to hide marching ants, or Select and Mask to refine the edge before masking.",
      variant: "selection",
      relatedPanel: "selection-studio",
      shortcut: "⌘D / ⌘H",
    })
  }
  if ((selection.feather ?? 0) > 0) {
    tips.push({
      id: "selection-feather",
      title: "Feather is active",
      body: `Edges are softened by ${selection.feather}px. Reset feather to 0 when you need crisp masks for typography or web export.`,
      variant: "selection",
    })
  }
  return tips
}

function documentTipsFor(doc: PsDocument | null): HelpTip[] {
  if (!doc) {
    return [{
      id: "doc-empty",
      title: "Open a document",
      body: "File → Open or drag any PNG, JPEG, WebP, GIF, or PSD onto the workspace to begin editing.",
      variant: "tip",
    }]
  }
  const tips: HelpTip[] = []
  if (doc.colorMode && doc.colorMode !== "RGB") {
    tips.push({
      id: "doc-color-mode",
      title: `Document mode: ${doc.colorMode.toUpperCase()}`,
      body: "This editor previews CMYK, Lab, and Grayscale, but every adjustment is computed in RGB before re-encoding for display.",
      variant: "depth",
    })
  }
  if (doc.bitDepth && doc.bitDepth !== 8) {
    tips.push({
      id: "doc-bit-depth",
      title: `${doc.bitDepth}-bit document`,
      body: "Browser canvases store 8-bit RGBA, so 16/32-bit pixels are emulated. Filters that need higher precision run in the worker before clamping back.",
      variant: "depth",
    })
  }
  if (doc.layers.length > 50) {
    tips.push({
      id: "doc-many-layers",
      title: "Lots of layers",
      body: "Group related layers (Cmd/Ctrl+G) to keep the Layers panel readable. Use Layer Comps to snapshot visibility for client variants.",
      variant: "tip",
      relatedPanel: "layer-comps",
    })
  }
  if (doc.notes?.length) {
    tips.push({
      id: "doc-notes",
      title: `${doc.notes.length} notes attached`,
      body: "Open the Notes panel to navigate, filter, and reply. Resolved comments stay in the document until you delete them.",
      variant: "tip",
      relatedPanel: "notes",
    })
  }
  if (!tips.length) {
    tips.push({
      id: "doc-ready",
      title: "Document looks healthy",
      body: "Ruler units, grid, and snap are configured per-document. Use View → Snap to toggle them quickly.",
      variant: "tip",
    })
  }
  return tips
}

export function computeContextualHelp(input: ContextualHelpInput): ContextualHelpResult {
  return {
    toolTips: TOOL_TIPS[input.toolId] ?? [
      {
        id: `tool-${input.toolId}-generic`,
        title: "Tool tips",
        body: `Use the Properties and Brush panels to refine settings for the ${input.toolId.replace(/-/g, " ")} tool.`,
        variant: "tip",
        relatedPanel: "properties",
      },
    ],
    selectionTips: selectionTipsFor(input.selection),
    documentTips: documentTipsFor(input.doc),
    fallback: FALLBACK_TIPS,
  }
}

export function contextualHelpForTool(toolId: ToolId): HelpTip[] {
  return TOOL_TIPS[toolId] ?? []
}

export function listToolsWithHelp(): ToolId[] {
  return Object.keys(TOOL_TIPS) as ToolId[]
}
