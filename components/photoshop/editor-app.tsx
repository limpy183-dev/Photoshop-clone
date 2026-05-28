"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { EditorProvider, makeHistoryEntry, useEditor } from "@/components/photoshop/editor-context"
import { MenuBar } from "@/components/photoshop/menu-bar"
import { OptionsBar } from "@/components/photoshop/options-bar"
import { ToolPalette } from "@/components/photoshop/tool-palette"
import { PanelDock } from "@/components/photoshop/panel-dock"
import { StatusBar } from "@/components/photoshop/status-bar"
import { DocumentTabs } from "@/components/photoshop/document-tabs"
import { ImageAssetsGeneratorRunner } from "@/components/photoshop/image-assets-generator-runner"
import { NewDocumentDialog } from "@/components/photoshop/new-document-dialog"
import { useShortcuts } from "@/components/photoshop/use-shortcuts"
import { ResizeHandle } from "@/components/photoshop/resize-handle"
import { useMounted } from "@/components/photoshop/use-mounted"
import {
  applyPreferencesToDocumentSettings,
  loadPreferencesFromStorage,
  normalizePreferences,
} from "@/components/photoshop/preferences-engine"
import { deserializeProject } from "@/components/photoshop/document-io"
import { requestCanvasZoom } from "@/components/photoshop/zoom-events"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "@/components/photoshop/events"
import { buildLearningIndex, runLearningIndexItem } from "@/components/photoshop/learning-index"
import { findNewDocumentPreset } from "@/components/photoshop/new-document-presets"
import { readRecentDocuments, rememberRecentDocument } from "@/components/photoshop/recent-documents"
import { createDocumentFromPreset } from "@/components/photoshop/startup-documents"
import {
  applyScreenMode,
  cycleScreenMode,
  resolveScreenModeState,
  type ScreenMode,
} from "@/components/photoshop/screen-modes"
import type { DocumentFileKind, DocumentStorageKind } from "@/components/photoshop/editor-context"

// Heavy dialogs / overlays are rarely visible — load them lazily so their
// JS, Radix portals, and event listeners don't bloat first paint or
// re-render with the workspace.
const CommandPalette = React.lazy(() =>
  import("@/components/photoshop/command-palette").then((m) => ({ default: m.CommandPalette })),
)
const ImageSizeDialog = React.lazy(() =>
  import("@/components/photoshop/image-size-dialog").then((m) => ({ default: m.ImageSizeDialog })),
)
const CanvasSizeDialog = React.lazy(() =>
  import("@/components/photoshop/canvas-size-dialog").then((m) => ({ default: m.CanvasSizeDialog })),
)
const AutosaveRecovery = React.lazy(() =>
  import("@/components/photoshop/autosave-recovery").then((m) => ({ default: m.AutosaveRecovery })),
)
// The Home/Start workspace is shown when no document is open or when the
// user explicitly toggles it from Window ▸ Home. Lazy-load so its preset/
// recent-thumbnail rendering only ships when actually visible.
const HomeWorkspace = React.lazy(() =>
  import("@/components/photoshop/home-workspace").then((m) => ({ default: m.HomeWorkspace })),
)

const CanvasView = dynamic(
  () => import("@/components/photoshop/canvas-view").then((m) => m.CanvasView),
  {
    ssr: false,
    loading: () => <div className="min-w-0 flex-1 bg-[var(--ps-canvas-bg)]" aria-label="Loading canvas" />,
  },
)
const ColorPickerDialog = React.lazy(() =>
  import("@/components/photoshop/color-picker-dialog").then((m) => ({ default: m.ColorPickerDialog })),
)
const ColorPickerHud = React.lazy(() =>
  import("@/components/photoshop/color-picker-dialog").then((m) => ({ default: m.ColorPickerHud })),
)

const STATUS_BAR_VISIBILITY_KEY = "ps-status-bar-visible"

type WorkspaceContextMenu = {
  x: number
  y: number
  kind: "canvas" | "app"
}

