"use client"

import * as React from "react"
import { LayersPanel } from "./panels/layers-panel"
import { ChannelsPanel } from "./panels/channels-panel"
import { PathsPanel } from "./panels/paths-panel"
import { ColorPanel } from "./panels/color-panel"
import { SwatchesPanel } from "./panels/swatches-panel"
import { PatternsPanel } from "./panels/patterns-panel"
import { GradientsPanel } from "./panels/gradients-panel"
import { HistoryPanel } from "./panels/history-panel"
import { PropertiesPanel } from "./panels/properties-panel"
import { BrushPanel } from "./panels/brush-panel"
import { HistogramPanel, InfoPanel, NavigatorPanel } from "./panels/inspection-panels"
import { CharacterPanel, ParagraphPanel } from "./panels/character-paragraph-panels"
import { ActionsPanel } from "./panels/actions-panel"
import { AdjustmentsPanel } from "./panels/adjustments-panel"
import { AssetsPanel } from "./panels/assets-panel"
import { TimelinePanel } from "./panels/timeline-panel"
import { ScriptingPanel } from "./panels/scripting-panel"
import { SelectionStudioPanel } from "./panels/selection-studio-panel"
import { AnnotationsPanel } from "./panels/annotations-panel"
import { GuidesPanel } from "./panels/guides-panel"
import { SlicesPanel } from "./panels/slices-panel"
import { ToolPresetsPanel } from "./panels/tool-presets-panel"
import { CloneSourcePanel } from "./panels/clone-source-panel"
import { LayerCompsPanel } from "./panels/layer-comps-panel"
import {
  AnimationPanel,
  CommentsPanel,
  DiscoverPanel,
  GlyphsPanel,
  LearnPanel,
  LibrariesPanel,
  MeasurementLogPanel,
  NotesPanel,
  ShapesPanel,
  StylesPanel,
} from "./panels/gap-panels"
import { cn } from "@/lib/utils"
import { Archive, BarChart3, BookOpen, ChevronDown, ChevronUp, Code2, Eye, Film, Info, Layers, Library, Maximize2, MessageSquare, Minimize2, Navigation, Palette, History, Search, SlidersHorizontal, Paintbrush, PenTool, Grid3X3, Pipette, CircleDot, Type, AlignLeft, Play, MousePointer2, StickyNote, Ruler, Scissors, Sparkles, Stamp } from "lucide-react"

interface PanelGroup {
  defaultTab: string
  tabs: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; render: () => React.ReactNode }[]
}

const TOP: PanelGroup = {
  defaultTab: "color",
  tabs: [
    { id: "color", label: "Color", icon: Palette, render: () => <ColorPanel /> },
    { id: "swatches", label: "Swatches", icon: Grid3X3, render: () => <SwatchesPanel /> },
    { id: "gradients", label: "Gradients", icon: CircleDot, render: () => <GradientsPanel /> },
    { id: "patterns", label: "Patterns", icon: Pipette, render: () => <PatternsPanel /> },
    { id: "brush", label: "Brush", icon: Paintbrush, render: () => <BrushPanel /> },
    { id: "glyphs", label: "Glyphs", icon: Type, render: () => <GlyphsPanel /> },
    { id: "styles", label: "Styles", icon: Sparkles, render: () => <StylesPanel /> },
    { id: "shapes", label: "Shapes", icon: CircleDot, render: () => <ShapesPanel /> },
    { id: "tool-presets", label: "Tool Setups", icon: SlidersHorizontal, render: () => <ToolPresetsPanel /> },
    { id: "character", label: "Character", icon: Type, render: () => <CharacterPanel /> },
    { id: "paragraph", label: "Paragraph", icon: AlignLeft, render: () => <ParagraphPanel /> },
    { id: "navigator", label: "Navigator", icon: Navigation, render: () => <NavigatorPanel /> },
    { id: "histogram", label: "Histogram", icon: BarChart3, render: () => <HistogramPanel /> },
    { id: "info", label: "Info", icon: Info, render: () => <InfoPanel /> },
    { id: "properties", label: "Properties", icon: SlidersHorizontal, render: () => <PropertiesPanel /> },
    { id: "selection-studio", label: "Selection", icon: MousePointer2, render: () => <SelectionStudioPanel /> },
    { id: "guides", label: "Guides", icon: Ruler, render: () => <GuidesPanel /> },
    { id: "adjustments", label: "Adjustments", icon: CircleDot, render: () => <AdjustmentsPanel /> },
    { id: "assets", label: "Assets", icon: Archive, render: () => <AssetsPanel /> },
    { id: "libraries", label: "Libraries", icon: Library, render: () => <LibrariesPanel /> },
    { id: "learn", label: "Learn", icon: BookOpen, render: () => <LearnPanel /> },
    { id: "discover", label: "Discover", icon: Search, render: () => <DiscoverPanel /> },
  ],
}

