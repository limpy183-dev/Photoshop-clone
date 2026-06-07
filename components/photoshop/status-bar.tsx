"use client"

import * as React from "react"
import { X } from "lucide-react"
import { describeDocumentColorHonesty } from "./color-pipeline"
import { createExportLimitationReport, type ExportFormat } from "./document-io"
import { useEditor } from "./editor-context"
import { planFilterPreviewExecution } from "./filter-preview"
import { createHeapMemoryMonitor, formatMemoryUsage, getGlobalMemoryBudget, planRuntimeMemoryPressure, type RuntimeMemoryPressurePlan } from "./memory-budget"
import { detectOffscreenCanvasCapabilities, diagnoseOffscreenCanvasTransfer } from "./offscreen-canvas"
import { loadPreferencesFromStorage, summarizePerformancePolicy, type PerformancePolicySummary, type PhotoshopPreferences } from "./preferences-engine"
import { createTileOnlyCapabilityDashboard, type TileOnlyCapabilityDashboard } from "./tile-only-pipeline"
import { requestCanvasZoom } from "./zoom-events"
import { diagnoseBrowserLargeDocumentLimits, type BrowserLargeDocumentDiagnostics } from "./large-document"

function BrowserDiagnosticsBadge({ diagnostics }: { diagnostics: BrowserLargeDocumentDiagnostics | null }) {
  if (!diagnostics) return null
  const title = [
    `Canvas: ${diagnostics.canvas.detail}`,
    `GPU: ${diagnostics.gpu.detail}`,
    `Memory: ${diagnostics.memory.detail}`,
    `Offscreen: ${diagnostics.offscreen.detail}`,
    ...diagnostics.fallbacks,
  ].join("\n")
  const warning =
    diagnostics.canvas.status !== "ok" ||
    diagnostics.gpu.status !== "ok" ||
    diagnostics.memory.status === "limited" ||
    diagnostics.offscreen.status !== "ok"
  return (
    <span
      data-testid="browser-diagnostics"
      title={title}
      className={warning ? "text-amber-300" : "text-[var(--ps-text-dim)]"}
    >
      Browser limits
    </span>
  )
}

function PerformanceConfidenceBadge({
  policy,
  pressure,
  dashboard,
  offscreenActive,
  autosave,
}: {
  policy: PerformancePolicySummary | null
  pressure: RuntimeMemoryPressurePlan | null
  dashboard: TileOnlyCapabilityDashboard | null
  offscreenActive: boolean
  autosave: string
}) {
  if (!policy) return null
  const tileState = dashboard
    ? dashboard.blockedCount > 0
      ? "Tile blocked"
      : dashboard.approximateCount > 0
        ? "Tile managed"
        : "Tile safe"
    : "No tile plan"
  const memoryState = pressure?.level === "hard" ? "Memory hard" : pressure?.level === "soft" ? "Memory soft" : "Memory ok"
  const warning = pressure?.level !== "ok" || dashboard?.blockedCount
  const title = [
    `Mode: ${policy.performanceModeLabel}`,
    `Memory: ${memoryState}${pressure ? `, evict ${Math.round(pressure.recommendedEvictBytes / (1024 * 1024))} MB recommended` : ""}`,
    `Tile mode: ${tileState}${dashboard ? ` (${dashboard.tileColumns} x ${dashboard.tileRows}, ${dashboard.tileSize}px)` : ""}`,
    `Worker mode: ${offscreenActive && policy.workerFilters ? "worker previews active" : "main-thread fallback"}`,
    `Render path: ${policy.gpuPath}`,
    autosave,
    ...policy.warnings,
  ].join("\n")
  return (
    <span
      data-testid="status-performance-confidence"
      title={title}
      className={`max-w-[360px] truncate rounded-[2px] border px-1 ${warning ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text-dim)]"}`}
    >
      {policy.performanceModeLabel}: {memoryState} / {tileState} / {policy.workerFilters && offscreenActive ? "Worker" : "Main"} / {autosave}
    </span>
  )
}

