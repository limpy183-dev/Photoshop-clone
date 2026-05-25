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
import {
  createCompatibilityManifest,
  createDocumentReport,
  downloadText,
  type CompatibilityTarget,
} from "./document-io"
import { createPsdExportActionPlan } from "./psd-compatibility"
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
  const [target, setTarget] = React.useState<CompatibilityTarget>("project")
  const [sourceFilter, setSourceFilter] = React.useState<DocumentReport["source"] | "All">("All")
  const [statusFilter, setStatusFilter] = React.useState<DocumentReport["items"][number]["status"] | "All">("All")
  if (!activeDoc) return null

  const reports = activeDoc.reports ?? []
  const manifest = createCompatibilityManifest(activeDoc, target)
  const psdActionPlan = target === "psd" ? createPsdExportActionPlan(activeDoc) : null
  const reportSources = ["All", ...Array.from(new Set(reports.map((report) => report.source)))] as Array<DocumentReport["source"] | "All">
  const visibleReports = reports.filter((report) => {
    if (sourceFilter !== "All" && report.source !== sourceFilter) return false
    if (statusFilter === "All") return true
    return report.items.some((item) => item.status === statusFilter)
  })

  const generate = () => {
    dispatch({ type: "add-document-report", report: createDocumentReport(activeDoc, "Project Export") })
  }

  const exportReports = () => {
    downloadText(JSON.stringify({ app: "Photoshop Web", document: activeDoc.name, reports }, null, 2), `${activeDoc.name}-round-trip-report.json`)
  }

  const exportManifest = () => {
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "ps-compatibility-manifest",
          version: 1,
          document: activeDoc.name,
          generatedAt: new Date().toISOString(),
          manifest,
        },
        null,
        2,
      ),
      `${activeDoc.name}-${target}-compatibility-manifest.json`,
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[820px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Round-Trip Inspector</DialogTitle>
          <DialogDescription className="sr-only">Inspect project and PSD import/export fidelity reports.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[220px_1fr_auto] items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px]">
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value as CompatibilityTarget)}
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2"
            aria-label="Compatibility target"
          >
            <option value="project">Project format</option>
            <option value="psd">PSD round trip</option>
            <option value="browser-raster">Browser raster export</option>
          </select>
          <div className="min-w-0">
            <div className="truncate text-[var(--ps-text)]">{manifest.summary}</div>
            <div className="text-[10px] text-[var(--ps-text-dim)]">
              {manifest.totals.preserved} preserved, {manifest.totals.approximated} approximated, {manifest.totals.flattened} flattened, {manifest.totals.unsupported} unsupported
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={exportManifest}>Export Manifest</Button>
        </div>
        <div className="grid grid-cols-4 gap-2 text-[11px]">
          <Summary label="Preserved" value={manifest.totals.preserved} className="text-emerald-300" />
          <Summary label="Approximated" value={manifest.totals.approximated} className="text-amber-300" />
          <Summary label="Flattened" value={manifest.totals.flattened} className="text-orange-300" />
          <Summary label="Unsupported" value={manifest.totals.unsupported} className="text-red-300" />
        </div>
        {psdActionPlan ? (
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-medium text-[var(--ps-text)]">PSD Export Action Plan</div>
              <div className="text-[10px] text-[var(--ps-text-dim)]">{psdActionPlan.summary}</div>
            </div>
            <div className="grid max-h-36 gap-1 overflow-y-auto">
              {psdActionPlan.items.slice(0, 8).map((item) => (
                <div key={item.id} className="grid grid-cols-[92px_120px_1fr] gap-2">
                  <span className={item.status === "rasterized" ? "text-orange-300" : item.status === "approximated" ? "text-amber-300" : item.status === "project-only" ? "text-sky-300" : item.status === "unsupported" ? "text-red-300" : "text-emerald-300"}>
                    {item.status}
                  </span>
                  <span className="truncate text-[var(--ps-text)]">{item.layerName ?? item.label}</span>
                  <span className="text-[var(--ps-text-dim)]">{item.label}: {item.detail}</span>
                </div>
              ))}
              {!psdActionPlan.items.length ? (
                <div className="text-[var(--ps-text-dim)]">No rasterized, approximated, project-only, or unsupported PSD elements detected.</div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
            aria-label="Report source filter"
          >
            {reportSources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
            aria-label="Report status filter"
          >
            <option value="All">All statuses</option>
            <option value="preserved">Preserved</option>
            <option value="approximated">Approximated</option>
            <option value="flattened">Flattened</option>
            <option value="unsupported">Unsupported</option>
            <option value="info">Info</option>
          </select>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-sm border border-[var(--ps-divider)] text-[11px]">
          {reports.length === 0 ? (
            <div className="p-8 text-center text-[var(--ps-text-dim)]">No reports yet. Generate one or import/export a document.</div>
          ) : visibleReports.length === 0 ? (
            <div className="p-8 text-center text-[var(--ps-text-dim)]">No reports match the active filters.</div>
          ) : (
            visibleReports.map((report) => {
              const visibleItems = statusFilter === "All"
                ? report.items
                : report.items.filter((item) => item.status === statusFilter)
              return (
              <div key={report.id} className="border-b border-[var(--ps-divider)] last:border-b-0">
                <div className="flex items-center justify-between bg-[var(--ps-panel-2)] px-3 py-2">
                  <div>
                    <div className="font-medium">{report.title}</div>
                    <div className="text-[10px] text-[var(--ps-text-dim)]">{new Date(report.createdAt).toLocaleString()}</div>
                  </div>
                  <span className="rounded-sm border border-[var(--ps-divider)] px-2 py-1 text-[10px] text-[var(--ps-text-dim)]">{report.source}</span>
                </div>
                <div className="divide-y divide-[var(--ps-divider)]">
                  {visibleItems.map((item, idx) => (
                    <div key={`${item.label}-${idx}`} className="grid grid-cols-[120px_94px_1fr] gap-2 px-3 py-2">
                      <span>{item.label}</span>
                      <span className={STATUS_CLASS[item.status]}>{item.status}</span>
                      <span className="text-[var(--ps-text-dim)]">{item.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
              )
            })
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

function Summary({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{label}</div>
      <div className={`text-lg tabular-nums ${className}`}>{value}</div>
    </div>
  )
}
