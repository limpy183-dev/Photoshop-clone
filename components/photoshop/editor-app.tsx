"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { EditorProvider, makeHistoryEntry, useEditorSelector } from "@/components/photoshop/editor-context"
import { EditorErrorBoundary } from "@/components/photoshop/editor-error-boundary"
import { useShortcuts } from "@/components/photoshop/use-shortcuts"
import { useMounted } from "@/components/photoshop/use-mounted"
import {
  applyPreferencesToDocumentSettings,
  loadPreferencesFromStorage,
  normalizePreferences,
} from "@/components/photoshop/preferences-engine"
import { requestCanvasZoom } from "@/components/photoshop/zoom-events"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "@/components/photoshop/events"
import { CLIENT_STORAGE_KEYS, readClientStorageString, writeClientStorageString } from "@/components/photoshop/client-storage"
import { buildLearningIndex, runLearningIndexItem } from "@/components/photoshop/learning-index"
import { findNewDocumentPreset } from "@/components/photoshop/new-document-presets"
import { readRecentDocuments, rememberRecentDocument } from "@/components/photoshop/recent-documents"
import { createDocumentFromPreset, createDocumentFromRasterImport } from "@/components/photoshop/startup-documents"
import {
  deleteStartupImageImport,
  readStartupImageImport,
  STARTUP_IMAGE_IMPORT_PARAM,
} from "@/components/photoshop/startup-file-handoff"
import {
  applyScreenMode,
  cycleScreenMode,
  resolveScreenModeState,
  type ScreenMode,
} from "@/components/photoshop/screen-modes"
import type { DocumentFileKind, DocumentStorageKind } from "@/components/photoshop/editor-context"
import {
  preloadCanvasSizeDialog,
  preloadImageSizeDialog,
  preloadNewDocumentDialog,
} from "@/components/photoshop/dialog-preload"

if (typeof performance !== "undefined") {
  performance.mark("photoshop-editor-entry-loaded")
}

// Heavy dialogs / overlays are rarely visible — load them lazily so their
// JS, Radix portals, and event listeners don't bloat first paint or
// re-render with the workspace.
const loadCommandPalette = () =>
  import("@/components/photoshop/command-palette").then((m) => ({ default: m.CommandPalette }))
const CommandPalette = React.lazy(loadCommandPalette)
const ImageSizeDialog = React.lazy(() =>
  preloadImageSizeDialog(),
)
const CanvasSizeDialog = React.lazy(() =>
  preloadCanvasSizeDialog(),
)
const AutosaveRecovery = React.lazy(() =>
  import("@/components/photoshop/autosave-recovery").then((m) => ({ default: m.AutosaveRecovery })),
)
const NewDocumentDialog = React.lazy(() =>
  preloadNewDocumentDialog(),
)
// The Home/Start workspace is shown when no document is open or when the
// user explicitly toggles it from Window ▸ Home. Lazy-load so its preset/
// recent-thumbnail rendering only ships when actually visible.
const HomeWorkspace = React.lazy(() =>
  import("@/components/photoshop/home-workspace").then((m) => ({ default: m.HomeWorkspace })),
)
const ImageAssetsGeneratorRunner = React.lazy(() =>
  import("@/components/photoshop/image-assets-generator-runner").then((m) => ({
    default: m.ImageAssetsGeneratorRunner,
  })),
)

const EditorShell = dynamic(
  () => import("@/components/photoshop/editor-shell").then((m) => m.EditorShell),
  {
    ssr: false,
    loading: () => <div role="status" className="min-h-0 flex-1 bg-[var(--ps-canvas-bg)]" aria-label="Loading editor shell" />,
  },
)

const ColorPickerDialog = React.lazy(() =>
  import("@/components/photoshop/color-picker-dialog").then((m) => ({ default: m.ColorPickerDialog })),
)
const ColorPickerHud = React.lazy(() =>
  import("@/components/photoshop/color-picker-dialog").then((m) => ({ default: m.ColorPickerHud })),
)

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
    <EditorErrorBoundary>
      <EditorProvider>
        <Workspace />
      </EditorProvider>
    </EditorErrorBoundary>
  )
}