type ColorPickerState = {
  target: "foreground" | "background"
  surface: "dialog" | "hud"
  x: number
  y: number
}

export default function Page() {
  return (
    <EditorProvider>
      <Workspace />
    </EditorProvider>
  )
}

// The main workspace shell. Context-menu state is intentionally NOT held
// here: it lives in a sibling overlay so opening/positioning the menu
// doesn't re-render the heavy MenuBar / Canvas / PanelDock tree.
function Workspace() {
  const { activeDocId, activeDoc, dispatch, documents } = useEditor()
  const [newOpen, setNewOpen] = React.useState(false)
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [imageSizeOpen, setImageSizeOpen] = React.useState(false)
  const [canvasSizeOpen, setCanvasSizeOpen] = React.useState(false)
  const [statusBarVisible, setStatusBarVisible] = React.useState(true)
  const [colorPicker, setColorPicker] = React.useState<ColorPickerState | null>(null)
  const [screenMode, setScreenMode] = React.useState<ScreenMode>("standard")
  const screenModeState = React.useMemo(() => resolveScreenModeState(screenMode), [screenMode])
  // Tracks whether the Home/Start workspace is explicitly open. The view is
  // also shown automatically whenever no documents are open, so this flag
  // only matters for "Window ▸ Home" toggling while a doc is active.
  const [homeOpen, setHomeOpen] = React.useState(false)
  const openNew = React.useCallback(() => setNewOpen(true), [])
  const openCommandPalette = React.useCallback(() => setCommandOpen(true), [])
  useShortcuts(openNew, openCommandPalette)

  const [dockWidth, setDockWidth] = React.useState(380)
  const dockWidthRef = React.useRef(dockWidth)
  const activeDocRef = React.useRef(activeDoc)
  // Persisted dock width is read from localStorage in an effect, so SSR
  // and first client render both see 380. Gate the value passed to
  // PanelDock so even if anything else (HMR, future lazy init) leaks the
  // persisted value into first render, the SSR width survives hydration.
  const mounted = useMounted()

  React.useEffect(() => {
    dockWidthRef.current = dockWidth
  }, [dockWidth])

  React.useEffect(() => {
    activeDocRef.current = activeDoc
  }, [activeDoc])

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STATUS_BAR_VISIBILITY_KEY)
      if (saved !== null) setStatusBarVisible(saved !== "false")
    } catch {}
  }, [])

  const setStatusBarVisibility = React.useCallback((visible: boolean) => {
    setStatusBarVisible(visible)
    try {
      localStorage.setItem(STATUS_BAR_VISIBILITY_KEY, visible ? "true" : "false")
    } catch {}
  }, [])

  const toggleStatusBarVisibility = React.useCallback(() => {
    setStatusBarVisible((visible) => {
      const next = !visible
      try {
        localStorage.setItem(STATUS_BAR_VISIBILITY_KEY, next ? "true" : "false")
      } catch {}
      return next
    })
  }, [])

  const saveDockWidth = React.useCallback(() => {
    try { localStorage.setItem("ps-dock-width", String(dockWidthRef.current)) } catch {}
  }, [])

  const resizeDock = React.useCallback((delta: number) => {
    setDockWidth((width) => Math.max(340, Math.min(720, width - delta)))
  }, [])

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("ps-dock-width")
      if (saved) {
        const value = Number(saved)
        // If the stored width is below the minimum (340), restore the
        // default (380) instead of silently clamping up — clamping would
        // hide a corrupt or stale persisted value behind a confusing
        // "I was at 320 yesterday, now I'm at 340" jump on next session.
        if (Number.isFinite(value) && value >= 340 && value <= 720) {
          setDockWidth(value)
        }
      }
    } catch {}

    return addPhotoshopEventListener("ps-set-dock-width", (detail) => {
      const nextWidth = Number(detail)
      if (!Number.isFinite(nextWidth)) return
      setDockWidth(Math.max(340, Math.min(720, nextWidth)))
    })
  }, [])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-open-command-palette", () => setCommandOpen(true))
  }, [])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-set-screen-mode", (detail) => {
      const mode = detail?.mode
      if (mode) {
        setScreenMode(mode)
        void applyScreenMode(mode)
      }
    })
  }, [])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-cycle-screen-mode", () => {
      setScreenMode((current) => {
        const next = cycleScreenMode(current)
        void applyScreenMode(next)
        return next
      })
    })
  }, [])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F" || event.key === "f") {
        const target = event.target as HTMLElement | null
        if (target?.closest("input, textarea, [contenteditable=true], [role=textbox]")) return
        event.preventDefault()
        setScreenMode((current) => {
          const next = cycleScreenMode(current)
          void applyScreenMode(next)
          return next
        })
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-show-home", (detail) => {
      // Detail can specify open:true/false to set, or be undefined to toggle.
      // Falls back to a plain toggle so Window ▸ Home keeps behaving as a
      // single shortcut even if newer callers stop sending the detail.
      setHomeOpen((current) => {
        if (detail && typeof detail.open === "boolean") return detail.open
        return !current
      })
    })
  }, [])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-open-color-picker", (detail) => {
      const surface = detail?.surface === "hud" ? "hud" : "dialog"
      const target = detail?.target === "background" ? "background" : "foreground"
      setColorPicker({
        target,
        surface,
        x: Number.isFinite(detail?.x) ? Number(detail?.x) : Math.max(12, window.innerWidth / 2 - 164),
        y: Number.isFinite(detail?.y) ? Number(detail?.y) : 96,
      })
    })
  }, [])

  React.useEffect(() => {
    const imageSizeHandler = () => setImageSizeOpen(true)
    const canvasSizeHandler = () => setCanvasSizeOpen(true)

    window.addEventListener("ps-open-image-size", imageSizeHandler)
    window.addEventListener("ps-open-canvas-size", canvasSizeHandler)
    return () => {
      window.removeEventListener("ps-open-image-size", imageSizeHandler)
      window.removeEventListener("ps-open-canvas-size", canvasSizeHandler)
    }
  }, [])

  React.useEffect(() => {
    const applyPreferences = (input: unknown) => {
      const prefs = normalizePreferences(input)
      const patch = applyPreferencesToDocumentSettings(prefs)
      const doc = activeDocRef.current

      dispatch({ type: "set-grid-size", size: patch.gridSize ?? prefs.gridSize })
      dispatch({ type: "set-ruler-units", units: patch.rulerUnits })
      dispatch({ type: "set-grid-color", color: patch.gridColor ?? prefs.rulerGrid.gridColor })
      dispatch({ type: "set-grid-subdivisions", subdivisions: patch.gridSubdivisions ?? prefs.rulerGrid.gridSubdivisions })
      dispatch({ type: "set-grid-opacity", opacity: patch.gridOpacity ?? prefs.rulerGrid.gridOpacity })
      dispatch({ type: "set-show-smart-guides", show: patch.showSmartGuides ?? prefs.rulerGrid.smartGuides })
      dispatch({ type: "set-brush", brush: { smoothing: prefs.toolBehavior.brushSmoothing } })

      if (doc) {
        if ((doc.showGrid ?? false) !== (patch.showGrid ?? false)) dispatch({ type: "toggle-grid" })
        if ((doc.showPixelGrid ?? false) !== (patch.showPixelGrid ?? false)) dispatch({ type: "toggle-pixel-grid" })
        if ((doc.snapToGrid ?? false) !== (patch.snapToGrid ?? false)) dispatch({ type: "toggle-snap-grid" })
        if ((doc.snapToGuides ?? true) !== (patch.snapToGuides ?? true)) dispatch({ type: "toggle-snap-guides" })
      }
    }

    applyPreferences(loadPreferencesFromStorage())
    const preferencesHandler = (event: Event) => {
      applyPreferences((event as CustomEvent<unknown>).detail ?? loadPreferencesFromStorage())
    }
    window.addEventListener("ps-preferences-changed", preferencesHandler)
    return () => window.removeEventListener("ps-preferences-changed", preferencesHandler)
  }, [activeDocId, dispatch])

  return (
    <main
      className="h-screen w-screen flex flex-col text-[var(--ps-text)]"
      style={{ background: screenModeState.backgroundColor }}
      data-screen-mode={screenMode}
    >
      <StartupRouteEffects />
      {screenModeState.hideMenuBar ? null : (
        <MenuBar
          onOpenNew={openNew}
          statusBarVisible={statusBarVisible && !screenModeState.hideStatusBar}
          onToggleStatusBar={toggleStatusBarVisibility}
        />
      )}
      {screenModeState.hideMenuBar ? null : <OptionsBar />}
      {screenModeState.hideMenuBar ? null : <DocumentTabs />}
      <ImageAssetsGeneratorRunner />
      <div className="flex-1 flex min-h-0">
        {screenModeState.hideToolPalette ? null : <ToolPalette />}
        <CanvasView />
        {screenModeState.hidePanels ? null : (
          <ResizeHandle
            direction="horizontal"
            ariaLabel="Resize right sidebar"
            onResize={resizeDock}
            onResizeEnd={saveDockWidth}
          />
        )}
        {screenModeState.hidePanels ? null : <PanelDock width={mounted ? dockWidth : 380} />}
      </div>
      {statusBarVisible && !screenModeState.hideStatusBar ? <StatusBar onHide={() => setStatusBarVisibility(false)} /> : null}

      {/* Context menu lives in its own subtree so opening/closing it does
          not re-render the workspace shell. */}
      <ContextMenuLayer
        hasActiveDoc={!!activeDoc}
        statusBarVisible={statusBarVisible}
        onCommandPalette={openCommandPalette}
        onToggleStatusBar={toggleStatusBarVisibility}
        onHudColorPicker={(x, y) => setColorPicker({ target: "foreground", surface: "hud", x, y })}
      />

      <NewDocumentDialog open={newOpen} onOpenChange={setNewOpen} />
      <React.Suspense fallback={null}>
        {imageSizeOpen ? <ImageSizeDialog open={imageSizeOpen} onOpenChange={setImageSizeOpen} /> : null}
        {canvasSizeOpen ? <CanvasSizeDialog open={canvasSizeOpen} onOpenChange={setCanvasSizeOpen} /> : null}
        {commandOpen ? <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onOpenNew={openNew} /> : null}
        {colorPicker?.surface === "dialog" ? (
          <ColorPickerDialog
            open
            target={colorPicker.target}
            onOpenChange={(open) => {
              if (!open) setColorPicker(null)
            }}
          />
        ) : null}
        {colorPicker?.surface === "hud" ? (
          <ColorPickerHud
            open
            target={colorPicker.target}
            position={{ x: colorPicker.x, y: colorPicker.y }}
            onOpenChange={(open) => {
              if (!open) setColorPicker(null)
            }}
            onOpenFull={() => setColorPicker((current) => current ? { ...current, surface: "dialog" } : null)}
          />
        ) : null}
        <AutosaveRecovery />
      </React.Suspense>
    </main>
  )
}

