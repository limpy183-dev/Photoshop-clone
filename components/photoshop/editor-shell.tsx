"use client"

import * as React from "react"

import { CanvasView } from "./canvas-view"
import { DocumentTabs } from "./document-tabs"
import { MenuBar } from "./menu-bar"
import { OptionsBar } from "./options-bar"
import { PanelDock } from "./panel-dock"
import { ResizeHandle } from "./resize-handle"
import { StatusBar } from "./status-bar"
import { ToolPalette } from "./tool-palette"

interface EditorShellProps {
  hideMenuBar: boolean
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
      {hideMenuBar ? null : (
        <MenuBar
          onOpenNew={onOpenNew}
          statusBarVisible={statusBarVisible && !hideStatusBar}
          onToggleStatusBar={onToggleStatusBar}
        />
      )}
      {hideMenuBar ? null : <OptionsBar />}
      {hideMenuBar ? null : <DocumentTabs />}
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
