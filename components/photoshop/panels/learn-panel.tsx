"use client"

import * as React from "react"
import { BookOpen, ChevronRight, Keyboard, Lightbulb, Layers, MousePointer2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEditor } from "../editor-context"
import { dispatchPhotoshopEvent } from "../events"
import { computeContextualHelp, type HelpTip } from "../contextual-help"
import { FILTERS } from "../filters"
import {
  buildLearningIndex,
  runLearningIndexItem,
} from "../learning-index"
import { LEARNING_PANEL_SOURCES } from "../learning-panel-sources"
import { WORKFLOW_PACKS } from "../workflow-presets"

interface LearnGuide {
  id: string
  title: string
  category: string
  summary: string
  relatedPanel?: string
  action?: { label: string; event: string; detail?: unknown }
  steps: string[]
}

const WORKFLOW_PACK_GUIDES: LearnGuide[] = WORKFLOW_PACKS.map((pack) => ({
  id: `guide-${pack.id}`,
  title: pack.shortTitle,
  category: pack.category,
  summary: pack.summary,
  action: { label: "Open workflow", event: "ps-open-workflow-pack", detail: { id: pack.id } },
  steps: pack.steps.map((step) => step.title),
}))

const LEARN_GUIDES: LearnGuide[] = [
  ...WORKFLOW_PACK_GUIDES,
  {
    id: "glyphs-special-characters",
    title: "Insert special characters",
    category: "Type",
    summary: "Browse Unicode blocks or embedded font cmaps, then append a glyph to the active text layer.",
    relatedPanel: "glyphs",
    steps: [
      "Select a text layer so the Glyphs panel can read the active font.",
      "Choose Active embedded font cmap when the document includes embedded font bytes, or pick a Unicode block.",
      "Search by name, character, decimal codepoint, or hex code, then click a glyph to append it.",
      "Use Recents for repeated marks, currency symbols, alternates, or punctuation.",
    ],
  },
  {
    id: "libraries-place-asset",
    title: "Place a library asset",
    category: "Assets",
    summary: "Import local image assets, keep searchable metadata, and place them as smart objects or pixels.",
    relatedPanel: "libraries",
    steps: [
      "Open Libraries, then import image files or save the active layer into the local browser library.",
      "Filter by name, group, description, or tags to find the reusable asset.",
      "Choose whether placement creates an embedded smart object or a raster layer.",
      "Double-click Place from the metadata area, or drag the asset tile as a placement source.",
    ],
  },
  {
    id: "notes-review-pass",
    title: "Run a note review pass",
    category: "Review",
    summary: "Use document notes for lightweight sticky-note review separate from geometric annotations.",
    relatedPanel: "notes",
    steps: [
      "Set your author name so new notes and replies are attributable.",
      "Add a sticky note, then use Go to when you need to return to its canvas position.",
      "Filter by author and date bucket during review handoff.",
      "Reply, edit, or delete notes without mixing them into annotation geometry threads.",
    ],
  },
  {
    id: "discover-command-search",
    title: "Find commands and panels",
    category: "Discovery",
    summary: "Use Discover as the searchable command, panel, tool, filter, and workflow index.",
    relatedPanel: "discover",
    steps: [
      "Open Discover from the panel browser or a Learn more link.",
      "Search for a task, command, panel, tool, filter, or workflow phrase.",
      "Narrow the result type with the filter chips.",
      "Run a result to open its panel, command surface, or filter workflow.",
    ],
  },
]

