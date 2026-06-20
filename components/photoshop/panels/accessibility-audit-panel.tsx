"use client"

import * as React from "react"
import { Download, RefreshCw } from "lucide-react"
import { createAccessibilityAuditReport, formatAccessibilityAuditReport, type AccessibilityAuditReport } from "../accessibility-audit"
import { downloadText } from "../document-io"
import { DEFAULT_SHORTCUTS } from "../shortcuts"

const KNOWN_DIALOGS = [
  { id: "keyboard-shortcuts", label: "Keyboard Shortcuts", usesFocusTrap: true, ariaTitle: true, ariaDescription: true },
  { id: "preferences", label: "Preferences", usesFocusTrap: true, ariaTitle: true, ariaDescription: true },
  { id: "preflight", label: "Preflight", usesFocusTrap: true, ariaTitle: true, ariaDescription: true },
]

const COMPACT_CONTROLS = [
  { id: "panel-refresh", label: "Refresh", role: "button", ariaLabel: "Refresh audit", width: 32, height: 32, iconOnly: true },
  { id: "panel-export", label: "Export", role: "button", ariaLabel: "Export audit", width: 32, height: 32, iconOnly: true },
]

export function AccessibilityAuditPanel() {
  const [report, setReport] = React.useState<AccessibilityAuditReport | null>(null)

  const refresh = React.useCallback(() => {
    setReport(createAccessibilityAuditReport({
      shortcuts: DEFAULT_SHORTCUTS,
      panels: [
        { id: "browser-diagnostics", label: "Browser Diagnostics", category: "Inspection and Guides", keywords: ["diagnostics", "health", "webgl"] },
        { id: "accessibility-audit", label: "Accessibility Audit", category: "Inspection and Guides", keywords: ["accessibility", "keyboard", "aria"] },
      ],
      dialogs: KNOWN_DIALOGS,
      controls: COMPACT_CONTROLS,
    }))
  }, [])

  React.useEffect(() => refresh(), [refresh])

  const exportReport = () => {
    if (!report) return
    downloadText(formatAccessibilityAuditReport(report), "accessibility-audit-report.txt", "text/plain")
  }

  return (
    <div data-testid="accessibility-audit-panel" className="flex max-h-full flex-col gap-2 p-2 text-[11px] text-[var(--ps-text)]">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Refresh accessibility audit" title="Refresh" onClick={refresh} className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Export accessibility audit" title="Export" onClick={exportReport} disabled={!report} className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:opacity-50">
          <Download className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1 text-right text-[10px] text-[var(--ps-text-dim)]">
          {report ? `${report.summary.errors} errors / ${report.summary.warnings} warnings` : "Not scanned"}
        </div>
      </div>
      {report ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {report.sections.map((section) => (
            <section key={section.id} className="rounded-sm border border-[var(--ps-divider)]">
              <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] font-medium uppercase text-[var(--ps-text-dim)]">{section.title}</div>
              <div className="divide-y divide-[var(--ps-divider)]">
                {section.findings.map((finding) => (
                  <div key={finding.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-2 px-2 py-1.5 text-[10px]">
                    <span className={finding.severity === "error" ? "text-red-300" : finding.severity === "warn" ? "text-amber-300" : finding.severity === "ok" ? "text-emerald-300" : "text-[var(--ps-text-dim)]"}>{finding.severity}</span>
                    <span className="min-w-0 break-words text-[var(--ps-text-dim)]">{finding.label}: {finding.detail}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