function StartupRouteEffects() {
  const searchParams = useSearchParams()
  const { dispatch, requestRender } = useEditor()
  const presetName = searchParams.get("preset")
  const recentId = searchParams.get("recent")
  const learnId = searchParams.get("learn")
  const handledKeyRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const key = `${presetName ?? ""}|${recentId ?? ""}|${learnId ?? ""}`
    if (handledKeyRef.current === key) return
    handledKeyRef.current = key
    let cancelled = false

    const openPreset = () => {
      const preset = findNewDocumentPreset(presetName)
      if (!preset) return false
      const doc = createDocumentFromPreset(preset)
      dispatch({
        type: "replace-startup-document",
        doc,
        entry: makeHistoryEntry(doc, `New ${preset.name}`),
        lifecycle: { storage: "new" },
      })
      requestRender()
      return true
    }

    const openRecent = async () => {
      if (!recentId || presetName) return
      const recent = readRecentDocuments().find((item) => item.id === recentId)
      if (!recent) return
      try {
        const doc = await deserializeProject(recent.serialized)
        if (cancelled) return
        const fileKind: DocumentFileKind =
          recent.kind === "psd" ? "psd" : recent.kind === "image" ? "image" : "project"
        const storage: DocumentStorageKind = recent.storage ?? "snapshot"
        dispatch({
          type: "replace-startup-document",
          doc,
          entry: makeHistoryEntry(doc, "Open Recent"),
          lifecycle: {
            fileName: recent.fileName ?? recent.name,
            fileKind,
            storage,
          },
        })
        rememberRecentDocument({ ...recent, updatedAt: Date.now() })
        requestRender()
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Could not open recent document")
        }
      }
    }

    openPreset()
    void openRecent()

    if (learnId) {
      window.setTimeout(() => {
        if (cancelled) return
        const item = buildLearningIndex().find((candidate) => candidate.id === learnId)
        if (item) runLearningIndexItem(item)
      }, 350)
    }

    return () => {
      cancelled = true
    }
  }, [dispatch, learnId, presetName, recentId, requestRender])

  return null
}