export function StatusBar({ onHide }: { onHide?: () => void }) {
  const { activeDoc, tool, brush, foreground } = useEditor()
  const [zoomInput, setZoomInput] = React.useState("")
  const [memoryUsage, setMemoryUsage] = React.useState("")
  const [runtimePressure, setRuntimePressure] = React.useState<RuntimeMemoryPressurePlan | null>(null)
  const [clientReady, setClientReady] = React.useState(false)
  const [browserDiagnostics, setBrowserDiagnostics] = React.useState<BrowserLargeDocumentDiagnostics | null>(null)
  const [prefs, setPrefs] = React.useState<PhotoshopPreferences | null>(null)
  // Active export-target format, broadcast by the export dialogs so the
  // status bar can surface format compatibility warnings reactively when the
  // user changes their pick.
  const [activeExportFormat, setActiveExportFormat] = React.useState<ExportFormat | null>(null)
  const offscreenDiagnostic = React.useMemo(() => {
    const capabilities = detectOffscreenCanvasCapabilities()
    return diagnoseOffscreenCanvasTransfer({
      requestedWorker: true,
      offscreenCanvasSupported: capabilities.offscreenCanvasSupported,
      workerTransferSupported: capabilities.workerOffscreenSupported,
      transferToImageBitmapSupported: capabilities.transferToImageBitmapSupported,
    })
  }, [])
  const performancePolicy = React.useMemo(() => prefs ? summarizePerformancePolicy(prefs) : null, [prefs])
  const autosaveStatus = prefs?.fileHandling.autoSave
    ? `Autosave ${prefs.fileHandling.autosaveIntervalSec}s`
    : "Autosave off"
  const tileDashboard = React.useMemo(() => {
    if (!activeDoc) return null
    return createTileOnlyCapabilityDashboard({
      documentWidth: activeDoc.width,
      documentHeight: activeDoc.height,
      tileSize: prefs?.memory.tileSize ?? activeDoc.metadata?.largeDocumentTileView?.tileSize ?? 512,
      explicitTileOnly: !!activeDoc.metadata?.largeDocumentTileView || !!activeDoc.metadata?.largeDocumentTileEdit,
      format: "png",
      colorMode: activeDoc.colorMode,
      bitDepth: activeDoc.bitDepth,
      layers: activeDoc.layers.map((layer) => ({ id: layer.id, kind: layer.kind, visible: layer.visible })),
    })
  }, [activeDoc, prefs?.memory.tileSize])
  const colorHonesty = React.useMemo(
    () => activeDoc ? describeDocumentColorHonesty(activeDoc) : null,
    [activeDoc],
  )
  const showPrecisionWarning = clientReady && !!colorHonesty?.hasWarnings
  const editingDepthLabel = clientReady && activeDoc && activeDoc.bitDepth > 8
    ? `High-bit edit path | Preview: 8-bit | Document: ${activeDoc.bitDepth}-bit`
    : "Editing at 8-bit"

  // Filter-preview vs full-pass divergence. Recomputed reactively whenever the
  // active document dimensions change — the planFilterPreviewExecution
  // function quantises by pixel count, so when the user resizes the canvas or
  // opens a different document the warning updates without user action.
  const filterPreviewWarning = React.useMemo(() => {
    if (!clientReady || !activeDoc) return null
    const plan = planFilterPreviewExecution("gaussian-blur", activeDoc.width, activeDoc.height, {})
    if (plan.previewScale >= 1 && plan.mode !== "tiled-worker" && plan.mode !== "tiled-main") return null
    if (plan.mode === "tiled-worker" || plan.mode === "tiled-main") {
      return {
        kind: "tiled",
        label: `Filter preview: tiled ${plan.tileSize ?? 512}px`,
        detail: `Heavy filters render this ${activeDoc.width}x${activeDoc.height}px document in ${plan.tileSize ?? 512}px tiles; preview composites are reassembled tile-by-tile and the final pass uses the same tiling.`,
      }
    }
    return {
      kind: "downsample",
      label: `Filter preview at ${Math.round(plan.previewScale * 100)}%`,
      detail: `Document ${activeDoc.width}x${activeDoc.height}px exceeds the interactive preview budget. Filter previews run at ${Math.round(plan.previewScale * 100)}% scale; the final pass renders at full resolution and may show extra detail not visible in the preview.`,
    }
  }, [activeDoc, clientReady])

  // Export-target compatibility warning: when the user has an export dialog
  // open we listen for the active format and run the compatibility report.
  // This surfaces "JPEG can't carry alpha" or "GIF flattens 24-bit" etc.
  // without the user having to open the warnings tab in the dialog.
  const exportTargetWarning = React.useMemo(() => {
    if (!clientReady || !activeDoc || !activeExportFormat) return null
    let report
    try {
      report = createExportLimitationReport(activeDoc, { format: activeExportFormat, includeMetadata: false })
    } catch {
      return null
    }
    const items = report.items.filter((item) => item.status === "unsupported" || item.status === "flattened" || item.status === "approximated")
    if (!items.length) return null
    return {
      format: activeExportFormat,
      count: items.length,
      detail: items
        .slice(0, 12)
        .map((item) => `${item.label} (${item.status}): ${item.detail}`)
        .join("\n"),
    }
  }, [activeDoc, activeExportFormat, clientReady])

  React.useEffect(() => {
    setClientReady(true)
    setBrowserDiagnostics(diagnoseBrowserLargeDocumentLimits())
  }, [])

  React.useEffect(() => {
    const refreshPreferences = () => setPrefs(loadPreferencesFromStorage())
    refreshPreferences()
    window.addEventListener("ps-preferences-changed", refreshPreferences)
    return () => window.removeEventListener("ps-preferences-changed", refreshPreferences)
  }, [])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ format?: ExportFormat | null }>).detail ?? {}
      setActiveExportFormat(detail.format ?? null)
    }
    window.addEventListener("ps-active-export-format", handler as EventListener)
    return () => window.removeEventListener("ps-active-export-format", handler as EventListener)
  }, [])

  React.useEffect(() => {
    setZoomInput(`${Math.round((activeDoc?.zoom ?? 1) * 100)}%`)
  }, [activeDoc?.zoom])

  React.useEffect(() => {
    const monitor = createHeapMemoryMonitor({ tracker: getGlobalMemoryBudget() })
    const update = () => {
      const sample = monitor.sample()
      setMemoryUsage(formatMemoryUsage(sample))
      setRuntimePressure(planRuntimeMemoryPressure({
        budgetMB: performancePolicy?.ramBudgetMB,
        declaredBytes: sample.declaredBytes,
        usedJSHeapSize: sample.usedJSHeapSize,
        totalJSHeapSize: sample.totalJSHeapSize,
        jsHeapSizeLimit: sample.jsHeapSizeLimit,
      }))
    }
    update()
    const id = window.setInterval(update, 2500)
    return () => window.clearInterval(id)
  }, [performancePolicy?.ramBudgetMB])

  if (!activeDoc) {
    return (
      <div
        data-testid="status-bar"
        className="h-6 bg-[var(--ps-chrome)] border-t border-[var(--ps-divider)] text-[11px] text-[var(--ps-text-dim)] px-2 flex items-center"
      >
        <span>Ready</span>
        {browserDiagnostics ? (
          <>
            <span className="mx-2">|</span>
            <BrowserDiagnosticsBadge diagnostics={browserDiagnostics} />
          </>
        ) : null}
        {clientReady && performancePolicy ? (
          <>
            <span className="mx-2">|</span>
            <PerformanceConfidenceBadge
              policy={performancePolicy}
              pressure={runtimePressure}
              dashboard={tileDashboard}
              offscreenActive={offscreenDiagnostic.active}
              autosave={autosaveStatus}
            />
          </>
        ) : null}
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
        title="High-bit sources use typed arrays where supported; browser canvas display remains an 8-bit RGBA preview."
      >
        {editingDepthLabel}
      </span>
      {showPrecisionWarning ? (
        <>
          <span>|</span>
          <span
            data-testid="status-precision-warning"
            className="max-w-[320px] truncate rounded-[2px] border border-amber-400/40 bg-amber-400/10 px-1 text-amber-200"
            title={colorHonesty.items.map((item) => `${item.label}: ${item.detail}`).join("\n")}
          >
            Precision warning
          </span>
        </>
      ) : null}
      {filterPreviewWarning ? (
        <>
          <span>|</span>
          <span
            data-testid="status-filter-preview-warning"
            className="max-w-[260px] truncate rounded-[2px] border border-amber-400/40 bg-amber-400/10 px-1 text-amber-200"
            title={filterPreviewWarning.detail}
          >
            {filterPreviewWarning.label}
          </span>
        </>
      ) : null}
      {exportTargetWarning ? (
        <>
          <span>|</span>
          <span
            data-testid="status-export-target-warning"
            className="max-w-[320px] truncate rounded-[2px] border border-amber-400/40 bg-amber-400/10 px-1 text-amber-200"
            title={exportTargetWarning.detail}
          >
            {exportTargetWarning.format.toUpperCase()} export: {exportTargetWarning.count} compat issue{exportTargetWarning.count === 1 ? "" : "s"}
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
      {clientReady && performancePolicy ? (
        <>
          <span>|</span>
          <PerformanceConfidenceBadge
            policy={performancePolicy}
            pressure={runtimePressure}
            dashboard={tileDashboard}
            offscreenActive={offscreenDiagnostic.active}
            autosave={autosaveStatus}
          />
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
      {clientReady && browserDiagnostics ? (
        <>
          <span>|</span>
          <BrowserDiagnosticsBadge diagnostics={browserDiagnostics} />
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
