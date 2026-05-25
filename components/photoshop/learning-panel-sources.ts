import type { LearningPanelSource } from "./learning-index"

export const LEARNING_PANEL_SOURCES: LearningPanelSource[] = [
  { id: "color", label: "Color", category: "Core", complexity: "core", keywords: ["foreground", "background", "picker", "swatches"] },
  { id: "swatches", label: "Swatches", category: "Color and Assets", complexity: "standard", keywords: ["palette", "colors", "preset"] },
  { id: "gradients", label: "Gradients", category: "Color and Assets", complexity: "standard", keywords: ["gradient", "preset", "fill"] },
  { id: "patterns", label: "Patterns", category: "Color and Assets", complexity: "standard", keywords: ["pattern", "texture", "fill"] },
  { id: "brush", label: "Brush", category: "Core", complexity: "core", keywords: ["painting", "dynamics", "preset"] },
  { id: "glyphs", label: "Glyphs", category: "Type and Vector", complexity: "advanced", keywords: ["typography", "character", "unicode", "font", "glyph grid", "embedded font"] },
  { id: "styles", label: "Styles", category: "Type and Vector", complexity: "standard", keywords: ["effects", "layer fx", "preset"] },
  { id: "shapes", label: "Shapes", category: "Type and Vector", complexity: "standard", keywords: ["vector", "shape", "custom"] },
  { id: "character", label: "Character", category: "Type and Vector", complexity: "standard", keywords: ["font", "type", "text"] },
  { id: "paragraph", label: "Paragraph", category: "Type and Vector", complexity: "standard", keywords: ["text", "type", "alignment"] },
  { id: "navigator", label: "Navigator", category: "Inspection and Guides", complexity: "standard", keywords: ["zoom", "pan", "view"] },
  { id: "histogram", label: "Histogram", category: "Inspection and Guides", complexity: "standard", keywords: ["levels", "exposure", "photo"] },
  { id: "info", label: "Info", category: "Inspection and Guides", complexity: "standard", keywords: ["readout", "coordinates", "sampler"] },
  { id: "properties", label: "Properties", category: "Core", complexity: "core", keywords: ["layer", "document", "tool"] },
  { id: "selection-studio", label: "Selection", category: "Selection", complexity: "standard", keywords: ["mask", "subject", "edge"] },
  { id: "guides", label: "Guides", category: "Inspection and Guides", complexity: "standard", keywords: ["grid", "rulers", "layout"] },
  { id: "adjustments", label: "Adjustments", category: "Core", complexity: "core", keywords: ["photo", "color", "tonal"] },
  { id: "assets", label: "Assets", category: "Color and Assets", complexity: "standard", keywords: ["export", "library", "bundle", "tags"] },
  { id: "libraries", label: "Libraries", category: "Color and Assets", complexity: "advanced", keywords: ["local library", "gallery", "asset", "drag", "smart object", "tag"] },
  { id: "learn", label: "Learn", category: "Collaboration and Learning", complexity: "specialized", keywords: ["tutorial", "help", "education", "guide", "step by step"] },
  { id: "discover", label: "Discover", category: "Collaboration and Learning", complexity: "specialized", keywords: ["search", "learn", "help", "command discovery", "workflow"] },
  { id: "layers", label: "Layers", category: "Core", complexity: "core", keywords: ["layer", "stack", "visibility"] },
  { id: "channels", label: "Channels", category: "Core", complexity: "standard", keywords: ["alpha", "rgb", "mask"] },
  { id: "paths", label: "Paths", category: "Type and Vector", complexity: "standard", keywords: ["vector", "pen", "path"] },
  { id: "history", label: "History", category: "Core", complexity: "core", keywords: ["undo", "states", "snapshot"] },
  { id: "actions", label: "Actions", category: "Motion and Automation", complexity: "standard", keywords: ["macro", "automation", "record"] },
  { id: "layer-comps", label: "Layer Comps", category: "Core", complexity: "advanced", keywords: ["compositions", "states", "presentation"] },
  { id: "clone-source", label: "Clone Source", category: "Core", complexity: "advanced", keywords: ["clone", "stamp", "source"] },
  { id: "timeline", label: "Timeline", category: "Motion and Automation", complexity: "advanced", keywords: ["animation", "video", "frames"] },
  { id: "comments", label: "Comments", category: "Collaboration and Learning", complexity: "specialized", keywords: ["review", "thread", "resolved", "report"] },
  { id: "annotations", label: "Annotations", category: "Collaboration and Learning", complexity: "specialized", keywords: ["geometry", "markup", "report"] },
  { id: "notes", label: "Notes", category: "Collaboration and Learning", complexity: "specialized", keywords: ["sticky note", "author", "timestamps", "reply", "filter"] },
  { id: "measurement-log", label: "Measurement Log", category: "Inspection and Guides", complexity: "specialized", keywords: ["measure", "count", "analysis"] },
  { id: "slices", label: "Slices", category: "Motion and Automation", complexity: "advanced", keywords: ["web", "export", "regions"] },
  { id: "scripting", label: "Scripting", category: "Motion and Automation", complexity: "specialized", keywords: ["automation", "code", "script"] },
]

export function learningPanelSourceIds() {
  return LEARNING_PANEL_SOURCES.map((panel) => panel.id)
}
