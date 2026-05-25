export type LearningIndexType = "command" | "doc" | "filter" | "panel" | "workflow"

export interface LearningIndexItem {
  id: string
  type: LearningIndexType
  title: string
  category: string
  description: string
  keywords: string[]
  action?: {
    kind: "event" | "panel" | "filter"
    target: string
    detail?: unknown
  }
}

export interface LearningPanelSource {
  id: string
  label: string
  category: string
  complexity?: string
  keywords?: string[]
}

export interface LearningFilterSource {
  id: string
  name: string
  category: string
  description?: string
}

export interface LearningIndexSources {
  panels?: LearningPanelSource[]
  filters?: LearningFilterSource[]
}

const COMMAND_ITEMS: LearningIndexItem[] = [
  {
    id: "command-export-as",
    type: "command",
    title: "Export As",
    category: "File",
    description: "Export the active document to browser image formats with scale, quality, matte, and metadata options.",
    keywords: ["save", "png", "jpeg", "webp", "asset", "delivery"],
    action: { kind: "event", target: "ps-open-export-as" },
  },
  {
    id: "command-preflight",
    type: "command",
    title: "Preflight Check",
    category: "File",
    description: "Review document risks before export, print handoff, or compatibility checks.",
    keywords: ["report", "print", "quality", "inspect"],
    action: { kind: "event", target: "ps-open-preflight" },
  },
  {
    id: "command-command-palette",
    type: "command",
    title: "Command Palette",
    category: "Edit",
    description: "Search and run editor commands, panels, tools, filters, and plugin commands.",
    keywords: ["search", "commands", "discover", "ctrl-k"],
    action: { kind: "event", target: "ps-open-command-palette" },
  },
]

const DOC_ITEMS: LearningIndexItem[] = [
  {
    id: "doc-project-files",
    type: "doc",
    title: "Project File Format",
    category: "Docs",
    description: "Project files preserve app-only layers, asset libraries, comments, annotations, reports, and local metadata.",
    keywords: ["project", "file", "docs", "psproj", "round-trip"],
  },
  {
    id: "doc-panels",
    type: "doc",
    title: "Panel Registry",
    category: "Docs",
    description: "Panels are indexed through the registry for workspaces, commands, Learn, and Discover.",
    keywords: ["panel", "workspace", "dock", "docs"],
  },
  {
    id: "doc-browser-limits",
    type: "doc",
    title: "Browser Limits",
    category: "Docs",
    description: "Explains local canvas, PSD, raster, color, and metadata boundaries in the browser editor.",
    keywords: ["compatibility", "limits", "metadata", "reports"],
  },
]

const WORKFLOW_ITEMS: LearningIndexItem[] = [
  {
    id: "workflow-review-export",
    type: "workflow",
    title: "Export Review Report",
    category: "Collaboration",
    description: "Create an audit-ready text report from open and resolved comments, replies, tags, and annotation geometry.",
    keywords: ["comments", "annotations", "review", "report", "export", "thread"],
    action: { kind: "panel", target: "comments" },
  },
  {
    id: "workflow-local-library",
    type: "workflow",
    title: "Import Local Library Bundle",
    category: "Assets",
    description: "Move project-local brushes, swatches, gradients, styles, export presets, and tagged assets between files.",
    keywords: ["assets", "library", "bundle", "tags", "import", "export"],
    action: { kind: "panel", target: "assets" },
  },
  {
    id: "workflow-selection-mask",
    type: "workflow",
    title: "Refine a Selection Mask",
    category: "Selection",
    description: "Use object selection, quick selection, selection studio, and Select and Mask to refine cutouts.",
    keywords: ["mask", "selection", "subject", "edge"],
    action: { kind: "panel", target: "selection-studio" },
  },
]

export function buildLearningIndex(sources: LearningIndexSources = {}): LearningIndexItem[] {
  const panels = (sources.panels ?? []).map<LearningIndexItem>((panel) => ({
    id: `panel-${panel.id}`,
    type: "panel",
    title: `${panel.label} Panel`,
    category: panel.category,
    description: `${panel.label} panel for ${panel.category.toLowerCase()} workflows.`,
    keywords: [panel.complexity ?? "", ...(panel.keywords ?? [])].filter(Boolean),
    action: { kind: "panel", target: panel.id },
  }))
  const filters = (sources.filters ?? []).map<LearningIndexItem>((filter) => ({
    id: `filter-${filter.id}`,
    type: "filter",
    title: filter.name,
    category: filter.category,
    description: filter.description ?? `${filter.name} filter in ${filter.category}.`,
    keywords: [filter.category, "filter"],
    action: { kind: "filter", target: filter.id },
  }))
  return [...COMMAND_ITEMS, ...DOC_ITEMS, ...WORKFLOW_ITEMS, ...panels, ...filters]
}

export function searchLearningIndex(items: LearningIndexItem[], query: string, options: { limit?: number } = {}) {
  const terms = tokenize(query)
  const limit = options.limit ?? 40
  const scored = items
    .map((item, index) => ({ item, index, score: scoreLearningItem(item, terms) }))
    .filter((entry) => !terms.length || entry.score > 0)
    .sort((a, b) => b.score - a.score || typePriority(a.item.type) - typePriority(b.item.type) || a.index - b.index)
  return scored.slice(0, limit).map((entry) => entry.item)
}

export function runLearningIndexItem(item: LearningIndexItem) {
  if (typeof window === "undefined" || !item.action) return
  if (item.action.kind === "panel") {
    window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: item.action.target }))
    return
  }
  if (item.action.kind === "filter") {
    window.dispatchEvent(new CustomEvent("ps-open-filter", { detail: item.action.target }))
    return
  }
  window.dispatchEvent(new CustomEvent(item.action.target, item.action.detail === undefined ? undefined : { detail: item.action.detail }))
}

function scoreLearningItem(item: LearningIndexItem, terms: string[]) {
  if (!terms.length) return typePriority(item.type) === 0 ? 8 : 4
  const title = item.title.toLowerCase()
  const category = item.category.toLowerCase()
  const keywords = item.keywords.join(" ").toLowerCase()
  const description = item.description.toLowerCase()
  const haystack = `${title} ${category} ${keywords} ${description}`
  if (!terms.every((term) => haystack.includes(term))) return 0
  let score = 0
  for (const term of terms) {
    if (title.includes(term)) score += 12
    if (keywords.includes(term)) score += 8
    if (category.includes(term)) score += 5
    if (description.includes(term)) score += 2
  }
  if (item.type === "workflow") score += 2
  if (item.type === "panel" && terms.includes("panel")) score += 6
  return score
}

function tokenize(query: string) {
  return query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean)
}

function typePriority(type: LearningIndexType) {
  switch (type) {
    case "workflow":
      return 0
    case "command":
      return 1
    case "panel":
      return 2
    case "filter":
      return 3
    case "doc":
    default:
      return 4
  }
}
