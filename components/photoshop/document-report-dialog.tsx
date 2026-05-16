"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { createDocumentReport, downloadText } from "./document-io"
import { useEditor } from "./editor-context"
import type { DocumentReport } from "./types"

const STATUS_CLASS: Record<DocumentReport["items"][number]["status"], string> = {
  preserved: "text-emerald-300",
  approximated: "text-amber-300",
  flattened: "text-orange-300",
  unsupported: "text-red-300",
  info: "text-[var(--ps-text-dim)]",
}

export function DocumentReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, dispatch } = useEditor()
  if (!activeDoc) return null

  const reports = activeDoc.reports ?? []

  const generate = () => {
    dispatch({ type: "add-document-report", report: createDocumentReport(activeDoc, "Project Export") })
  }

  const exportReports = () => {
    downloadText(JSON.stringify({ app: "Photoshop Web", document: activeDoc.name, reports }, null, 2), `${activeDoc.name}-round-trip-report.json`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Round-Trip Inspector</DialogTitle>
          <DialogDescription className="sr-only">Inspect project and PSD import/export fidelity reports.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-sm border border-[var(--ps-divider)] text-[11px]">
          {reports.length === 0 ? (
            <div className="p-8 text-center text-[var(--ps-text-dim)]">No reports yet. Generate one or import/export a document.</div>
          ) : (
            reports.map((report) => (
              <div key={report.id} className="border-b border-[var(--ps-divider)] last:border-b-0">
                <div className="flex items-center justify-between bg-[var(--ps-panel-2)] px-3 py-2">
                  <div>
                    <div className="font-medium">{report.title}</div>
                    <div className="text-[10px] text-[var(--ps-text-dim)]">{new Date(report.createdAt).toLocaleString()}</div>
                  </div>
                  <span className="rounded-sm border border-[var(--ps-divider)] px-2 py-1 text-[10px] text-[var(--ps-text-dim)]">{report.source}</span>
                </div>
                <div className="divide-y divide-[var(--ps-divider)]">
                  {report.items.map((item, idx) => (
                    <div key={`${item.label}-${idx}`} className="grid grid-cols-[120px_94px_1fr] gap-2 px-3 py-2">
                      <span>{item.label}</span>
                      <span className={STATUS_CLASS[item.status]}>{item.status}</span>
                      <span className="text-[var(--ps-text-dim)]">{item.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: "clear-document-reports" })} disabled={!reports.length}>Clear</Button>
          <Button variant="outline" size="sm" onClick={exportReports} disabled={!reports.length}>Export JSON</Button>
          <Button size="sm" onClick={generate}>Generate Report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
