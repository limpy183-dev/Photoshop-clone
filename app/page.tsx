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

  return (
    <main className="h-screen w-screen flex flex-col bg-[var(--ps-chrome)] text-[var(--ps-text)]">
      <MenuBar onOpenNew={openNew} />
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
      <StatusBar />
      <NewDocumentDialog open={newOpen} onOpenChange={setNewOpen} />
      <ImageSizeDialog open={imageSizeOpen} onOpenChange={setImageSizeOpen} />
      <CanvasSizeDialog open={canvasSizeOpen} onOpenChange={setCanvasSizeOpen} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onOpenNew={openNew} />
      <AutosaveRecovery />
    </main>
  )
}
