"use client"

import * as React from "react"
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronsLeft,
  ChevronUp,
  Columns3,
  GripVertical,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pin,
  PinOff,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ResizeHandle } from "./resize-handle"
import {
  PANEL_CATEGORIES,
  PANEL_DEFINITIONS,
  WORKSPACE_PRESETS,
  panelById,
  panelsByCategory,
  panelsForStack,
  type PanelDockMode,
  type PanelStack,
  type PhotoshopPanelDefinition,
  type WorkspacePanelPreset,
  type WorkspacePresetId,
} from "./panel-registry"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "./events"

const DOCK_STATE_KEY = "ps-panel-dock-state-v2"
const WORKSPACES_KEY = "ps-workspaces-v2"
const LEGACY_WORKSPACES_KEY = "ps-workspaces-v1"
const CURRENT_WORKSPACE_KEY = "ps-current-workspace-preset"
const TOP_MIN_HEIGHT = 78
const BOTTOM_MIN_HEIGHT = 78
const SPLITTER_HEIGHT = 12
const SPLIT_SNAP_DISTANCE = 44

interface WorkspaceLayout {
  name: string
  topHeight: number
  dockWidth: number
  topTab: string
  bottomTab: string
  upperPinned: string[]
  lowerPinned: string[]
  dockMode: PanelDockMode
  upperHidden?: boolean
  savedAt: number
}

interface SavedDockState {
  topHeight?: number
  topActive?: string
  bottomActive?: string
  upperPinned?: string[]
  lowerPinned?: string[]
  mode?: PanelDockMode
  recentPanels?: string[]
  upperHidden?: boolean
}

const upperPanels = panelsForStack("upper")
const lowerPanels = panelsForStack("lower")

function isDockMode(value: unknown): value is PanelDockMode {
  return value === "expanded" || value === "compact" || value === "hidden"
}

function validPanelIds(stack: PanelStack) {
  return new Set(panelsForStack(stack).map((panel) => panel.id))
}

function normalizePinned(stack: PanelStack, ids: unknown, fallback: readonly string[]) {
  const valid = validPanelIds(stack)
  const source = Array.isArray(ids) ? ids : fallback
  const normalized = source
    .map((id) => String(id))
    .filter((id, index, list) => valid.has(id) && list.indexOf(id) === index)
  return normalized.length ? normalized : fallback.filter((id) => valid.has(id))
}

function readDockState(): SavedDockState | null {
  if (typeof window === "undefined") return null
  try {
    const parsed = JSON.parse(localStorage.getItem(DOCK_STATE_KEY) ?? "null")
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function normalizeWorkspaceLayout(input: unknown): WorkspaceLayout | null {
  if (!input || typeof input !== "object") return null
  const source = input as Partial<WorkspaceLayout> & {
    topTab?: unknown
    bottomTab?: unknown
    topActive?: unknown
    bottomActive?: unknown
    mode?: unknown
  }
  const name = String(source.name ?? "").trim()
  if (!name) return null
  const topTab = String(source.topTab ?? source.topActive ?? WORKSPACE_PRESETS.essentials.topActive)
  const bottomTab = String(source.bottomTab ?? source.bottomActive ?? WORKSPACE_PRESETS.essentials.bottomActive)
  return {
    name,
    topHeight: Number.isFinite(Number(source.topHeight)) ? Number(source.topHeight) : WORKSPACE_PRESETS.essentials.topHeight,
    dockWidth: Number.isFinite(Number(source.dockWidth)) ? Number(source.dockWidth) : WORKSPACE_PRESETS.essentials.dockWidth,
    topTab,
    bottomTab,
    upperPinned: normalizePinned("upper", source.upperPinned, WORKSPACE_PRESETS.essentials.upperPinned),
    lowerPinned: normalizePinned("lower", source.lowerPinned, WORKSPACE_PRESETS.essentials.lowerPinned),
    dockMode: isDockMode(source.dockMode) ? source.dockMode : isDockMode(source.mode) ? source.mode : "expanded",
    upperHidden: !!source.upperHidden,
    savedAt: Number.isFinite(Number(source.savedAt)) ? Number(source.savedAt) : Date.now(),
  }
}

function readWorkspaces(): WorkspaceLayout[] {
  if (typeof window === "undefined") return []
  for (const key of [WORKSPACES_KEY, LEGACY_WORKSPACES_KEY]) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]")
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map(normalizeWorkspaceLayout).filter(Boolean) as WorkspaceLayout[]
      }
    } catch {}
  }
  return []
}