// Isolated overlay that owns the right-click context-menu state. Listens
// for contextmenu / click on window so the workspace shell never re-renders
// when the menu opens, moves, or closes.
function ContextMenuLayer({
  hasActiveDoc,
  statusBarVisible,
  onCommandPalette,
  onToggleStatusBar,
  onHudColorPicker,
}: {
  hasActiveDoc: boolean
  statusBarVisible: boolean
  onCommandPalette: () => void
  onToggleStatusBar: () => void
  onHudColorPicker: (x: number, y: number) => void
}) {
  const [menu, setMenu] = React.useState<WorkspaceContextMenu | null>(null)
  const rightClickGestureRef = React.useRef<{
    x: number
    y: number
    modified: boolean
    moved: boolean
  } | null>(null)
  // Hold the latest `onHudColorPicker` in a ref so the window-level
  // contextmenu listener doesn't have to re-bind on every render.
  const onHudColorPickerRef = React.useRef(onHudColorPicker)
  React.useEffect(() => {
    onHudColorPickerRef.current = onHudColorPicker
  }, [onHudColorPicker])

  React.useEffect(() => {
    const hasKeybindModifier = (event: MouseEvent) =>
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey

    // Shift+Alt+RightClick on the canvas opens the HUD color picker at the
    // cursor. The general "modifier on right-click cancels the menu" rule
    // below still fires, but we capture this specific combo first so the
    // HUD opens without showing the context menu.
    const isHudGesture = (event: MouseEvent, target: HTMLElement | null) =>
      target?.closest("[data-canvas-root]") &&
      event.shiftKey &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey

    const onContextMenu = (event: MouseEvent) => {
      // Allow native context menu on inputs / textareas / editable elements
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, [contenteditable=true]")) return
      event.preventDefault()
      const gesture = rightClickGestureRef.current
      rightClickGestureRef.current = null
      if (isHudGesture(event, target)) {
        setMenu(null)
        onHudColorPickerRef.current(event.clientX, event.clientY)
        return
      }
      if (hasKeybindModifier(event) || gesture?.modified || gesture?.moved) {
        setMenu(null)
        return
      }
      const menuWidth = 232
      const menuHeight = target?.closest("[data-canvas-root]") ? 292 : 244
      const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8))
      const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
      setMenu({
        x,
        y,
        kind: target?.closest("[data-canvas-root]") ? "canvas" : "app",
      })
    }
    const onPointerMove = (event: MouseEvent) => {
      const gesture = rightClickGestureRef.current
      if (!gesture) return
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) {
        gesture.moved = true
      }
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (event.button === 0 && !target?.closest("[data-context-menu-root]")) setMenu(null)
      if (event.button === 2) {
        rightClickGestureRef.current = {
          x: event.clientX,
          y: event.clientY,
          modified: hasKeybindModifier(event),
          moved: false,
        }
      }
    }
    const onPointerUp = (event: MouseEvent) => {
      if (event.button !== 2) return
      window.setTimeout(() => {
        rightClickGestureRef.current = null
      }, 0)
    }
    window.addEventListener("contextmenu", onContextMenu)
    window.addEventListener("mousedown", onPointerDown)
    window.addEventListener("mousemove", onPointerMove)
    window.addEventListener("mouseup", onPointerUp)
    return () => {
      window.removeEventListener("contextmenu", onContextMenu)
      window.removeEventListener("mousedown", onPointerDown)
      window.removeEventListener("mousemove", onPointerMove)
      window.removeEventListener("mouseup", onPointerUp)
    }
  }, [])

  React.useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
    }
  }, [menu])

  return (
    <AppContextMenu
      menu={menu}
      activeDoc={hasActiveDoc}
      statusBarVisible={statusBarVisible}
      onClose={() => setMenu(null)}
      onCommandPalette={onCommandPalette}
      onToggleStatusBar={onToggleStatusBar}
      onHudColorPicker={onHudColorPicker}
      onZoom={(zoom) => requestCanvasZoom({ zoom })}
    />
  )
}

