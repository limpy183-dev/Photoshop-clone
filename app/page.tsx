"use client"

import * as React from "react"
import { EditorProvider, useEditor } from "@/components/photoshop/editor-context"
import { MenuBar } from "@/components/photoshop/menu-bar"
import { OptionsBar } from "@/components/photoshop/options-bar"
import { ToolPalette } from "@/components/photoshop/tool-palette"
import { CanvasView } from "@/components/photoshop/canvas-view"
import { PanelDock } from "@/components/photoshop/panel-dock"
import { StatusBar } from "@/components/photoshop/status-bar"
import { DocumentTabs } from "@/components/photoshop/document-tabs"
import { NewDocumentDialog } from "@/components/photoshop/new-document-dialog"
import { useShortcuts } from "@/components/photoshop/use-shortcuts"
import { ResizeHandle } from "@/components/photoshop/resize-handle"
import { useMounted } from "@/components/photoshop/use-mounted"
import {
  applyPreferencesToDocumentSettings,
  loadPreferencesFromStorage,
  normalizePreferences,
} from "@/components/photoshop/preferences-engine"
import { requestCanvasZoom } from "@/components/photoshop/zoom-events"

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

const STATUS_BAR_VISIBILITY_KEY = "ps-status-bar-visible"

type WorkspaceContextMenu = {
  x: number
  y: number
  kind: "canvas" | "app"
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
  const { activeDocId, activeDoc, dispatch } = useEditor()
  const [newOpen, setNewOpen] = React.useState(false)
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [imageSizeOpen, setImageSizeOpen] = React.useState(false)
  const [canvasSizeOpen, setCanvasSizeOpen] = React.useState(false)
  const [statusBarVisible, setStatusBarVisible] = React.useState(true)
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

    const handler = (event: Event) => {
      const nextWidth = Number((event as CustomEvent).detail)
      if (!Number.isFinite(nextWidth)) return
      setDockWidth(Math.max(340, Math.min(720, nextWidth)))
    }
    window.addEventListener("ps-set-dock-width", handler)
    return () => window.removeEventListener("ps-set-dock-width", handler)
  }, [])

  React.useEffect(() => {
    const openHandler = () => setCommandOpen(true)

    window.addEventListener("ps-open-command-palette", openHandler)
    return () => {
      window.removeEventListener("ps-open-command-palette", openHandler)
    }
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
    <main className="h-screen w-screen flex flex-col bg-[var(--ps-chrome)] text-[var(--ps-text)]">
      <MenuBar
        onOpenNew={openNew}
        statusBarVisible={statusBarVisible}
        onToggleStatusBar={toggleStatusBarVisibility}
      />
      <OptionsBar />
      <DocumentTabs />
      <div className="flex-1 flex min-h-0">
        <ToolPalette />
        <CanvasView />
        <ResizeHandle
          direction="horizontal"
          ariaLabel="Resize right sidebar"
          onResize={resizeDock}
          onResizeEnd={saveDockWidth}
        />
        <PanelDock width={mounted ? dockWidth : 380} />
      </div>
      {statusBarVisible ? <StatusBar onHide={() => setStatusBarVisibility(false)} /> : null}

      {/* Context menu lives in its own subtree so opening/closing it does
          not re-render the workspace shell. */}
      <ContextMenuLayer
        hasActiveDoc={!!activeDoc}
        statusBarVisible={statusBarVisible}
        onCommandPalette={openCommandPalette}
        onToggleStatusBar={toggleStatusBarVisibility}
      />

      <NewDocumentDialog open={newOpen} onOpenChange={setNewOpen} />
      <React.Suspense fallback={null}>
        {imageSizeOpen ? <ImageSizeDialog open={imageSizeOpen} onOpenChange={setImageSizeOpen} /> : null}
        {canvasSizeOpen ? <CanvasSizeDialog open={canvasSizeOpen} onOpenChange={setCanvasSizeOpen} /> : null}
        {commandOpen ? <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onOpenNew={openNew} /> : null}
        <AutosaveRecovery />
      </React.Suspense>
    </main>
  )
}

// Isolated overlay that owns the right-click context-menu state. Listens
// for contextmenu / click on window so the workspace shell never re-renders
// when the menu opens, moves, or closes.
function ContextMenuLayer({
  hasActiveDoc,
  statusBarVisible,
  onCommandPalette,
  onToggleStatusBar,
}: {
  hasActiveDoc: boolean
  statusBarVisible: boolean
  onCommandPalette: () => void
  onToggleStatusBar: () => void
}) {
  const [menu, setMenu] = React.useState<WorkspaceContextMenu | null>(null)
  const rightClickGestureRef = React.useRef<{
    x: number
    y: number
    modified: boolean
    moved: boolean
  } | null>(null)

  React.useEffect(() => {
    const hasKeybindModifier = (event: MouseEvent) =>
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey

    const onContextMenu = (event: MouseEvent) => {
      // Allow native context menu on inputs / textareas / editable elements
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, [contenteditable=true]")) return
      event.preventDefault()
      const gesture = rightClickGestureRef.current
      rightClickGestureRef.current = null
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
      if (event.button === 0) setMenu(null)
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
  onZoom,
}: {
  menu: WorkspaceContextMenu | null
  activeDoc: boolean
  statusBarVisible: boolean
  onClose: () => void
  onCommandPalette: () => void
  onToggleStatusBar: () => void
  onZoom: (zoom: number) => void
}) {
  if (!menu) return null

  const run = (action: () => void) => {
    action()
    onClose()
  }
  const openPanel = (id: string) => {
    window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: id }))
  }
  const openExportAs = () => {
    window.dispatchEvent(new CustomEvent("ps-open-export-as"))
  }
  const menuLabel = menu.kind === "canvas" ? "Canvas context menu" : "App context menu"

  return (
    <div
      role="menu"
      aria-label={menuLabel}
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
