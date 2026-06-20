"use client"

import * as React from "react"
import {
  AlignLeft,
  Archive,
  Activity,
  BarChart3,
  BookOpen,
  CircleDot,
  Code2,
  Eye,
  Film,
  Grid3X3,
  History,
  Info,
  Layers,
  Library,
  MessageSquare,
  MousePointer2,
  Navigation,
  Paintbrush,
  Palette,
  PenTool,
  Pipette,
  Play,
  Ruler,
  Scissors,
  Search,
  SlidersHorizontal,
  Sparkles,
  Stamp,
  StickyNote,
  Type,
} from "lucide-react"
import { lazyPanel } from "./lazy-dialog"

// All panels are lazy-mounted. The right dock typically displays only a
// handful at a time (4-8 in the default workspace), but the registry has
// 38 panels — eagerly importing them all would pull every panel's
// JS, hooks, and state into the workspace's first paint chunk. Switching
// to lazy means each panel's code is fetched only when it actually
// becomes visible in the dock or is referenced by the command palette.
const ActionsPanel = lazyPanel(
  () => import("./panels/actions-panel").then((m) => ({ default: m.ActionsPanel })),
)
const AdjustmentsPanel = lazyPanel(
  () => import("./panels/adjustments-panel").then((m) => ({ default: m.AdjustmentsPanel })),
)
const AnnotationsPanel = lazyPanel(
  () => import("./panels/annotations-panel").then((m) => ({ default: m.AnnotationsPanel })),
)
const AssetsPanel = lazyPanel(
  () => import("./panels/assets-panel").then((m) => ({ default: m.AssetsPanel })),
)
const BrushPanel = lazyPanel(
  () => import("./panels/brush-panel").then((m) => ({ default: m.BrushPanel })),
)
const BrowserDiagnosticsPanel = lazyPanel(
  () => import("./panels/browser-diagnostics-panel").then((m) => ({ default: m.BrowserDiagnosticsPanel })),
)
const AccessibilityAuditPanel = lazyPanel(
  () => import("./panels/accessibility-audit-panel").then((m) => ({ default: m.AccessibilityAuditPanel })),
)
const ChannelsPanel = lazyPanel(
  () => import("./panels/channels-panel").then((m) => ({ default: m.ChannelsPanel })),
)
const CharacterPanel = lazyPanel(
  () => import("./panels/character-paragraph-panels").then((m) => ({ default: m.CharacterPanel })),
)
const ParagraphPanel = lazyPanel(
  () => import("./panels/character-paragraph-panels").then((m) => ({ default: m.ParagraphPanel })),
)
const CloneSourcePanel = lazyPanel(
  () => import("./panels/clone-source-panel").then((m) => ({ default: m.CloneSourcePanel })),
)
const ColorPanel = lazyPanel(
  () => import("./panels/color-panel").then((m) => ({ default: m.ColorPanel })),
)
const AnimationPanel = lazyPanel(
  () => import("./panels/gap-panels").then((m) => ({ default: m.AnimationPanel })),
)
const CommentsPanel = lazyPanel(
  () => import("./panels/gap-panels").then((m) => ({ default: m.CommentsPanel })),
)
const DiscoverPanel = lazyPanel(
  () => import("./panels/discover-panel").then((m) => ({ default: m.DiscoverPanel })),
)
const GlyphsPanel = lazyPanel(
  () => import("./panels/glyphs-panel").then((m) => ({ default: m.GlyphsPanel })),
)
const LearnPanel = lazyPanel(
  () => import("./panels/learn-panel").then((m) => ({ default: m.LearnPanel })),
)
const LibrariesPanel = lazyPanel(
  () => import("./panels/libraries-panel").then((m) => ({ default: m.LibrariesPanel })),
)
const MeasurementLogPanel = lazyPanel(
  () => import("./panels/measurement-log-panel").then((m) => ({ default: m.MeasurementLogPanel })),
)
const NotesPanel = lazyPanel(
  () => import("./panels/notes-panel").then((m) => ({ default: m.NotesPanel })),
)
const ShapesPanel = lazyPanel(
  () => import("./panels/shapes-panel").then((m) => ({ default: m.ShapesPanel })),
)
const StylesPanel = lazyPanel(
  () => import("./panels/styles-panel").then((m) => ({ default: m.StylesPanel })),
)
const GradientsPanel = lazyPanel(
  () => import("./panels/gradients-panel").then((m) => ({ default: m.GradientsPanel })),
)
const GuidesPanel = lazyPanel(
  () => import("./panels/guides-panel").then((m) => ({ default: m.GuidesPanel })),
)
const HistoryPanel = lazyPanel(
  () => import("./panels/history-panel").then((m) => ({ default: m.HistoryPanel })),
)
const HistogramPanel = lazyPanel(
  () => import("./panels/inspection-panels").then((m) => ({ default: m.HistogramPanel })),
)
const InfoPanel = lazyPanel(
  () => import("./panels/inspection-panels").then((m) => ({ default: m.InfoPanel })),
)
const NavigatorPanel = lazyPanel(
  () => import("./panels/inspection-panels").then((m) => ({ default: m.NavigatorPanel })),
)
const LayerCompsPanel = lazyPanel(
  () => import("./panels/layer-comps-panel").then((m) => ({ default: m.LayerCompsPanel })),
)
const LayersPanel = lazyPanel(
  () => import("./panels/layers-panel").then((m) => ({ default: m.LayersPanel })),
)
const PathsPanel = lazyPanel(
  () => import("./panels/paths-panel").then((m) => ({ default: m.PathsPanel })),
)
const PatternsPanel = lazyPanel(
  () => import("./panels/patterns-panel").then((m) => ({ default: m.PatternsPanel })),
)
const PresetManagerPanel = lazyPanel(
  () => import("./panels/preset-manager-panel").then((m) => ({ default: m.PresetManagerPanel })),
)
const PropertiesPanel = lazyPanel(
  () => import("./panels/properties-panel").then((m) => ({ default: m.PropertiesPanel })),
)
const ScriptingPanel = lazyPanel(
  () => import("./panels/scripting-panel").then((m) => ({ default: m.ScriptingPanel })),
)
const SelectionStudioPanel = lazyPanel(
  () => import("./panels/selection-studio-panel").then((m) => ({ default: m.SelectionStudioPanel })),
)
const SlicesPanel = lazyPanel(
  () => import("./panels/slices-panel").then((m) => ({ default: m.SlicesPanel })),
)
const SwatchesPanel = lazyPanel(
  () => import("./panels/swatches-panel").then((m) => ({ default: m.SwatchesPanel })),
)
const TimelinePanel = lazyPanel(
  () => import("./panels/timeline-panel").then((m) => ({ default: m.TimelinePanel })),
)
const ToolPresetsPanel = lazyPanel(
  () => import("./panels/tool-presets-panel").then((m) => ({ default: m.ToolPresetsPanel })),
)