// Below this width the shell cannot fit the tool rail, resize handle, and
// the 340px-minimum dock next to a usable canvas, so the dock switches to an
// overlay. Returns false until mounted so SSR and the first client render
// agree (same hydration gating as the persisted dock width).
function useIsNarrowViewport() {
  const [isNarrow, setIsNarrow] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)")
    const update = () => setIsNarrow(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return isNarrow
}

// The main workspace shell. Context-menu state is intentionally NOT held
// here: it lives in a sibling overlay so opening/positioning the menu
// doesn't re-render the heavy MenuBar / Canvas / PanelDock tree.
function Workspace() {
  const { activeDocId, activeDoc, dispatch } = useEditorSelector((editor) => editor)
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
  const newDialogReturnFocusRef = React.useRef<HTMLElement | null>(null)
  const commandPaletteReturnFocusRef = React.useRef<HTMLElement | null>(null)
  const openNew = React.useCallback(() => {
    newDialogReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void preloadNewDocumentDialog()
    setNewOpen(true)
  }, [])
  const openCommandPalette = React.useCallback(() => {
    commandPaletteReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void loadCommandPalette()
    setCommandOpen(true)
  }, [])
  const setNewDialogOpen = React.useCallback((open: boolean) => {
    setNewOpen(open)
    if (!open) requestAnimationFrame(() => newDialogReturnFocusRef.current?.focus())
  }, [])
  const setCommandPaletteOpen = React.useCallback((open: boolean) => {
    setCommandOpen(open)
    if (!open) requestAnimationFrame(() => commandPaletteReturnFocusRef.current?.focus())
  }, [])
  useShortcuts(openNew, openCommandPalette)

  const [dockWidth, setDockWidth] = React.useState(380)
  const dockWidthRef = React.useRef(dockWidth)
  const activeDocRef = React.useRef(activeDoc)
  const isNarrow = useIsNarrowViewport()
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
    const saved = readClientStorageString(CLIENT_STORAGE_KEYS.statusBarVisible)
    if (saved !== null) setStatusBarVisible(saved !== "false")
  }, [])

  const setStatusBarVisibility = React.useCallback((visible: boolean) => {
    setStatusBarVisible(visible)
    writeClientStorageString(CLIENT_STORAGE_KEYS.statusBarVisible, visible ? "true" : "false")
  }, [])

  const toggleStatusBarVisibility = React.useCallback(() => {
    setStatusBarVisible((visible) => {
      const next = !visible
      writeClientStorageString(CLIENT_STORAGE_KEYS.statusBarVisible, next ? "true" : "false")
      return next
    })
  }, [])

  const saveDockWidth = React.useCallback(() => {
    writeClientStorageString(CLIENT_STORAGE_KEYS.dockWidth, String(dockWidthRef.current))
  }, [])

  const resizeDock = React.useCallback((delta: number) => {
    setDockWidth((width) => Math.max(340, Math.min(720, width - delta)))
  }, [])

  React.useEffect(() => {
    const saved = readClientStorageString(CLIENT_STORAGE_KEYS.dockWidth)
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

  // Opening or switching to a real document always returns to the editor,
  // even when Home was explicitly toggled on via Window ▸ Home.
  React.useEffect(() => {
    if (activeDocId) setHomeOpen(false)
  }, [activeDocId])

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
    const imageSizeHandler = () => {
      void preloadImageSizeDialog()
      setImageSizeOpen(true)
    }
    const canvasSizeHandler = () => {
      void preloadCanvasSizeDialog()
      setCanvasSizeOpen(true)
    }

    const removeImageSize = addPhotoshopEventListener("ps-open-image-size", imageSizeHandler)
    const removeCanvasSize = addPhotoshopEventListener("ps-open-canvas-size", canvasSizeHandler)
    return () => {
      removeImageSize()
      removeCanvasSize()
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
    const preferencesHandler = (detail: unknown) => {
      applyPreferences(detail ?? loadPreferencesFromStorage())
    }
    return addPhotoshopEventListener("ps-preferences-changed", preferencesHandler)
  }, [activeDocId, dispatch])

  return (
    <main
      className="h-screen w-screen flex flex-col text-[var(--ps-text)]"
      style={{ background: screenModeState.backgroundColor }}
      data-screen-mode={screenMode}
    >
      <StartupRouteEffects />
      <React.Suspense fallback={null}>
        <ImageAssetsGeneratorRunner />
      </React.Suspense>
      <EditorShell
        hideMenuBar={screenModeState.hideMenuBar}
        hidePanels={screenModeState.hidePanels}
        hideStatusBar={screenModeState.hideStatusBar}
        hideToolPalette={screenModeState.hideToolPalette}
        statusBarVisible={statusBarVisible}
        showCanvas={!homeOpen && !!activeDoc}
        centerContent={(
          <React.Suspense fallback={<div className="min-w-0 flex-1 bg-[var(--ps-canvas-bg)]" />}>
            <HomeWorkspace onOpenNew={openNew} onClose={() => setHomeOpen(false)} />
          </React.Suspense>
        )}
        dockWidth={mounted ? dockWidth : 380}
        panelOverlay={isNarrow}
        onOpenNew={openNew}
        onToggleStatusBar={toggleStatusBarVisibility}
        onHideStatusBar={() => setStatusBarVisibility(false)}
        onResizeDock={resizeDock}
        onResizeDockEnd={saveDockWidth}
      />

      {/* Context menu lives in its own subtree so opening/closing it does
          not re-render the workspace shell. */}
      <ContextMenuLayer
        hasActiveDoc={!!activeDoc}
        statusBarVisible={statusBarVisible}
        onCommandPalette={openCommandPalette}
        onToggleStatusBar={toggleStatusBarVisibility}
        onHudColorPicker={(x, y) => setColorPicker({ target: "foreground", surface: "hud", x, y })}
      />

      <React.Suspense fallback={null}>
        {newOpen ? <NewDocumentDialog open={newOpen} onOpenChange={setNewDialogOpen} /> : null}
        {imageSizeOpen ? <ImageSizeDialog open={imageSizeOpen} onOpenChange={setImageSizeOpen} /> : null}
        {canvasSizeOpen ? <CanvasSizeDialog open={canvasSizeOpen} onOpenChange={setCanvasSizeOpen} /> : null}
        {commandOpen ? <CommandPalette open={commandOpen} onOpenChange={setCommandPaletteOpen} onOpenNew={openNew} /> : null}
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
  const { dispatch, requestRender } = useEditorSelector((editor) => editor)
  const presetName = searchParams.get("preset")
  const recentId = searchParams.get("recent")
  const learnId = searchParams.get("learn")
  const startupImportId = searchParams.get(STARTUP_IMAGE_IMPORT_PARAM)
  const handledKeyRef = React.useRef<string | null>(null)
  const inFlightKeyRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const key = `${presetName ?? ""}|${recentId ?? ""}|${learnId ?? ""}|${startupImportId ?? ""}`
    const hasStartupRoute = !!presetName || !!recentId || !!learnId || !!startupImportId
    if (!hasStartupRoute || handledKeyRef.current === key || inFlightKeyRef.current === key) return
    inFlightKeyRef.current = key
    let cancelled = false
    const markHandled = () => {
      if (cancelled) return
      handledKeyRef.current = key
      if (inFlightKeyRef.current === key) inFlightKeyRef.current = null
    }
    const clearInFlight = () => {
      if (inFlightKeyRef.current === key) inFlightKeyRef.current = null
    }

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
      markHandled()
      return true
    }

    const openRecent = async () => {
      if (!recentId || presetName) return
      const recent = readRecentDocuments().find((item) => item.id === recentId)
      if (!recent) return
      try {
        const { deserializeProject } = await import("@/components/photoshop/document-io")
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
        markHandled()
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Could not open recent document")
          markHandled()
        }
      }
    }

    const openStartupImport = async () => {
      if (!startupImportId || presetName || recentId) return
      try {
        const {
          generateDocumentThumbnail,
          loadRasterCanvasFromFile,
          serializeProject,
        } = await import("@/components/photoshop/document-io")
        const file = await readStartupImageImport(startupImportId)
        if (!file) {
          toast.error("The selected image is no longer available. Choose it again from Home.")
          markHandled()
          return
        }
        const raster = await loadRasterCanvasFromFile(file)
        if (cancelled) return
        const doc = createDocumentFromRasterImport(file, raster)
        dispatch({
          type: "replace-startup-document",
          doc,
          entry: makeHistoryEntry(doc, raster.mode === "reduced-scale" ? "Open Reduced Image" : "Open"),
          lifecycle: {
            storage: "opened-file",
            fileKind: "image",
            fileName: file.name,
            lastSaveNote: "Opened from the Home image picker. The browser did not provide a reusable local file handle.",
          },
        })
        rememberRecentDocument({
          name: doc.name,
          kind: "image",
          serialized: serializeProject(doc),
          thumbnail: generateDocumentThumbnail(doc),
          fileName: file.name,
          storage: "opened-file",
        })
        requestRender()
        void deleteStartupImageImport(startupImportId)
        markHandled()
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Could not open selected image")
          markHandled()
        }
      }
    }

    const presetOpened = openPreset()
    if (!presetOpened) {
      void openRecent().finally(clearInFlight)
      void openStartupImport().finally(clearInFlight)
      if (!recentId && !startupImportId) clearInFlight()
    } else {
      clearInFlight()
    }

    if (learnId) {
      window.setTimeout(() => {
        if (cancelled) return
        const item = buildLearningIndex().find((candidate) => candidate.id === learnId)
        if (item) runLearningIndexItem(item)
        markHandled()
      }, 350)
    }

    return () => {
      cancelled = true
      clearInFlight()
    }
  }, [dispatch, learnId, presetName, recentId, requestRender, startupImportId])

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
  ...rest
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
  // Mount the panel only while open so its focus-management hooks run on
  // every open/close cycle without tripping the rules of hooks here.
  if (!menu) return null
  return <ContextMenuPanel menu={menu} {...rest} />
}