export function LearnPanel() {
  const { tool, activeDoc } = useEditor()
  const [activeGuideId, setActiveGuideId] = React.useState(LEARN_GUIDES[0].id)
  const help = React.useMemo(
    () => computeContextualHelp({
      toolId: tool,
      selection: activeDoc?.selection ?? null,
      doc: activeDoc,
    }),
    [tool, activeDoc],
  )
  const lessons = React.useMemo(() => {
    const learningIndex = buildLearningIndex({
      panels: LEARNING_PANEL_SOURCES,
      filters: Object.values(FILTERS).slice(0, 60),
    })
    return learningIndex
      .filter((item) => item.type === "workflow" || item.type === "doc" || item.type === "command")
      .slice(0, 12)
  }, [])
  const activeGuide = LEARN_GUIDES.find((guide) => guide.id === activeGuideId) ?? LEARN_GUIDES[0]

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
          <BookOpen className="h-3 w-3" /> Contextual help
        </div>
        <div className="mt-1 text-[var(--ps-text)]">
          Tool: <span className="font-mono">{tool}</span>
          {activeDoc ? <> - {activeDoc.colorMode?.toUpperCase() ?? "RGB"} - {activeDoc.layers.length} layers</> : null}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[104px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-r border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-1">
          <div className="mb-1 px-1 text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">Guides</div>
          <div className="space-y-1">
            {LEARN_GUIDES.map((guide) => (
              <button
                key={guide.id}
                type="button"
                onClick={() => setActiveGuideId(guide.id)}
                className={`w-full rounded-sm border px-1.5 py-1 text-left text-[10px] leading-tight ${
                  guide.id === activeGuide.id
                    ? "border-[var(--ps-accent,#3b82f6)] bg-[var(--ps-panel-2)] text-[var(--ps-text)]"
                    : "border-transparent text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                }`}
              >
                <span className="block truncate">{guide.title}</span>
                <span className="block truncate text-[9px] uppercase">{guide.category}</span>
              </button>
            ))}
          </div>
        </aside>
        <div className="min-h-0 space-y-3 overflow-auto p-2">
          <Section title="Selected guide" icon={<BookOpen className="h-3 w-3" />}>
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
              <div className="text-[11px] text-[var(--ps-text)]">{activeGuide.title}</div>
              <p className="mt-0.5 text-[10px] text-[var(--ps-text-dim)]">{activeGuide.summary}</p>
              <ol className="mt-2 space-y-1">
                {activeGuide.steps.map((step, index) => (
                  <li key={step} className="grid grid-cols-[18px_1fr] gap-1 text-[10px] text-[var(--ps-text-dim)]">
                    <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[9px] tabular-nums">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-6 gap-1 px-2 text-[10px]"
                onClick={() => {
                  if (activeGuide.action) {
                    window.dispatchEvent(new CustomEvent(activeGuide.action.event, { detail: activeGuide.action.detail }))
                    return
                  }
                  if (activeGuide.relatedPanel) dispatchPhotoshopEvent("ps-open-panel", activeGuide.relatedPanel)
                }}
              >
                {activeGuide.action?.label ?? `Open ${activeGuide.relatedPanel?.replace(/-/g, " ") ?? "related"} panel`} <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </Section>
          <Section title="For this tool" icon={<MousePointer2 className="h-3 w-3" />}>
            {help.toolTips.map((tip) => <TipCard key={tip.id} tip={tip} />)}
          </Section>
          <Section title="Selection" icon={<Lightbulb className="h-3 w-3" />}>
            {help.selectionTips.map((tip) => <TipCard key={tip.id} tip={tip} />)}
          </Section>
          <Section title="Document" icon={<Layers className="h-3 w-3" />}>
            {help.documentTips.map((tip) => <TipCard key={tip.id} tip={tip} />)}
          </Section>
          <Section title="Quick tips" icon={<Keyboard className="h-3 w-3" />}>
            {help.fallback.map((tip) => <TipCard key={tip.id} tip={tip} />)}
          </Section>
          {lessons.length ? (
            <Section title="Featured lessons" icon={<BookOpen className="h-3 w-3" />}>
              <div className="space-y-1">
                {lessons.map((lesson) => (
                  <button
                    key={lesson.id}
                    type="button"
                    onClick={() => runLearningIndexItem(lesson)}
                    className="flex w-full items-center justify-between gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                  >
                    <span className="truncate">
                      <span className="text-[var(--ps-text)]">{lesson.title}</span>
                      <span className="text-[10px] text-[var(--ps-text-dim)]"> - {lesson.category}</span>
                    </span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-[var(--ps-text-dim)]" />
                  </button>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
        {icon} {title}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function TipCard({ tip }: { tip: HelpTip }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-[11px] text-[var(--ps-text)]">{tip.title}</div>
          <div className="mt-0.5 text-[10px] text-[var(--ps-text-dim)]">{tip.body}</div>
        </div>
        {tip.shortcut ? (
          <span className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text-dim)]">
            {tip.shortcut}
          </span>
        ) : null}
      </div>
      {tip.relatedPanel ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 h-6 gap-1 px-2 text-[10px]"
          onClick={() => dispatchPhotoshopEvent("ps-open-panel", tip.relatedPanel!)}
        >
          Open {tip.relatedPanel.replace(/-/g, " ")} panel <ChevronRight className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  )
}

export const __learnPanelInternals = {
  LEARN_GUIDES,
}
