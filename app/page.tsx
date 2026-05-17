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
import { CommandPalette } from "@/components/photoshop/command-palette"
import { AutosaveRecovery } from "@/components/photoshop/autosave-recovery"
import { useShortcuts } from "@/components/photoshop/use-shortcuts"
import { ResizeHandle } from "@/components/photoshop/resize-handle"
import { ImageSizeDialog } from "@/components/photoshop/image-size-dialog"
import { CanvasSizeDialog } from "@/components/photoshop/canvas-size-dialog"
import {
  applyPreferencesToDocumentSettings,
  loadPreferencesFromStorage,
  normalizePreferences,
} from "@/components/photoshop/preferences-engine"

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

function Workspace() {
  const { activeDocId, activeDoc, dispatch } = useEditor()
  const [newOpen, setNewOpen] = React.useState(false)
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [imageSizeOpen, setImageSizeOpen] = React.useState(false)
  const [canvasSizeOpen, setCanvasSizeOpen] = React.useState(false)
  const [statusBarVisible, setStatusBarVisible] = React.useState(true)
  const [contextMenu, setContextMenu] = React.useState<WorkspaceContextMenu | null>(null)
  const openNew = React.useCallback(() => setNewOpen(true), [])
  const openCommandPalette = React.useCallback(() => setCommandOpen(true), [])
  useShortcuts(openNew, openCommandPalette)

  const [dockWidth, setDockWidth] = React.useState(380)
  const dockWidthRef = React.useRef(dockWidth)
  const activeDocRef = React.useRef(activeDoc)

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
      if (saved) setDockWidth(Math.max(340, Math.min(720, Number(saved))))
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

  React.useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
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
  }, [contextMenu])

  const openContextMenu = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    const target = event.target as HTMLElement | null
    const menuWidth = 232
    const menuHeight = target?.closest("[data-canvas-root]") ? 292 : 244
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8))
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    setContextMenu({
      x,
      y,
      kind: target?.closest("[data-canvas-root]") ? "canvas" : "app",
    })
  }, [])

  const closeContextMenu = React.useCallback(() => setContextMenu(null), [])

  return (
    <main
      className="h-screen w-screen flex flex-col bg-[var(--ps-chrome)] text-[var(--ps-text)]"
      onClick={closeContextMenu}
      onContextMenu={openContextMenu}
    >
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
        <PanelDock width={dockWidth} />
      </div>
      {statusBarVisible ? <StatusBar onHide={() => setStatusBarVisibility(false)} /> : null}
      <AppContextMenu
        menu={contextMenu}
        activeDoc={!!activeDoc}
        statusBarVisible={statusBarVisible}
        onClose={closeContextMenu}
        onCommandPalette={() => setCommandOpen(true)}
        onToggleStatusBar={toggleStatusBarVisibility}
        onZoom={(zoom) => dispatch({ type: "set-zoom", zoom })}
      />
      <NewDocumentDialog open={newOpen} onOpenChange={setNewOpen} />
      <ImageSizeDialog open={imageSizeOpen} onOpenChange={setImageSizeOpen} />
      <CanvasSizeDialog open={canvasSizeOpen} onOpenChange={setCanvasSizeOpen} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onOpenNew={openNew} />
      <AutosaveRecovery />
    </main>
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