function AppContextMenu({
  menu,
  activeDoc,
  statusBarVisible,
  onClose,
  onCommandPalette,
  onToggleStatusBar,
  onHudColorPicker,
  onZoom,
}: {
  menu: WorkspaceContextMenu | null
  activeDoc: boolean
  statusBarVisible: boolean
  onClose: () => void
  onCommandPalette: () => void
  onToggleStatusBar: () => void
  onHudColorPicker: (x: number, y: number) => void
  onZoom: (zoom: number) => void
}) {
  if (!menu) return null

  const run = (action: () => void) => {
    action()
    onClose()
  }
  const openPanel = (id: string) => {
    dispatchPhotoshopEvent("ps-open-panel", id)
  }
  const openExportAs = () => {
    dispatchPhotoshopEvent("ps-open-export-as")
  }
  const openHudColorPicker = () => {
    onHudColorPicker(menu.x, menu.y)
  }
  const menuLabel = menu.kind === "canvas" ? "Canvas context menu" : "App context menu"

  return (
    <div
      role="menu"
      aria-label={menuLabel}
      data-context-menu-root
      className="fixed z-[1000] w-56 overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] py-1 text-[12px] text-[var(--ps-text)] shadow-2xl"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {menu.kind === "canvas" ? (
        <>
          <ContextMenuItem onSelect={() => run(() => onZoom(0.5))} disabled={!activeDoc}>
            Fit on Screen
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => run(() => onZoom(1))} disabled={!activeDoc}>
            Actual Size
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => run(openHudColorPicker)}>
            HUD Color Picker
          </ContextMenuItem>
          <div className="my-1 h-px bg-[var(--ps-divider)]" />
        </>
      ) : null}
      <ContextMenuItem onSelect={() => run(() => openPanel("layers"))}>
        Open Layers Panel
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => run(() => openPanel("properties"))}>
        Open Properties Panel
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => run(openExportAs)} disabled={!activeDoc}>
        Export As...
      </ContextMenuItem>
      <div className="my-1 h-px bg-[var(--ps-divider)]" />
      <ContextMenuItem onSelect={() => run(onCommandPalette)}>
        Open Command Palette
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => run(onToggleStatusBar)}>
        {statusBarVisible ? "Hide Info Bar" : "Show Info Bar"}
      </ContextMenuItem>
    </div>
  )
}

function ContextMenuItem({
  children,
  disabled,
  onSelect,
}: {
  children: React.ReactNode
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="flex h-7 w-full items-center px-3 text-left text-[12px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)] disabled:pointer-events-none disabled:text-[var(--ps-text-dim)] disabled:opacity-45"
    >
      {children}
    </button>
  )
}