const BOTTOM: PanelGroup = {
  defaultTab: "layers",
  tabs: [
    { id: "layers", label: "Layers", icon: Layers, render: () => <LayersPanel /> },
    { id: "channels", label: "Channels", icon: Eye, render: () => <ChannelsPanel /> },
    { id: "paths", label: "Paths", icon: PenTool, render: () => <PathsPanel /> },
    { id: "history", label: "History", icon: History, render: () => <HistoryPanel /> },
    { id: "actions", label: "Actions", icon: Play, render: () => <ActionsPanel /> },
    { id: "layer-comps", label: "Layer Comps", icon: Layers, render: () => <LayerCompsPanel /> },
    { id: "clone-source", label: "Clone Source", icon: Stamp, render: () => <CloneSourcePanel /> },
    { id: "timeline", label: "Timeline", icon: Play, render: () => <TimelinePanel /> },
    { id: "animation", label: "Animation", icon: Film, render: () => <AnimationPanel /> },
    { id: "comments", label: "Comments", icon: MessageSquare, render: () => <CommentsPanel /> },
    { id: "annotations", label: "Annotations", icon: StickyNote, render: () => <AnnotationsPanel /> },
    { id: "notes", label: "Notes", icon: StickyNote, render: () => <NotesPanel /> },
    { id: "measurement-log", label: "Measurement Log", icon: Ruler, render: () => <MeasurementLogPanel /> },
    { id: "slices", label: "Slices", icon: Scissors, render: () => <SlicesPanel /> },
    { id: "scripting", label: "Scripting", icon: Code2, render: () => <ScriptingPanel /> },
  ],
}
import { ResizeHandle } from "./resize-handle"

interface WorkspaceLayout {
  name: string
  topHeight: number
  dockWidth: number
  topTab: string
  bottomTab: string
  savedAt: number
}

const WORKSPACES_KEY = "ps-workspaces-v1"

function readWorkspaces(): WorkspaceLayout[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACES_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeWorkspaces(workspaces: WorkspaceLayout[]) {
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces))
  window.dispatchEvent(new CustomEvent("ps-workspaces-changed", { detail: workspaces }))
}

const WORKSPACE_PRESETS: Record<string, WorkspaceLayout> = {
  essentials: { name: "Essentials", topHeight: 380, dockWidth: 380, topTab: "color", bottomTab: "layers", savedAt: 0 },
  photography: { name: "Photography", topHeight: 400, dockWidth: 400, topTab: "histogram", bottomTab: "layers", savedAt: 0 },
  painting: { name: "Painting", topHeight: 420, dockWidth: 380, topTab: "brush", bottomTab: "actions", savedAt: 0 },
}

const TOP_MIN_HEIGHT = 220
const BOTTOM_MIN_HEIGHT = 180
const SPLITTER_HEIGHT = 12

