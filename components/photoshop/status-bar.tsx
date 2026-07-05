"use client"

import * as React from "react"
import { X } from "lucide-react"
import { useActiveDocument, useEditorStateSelector } from "./editor-context"
import { requestCanvasZoom } from "./zoom-events"

export function StatusBar({ onHide }: { onHide?: () => void }) {
  const activeDoc = useActiveDocument()
  const tool = useEditorStateSelector((state) => state.tool)
  const brushSize = useEditorStateSelector((state) => state.brush.size)
  const foreground = useEditorStateSelector((state) => state.foreground)
  const [zoomInput, setZoomInput] = React.useState("")

  React.useEffect(() => {
    setZoomInput(`${Math.round((activeDoc?.zoom ?? 1) * 100)}%`)
  }, [activeDoc?.zoom])

  if (!activeDoc) {
    return (
      <div
        data-testid="status-bar"
        className="flex h-6 items-center border-t border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-2 text-[11px] text-[var(--ps-text-dim)]"
      >
        <span>Ready</span>
        <div className="flex-1" />
        {onHide ? <HideButton onHide={onHide} /> : null}
      </div>
    )
  }

  const documentBytes = activeDoc.width * activeDoc.height * 4
  const layeredMegabytes = documentBytes * activeDoc.layers.length / 1024 / 1024
  const colorManagement = activeDoc.colorManagement
  const showPrecisionWarning =
    activeDoc.bitDepth > 8 ||
    activeDoc.colorMode !== "RGB" ||
    (activeDoc.modeSettings?.mode !== undefined && activeDoc.modeSettings.mode !== "RGB") ||
    colorManagement?.proofColors === true ||
    colorManagement?.gamutWarning === true ||
    !!colorManagement?.proofChannels?.length ||
    (!!colorManagement?.assignedProfile && colorManagement.assignedProfile !== "sRGB IEC61966-2.1")

  return (
    <div
      data-testid="status-bar"
      className="flex h-6 items-center gap-3 overflow-hidden border-t border-[var(--ps-divider)] bg-[var(--ps-chrome)] px-2 text-[11px] text-[var(--ps-text-dim)]"
    >
      <input
        value={zoomInput}
        aria-label="Zoom level"
        title="Zoom level (percent)"
        onChange={(event) => setZoomInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          const zoom = Number.parseFloat(zoomInput.replace("%", ""))
          if (Number.isFinite(zoom)) requestCanvasZoom({ zoom: zoom / 100 })
        }}
        onBlur={() => setZoomInput(`${Math.round(activeDoc.zoom * 100)}%`)}
        className="h-4 w-14 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[11px] tabular-nums text-[var(--ps-text)]"
      />
      <span>
        Doc: {Math.floor(documentBytes / 1024 / 1024)}.0M / {layeredMegabytes.toFixed(1)}M
      </span>
      <span>|</span>
      <span>{activeDoc.width} x {activeDoc.height}px</span>
      <span>|</span>
      <span suppressHydrationWarning>{activeDoc.colorMode} / {activeDoc.bitDepth} bit</span>
      <span>|</span>
      <span
        className={activeDoc.bitDepth > 8 ? "text-amber-200" : undefined}
        title="Browser canvas display uses an 8-bit RGBA preview. Open Browser Diagnostics for capability and precision details."
      >
        {activeDoc.bitDepth > 8
          ? `High-bit edit path | Preview: 8-bit | Document: ${activeDoc.bitDepth}-bit`
          : "Editing at 8-bit"}
      </span>
      {showPrecisionWarning ? (
        <>
          <span>|</span>
          <span
            data-testid="status-precision-warning"
            className="max-w-[180px] truncate rounded-[2px] border border-amber-400/40 bg-amber-400/10 px-1 text-amber-200"
            title="The document uses color or precision semantics beyond the browser canvas display path. Open Browser Diagnostics for details."
          >
            Precision warning
          </span>
        </>
      ) : null}
      <span>|</span>
      <span>{activeDoc.layers.length} layers</span>
      <div className="flex-1" />
      <span className="capitalize">{tool}</span>
      <span>|</span>
      <span suppressHydrationWarning>Brush {brushSize}px</span>
      <span>|</span>
      <span className="flex items-center gap-1">
        FG
        <span
          className="inline-block h-3 w-3 border border-[var(--ps-text-dim)]"
          style={{ background: foreground }}
        />
      </span>
      {onHide ? <HideButton onHide={onHide} /> : null}
    </div>
  )
}

function HideButton({ onHide }: { onHide: () => void }) {
  return (
    <button
      type="button"
      aria-label="Hide info bar"
      title="Hide info bar"
      onClick={onHide}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
    >
      <X className="h-3 w-3" />
    </button>
  )
}