export type PanelStack = "upper" | "lower"
export type PanelDockMode = "expanded" | "compact" | "hidden"
export type PanelComplexity = "core" | "standard" | "advanced" | "specialized"
export type WorkspacePresetId = "essentials" | "photography" | "painting" | "web"

export const PANEL_CATEGORIES = [
  "Core",
  "Color and Assets",
  "Type and Vector",
  "Inspection and Guides",
  "Selection",
  "Motion and Automation",
  "Collaboration and Learning",
] as const

export type PanelCategory = (typeof PANEL_CATEGORIES)[number]

export interface PhotoshopPanelDefinition {
  id: string
  label: string
  stack: PanelStack
  category: PanelCategory
  complexity: PanelComplexity
  icon: React.ComponentType<{ className?: string }>
  keywords: string[]
  render: () => React.ReactNode
}

export interface WorkspacePanelPreset {
  id: WorkspacePresetId
  label: string
  topHeight: number
  dockWidth: number
  topActive: string
  bottomActive: string
  upperPinned: string[]
  lowerPinned: string[]
  mode: PanelDockMode
}

export const PANEL_DEFINITIONS: PhotoshopPanelDefinition[] = [
  { id: "color", label: "Color", stack: "upper", category: "Core", complexity: "core", icon: Palette, keywords: ["foreground", "background", "picker"], render: () => <ColorPanel /> },
  { id: "swatches", label: "Swatches", stack: "upper", category: "Color and Assets", complexity: "standard", icon: Grid3X3, keywords: ["palette", "colors", "preset"], render: () => <SwatchesPanel /> },
  { id: "gradients", label: "Gradients", stack: "upper", category: "Color and Assets", complexity: "standard", icon: CircleDot, keywords: ["gradient", "preset", "fill"], render: () => <GradientsPanel /> },
  { id: "patterns", label: "Patterns", stack: "upper", category: "Color and Assets", complexity: "standard", icon: Pipette, keywords: ["pattern", "texture", "fill"], render: () => <PatternsPanel /> },
  { id: "brush", label: "Brush", stack: "upper", category: "Core", complexity: "core", icon: Paintbrush, keywords: ["painting", "dynamics", "tip"], render: () => <BrushPanel /> },
  { id: "glyphs", label: "Glyphs", stack: "upper", category: "Type and Vector", complexity: "advanced", icon: Type, keywords: ["font", "typography", "characters"], render: () => <GlyphsPanel /> },
  { id: "styles", label: "Styles", stack: "upper", category: "Type and Vector", complexity: "standard", icon: Sparkles, keywords: ["effects", "layer fx", "preset"], render: () => <StylesPanel /> },
  { id: "shapes", label: "Shapes", stack: "upper", category: "Type and Vector", complexity: "standard", icon: CircleDot, keywords: ["vector", "shape", "custom"], render: () => <ShapesPanel /> },
  { id: "tool-presets", label: "Tool Setups", stack: "upper", category: "Core", complexity: "standard", icon: SlidersHorizontal, keywords: ["tool presets", "setups", "brush presets"], render: () => <ToolPresetsPanel /> },
  { id: "preset-manager", label: "Preset Manager", stack: "upper", category: "Color and Assets", complexity: "advanced", icon: Archive, keywords: ["preset", "manager", "brush", "swatches", "gradients", "patterns", "styles", "shapes", "assets"], render: () => <PresetManagerPanel /> },
  { id: "character", label: "Character", stack: "upper", category: "Type and Vector", complexity: "standard", icon: Type, keywords: ["font", "type", "text"], render: () => <CharacterPanel /> },
  { id: "paragraph", label: "Paragraph", stack: "upper", category: "Type and Vector", complexity: "standard", icon: AlignLeft, keywords: ["text", "type", "alignment"], render: () => <ParagraphPanel /> },
  { id: "navigator", label: "Navigator", stack: "upper", category: "Inspection and Guides", complexity: "standard", icon: Navigation, keywords: ["zoom", "pan", "view"], render: () => <NavigatorPanel /> },
  { id: "histogram", label: "Histogram", stack: "upper", category: "Inspection and Guides", complexity: "standard", icon: BarChart3, keywords: ["levels", "exposure", "photo"], render: () => <HistogramPanel /> },
  { id: "info", label: "Info", stack: "upper", category: "Inspection and Guides", complexity: "standard", icon: Info, keywords: ["readout", "coordinates", "sampler"], render: () => <InfoPanel /> },
  { id: "properties", label: "Properties", stack: "upper", category: "Core", complexity: "core", icon: SlidersHorizontal, keywords: ["layer", "document", "tool"], render: () => <PropertiesPanel /> },
  { id: "selection-studio", label: "Selection", stack: "upper", category: "Selection", complexity: "standard", icon: MousePointer2, keywords: ["select", "mask", "subject"], render: () => <SelectionStudioPanel /> },
  { id: "guides", label: "Guides", stack: "upper", category: "Inspection and Guides", complexity: "standard", icon: Ruler, keywords: ["grid", "rulers", "layout"], render: () => <GuidesPanel /> },
  { id: "adjustments", label: "Adjustments", stack: "upper", category: "Core", complexity: "core", icon: CircleDot, keywords: ["photo", "color", "tonal"], render: () => <AdjustmentsPanel /> },
  { id: "assets", label: "Assets", stack: "upper", category: "Color and Assets", complexity: "standard", icon: Archive, keywords: ["export", "library", "web"], render: () => <AssetsPanel /> },
  { id: "libraries", label: "Libraries", stack: "upper", category: "Color and Assets", complexity: "advanced", icon: Library, keywords: ["cloud", "assets", "stock"], render: () => <LibrariesPanel /> },
  { id: "learn", label: "Learn", stack: "upper", category: "Collaboration and Learning", complexity: "specialized", icon: BookOpen, keywords: ["tutorial", "help", "education"], render: () => <LearnPanel /> },
  { id: "discover", label: "Discover", stack: "upper", category: "Collaboration and Learning", complexity: "specialized", icon: Search, keywords: ["search", "learn", "help"], render: () => <DiscoverPanel /> },

  { id: "layers", label: "Layers", stack: "lower", category: "Core", complexity: "core", icon: Layers, keywords: ["layer", "stack", "visibility"], render: () => <LayersPanel /> },
  { id: "channels", label: "Channels", stack: "lower", category: "Core", complexity: "standard", icon: Eye, keywords: ["alpha", "rgb", "mask"], render: () => <ChannelsPanel /> },
  { id: "paths", label: "Paths", stack: "lower", category: "Type and Vector", complexity: "standard", icon: PenTool, keywords: ["vector", "pen", "path"], render: () => <PathsPanel /> },
  { id: "history", label: "History", stack: "lower", category: "Core", complexity: "core", icon: History, keywords: ["undo", "states", "snapshot"], render: () => <HistoryPanel /> },
  { id: "browser-diagnostics", label: "Browser Diagnostics", stack: "lower", category: "Inspection and Guides", complexity: "specialized", icon: Activity, keywords: ["diagnostics", "capabilities", "browser", "canvas", "webgl", "opfs", "mediarecorder", "encoder", "heap", "fallback"], render: () => <BrowserDiagnosticsPanel /> },
  { id: "accessibility-audit", label: "Accessibility Audit", stack: "lower", category: "Inspection and Guides", complexity: "specialized", icon: Activity, keywords: ["accessibility", "keyboard", "aria", "focus", "touch"], render: () => <AccessibilityAuditPanel /> },
  { id: "actions", label: "Actions", stack: "lower", category: "Motion and Automation", complexity: "standard", icon: Play, keywords: ["macro", "automation", "record"], render: () => <ActionsPanel /> },
  { id: "layer-comps", label: "Layer Comps", stack: "lower", category: "Core", complexity: "advanced", icon: Layers, keywords: ["compositions", "states", "presentation"], render: () => <LayerCompsPanel /> },
  { id: "clone-source", label: "Clone Source", stack: "lower", category: "Core", complexity: "advanced", icon: Stamp, keywords: ["clone", "stamp", "source"], render: () => <CloneSourcePanel /> },
  { id: "timeline", label: "Timeline", stack: "lower", category: "Motion and Automation", complexity: "advanced", icon: Play, keywords: ["video", "animation", "frames"], render: () => <TimelinePanel /> },
  { id: "animation", label: "Animation", stack: "lower", category: "Motion and Automation", complexity: "advanced", icon: Film, keywords: ["frames", "gif", "motion"], render: () => <AnimationPanel /> },
  { id: "comments", label: "Comments", stack: "lower", category: "Collaboration and Learning", complexity: "specialized", icon: MessageSquare, keywords: ["review", "collaboration", "notes"], render: () => <CommentsPanel /> },
  { id: "annotations", label: "Annotations", stack: "lower", category: "Collaboration and Learning", complexity: "specialized", icon: StickyNote, keywords: ["markup", "review", "notes"], render: () => <AnnotationsPanel /> },
  { id: "notes", label: "Notes", stack: "lower", category: "Collaboration and Learning", complexity: "specialized", icon: StickyNote, keywords: ["note", "document", "annotation"], render: () => <NotesPanel /> },
  { id: "measurement-log", label: "Measurement Log", stack: "lower", category: "Inspection and Guides", complexity: "specialized", icon: Ruler, keywords: ["measure", "count", "analysis"], render: () => <MeasurementLogPanel /> },
  { id: "slices", label: "Slices", stack: "lower", category: "Motion and Automation", complexity: "advanced", icon: Scissors, keywords: ["web", "export", "slice"], render: () => <SlicesPanel /> },
  { id: "scripting", label: "Scripting", stack: "lower", category: "Motion and Automation", complexity: "specialized", icon: Code2, keywords: ["automation", "code", "script"], render: () => <ScriptingPanel /> },
]