export function PanelDock({ width }: { width?: number }) {
  const dockRef = React.useRef<HTMLDivElement>(null)
  const [dockHeight, setDockHeight] = React.useState(0)
  const [topHeight, setTopHeight] = React.useState(380)
  const [topActive, setTopActive] = React.useState(TOP.defaultTab)
  const [bottomActive, setBottomActive] = React.useState(BOTTOM.defaultTab)
  const [solo, setSolo] = React.useState<"top" | "bottom" | null>(null)
  const topHeightRef = React.useRef(topHeight)
  const topActiveRef = React.useRef(topActive)
  const bottomActiveRef = React.useRef(bottomActive)
  const widthRef = React.useRef(width)
  const topMax = dockHeight > 0 ? Math.max(TOP_MIN_HEIGHT, dockHeight - BOTTOM_MIN_HEIGHT - SPLITTER_HEIGHT) : 720
  const clampTopHeight = React.useCallback(
    (value: number) => Math.max(TOP_MIN_HEIGHT, Math.min(topMax, value)),
    [topMax],
  )

  const applyLayout = React.useCallback((layout: WorkspaceLayout) => {
    setTopHeight(clampTopHeight(layout.topHeight))
    if (TOP.tabs.some((tab) => tab.id === layout.topTab)) setTopActive(layout.topTab)
    if (BOTTOM.tabs.some((tab) => tab.id === layout.bottomTab)) setBottomActive(layout.bottomTab)
    if (Number.isFinite(layout.dockWidth)) {
      window.dispatchEvent(new CustomEvent("ps-set-dock-width", { detail: layout.dockWidth }))
    }
  }, [clampTopHeight])

  React.useEffect(() => {
    topHeightRef.current = topHeight
  }, [topHeight])

  React.useEffect(() => {
    topActiveRef.current = topActive
  }, [topActive])

  React.useEffect(() => {
    bottomActiveRef.current = bottomActive
  }, [bottomActive])

  React.useEffect(() => {
    widthRef.current = width
  }, [width])

  const saveTopHeight = React.useCallback(() => {
    try { localStorage.setItem("ps-panel-split", String(topHeightRef.current)) } catch { }
  }, [])

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("ps-panel-split")
      const parsed = Number(saved)
      if (Number.isFinite(parsed)) setTopHeight(Math.max(TOP_MIN_HEIGHT, parsed))
    } catch { }
  }, [])

  const resizePanelSplit = React.useCallback(
    (delta: number) => {
      setTopHeight((height) => clampTopHeight(height + delta))
    },
    [clampTopHeight],
  )

  React.useEffect(() => {
    const openPanel = (event: Event) => {
      const id = String((event as CustomEvent).detail ?? "")
      if (TOP.tabs.some((tab) => tab.id === id)) setTopActive(id)
      if (BOTTOM.tabs.some((tab) => tab.id === id)) setBottomActive(id)
    }
    const saveWorkspace = (event: Event) => {
      const name = String((event as CustomEvent).detail?.name ?? "").trim()
      if (!name) return
      const workspaces = readWorkspaces().filter((workspace) => workspace.name.toLowerCase() !== name.toLowerCase())
      workspaces.push({
        name,
        topHeight: topHeightRef.current,
        dockWidth: widthRef.current ?? 380,
        topTab: topActiveRef.current,
        bottomTab: bottomActiveRef.current,
        savedAt: Date.now(),
      })
      writeWorkspaces(workspaces.sort((a, b) => a.name.localeCompare(b.name)))
    }
    const applyWorkspace = (event: Event) => {
      const name = String((event as CustomEvent).detail?.name ?? "")
      const layout = readWorkspaces().find((workspace) => workspace.name === name)
      if (layout) applyLayout(layout)
    }
    const deleteWorkspace = (event: Event) => {
      const name = String((event as CustomEvent).detail?.name ?? "")
      writeWorkspaces(readWorkspaces().filter((workspace) => workspace.name !== name))
    }
    const applyPreset = (event: Event) => {
      const preset = String((event as CustomEvent).detail?.preset ?? "essentials")
      applyLayout(WORKSPACE_PRESETS[preset] ?? WORKSPACE_PRESETS.essentials)
    }
    window.addEventListener("ps-open-panel", openPanel)
    window.addEventListener("ps-switch-panel", openPanel)
    window.addEventListener("ps-save-workspace", saveWorkspace)
    window.addEventListener("ps-apply-workspace", applyWorkspace)
    window.addEventListener("ps-delete-workspace", deleteWorkspace)
    window.addEventListener("ps-apply-workspace-preset", applyPreset)
    return () => {
      window.removeEventListener("ps-open-panel", openPanel)
      window.removeEventListener("ps-switch-panel", openPanel)
      window.removeEventListener("ps-save-workspace", saveWorkspace)
      window.removeEventListener("ps-apply-workspace", applyWorkspace)
      window.removeEventListener("ps-delete-workspace", deleteWorkspace)
      window.removeEventListener("ps-apply-workspace-preset", applyPreset)
    }
  }, [applyLayout])

  React.useEffect(() => {
    const node = dockRef.current
    if (!node) return
    const update = () => setDockHeight(node.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [])

  React.useEffect(() => {
    setTopHeight((height) => clampTopHeight(height))
  }, [clampTopHeight])

  return (
    <div
      ref={dockRef}
      className="shrink-0 bg-[var(--ps-panel)] border-l border-[var(--ps-divider)] flex flex-col select-none"
      style={{ width: width ?? 380 }}
    >
      {solo !== "bottom" ? (
        <PanelGroupView
          label="Upper"
          group={TOP}
          flex={solo === "top"}
          height={solo === "top" ? undefined : topHeight}
          active={topActive}
          onActiveChange={setTopActive}
          isSolo={solo === "top"}
          onToggleSolo={() => setSolo(solo === "top" ? null : "top")}
        />
      ) : null}
      {solo === null ? (
        <ResizeHandle
          direction="vertical"
          className="h-3 bg-[var(--ps-divider)]/80 hover:bg-[var(--ps-accent)]/50"
          onResize={resizePanelSplit}
          onResizeEnd={saveTopHeight}
        />
      ) : null}
      {solo !== "top" ? (
        <PanelGroupView
          label="Lower"
          group={BOTTOM}
          flex={true}
          active={bottomActive}
          onActiveChange={setBottomActive}
          isSolo={solo === "bottom"}
          onToggleSolo={() => setSolo(solo === "bottom" ? null : "bottom")}
        />
      ) : null}
    </div>
  )
}

function PanelGroupView({
  label,
  group,
  flex,
  height,
  active,
  onActiveChange,
  isSolo,
  onToggleSolo,
}: {
  label: string
  group: PanelGroup
  flex: boolean
  height?: number
  active: string
  onActiveChange: (id: string) => void
  isSolo: boolean
  onToggleSolo: () => void
}) {
  const [showBrowser, setShowBrowser] = React.useState(true)
  const tab = group.tabs.find((t) => t.id === active) ?? group.tabs[0]
  const selectPanel = React.useCallback(
    (id: string) => {
      if (!group.tabs.some((candidate) => candidate.id === id)) return
      onActiveChange(id)
    },
    [group.tabs, onActiveChange],
  )
  const handleSelectPanel = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement> | React.FormEvent<HTMLSelectElement>) => {
      selectPanel(event.currentTarget.value)
    },
    [selectPanel],
  )

  return (
    <div
      className={cn("flex flex-col bg-[var(--ps-panel)] min-h-0", flex && "flex-1")}
      style={!flex ? { height } : undefined}
    >
      {/* ---- Header: compact icon strip ---- */}
      <div className="bg-[var(--ps-chrome)] border-b border-[var(--ps-divider)] px-1 py-1">
        <div className="flex items-center gap-1">
          <select
            aria-label={`${label} panel picker`}
            value={active}
            onInput={handleSelectPanel}
            onChange={handleSelectPanel}
            className="h-6 max-w-[128px] shrink-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[11px] text-[var(--ps-text)]"
          >
            {group.tabs.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          {/* Icon strip — scrollable single row of icons for quick switching */}
          <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {group.tabs.map((t) => {
              const isActive = t.id === active
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-label={t.label}
                  title={t.label}
                  onClick={() => {
                    selectPanel(t.id)
                    if (label === "Upper" && t.id === "patterns") setShowBrowser(false)
                  }}
                  className={cn(
                    "flex shrink-0 h-6 w-6 items-center justify-center rounded-sm transition-colors",
                    isActive
                      ? "bg-[var(--ps-tool-active)] text-[var(--ps-text)] ring-1 ring-[var(--ps-accent)]"
                      : "text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]",
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                </button>
              )
            })}
          </div>
          <button
            type="button"
            aria-label={showBrowser ? `Hide ${label} panel browser` : `Show ${label} panel browser`}
            title={showBrowser ? "Hide panel browser" : "Show panel browser"}
            onClick={() => setShowBrowser((value) => !value)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            {showBrowser ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button
            type="button"
            aria-label={isSolo ? `Restore ${label} panel stack` : `Maximize ${label} panel stack`}
            title={isSolo ? "Restore split panels" : "Maximize this panel stack"}
            onClick={onToggleSolo}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            {isSolo ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        </div>
        {/* Expanded browser grid — hidden by default */}
        {showBrowser ? (
          <div
            className="mt-1 grid gap-1"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))" }}
          >
            {group.tabs.map((t) => {
              const isActive = t.id === active
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-label={`Open ${t.label} panel`}
                  title={t.label}
                  onClick={() => { selectPanel(t.id); setShowBrowser(false) }}
                  className={cn(
                    "flex h-7 min-w-0 items-center gap-1.5 rounded-sm border px-2 text-left text-[11px]",
                    isActive
                      ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)] text-[var(--ps-text)]"
                      : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]",
                  )}
                >
                  <t.icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowBrowser(true)}
            className="mt-1 h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-left text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            Show all panels
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden overflow-y-auto">{tab.render()}</div>
    </div>
  )
}
