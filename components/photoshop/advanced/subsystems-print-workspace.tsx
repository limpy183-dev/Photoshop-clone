"use client"

/**
 * Print tab — print settings, soft-proofing and the print preview report.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  CheckField,
  EmptyState,
  NumberField,
  Panel,
  SelectField,
} from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { useEditor } from "@/components/photoshop/editor/context"
import { downloadText, renderDocumentComposite } from "@/editor/document/io"
import { buildPrintPreviewCanvas, buildPrintPreviewReport } from "@/editor/advanced/subsystems"
import type { PrintSettings } from "@/editor/types"
export function PrintWorkspace() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [settings, setSettings] = React.useState<PrintSettings | null>(null)
  const [previewReport, setPreviewReport] = React.useState<ReturnType<typeof buildPrintPreviewReport> | null>(null)
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    if (activeDoc) setSettings({
      paperSize: "Letter",
      orientation: "portrait",
      scale: 100,
      bleedMm: 0,
      cropMarks: false,
      registrationMarks: false,
      centerCropMarks: false,
      colorBars: false,
      description: false,
      labels: false,
      colorHandling: "app",
      proofPrint: false,
      printerProfile: "Working CMYK",
      paperColor: "#ffffff",
      marksOffsetMm: 4,
      pagePosition: "center",
      ...(activeDoc.printSettings ?? {}),
    })
  }, [activeDoc])

  React.useEffect(() => {
    if (!activeDoc || !settings || !previewRef.current) return
    const flat = renderDocumentComposite(activeDoc, { transparent: false })
    const preview = buildPrintPreviewCanvas(flat, settings, activeDoc.name)
    setPreviewReport(buildPrintPreviewReport(flat, settings, activeDoc.name, activeDoc))
    previewRef.current.width = preview.width
    previewRef.current.height = preview.height
    previewRef.current.getContext("2d")!.drawImage(preview, 0, 0)
  }, [activeDoc, settings])

  if (!activeDoc || !settings) return <EmptyState text="Open a document before printing." />
  const update = (patch: Partial<PrintSettings>) => setSettings({ ...settings, ...patch })
  const save = () => {
    dispatch({ type: "set-print-settings", settings })
    window.setTimeout(() => commit("Update Print Settings", []), 0)
  }
  const print = () => {
    save()
    const canvas = previewRef.current
    if (!canvas) return
    const win = window.open("about:blank", "_blank")
    if (!win) return
    try { (win as Window & { opener: Window | null }).opener = null } catch {}
    win.document.title = `Print - ${activeDoc.name}`
    win.document.body.style.margin = "0"
    win.document.body.style.background = "#fff"
    const img = win.document.createElement("img")
    img.src = canvas.toDataURL("image/png")
    img.style.width = "100%"
    img.onload = () => win.print()
    win.document.body.appendChild(img)
  }
  const exportReport = () => {
    if (!previewReport) return
    downloadText(JSON.stringify(previewReport, null, 2), `${activeDoc.name}-print-preview-report.json`, "application/json")
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="max-h-[640px] overflow-auto rounded-sm border border-[var(--ps-divider)] bg-[#2b2b2b] p-4">
        <canvas ref={previewRef} className="mx-auto max-w-full bg-white" />
      </div>
      <Panel title="Print Setup">
        <SelectField label="Paper" value={settings.paperSize} options={["Letter", "A4", "A3", "Tabloid", "Custom"]} onChange={(value) => update({ paperSize: value as PrintSettings["paperSize"] })} />
        <SelectField label="Orientation" value={settings.orientation} options={["portrait", "landscape"]} onChange={(value) => update({ orientation: value as PrintSettings["orientation"] })} />
        <NumberField label="Scale %" value={settings.scale} min={10} max={400} onChange={(value) => update({ scale: value })} />
        <NumberField label="Bleed mm" value={settings.bleedMm} min={0} max={50} step={0.5} onChange={(value) => update({ bleedMm: value })} />
        <NumberField label="Marks offset mm" value={settings.marksOffsetMm ?? 4} min={0} max={20} step={0.5} onChange={(value) => update({ marksOffsetMm: value })} />
        <SelectField label="Color handling" value={settings.colorHandling} options={["app", "printer"]} onChange={(value) => update({ colorHandling: value as PrintSettings["colorHandling"] })} />
        <SelectField label="Printer profile" value={settings.printerProfile ?? "Working CMYK"} options={["Working CMYK", "U.S. Web Coated SWOP v2", "Japan Color 2001 Coated", "Display P3", "Dot Gain 20%"]} onChange={(value) => update({ printerProfile: value as PrintSettings["printerProfile"] })} />
        <CheckField label="Crop marks" checked={settings.cropMarks} onChange={(checked) => update({ cropMarks: checked })} />
        <CheckField label="Center-crop marks" checked={settings.centerCropMarks ?? false} onChange={(checked) => update({ centerCropMarks: checked })} />
        <CheckField label="Registration marks" checked={settings.registrationMarks} onChange={(checked) => update({ registrationMarks: checked })} />
        <CheckField label="Color bars" checked={settings.colorBars ?? false} onChange={(checked) => update({ colorBars: checked })} />
        <CheckField label="Description" checked={settings.description ?? false} onChange={(checked) => update({ description: checked })} />
        <CheckField label="Labels" checked={settings.labels ?? false} onChange={(checked) => update({ labels: checked })} />
        <CheckField label="Proof print" checked={settings.proofPrint} onChange={(checked) => update({ proofPrint: checked })} />
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button size="sm" variant="secondary" onClick={save}>Save Setup</Button>
          <Button size="sm" onClick={print}>Print</Button>
        </div>
        {previewReport ? (
          <div className="mt-3 space-y-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] text-[var(--ps-text-dim)]" data-testid="print-preview-report">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--ps-text)]">Preview report</span>
              <Button size="sm" variant="secondary" onClick={exportReport}>Export JSON</Button>
            </div>
            <p>{previewReport.limitations[0]}</p>
            <p>
              Marks: {previewReport.marks.filter((mark) => mark.enabled).map((mark) => mark.kind).join(", ") || "none"}; bleed {previewReport.bleed.requestedMm}mm; risks {previewReport.risks.length}.
            </p>
            {previewReport.risks.slice(0, 3).map((risk) => (
              <p key={risk.id}>{risk.severity}: {risk.detail}</p>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
