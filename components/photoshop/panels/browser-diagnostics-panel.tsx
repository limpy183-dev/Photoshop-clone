"use client"

import * as React from "react"
import { CheckCircle2, Clipboard, Download, RefreshCw, TriangleAlert } from "lucide-react"
import {
  collectBrowserDiagnosticsSnapshot,
  createBrowserDiagnosticsReport,
  formatBrowserDiagnosticsReport,
  type BrowserDiagnosticRow,
  type BrowserDiagnosticsDocumentSnapshot,
  type BrowserDiagnosticsReport,
} from "../browser-diagnostics"
import { downloadText } from "../document-io"
import { useEditor } from "../editor-context"
import type { PsDocument } from "../types"

function documentSnapshot(doc: PsDocument | null | undefined): BrowserDiagnosticsDocumentSnapshot | null {
  if (!doc) return null
  return {
    width: doc.width,
    height: doc.height,
    colorMode: doc.colorMode,
    bitDepth: doc.bitDepth,
    layers: doc.layers.map((layer) => ({
      kind: layer.kind,
      smartObject: layer.smartObject,
      smartFilters: layer.smartFilters?.map((filter) => ({ enabled: filter.enabled })),
      adjustment: layer.adjustment,
      frame: layer.frame,
      artboard: layer.artboard,
      threeD: layer.threeD,
      video: layer.video,
      plugins: (layer as { plugins?: unknown }).plugins,
    })),
    plugins: doc.plugins,
    variableDataSets: doc.variableDataSets,
    comps: doc.comps,
    slices: doc.slices,
    guides: doc.guides,
    metadata: doc.metadata,
    colorManagement: doc.colorManagement,
  }
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  if (typeof document === "undefined") throw new Error("Clipboard API unavailable")
  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.style.position = "fixed"
  textArea.style.left = "-9999px"
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  try {
    const copied = document.execCommand("copy")
    if (!copied) throw new Error("Copy command rejected")
  } finally {
    textArea.remove()
  }
}

function statusClass(status: BrowserDiagnosticRow["status"]) {
  if (status === "ok") return "text-emerald-300"
  if (status === "warn") return "text-amber-300"
  if (status === "unavailable") return "text-red-300"
  return "text-[var(--ps-text-dim)]"
}

function StatusIcon({ status }: { status: BrowserDiagnosticRow["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-3 w-3 text-emerald-300" />
  if (status === "warn" || status === "unavailable") return <TriangleAlert className="h-3 w-3 text-amber-300" />
  return <span className="h-3 w-3 rounded-full border border-[var(--ps-divider)]" />
}

function ReportSection({
  title,
  rows,
}: {
  title: string
  rows: BrowserDiagnosticRow[]
}) {
  return (
    <section className="rounded-sm border border-[var(--ps-divider)]">
      <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] font-medium uppercase text-[var(--ps-text-dim)]">
        {title}
      </div>
      <div className="divide-y divide-[var(--ps-divider)]">
        {rows.map((row, index) => (
          <div key={`${row.label}-${index}`} className="grid grid-cols-[14px_92px_minmax(0,1fr)] gap-1.5 px-2 py-1.5 text-[10px]">
            <StatusIcon status={row.status} />
            <span className="text-[var(--ps-text-dim)]">{row.label}</span>
            <span className={`${statusClass(row.status)} min-w-0 break-words tabular-nums`} title={row.detail ?? row.value}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function BrowserDiagnosticsPanel() {
  const { activeDoc } = useEditor()
  const [report, setReport] = React.useState<BrowserDiagnosticsReport | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState("")

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setMessage("")
    try {
      const snapshot = await collectBrowserDiagnosticsSnapshot(documentSnapshot(activeDoc))
      setReport(createBrowserDiagnosticsReport(snapshot))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [activeDoc])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const reportText = React.useMemo(() => report ? formatBrowserDiagnosticsReport(report) : "", [report])

  const copyReport = async () => {
    if (!reportText) return
    try {
      await copyText(reportText)
      setMessage("Report copied")
    } catch {
      setMessage("Clipboard unavailable")
    }
  }

  const exportReport = () => {
    if (!reportText) return
    downloadText(reportText, "browser-diagnostics-report.txt", "text/plain")
    setMessage("Report exported")
  }

  return (
    <div data-testid="browser-diagnostics-panel" className="flex max-h-full flex-col gap-2 p-2 text-[11px] text-[var(--ps-text)]">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Refresh diagnostic report"
          title="Refresh"
          onClick={refresh}
          disabled={loading}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:opacity-50"
        >
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        </button>
        <button
          type="button"
          aria-label="Copy diagnostic report"
          title="Copy report"
          onClick={copyReport}
          disabled={!reportText}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:opacity-50"
        >
          <Clipboard className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Export diagnostic report"
          title="Export report"
          onClick={exportReport}
          disabled={!reportText}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1 text-right text-[10px] text-[var(--ps-text-dim)]">
          {report ? new Date(report.generatedAt).toLocaleTimeString() : loading ? "Scanning" : "Not scanned"}
        </div>
      </div>

      {message ? (
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] text-[var(--ps-text-dim)]">
          {message}
        </div>
      ) : null}

      {report ? (
        <>
          <div className={report.fallbacks.length ? "rounded-sm border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-200" : "rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]"}>
            {report.summary}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {report.sections.map((section) => (
              <ReportSection key={section.id} title={section.title} rows={section.rows} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[11px] text-[var(--ps-text-dim)]">
          {loading ? "Scanning browser capabilities" : "No diagnostic report available"}
        </div>
      )}
    </div>
  )
}