function ContextMenuPanel({
  menu,
  activeDoc,
  statusBarVisible,
  onClose,
  onCommandPalette,
  onToggleStatusBar,
  onHudColorPicker,
  onZoom,
}: {
  menu: WorkspaceContextMenu
  activeDoc: boolean
  statusBarVisible: boolean
  onClose: () => void
  onCommandPalette: () => void
  onToggleStatusBar: () => void
  onHudColorPicker: (x: number, y: number) => void
  onZoom: (zoom: number) => void
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Move focus into the menu on open and hand it back to the previously
  // focused element on close, per the WAI-ARIA menu pattern.
  React.useEffect(() => {
    const previous = document.activeElement
    containerRef.current
      ?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")
      ?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") {
      onClose()
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return
    const items = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [],
    )
    if (!items.length) return
    event.preventDefault()
    if (event.key === "Home") {
      items[0].focus()
      return
    }
    if (event.key === "End") {
      items[items.length - 1].focus()
      return
    }
    const index = items.indexOf(document.activeElement as HTMLElement)
    const delta = event.key === "ArrowDown" ? 1 : -1
    const next = index === -1 ? (delta === 1 ? 0 : items.length - 1) : (index + delta + items.length) % items.length
    items[next].focus()
  }

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
      ref={containerRef}
      role="menu"
      aria-label={menuLabel}
      data-context-menu-root
      className="fixed z-[1000] w-56 overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] py-1 text-[12px] text-[var(--ps-text)] shadow-2xl"
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={handleKeyDown}
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