export const PANEL_BY_ID = new Map(PANEL_DEFINITIONS.map((panel) => [panel.id, panel]))

export const WORKSPACE_PRESETS: Record<WorkspacePresetId, WorkspacePanelPreset> = {
  essentials: {
    id: "essentials",
    label: "Essentials",
    topHeight: 360,
    dockWidth: 380,
    topActive: "color",
    bottomActive: "layers",
    upperPinned: ["color", "properties", "adjustments", "swatches"],
    lowerPinned: ["layers", "history", "channels", "paths"],
    mode: "expanded",
  },
  photography: {
    id: "photography",
    label: "Photography",
    topHeight: 400,
    dockWidth: 400,
    topActive: "histogram",
    bottomActive: "layers",
    upperPinned: ["histogram", "adjustments", "navigator", "info", "color"],
    lowerPinned: ["layers", "history", "channels", "actions"],
    mode: "expanded",
  },
  painting: {
    id: "painting",
    label: "Painting",
    topHeight: 420,
    dockWidth: 380,
    topActive: "brush",
    bottomActive: "layers",
    upperPinned: ["brush", "tool-presets", "color", "swatches"],
    lowerPinned: ["layers", "history", "actions"],
    mode: "expanded",
  },
  web: {
    id: "web",
    label: "Web",
    topHeight: 380,
    dockWidth: 400,
    topActive: "assets",
    bottomActive: "layers",
    upperPinned: ["assets", "properties", "guides", "slices"],
    lowerPinned: ["layers", "layer-comps", "comments"],
    mode: "expanded",
  },
}

export const WORKSPACE_PRESET_OPTIONS = Object.values(WORKSPACE_PRESETS)

export function panelsForStack(stack: PanelStack) {
  return PANEL_DEFINITIONS.filter((panel) => panel.stack === stack)
}

export function panelById(id: string) {
  return PANEL_BY_ID.get(id)
}

export function panelsByCategory(panels: readonly PhotoshopPanelDefinition[] = PANEL_DEFINITIONS) {
  return PANEL_CATEGORIES.map((category) => ({
    category,
    panels: panels.filter((panel) => panel.category === category),
  })).filter((group) => group.panels.length > 0)
}
