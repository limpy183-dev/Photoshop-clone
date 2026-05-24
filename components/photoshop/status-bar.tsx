"use client"

import * as React from "react"
import { X } from "lucide-react"
import { describeDocumentColorHonesty } from "./color-pipeline"
import { useEditor } from "./editor-context"
import { createHeapMemoryMonitor, formatMemoryUsage, getGlobalMemoryBudget } from "./memory-budget"
import { detectOffscreenCanvasCapabilities, diagnoseOffscreenCanvasTransfer } from "./offscreen-canvas"
import { requestCanvasZoom } from "./zoom-events"

export function StatusBar({ onHide }: { onHide?: () => void }) {
  const { activeDoc, tool, brush, foreground } = useEditor()
  const [zoomInput, setZoomInput] = React.useState("")
  const [memoryUsage, setMemoryUsage] = React.useState("")
  const [clientReady, setClientReady] = React.useState(false)
  const offscreenDiagnostic = React.useMemo(() => {
    const capabilities = detectOffscreenCanvasCapabilities()
    return diagnoseOffscreenCanvasTransfer({
      requestedWorker: true,
      offscreenCanvasSupported: capabilities.offscreenCanvasSupported,
      workerTransferSupported: capabilities.workerOffscreenSupported,
      transferToImageBitmapSupported: capabilities.transferToImageBitmapSupported,
    })
  }, [])
  const colorHonesty = React.useMemo(
    () => activeDoc ? describeDocumentColorHonesty(activeDoc) : null,
    [activeDoc],
  )
  const showPrecisionWarning = clientReady && !!colorHonesty?.hasWarnings
  const editingDepthLabel = clientReady && activeDoc && activeDoc.bitDepth > 8
    ? `Editing at 8-bit | Document: ${activeDoc.bitDepth}-bit`
    : "Editing at 8-bit"

  React.useEffect(() => {
    setClientReady(true)
  }, [])

  React.useEffect(() => {
    setZoomInput(`${Math.round((activeDoc?.zoom ?? 1) * 100)}%`)
  }, [activeDoc?.zoom])

  React.useEffect(() => {
    const monitor = createHeapMemoryMonitor({ tracker: getGlobalMemoryBudget() })
    const update = () => setMemoryUsage(formatMemoryUsage(monitor.sample()))
    update()
    const id = window.setInterval(update, 2500)
    return () => window.clearInterval(id)
  }, [])

  if (!activeDoc) {
    return (
      <div
        data-testid="status-bar"
        className="h-6 bg-[var(--ps-chrome)] border-t border-[var(--ps-divider)] text-[11px] text-[var(--ps-text-dim)] px-2 flex items-center"
      >
        <span>Ready</span>
        <div className="flex-1" />
        {onHide ? (
          <button
            type="button"
            aria-label="Hide info bar"
            title="Hide info bar"
            onClick={onHide}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div
      data-testid="status-bar"
      className="h-6 bg-[var(--ps-chrome)] border-t border-[var(--ps-divider)] text-[11px] text-[var(--ps-text-dim)] px-2 flex items-center gap-3 overflow-hidden"
    >
      <input
        value={zoomInput}
        aria-label="Zoom level"
        title="Zoom level (percent)"
        onChange={(e) => setZoomInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const num = parseFloat(zoomInput.replace("%", ""))
            if (!Number.isNaN(num)) {
              requestCanvasZoom({ zoom: num / 100 })
            }
          }
        }}
        onBlur={() => setZoomInput(`${Math.round(activeDoc.zoom * 100)}%`)}
        className="w-14 h-4 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px] tabular-nums text-[var(--ps-text)]"
      />
      <span>
        Doc: {(((activeDoc.width * activeDoc.height * 4) / 1024 / 1024) | 0)}.0M /{" "}
        {((activeDoc.width * activeDoc.height * 4 * activeDoc.layers.length) / 1024 / 1024).toFixed(
          1,
        )}
        M
      </span>
      <span>|</span>
      <span>
        {activeDoc.width} x {activeDoc.height}px
      </span>
      <span>|</span>
      <span suppressHydrationWarning>
        {activeDoc.colorMode} / {activeDoc.bitDepth} bit
      </span>
      <span>|</span>
      <span
        suppressHydrationWarning
        className={clientReady && activeDoc.bitDepth > 8 ? "text-amber-200" : undefined}
        title="Browser canvas painting and display are 8-bit RGBA."
      >
        {editingDepthLabel}
      </span>
      {showPrecisionWarning ? (
        <>
          <span>|</span>
          <span
            className="max-w-[320px] truncate rounded-[2px] border border-amber-400/40 bg-amber-400/10 px-1 text-amber-200"
            title={colorHonesty.items.map((item) => `${item.label}: ${item.detail}`).join("\n")}
          >
            Precision warning
          </span>
        </>
      ) : null}
      <span>|</span>
      <span>{activeDoc.layers.length} layers</span>
      {memoryUsage ? (
        <>
          <span>|</span>
          <span title={memoryUsage}>{memoryUsage}</span>
        </>
      ) : null}
      {clientReady && !offscreenDiagnostic.active ? (
        <>
          <span>|</span>
          <span title={offscreenDiagnostic.warning ?? offscreenDiagnostic.reason} className="text-amber-300">
            {offscreenDiagnostic.badge}
          </span>
        </>
      ) : null}

      <div className="flex-1" />

      <span className="capitalize">{tool}</span>
      <span>|</span>
      {/* brush.size comes from persisted state and may differ between SSR
          (defaults) and the client (localStorage). suppressHydrationWarning
          accepts the client value without warning — visually correct,
          accessibility-safe (the value is read by the user, not assistive
          tech). */}
      <span suppressHydrationWarning>Brush {brush.size}px</span>
      <span>|</span>
      <span className="flex items-center gap-1">
        FG
        <span
          className="inline-block w-3 h-3 border border-[var(--ps-text-dim)]"
          style={{ background: foreground }}
        />
      </span>
      {onHide ? (
        <button
          type="button"
          aria-label="Hide info bar"
          title="Hide info bar"
          onClick={onHide}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
}
