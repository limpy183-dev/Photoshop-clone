"use client"

import * as React from "react"

import { CanvasView } from "@/components/photoshop/canvas/view"
import { DocumentTabs } from "@/components/photoshop/document/tabs"
import { MenuBar } from "@/components/photoshop/menu-bar"
import { OptionsBar } from "@/components/photoshop/options-bar"
import { PanelDock } from "@/components/photoshop/panel-dock"
import { ResizeHandle } from "@/components/photoshop/resize-handle"
import { StatusBar } from "@/components/photoshop/status-bar"
import { ToolPalette } from "@/components/photoshop/tool/palette"

interface EditorShellProps {
  hideMenuBar: boolean
  hideOptionsBar: boolean
  hideDocumentTabs: boolean
  hidePanels: boolean
  hideStatusBar: boolean
  hideToolPalette: boolean
  statusBarVisible: boolean
  showCanvas: boolean
  centerContent?: React.ReactNode
  dockWidth: number
  panelOverlay: boolean
  onOpenNew: () => void
  onToggleStatusBar: () => void
  onHideStatusBar: () => void
  onResizeDock: (delta: number) => void
  onResizeDockEnd: () => void
}

/**
 * One persistent-chrome boundary for the editor. Keeping the always-visible
 * shell together prevents independent async fragments from shifting the canvas
 * while an interaction is in progress.
 */
export function EditorShell({
  hideMenuBar,
  hideOptionsBar,
  hideDocumentTabs,
  hidePanels,
  hideStatusBar,
  hideToolPalette,
  statusBarVisible,
  showCanvas,
  centerContent,
  dockWidth,
  panelOverlay,
  onOpenNew,
  onToggleStatusBar,
  onHideStatusBar,
  onResizeDock,
  onResizeDockEnd,
}: EditorShellProps) {
  return (
    <>
      <MenuBar
        hidden={hideMenuBar}
        onOpenNew={onOpenNew}
        statusBarVisible={statusBarVisible && !hideStatusBar}
        onToggleStatusBar={onToggleStatusBar}
      />
      {hideOptionsBar ? null : <OptionsBar />}
      {hideDocumentTabs ? null : <DocumentTabs />}
      <div className="relative flex min-h-0 flex-1">
        {hideToolPalette ? null : <ToolPalette />}
        {showCanvas ? <CanvasView /> : centerContent}
        {hidePanels || panelOverlay ? null : (
          <ResizeHandle
            direction="horizontal"
            ariaLabel="Resize right sidebar"
            onResize={onResizeDock}
            onResizeEnd={onResizeDockEnd}
          />
        )}
        {hidePanels ? null : <PanelDock width={dockWidth} overlay={panelOverlay} />}
      </div>
      {statusBarVisible && !hideStatusBar ? <StatusBar onHide={onHideStatusBar} /> : null}
    </>
  )
}