function writeWorkspaces(workspaces: WorkspaceLayout[]) {
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces))
  window.dispatchEvent(new CustomEvent("ps-workspaces-changed", { detail: workspaces }))
}

function presetToLayout(preset: WorkspacePanelPreset): WorkspaceLayout {
  return {
    name: preset.label,
    topHeight: preset.topHeight,
    dockWidth: preset.dockWidth,
    topTab: preset.topActive,
    bottomTab: preset.bottomActive,
    upperPinned: preset.upperPinned,
    lowerPinned: preset.lowerPinned,
    dockMode: preset.mode,
    upperHidden: false,
    savedAt: 0,
  }
}

function setCurrentWorkspacePreset(id: WorkspacePresetId) {
  try {
    localStorage.setItem(CURRENT_WORKSPACE_KEY, id)
  } catch {}
  window.dispatchEvent(new CustomEvent("ps-workspace-preset-changed", { detail: { preset: id } }))
}

function moveItem(ids: string[], id: string, delta: number) {
  const index = ids.indexOf(id)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids
  const next = ids.slice()
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

function snapHeight(value: number, min: number, max: number) {
  const clamped = Math.max(min, Math.min(max, value))
  if (clamped - min <= SPLIT_SNAP_DISTANCE) return min
  if (max - clamped <= SPLIT_SNAP_DISTANCE) return max
  return clamped
}

export function PanelDock({ width, overlay }: { width?: number; overlay?: boolean }) {
  const dockRef = React.useRef<HTMLDivElement>(null)
  const [dockHeight, setDockHeight] = React.useState(0)
  const [topHeight, setTopHeight] = React.useState(WORKSPACE_PRESETS.essentials.topHeight)
  const [topActive, setTopActive] = React.useState(WORKSPACE_PRESETS.essentials.topActive)
  const [bottomActive, setBottomActive] = React.useState(WORKSPACE_PRESETS.essentials.bottomActive)
  const [upperPinned, setUpperPinned] = React.useState(() => WORKSPACE_PRESETS.essentials.upperPinned)
  const [lowerPinned, setLowerPinned] = React.useState(() => WORKSPACE_PRESETS.essentials.lowerPinned)
  const [mode, setMode] = React.useState<PanelDockMode>("expanded")
  const [solo, setSolo] = React.useState<"top" | "bottom" | null>(null)
  const [upperHidden, setUpperHidden] = React.useState(false)
  const [allPanelsOpen, setAllPanelsOpen] = React.useState(false)
  const [recentPanels, setRecentPanels] = React.useState<string[]>([])
  const hydratedRef = React.useRef(false)
  const hadSavedModeRef = React.useRef(false)
  const topHeightRef = React.useRef(topHeight)
  const topActiveRef = React.useRef(topActive)
  const bottomActiveRef = React.useRef(bottomActive)
  const upperPinnedRef = React.useRef(upperPinned)
  const lowerPinnedRef = React.useRef(lowerPinned)
  const modeRef = React.useRef(mode)
  const upperHiddenRef = React.useRef(upperHidden)
  const widthRef = React.useRef(width)
  const rawTopHeightRef = React.useRef(topHeight)
  const resizingSplitRef = React.useRef(false)

  const topMax = dockHeight > 0 ? Math.max(TOP_MIN_HEIGHT, dockHeight - BOTTOM_MIN_HEIGHT - SPLITTER_HEIGHT) : 720
  const clampTopHeight = React.useCallback(
    (value: number) => Math.max(TOP_MIN_HEIGHT, Math.min(topMax, value)),
    [topMax],
  )
  const snapTopHeight = React.useCallback(
    (value: number) => snapHeight(value, TOP_MIN_HEIGHT, topMax),
    [topMax],
  )
  const splitState = upperHidden || solo === "bottom" || topHeight <= TOP_MIN_HEIGHT + 1
    ? "layers-max"
    : solo === "top" || topHeight >= topMax - 1
      ? "layers-min"
      : "balanced"

  React.useEffect(() => {
    topHeightRef.current = topHeight
    if (!resizingSplitRef.current) rawTopHeightRef.current = topHeight
  }, [topHeight])

  React.useEffect(() => {
    topActiveRef.current = topActive
  }, [topActive])

  React.useEffect(() => {
    bottomActiveRef.current = bottomActive
  }, [bottomActive])

  React.useEffect(() => {
    upperPinnedRef.current = upperPinned
  }, [upperPinned])

  React.useEffect(() => {
    lowerPinnedRef.current = lowerPinned
  }, [lowerPinned])

  React.useEffect(() => {
    modeRef.current = mode
  }, [mode])

  React.useEffect(() => {
    upperHiddenRef.current = upperHidden
  }, [upperHidden])

  React.useEffect(() => {
    widthRef.current = width
  }, [width])

  const updateRecent = React.useCallback((id: string) => {
    setRecentPanels((current) => [id, ...current.filter((item) => item !== id)].slice(0, 10))
  }, [])

  const activatePanel = React.useCallback((id: string, expand = false) => {
    const panel = panelById(id)
    if (!panel) return
    if (panel.stack === "upper") setTopActive(panel.id)
    if (panel.stack === "lower") setBottomActive(panel.id)
    updateRecent(panel.id)
    if (expand || modeRef.current !== "expanded") setMode("expanded")
  }, [updateRecent])

  const pinPanel = React.useCallback((id: string) => {
    const panel = panelById(id)
    if (!panel) return
    const update = (current: string[]) => current.includes(panel.id) ? current : [...current, panel.id]
    if (panel.stack === "upper") setUpperPinned(update)
    if (panel.stack === "lower") setLowerPinned(update)
    activatePanel(panel.id)
  }, [activatePanel])

  const unpinPanel = React.useCallback((id: string) => {
    const panel = panelById(id)
    if (!panel) return
    const fallback = panel.stack === "upper" ? WORKSPACE_PRESETS.essentials.upperPinned : WORKSPACE_PRESETS.essentials.lowerPinned
    const setPinned = panel.stack === "upper" ? setUpperPinned : setLowerPinned
    setPinned((current) => {
      if (!current.includes(panel.id) || current.length <= 1) return current
      const next = current.filter((item) => item !== panel.id)
      const nextActive = next[0] ?? fallback[0]
      if (panel.stack === "upper" && topActiveRef.current === panel.id) setTopActive(nextActive)
      if (panel.stack === "lower" && bottomActiveRef.current === panel.id) setBottomActive(nextActive)
      return next
    })
  }, [])

  const movePinnedPanel = React.useCallback((stack: PanelStack, id: string, delta: number) => {
    if (stack === "upper") setUpperPinned((current) => moveItem(current, id, delta))
    if (stack === "lower") setLowerPinned((current) => moveItem(current, id, delta))
  }, [])

  const applyLayout = React.useCallback((layout: WorkspaceLayout) => {
    setTopHeight(clampTopHeight(layout.topHeight))
    setUpperPinned(normalizePinned("upper", layout.upperPinned, WORKSPACE_PRESETS.essentials.upperPinned))
    setLowerPinned(normalizePinned("lower", layout.lowerPinned, WORKSPACE_PRESETS.essentials.lowerPinned))
    if (panelById(layout.topTab)?.stack === "upper") setTopActive(layout.topTab)
    if (panelById(layout.bottomTab)?.stack === "lower") setBottomActive(layout.bottomTab)
    setMode(layout.dockMode)
    setUpperHidden(!!layout.upperHidden)
    setSolo(null)
    if (Number.isFinite(layout.dockWidth)) {
      dispatchPhotoshopEvent("ps-set-dock-width", layout.dockWidth)
    }
  }, [clampTopHeight])

  React.useEffect(() => {
    const saved = readDockState()
    // Capture whether a dock mode was ever persisted before this session's
    // own persist effect writes one — the overlay default below must only
    // apply when the user never picked a mode themselves.
    if (!hydratedRef.current) hadSavedModeRef.current = !!(saved && isDockMode(saved.mode))
    if (saved) {
      if (Number.isFinite(Number(saved.topHeight))) setTopHeight(clampTopHeight(Number(saved.topHeight)))
      if (panelById(String(saved.topActive ?? ""))?.stack === "upper") setTopActive(String(saved.topActive))
      if (panelById(String(saved.bottomActive ?? ""))?.stack === "lower") setBottomActive(String(saved.bottomActive))
      setUpperPinned(normalizePinned("upper", saved.upperPinned, WORKSPACE_PRESETS.essentials.upperPinned))
      setLowerPinned(normalizePinned("lower", saved.lowerPinned, WORKSPACE_PRESETS.essentials.lowerPinned))
      if (isDockMode(saved.mode)) setMode(saved.mode)
      setUpperHidden(!!saved.upperHidden)
      if (Array.isArray(saved.recentPanels)) {
        setRecentPanels(saved.recentPanels.map(String).filter((id) => panelById(id)).slice(0, 10))
      }
    } else {
      try {
        const savedSplit = localStorage.getItem("ps-panel-split")
        const parsed = Number(savedSplit)
        if (Number.isFinite(parsed)) setTopHeight(Math.max(TOP_MIN_HEIGHT, parsed))
      } catch {}
    }
    hydratedRef.current = true
  }, [clampTopHeight])

  // Phone-width overlay layouts default the dock to the hidden rail so the
  // canvas keeps usable width by default; an explicitly saved mode wins.
  React.useEffect(() => {
    if (overlay && !hadSavedModeRef.current) setMode("hidden")
  }, [overlay])

  React.useEffect(() => {
    if (!hydratedRef.current) return
    try {
      localStorage.setItem(DOCK_STATE_KEY, JSON.stringify({
        topHeight,
        topActive,
        bottomActive,
        upperPinned,
        lowerPinned,
        mode,
        upperHidden,
        recentPanels,
      }))
    } catch {}
  }, [topHeight, topActive, bottomActive, upperPinned, lowerPinned, mode, upperHidden, recentPanels])

  React.useEffect(() => {
    const openPanel = (id: string) => {
      activatePanel(id, true)
    }
    const switchPanel = (event: Event) => {
      openPanel(String((event as CustomEvent).detail ?? ""))
    }
    const saveWorkspace = (event: Event) => {
      const name = String((event as CustomEvent).detail?.name ?? "").trim()
      if (!name) return
      const workspaces = readWorkspaces().filter((workspace) => workspace.name.toLowerCase() !== name.toLowerCase())
      workspaces.push({
        name,
        topHeight: topHeightRef.current,
        dockWidth: widthRef.current ?? WORKSPACE_PRESETS.essentials.dockWidth,
        topTab: topActiveRef.current,
        bottomTab: bottomActiveRef.current,
        upperPinned: upperPinnedRef.current,
        lowerPinned: lowerPinnedRef.current,
        dockMode: modeRef.current,
        upperHidden: upperHiddenRef.current,
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
      const presetId = String((event as CustomEvent).detail?.preset ?? "essentials") as WorkspacePresetId
      const preset = WORKSPACE_PRESETS[presetId] ?? WORKSPACE_PRESETS.essentials
      applyLayout(presetToLayout(preset))
      setCurrentWorkspacePreset(preset.id)
    }
    const removeOpenPanelListener = addPhotoshopEventListener("ps-open-panel", openPanel)
    window.addEventListener("ps-switch-panel", switchPanel)
    window.addEventListener("ps-save-workspace", saveWorkspace)
    window.addEventListener("ps-apply-workspace", applyWorkspace)
    window.addEventListener("ps-delete-workspace", deleteWorkspace)
    window.addEventListener("ps-apply-workspace-preset", applyPreset)
    return () => {
      removeOpenPanelListener()
      window.removeEventListener("ps-switch-panel", switchPanel)
      window.removeEventListener("ps-save-workspace", saveWorkspace)
      window.removeEventListener("ps-apply-workspace", applyWorkspace)
      window.removeEventListener("ps-delete-workspace", deleteWorkspace)
      window.removeEventListener("ps-apply-workspace-preset", applyPreset)
    }
  }, [activatePanel, applyLayout])

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
    setTopHeight((height) => snapTopHeight(height))
  }, [snapTopHeight])

  const saveTopHeight = React.useCallback(() => {
    resizingSplitRef.current = false
    rawTopHeightRef.current = topHeightRef.current
    try {
      localStorage.setItem("ps-panel-split", String(topHeightRef.current))
    } catch {}
  }, [])

  const resizePanelSplit = React.useCallback(
    (delta: number) => {
      if (!resizingSplitRef.current) {
        rawTopHeightRef.current = topHeightRef.current
        resizingSplitRef.current = true
      }
      rawTopHeightRef.current += delta
      setTopHeight(snapTopHeight(rawTopHeightRef.current))
    },
    [snapTopHeight],
  )

  const dockWidth = mode === "expanded" ? width ?? WORKSPACE_PRESETS.essentials.dockWidth : mode === "compact" ? 48 : 34
  // Overlay docks float over the canvas on phone widths — cap the width so
  // a sliver of canvas stays visible behind the expanded dock.
  const expandedWidth = overlay && typeof window !== "undefined"
    ? Math.min(dockWidth, window.innerWidth - 60)
    : dockWidth

  if (mode === "hidden") {
    return (
      <div
        ref={dockRef}
        data-testid="panel-dock"
        data-mode="hidden"
        className="shrink-0 border-l border-[var(--ps-divider)] bg-[var(--ps-panel)]"
        style={{ width: dockWidth }}
      >
        <div className="flex h-full flex-col items-center gap-1 px-1 py-2">
          <button
            type="button"
            aria-label="Show panel dock"
            title="Show panel dock"
            onClick={() => setMode("expanded")}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  if (mode === "compact") {
    return (
      <div
        ref={dockRef}
        data-testid="panel-dock"
        data-mode="compact"
        className="shrink-0 border-l border-[var(--ps-divider)] bg-[var(--ps-panel)]"
        style={{ width: dockWidth }}
      >
        <CompactRail
          upperPinned={upperPinned}
          lowerPinned={lowerPinned}
          topActive={topActive}
          bottomActive={bottomActive}
          onOpen={(id) => activatePanel(id, true)}
          onExpand={() => setMode("expanded")}
          onHide={() => setMode("hidden")}
        />
      </div>
    )
  }

  return (
    <div
      ref={dockRef}
      data-testid="panel-dock"
      data-mode="expanded"
      data-split={splitState}
      data-upper-hidden={upperHidden ? "true" : "false"}
      className={cn(
        "shrink-0 bg-[var(--ps-panel)] border-l border-[var(--ps-divider)] flex flex-col select-none",
        overlay ? "absolute inset-y-0 right-0 z-40 shadow-xl" : "relative",
      )}
      style={{ width: expandedWidth }}
    >
      <DockHeader
        upperHidden={upperHidden}
        onOpenPanels={() => setAllPanelsOpen((open) => !open)}
        onToggleUpper={() => {
          setUpperHidden((hidden) => !hidden)
          setSolo(null)
        }}
        onCompact={() => setMode("compact")}
        onHide={() => setMode("hidden")}
      />
      {allPanelsOpen ? (
        <AllPanelBrowser
          recentPanels={recentPanels}
          upperPinned={upperPinned}
          lowerPinned={lowerPinned}
          onOpen={(id) => {
            activatePanel(id, true)
            setAllPanelsOpen(false)
          }}
          onPin={pinPanel}
          onUnpin={unpinPanel}
          onClose={() => setAllPanelsOpen(false)}
        />
      ) : null}
      {!upperHidden && solo !== "bottom" ? (
        <PanelStackView
          label="Upper"
          stack="upper"
          panels={upperPanels}
          pinnedIds={upperPinned}
          active={topActive}
          flex={solo === "top"}
          height={solo === "top" ? undefined : topHeight}
          recentPanels={recentPanels}
          isSolo={solo === "top"}
          onActiveChange={activatePanel}
          onPin={pinPanel}
          onUnpin={unpinPanel}
          onMovePinned={movePinnedPanel}
          onToggleSolo={() => setSolo(solo === "top" ? null : "top")}
        />
      ) : null}
      {!upperHidden && solo === null ? (
        <PanelSplitter
          splitState={splitState}
          onResize={resizePanelSplit}
          onResizeEnd={saveTopHeight}
        />
      ) : null}
      {solo !== "top" ? (
        <PanelStackView
          label="Lower"
          stack="lower"
          panels={lowerPanels}
          pinnedIds={lowerPinned}
          active={bottomActive}
          flex={true}
          recentPanels={recentPanels}
          isSolo={solo === "bottom"}
          onActiveChange={activatePanel}
          onPin={pinPanel}
          onUnpin={unpinPanel}
          onMovePinned={movePinnedPanel}
          onToggleSolo={() => setSolo(solo === "bottom" ? null : "bottom")}
        />
      ) : null}
    </div>
  )
}

function DockHeader({
  upperHidden,
  onOpenPanels,
  onToggleUpper,
  onCompact,
  onHide,
}: {
  upperHidden: boolean
  onOpenPanels: () => void
  onToggleUpper: () => void
  onCompact: () => void
  onHide: () => void
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-2">
      <button
        type="button"
        aria-label="Panels"
        title="Open all panels"
        onClick={onOpenPanels}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-[11px] font-medium text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
      >
        <Columns3 className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-dim)]" />
        <span className="truncate">Panels</span>
      </button>
      <button
        type="button"
        aria-label={upperHidden ? "Show pinned panels section" : "Hide pinned panels section"}
        title={upperHidden ? "Show pinned panels section" : "Hide pinned panels section"}
        onClick={onToggleUpper}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
      >
        {upperHidden ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Compact panel dock"
        title="Compact panel dock"
        onClick={onCompact}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
      >
        <ChevronsLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Hide panel dock"
        title="Hide panel dock"
        onClick={onHide}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function PanelSplitter({
  splitState,
  onResize,
  onResizeEnd,
}: {
  splitState: "balanced" | "layers-max" | "layers-min"
  onResize: (delta: number) => void
  onResizeEnd: () => void
}) {
  const label = splitState === "layers-max" ? "Layers max" : splitState === "layers-min" ? "Layers min" : ""
  return (
    <div className="relative h-4 shrink-0">
      <ResizeHandle
        direction="vertical"
        ariaLabel="Resize panel stack"
        className={cn(
          "h-4 bg-[var(--ps-divider)]/70 hover:bg-[var(--ps-accent)]/45",
          splitState !== "balanced" && "bg-[var(--ps-accent)]/35 before:bg-[var(--ps-accent)]",
        )}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />
      {label ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[var(--ps-accent)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--ps-text)] shadow">
          {label}
        </div>
      ) : null}
    </div>
  )
}

function CompactRail({
  upperPinned,
  lowerPinned,
  topActive,
  bottomActive,
  onOpen,
  onExpand,
  onHide,
}: {
  upperPinned: string[]
  lowerPinned: string[]
  topActive: string
  bottomActive: string
  onOpen: (id: string) => void
  onExpand: () => void
  onHide: () => void
}) {
  const ids = [...upperPinned, ...lowerPinned].filter((id, index, list) => list.indexOf(id) === index)
  const panels = ids.map(panelById).filter(Boolean) as PhotoshopPanelDefinition[]
  return (
    <div className="flex h-full flex-col items-center gap-1 px-1 py-2">
      <button
        type="button"
        aria-label="Expand panel dock"
        title="Expand panel dock"
        onClick={onExpand}
        className="flex h-7 w-7 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <div className="my-1 h-px w-6 bg-[var(--ps-divider)]" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {panels.map((panel) => {
          const active = panel.id === topActive || panel.id === bottomActive
          return (
            <button
              key={panel.id}
              type="button"
              aria-label={`Open ${panel.label} panel from rail`}
              title={panel.label}
              onClick={() => onOpen(panel.id)}
              className={cn(
                "relative flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
                active
                  ? "bg-[var(--ps-tool-active)] text-[var(--ps-text)]"
                  : "text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]",
              )}
            >
              <panel.icon className="h-3.5 w-3.5" />
              {active ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--ps-accent)]" /> : null}
            </button>
          )
        })}
      </div>
      <div className="my-1 h-px w-6 bg-[var(--ps-divider)]" />
      <button
        type="button"
        aria-label="Hide panel dock"
        title="Hide panel dock"
        onClick={onHide}
        className="flex h-7 w-7 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function PanelStackView({
  label,
  stack,
  panels,
  pinnedIds,
  active,
  flex,
  height,
  recentPanels,
  isSolo,
  onActiveChange,
  onPin,
  onUnpin,
  onMovePinned,
  onToggleSolo,
}: {
  label: string
  stack: PanelStack
  panels: PhotoshopPanelDefinition[]
  pinnedIds: string[]
  active: string
  flex: boolean
  height?: number
  recentPanels: string[]
  isSolo: boolean
  onActiveChange: (id: string) => void
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  onMovePinned: (stack: PanelStack, id: string, delta: number) => void
  onToggleSolo: () => void
}) {
  const [moreOpen, setMoreOpen] = React.useState(false)
  const activePanel = panels.find((panel) => panel.id === active) ?? panels[0]
  const pinnedPanels = pinnedIds.map(panelById).filter((panel): panel is PhotoshopPanelDefinition => !!panel && panel.stack === stack)
  const activeIsPinned = pinnedIds.includes(activePanel.id)
  const activeIndex = pinnedIds.indexOf(activePanel.id)
  const shownTabs = activeIsPinned ? pinnedPanels : [activePanel, ...pinnedPanels]

  return (
    <div
      className={cn("relative flex flex-col bg-[var(--ps-panel)] min-h-0", flex && "flex-1")}
      style={!flex ? { height } : undefined}
    >
      <select
        key={activePanel.id}
        aria-label={`${label} panel picker`}
        defaultValue={activePanel.id}
        onChange={(event) => onActiveChange(event.currentTarget.value)}
        className="sr-only"
      >
        {panels.map((panel) => (
          <option key={panel.id} value={panel.id}>{panel.label}</option>
        ))}
      </select>

      <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-1.5 py-1">
        <div className="flex items-center gap-1">
          <activePanel.icon className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-dim)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-[var(--ps-text)]">{activePanel.label}</div>
            {!activeIsPinned ? <div className="text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">temporary</div> : null}
          </div>
          <button
            type="button"
            aria-label={activeIsPinned ? `Unpin ${activePanel.label} panel` : `Pin ${activePanel.label} panel`}
            title={activeIsPinned ? "Unpin active panel" : "Pin active panel"}
            onClick={() => activeIsPinned ? onUnpin(activePanel.id) : onPin(activePanel.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            {activeIsPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label={`Move active ${stack} panel left`}
            title="Move active pinned panel left"
            disabled={!activeIsPinned || activeIndex <= 0}
            onClick={() => onMovePinned(stack, activePanel.id, -1)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Move active ${stack} panel right`}
            title="Move active pinned panel right"
            disabled={!activeIsPinned || activeIndex === -1 || activeIndex >= pinnedIds.length - 1}
            onClick={() => onMovePinned(stack, activePanel.id, 1)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`More ${stack} panels`}
            title="More panels"
            onClick={() => setMoreOpen((open) => !open)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={isSolo ? `Restore ${label} panel stack` : `Maximize ${label} panel stack`}
            title={isSolo ? "Restore split panels" : "Maximize this panel stack"}
            onClick={onToggleSolo}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            {isSolo ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-1 overflow-x-auto">
          {shownTabs.map((panel) => {
            const selected = panel.id === activePanel.id
            return (
              <button
                key={panel.id}
                type="button"
                draggable={activeIsPinned}
                aria-label={panel.label}
                title={panel.label}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", panel.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  const dragged = event.dataTransfer.getData("text/plain")
                  const from = pinnedIds.indexOf(dragged)
                  const to = pinnedIds.indexOf(panel.id)
                  if (from < 0 || to < 0 || from === to) return
                  const delta = to > from ? 1 : -1
                  let next = pinnedIds
                  while (next.indexOf(dragged) !== to) {
                    onMovePinned(stack, dragged, delta)
                    next = moveItem(next, dragged, delta)
                  }
                }}
                onClick={() => onActiveChange(panel.id)}
                className={cn(
                  "flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-sm px-2 text-left text-[11px] transition-colors",
                  selected
                    ? "bg-[var(--ps-tool-active)] text-[var(--ps-text)] ring-1 ring-[var(--ps-accent)]"
                    : "bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]",
                  !pinnedIds.includes(panel.id) && "border border-dashed border-[var(--ps-divider)]",
                )}
              >
                <panel.icon className="h-3 w-3 shrink-0" />
                <span className="max-w-[88px] truncate">{panel.label}</span>
                {pinnedIds.includes(panel.id) ? <GripVertical className="h-3 w-3 shrink-0 opacity-40" /> : null}
              </button>
            )
          })}
        </div>
      </div>

      {moreOpen ? (
        <MorePanelBrowser
          stack={stack}
          panels={panels}
          pinnedIds={pinnedIds}
          recentPanels={recentPanels}
          onOpen={(id) => {
            onActiveChange(id)
            setMoreOpen(false)
          }}
          onPin={onPin}
          onUnpin={onUnpin}
          onClose={() => setMoreOpen(false)}
        />
      ) : null}

      <div className="flex-1 min-h-0 overflow-hidden overflow-y-auto">{activePanel.render()}</div>
    </div>
  )
}

function MorePanelBrowser({
  stack,
  panels,
  pinnedIds,
  recentPanels,
  onOpen,
  onPin,
  onUnpin,
  onClose,
}: {
  stack: PanelStack
  panels: PhotoshopPanelDefinition[]
  pinnedIds: string[]
  recentPanels: string[]
  onOpen: (id: string) => void
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = React.useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = panels.filter((panel) => {
    if (!normalizedQuery) return true
    return [
      panel.label,
      panel.category,
      panel.complexity,
      ...panel.keywords,
    ].join(" ").toLowerCase().includes(normalizedQuery)
  })
  const recent = recentPanels
    .map(panelById)
    .filter((panel): panel is PhotoshopPanelDefinition => !!panel && panel.stack === stack && !pinnedIds.includes(panel.id))
    .slice(0, 4)

  return (
    <div className="absolute left-2 right-2 top-[78px] z-50 max-h-[min(520px,calc(100%-90px))] overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-2 py-2">
        <Search className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
        <input
          autoFocus
          placeholder={`Search ${stack} panels`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none"
        />
        <button
          type="button"
          aria-label="Close panel browser"
          title="Close"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[430px] overflow-y-auto p-2">
        {!normalizedQuery && recent.length ? (
          <PanelBrowserSection
            title="Recent"
            panels={recent}
            pinnedIds={pinnedIds}
            onOpen={onOpen}
            onPin={onPin}
            onUnpin={onUnpin}
          />
        ) : null}
        {panelsByCategory(filtered).map(({ category, panels: categoryPanels }) => (
          <PanelBrowserSection
            key={category}
            title={category}
            panels={categoryPanels}
            pinnedIds={pinnedIds}
            onOpen={onOpen}
            onPin={onPin}
            onUnpin={onUnpin}
          />
        ))}
        {!filtered.length ? (
          <div className="px-2 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No matching panels.</div>
        ) : null}
      </div>
    </div>
  )
}

function AllPanelBrowser({
  recentPanels,
  upperPinned,
  lowerPinned,
  onOpen,
  onPin,
  onUnpin,
  onClose,
}: {
  recentPanels: string[]
  upperPinned: string[]
  lowerPinned: string[]
  onOpen: (id: string) => void
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = React.useState("")
  const pinnedIds = React.useMemo(
    () => [...upperPinned, ...lowerPinned].filter((id, index, list) => list.indexOf(id) === index),
    [lowerPinned, upperPinned],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = PANEL_DEFINITIONS.filter((panel) => {
    if (!normalizedQuery) return true
    return [
      panel.label,
      panel.category,
      panel.stack,
      panel.complexity,
      ...panel.keywords,
    ].join(" ").toLowerCase().includes(normalizedQuery)
  })
  const recent = recentPanels
    .map(panelById)
    .filter((panel): panel is PhotoshopPanelDefinition => !!panel && !pinnedIds.includes(panel.id))
    .slice(0, 5)

  return (
    <div className="absolute left-2 right-2 top-9 z-50 max-h-[min(620px,calc(100%-44px))] overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-2 py-2">
        <Search className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
        <input
          autoFocus
          placeholder="Search all panels"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none"
        />
        <button
          type="button"
          aria-label="Close all panels browser"
          title="Close"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[540px] overflow-y-auto p-2">
        {!normalizedQuery && recent.length ? (
          <PanelBrowserSection
            title="Recent"
            panels={recent}
            pinnedIds={pinnedIds}
            onOpen={onOpen}
            onPin={onPin}
            onUnpin={onUnpin}
          />
        ) : null}
        {panelsByCategory(filtered).map(({ category, panels: categoryPanels }) => (
          <PanelBrowserSection
            key={category}
            title={category}
            panels={categoryPanels}
            pinnedIds={pinnedIds}
            onOpen={onOpen}
            onPin={onPin}
            onUnpin={onUnpin}
          />
        ))}
        {!filtered.length ? (
          <div className="px-2 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No matching panels.</div>
        ) : null}
      </div>
    </div>
  )
}

function PanelBrowserSection({
  title,
  panels,
  pinnedIds,
  onOpen,
  onPin,
  onUnpin,
}: {
  title: string
  panels: PhotoshopPanelDefinition[]
  pinnedIds: string[]
  onOpen: (id: string) => void
  onPin: (id: string) => void
  onUnpin: (id: string) => void
}) {
  const ordered = (PANEL_CATEGORIES as readonly string[]).includes(title)
    ? panels
    : panels.slice().sort((a, b) => a.label.localeCompare(b.label))
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-dim)]">{title}</div>
      <div className="grid grid-cols-1 gap-1">
        {ordered.map((panel) => {
          const pinned = pinnedIds.includes(panel.id)
          return (
            <div key={`${title}-${panel.id}`} className="grid grid-cols-[1fr_auto] gap-1">
              <button
                type="button"
                aria-label={`Open ${panel.label} panel`}
                onClick={() => onOpen(panel.id)}
                className="flex min-w-0 items-center gap-2 rounded-sm bg-[var(--ps-panel-2)] px-2 py-1.5 text-left text-[11px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
              >
                <panel.icon className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-dim)]" />
                <span className="min-w-0 flex-1 truncate">{panel.label}</span>
                <span className="shrink-0 rounded-sm border border-[var(--ps-divider)] px-1 text-[9px] uppercase text-[var(--ps-text-dim)]">
                  {panel.complexity}
                </span>
              </button>
              <button
                type="button"
                aria-label={pinned ? `Unpin ${panel.label} panel` : `Pin ${panel.label} panel`}
                title={pinned ? "Unpin panel" : "Pin panel"}
                onClick={() => pinned ? onUnpin(panel.id) : onPin(panel.id)}
                className="flex h-8 w-8 items-center justify-center rounded-sm bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
              >
                {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
