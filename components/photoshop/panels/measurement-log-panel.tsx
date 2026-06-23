"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  ClipboardCopy,
  Download,
  FileText,
  Hash,
  Ruler,
  Save,
  Settings2,
  Target,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "../client-storage"
import { useEditor } from "../editor-context"
import { dispatchPhotoshopEvent } from "../events"
import { downloadText } from "../document-io"
import { uid } from "../uid"
import type { AssetLibraryItem } from "../types"

type RulerUnit = "px" | "in" | "cm" | "mm" | "pt" | "pc"

interface MeasurementPayload {
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
  angle: number
  label?: string
  tool?: string
  unit?: RulerUnit
  pixelsPerUnit?: number
  calibrationSource?: string
  recordedAt?: number
  notes?: string
}

interface MeasurementLogPreferences {
  unit: RulerUnit
  pixelsPerUnit: number
  calibrationSource: string
  defaultLabel: string
}

const DEFAULT_PREFS: MeasurementLogPreferences = {
  unit: "px",
  pixelsPerUnit: 1,
  calibrationSource: "manual",
  defaultLabel: "Measurement",
}

function readPrefs(): MeasurementLogPreferences {
  const parsed = readClientStorageJson(CLIENT_STORAGE_KEYS.measurementLogPreferences)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_PREFS
  const prefs = parsed as Partial<MeasurementLogPreferences>
  return {
    unit: prefs.unit ?? DEFAULT_PREFS.unit,
    pixelsPerUnit: Number(prefs.pixelsPerUnit) || DEFAULT_PREFS.pixelsPerUnit,
    calibrationSource: typeof prefs.calibrationSource === "string" ? prefs.calibrationSource : DEFAULT_PREFS.calibrationSource,
    defaultLabel: typeof prefs.defaultLabel === "string" ? prefs.defaultLabel : DEFAULT_PREFS.defaultLabel,
  }
}

function writePrefs(prefs: MeasurementLogPreferences) {
  writeClientStorageJson(CLIENT_STORAGE_KEYS.measurementLogPreferences, prefs)
}

function isMeasurementPayload(value: unknown): value is MeasurementPayload {
  if (!value || typeof value !== "object") return false
  const v = value as Partial<MeasurementPayload>
  return (
    typeof v.x1 === "number" &&
    typeof v.y1 === "number" &&
    typeof v.x2 === "number" &&
    typeof v.y2 === "number"
  )
}

function readMeasurementAsset(asset: AssetLibraryItem): MeasurementPayload | null {
  if (asset.kind !== "prepress" || asset.group !== "Measurement Log") return null
  const payload = asset.payload
  if (!isMeasurementPayload(payload)) return null
  return payload as MeasurementPayload
}

function formatNumber(value: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return "—"
  return value.toFixed(fractionDigits)
}

function formatLength(pixels: number, unit: RulerUnit, pixelsPerUnit: number) {
  if (!Number.isFinite(pixels)) return "—"
  if (unit === "px" || !pixelsPerUnit) return `${formatNumber(pixels)} px`
  const value = pixels / pixelsPerUnit
  return `${formatNumber(value, 3)} ${unit}`
}

function formatAngle(deg: number) {
  if (!Number.isFinite(deg)) return "—"
  return `${formatNumber(deg, 2)}°`
}

function formatDate(value: number | undefined) {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleString()
  } catch {
    return "—"
  }
}

const CSV_COLUMNS: { key: keyof MeasurementPayload | "id" | "name"; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "label", label: "Label" },
  { key: "tool", label: "Tool" },
  { key: "x1", label: "X1" },
  { key: "y1", label: "Y1" },
  { key: "x2", label: "X2" },
  { key: "y2", label: "Y2" },
  { key: "length", label: "Length (px)" },
  { key: "angle", label: "Angle (deg)" },
  { key: "unit", label: "Unit" },
  { key: "pixelsPerUnit", label: "PixelsPerUnit" },
  { key: "calibrationSource", label: "Calibration" },
  { key: "recordedAt", label: "RecordedAt" },
  { key: "notes", label: "Notes" },
]

function csvEscape(value: unknown, delimiter: string) {
  if (value === undefined || value === null) return ""
  const text = String(value)
  if (text.includes(delimiter) || text.includes("\n") || text.includes("\"")) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function buildDelimitedExport(
  rows: { asset: AssetLibraryItem; payload: MeasurementPayload }[],
  delimiter: string,
) {
  const header = CSV_COLUMNS.map((column) => column.label).join(delimiter)
  const lines = rows.map(({ asset, payload }) =>
    CSV_COLUMNS.map((column) => {
      const value = column.key === "id"
        ? asset.id
        : column.key === "name"
          ? asset.name
          : payload[column.key as keyof MeasurementPayload]
      return csvEscape(value, delimiter)
    }).join(delimiter),
  )
  return [header, ...lines].join("\n")
}

function buildJsonExport(
  rows: { asset: AssetLibraryItem; payload: MeasurementPayload }[],
  prefs: MeasurementLogPreferences,
  documentName: string,
) {
  return {
    type: "ps-measurement-log",
    version: 1,
    document: documentName,
    exportedAt: Date.now(),
    calibration: {
      unit: prefs.unit,
      pixelsPerUnit: prefs.pixelsPerUnit,
      source: prefs.calibrationSource,
    },
    measurements: rows.map(({ asset, payload }) => ({
      id: asset.id,
      name: asset.name,
      createdAt: asset.createdAt,
      ...payload,
    })),
  }
}

export function MeasurementLogPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [prefs, setPrefs] = React.useState<MeasurementLogPreferences>(readPrefs)
  const [label, setLabel] = React.useState<string>("")
  const [notes, setNotes] = React.useState<string>("")
  const [showSettings, setShowSettings] = React.useState(false)
  const [filterLabel, setFilterLabel] = React.useState<string>("all")
  const importInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { writePrefs(prefs) }, [prefs])

  if (!activeDoc) {
    return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No document open.</div>
  }

  const logs = (activeDoc.assetLibrary ?? [])
    .map((asset) => ({ asset, payload: readMeasurementAsset(asset) }))
    .filter((entry): entry is { asset: AssetLibraryItem; payload: MeasurementPayload } => entry.payload !== null)

  const visibleLogs = filterLabel === "all"
    ? logs
    : logs.filter(({ payload }) => (payload.label ?? "Untitled") === filterLabel)

  const labelOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const entry of logs) set.add(entry.payload.label ?? "Untitled")
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [logs])

  const counts = React.useMemo(() => activeDoc.counts ?? [], [activeDoc.counts])
  const countByGroup = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const count of counts) map.set(count.group, (map.get(count.group) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [counts])

  const recordMeasurement = () => {
    if (!activeDoc.measurement) {
      toast.error("Use the Ruler tool to create a measurement first.")
      return
    }
    const m = activeDoc.measurement
    const length = Math.hypot(m.x2 - m.x1, m.y2 - m.y1)
    const angle = (Math.atan2(m.y2 - m.y1, m.x2 - m.x1) * 180) / Math.PI
    const payload: MeasurementPayload = {
      x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2,
      length, angle,
      label: label.trim() || prefs.defaultLabel,
      tool: "ruler",
      unit: prefs.unit,
      pixelsPerUnit: prefs.pixelsPerUnit,
      calibrationSource: prefs.calibrationSource,
      recordedAt: Date.now(),
      notes: notes.trim() || undefined,
    }
    const asset: AssetLibraryItem = {
      id: uid("measure"),
      name: `${payload.label} ${logs.length + 1}`,
      kind: "prepress",
      group: "Measurement Log",
      tags: ["measurement", payload.label ?? "ruler"].filter(Boolean) as string[],
      payload,
      createdAt: Date.now(),
    }
    dispatch({ type: "set-asset-library", assets: [asset, ...(activeDoc.assetLibrary ?? [])] })
    window.setTimeout(() => commit("Record Measurement", []), 0)
    setNotes("")
    toast.success("Measurement recorded.")
  }

  const recordCounts = () => {
    if (!counts.length) {
      toast.error("Use the Count tool to mark targets first.")
      return
    }
    const total = counts.length
    const groupSummary = countByGroup.map(([group, value]) => `${group}: ${value}`).join("; ")
    const asset: AssetLibraryItem = {
      id: uid("count"),
      name: `Count snapshot (${total})`,
      kind: "prepress",
      group: "Measurement Log",
      tags: ["count", "summary"],
      payload: {
        x1: 0, y1: 0, x2: 0, y2: 0,
        length: 0, angle: 0,
        label: "Count",
        tool: "count",
        unit: prefs.unit,
        pixelsPerUnit: prefs.pixelsPerUnit,
        calibrationSource: prefs.calibrationSource,
        recordedAt: Date.now(),
        notes: `Total ${total} markers (${groupSummary})`,
      } satisfies MeasurementPayload,
      createdAt: Date.now(),
    }
    dispatch({ type: "set-asset-library", assets: [asset, ...(activeDoc.assetLibrary ?? [])] })
    window.setTimeout(() => commit("Record Count Snapshot", []), 0)
    toast.success(`Count snapshot saved (${total} markers).`)
  }

  const removeLog = (asset: AssetLibraryItem) => {
    const next = (activeDoc.assetLibrary ?? []).filter((entry) => entry.id !== asset.id)
    dispatch({ type: "set-asset-library", assets: next })
    window.setTimeout(() => commit("Delete Measurement", []), 0)
  }

  const focusMeasurement = (payload: MeasurementPayload) => {
    if (typeof window === "undefined") return
    const x = (payload.x1 + payload.x2) / 2
    const y = (payload.y1 + payload.y2) / 2
    dispatchPhotoshopEvent("ps-navigator-pan", { x, y })
    dispatch({ type: "set-measurement", m: { x1: payload.x1, y1: payload.y1, x2: payload.x2, y2: payload.y2 } })
  }

  const exportFile = (format: "csv" | "tsv" | "json") => {
    if (!visibleLogs.length) {
      toast.error("Nothing to export.")
      return
    }
    if (format === "json") {
      downloadText(
        JSON.stringify(buildJsonExport(visibleLogs, prefs, activeDoc.name), null, 2),
        `${activeDoc.name}-measurements.json`,
      )
    } else {
      const delimiter = format === "csv" ? "," : "\t"
      downloadText(
        buildDelimitedExport(visibleLogs, delimiter),
        `${activeDoc.name}-measurements.${format}`,
        format === "csv" ? "text/csv" : "text/tab-separated-values",
      )
    }
  }

  const copyClipboard = async () => {
    if (!visibleLogs.length) {
      toast.error("Nothing to copy.")
      return
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Clipboard API is unavailable in this browser.")
      return
    }
    try {
      await navigator.clipboard.writeText(buildDelimitedExport(visibleLogs, "\t"))
      toast.success(`Copied ${visibleLogs.length} row${visibleLogs.length === 1 ? "" : "s"} to clipboard.`)
    } catch (err) {
      toast.error(`Could not copy: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const importLog = async (file: File) => {
    try {
      const text = await file.text()
      const lower = file.name.toLowerCase()
      const incoming: { name: string; payload: MeasurementPayload }[] = []
      if (lower.endsWith(".json")) {
        const data = JSON.parse(text)
        const list = Array.isArray(data) ? data : Array.isArray(data?.measurements) ? data.measurements : []
        for (const item of list) {
          if (!isMeasurementPayload(item)) continue
          const payload = item as MeasurementPayload
          incoming.push({
            name: typeof (item as { name?: string }).name === "string" ? (item as { name?: string }).name! : (payload.label ?? "Measurement"),
            payload,
          })
        }
      } else {
        const delimiter = lower.endsWith(".tsv") ? "\t" : ","
        const lines = text.split(/\r?\n/).filter((line) => line.trim())
        if (lines.length <= 1) {
          toast.error("Import file appears to be empty.")
          return
        }
        const header = lines[0].split(delimiter).map((column) => column.trim())
        const indexOf = (label: string) => header.findIndex((column) => column.toLowerCase() === label.toLowerCase())
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(delimiter)
          const x1 = Number(cells[indexOf("X1")])
          const y1 = Number(cells[indexOf("Y1")])
          const x2 = Number(cells[indexOf("X2")])
          const y2 = Number(cells[indexOf("Y2")])
          if (![x1, y1, x2, y2].every(Number.isFinite)) continue
          const length = Number(cells[indexOf("Length (px)")]) || Math.hypot(x2 - x1, y2 - y1)
          const angle = Number(cells[indexOf("Angle (deg)")]) || (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
          const payload: MeasurementPayload = {
            x1, y1, x2, y2,
            length, angle,
            label: cells[indexOf("Label")] || prefs.defaultLabel,
            tool: cells[indexOf("Tool")] || "ruler",
            unit: (cells[indexOf("Unit")] as RulerUnit) || prefs.unit,
            pixelsPerUnit: Number(cells[indexOf("PixelsPerUnit")]) || prefs.pixelsPerUnit,
            calibrationSource: cells[indexOf("Calibration")] || prefs.calibrationSource,
            recordedAt: Number(cells[indexOf("RecordedAt")]) || Date.now(),
            notes: cells[indexOf("Notes")] || undefined,
          }
          incoming.push({ name: cells[indexOf("Name")] || `Measurement ${i}`, payload })
        }
      }
      if (!incoming.length) {
        toast.error("No valid measurements found in the file.")
        return
      }
      const imported: AssetLibraryItem[] = incoming.map(({ name, payload }) => ({
        id: uid("measure"),
        name,
        kind: "prepress",
        group: "Measurement Log",
        tags: ["measurement", payload.label ?? "imported", "imported"],
        payload,
        createdAt: Date.now(),
      }))
      dispatch({ type: "set-asset-library", assets: [...imported, ...(activeDoc.assetLibrary ?? [])] })
      window.setTimeout(() => commit("Import Measurement Log", []), 0)
      toast.success(`Imported ${imported.length} measurement${imported.length === 1 ? "" : "s"}.`)
    } catch (err) {
      toast.error(`Could not import: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const totalLength = logs.reduce((sum, entry) => sum + (entry.payload.length || 0), 0)
  const averageAngle = logs.length
    ? logs.reduce((sum, entry) => sum + entry.payload.angle, 0) / logs.length
    : 0

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
          <Ruler className="h-3 w-3" /> Measurement Log ({logs.length})
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-1">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={prefs.defaultLabel}
            aria-label="Measurement label"
            className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
          />
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!activeDoc.measurement} onClick={recordMeasurement}>
            <Save className="h-3 w-3" /> Record
          </Button>
        </div>
        <Input
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes (optional)"
          aria-label="Measurement notes"
          className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
        />
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <Metric label="Active" value={activeDoc.measurement ? formatLength(Math.hypot(activeDoc.measurement.x2 - activeDoc.measurement.x1, activeDoc.measurement.y2 - activeDoc.measurement.y1), prefs.unit, prefs.pixelsPerUnit) : "—"} />
          <Metric label="Total length" value={formatLength(totalLength, prefs.unit, prefs.pixelsPerUnit)} />
          <Metric label="Avg angle" value={formatAngle(averageAngle)} />
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setShowSettings((current) => !current)}>
            <Settings2 className="h-3 w-3" /> {showSettings ? "Hide" : "Settings"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!counts.length} onClick={recordCounts}>
            <Hash className="h-3 w-3" /> Counts ({counts.length})
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!visibleLogs.length} onClick={copyClipboard}>
            <ClipboardCopy className="h-3 w-3" /> Copy TSV
          </Button>
        </div>
        {showSettings ? (
          <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            <div className="grid grid-cols-2 gap-1">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Unit</span>
                <select
                  value={prefs.unit}
                  onChange={(event) => setPrefs((current) => ({ ...current, unit: event.target.value as RulerUnit }))}
                  className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px] outline-none"
                  aria-label="Unit"
                >
                  <option value="px">Pixels (px)</option>
                  <option value="in">Inches (in)</option>
                  <option value="cm">Centimetres (cm)</option>
                  <option value="mm">Millimetres (mm)</option>
                  <option value="pt">Points (pt)</option>
                  <option value="pc">Picas (pc)</option>
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Pixels / unit</span>
                <Input
                  type="number"
                  step="0.001"
                  value={prefs.pixelsPerUnit}
                  onChange={(event) => setPrefs((current) => ({ ...current, pixelsPerUnit: Math.max(0.0001, Number(event.target.value) || 1) }))}
                  className="h-7 bg-[var(--ps-panel)] text-[11px]"
                  aria-label="Pixels per unit"
                />
              </label>
            </div>
            <Input
              value={prefs.calibrationSource}
              onChange={(event) => setPrefs((current) => ({ ...current, calibrationSource: event.target.value }))}
              placeholder="Calibration source (e.g. scan@300dpi)"
              aria-label="Calibration source"
              className="h-7 bg-[var(--ps-panel)] text-[11px]"
            />
            <Input
              value={prefs.defaultLabel}
              onChange={(event) => setPrefs((current) => ({ ...current, defaultLabel: event.target.value || "Measurement" }))}
              placeholder="Default label"
              aria-label="Default label"
              className="h-7 bg-[var(--ps-panel)] text-[11px]"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-full gap-1 px-2 text-[11px]"
              disabled={!activeDoc.measurement}
              onClick={() => {
                if (!activeDoc.measurement) return
                const pixels = Math.hypot(activeDoc.measurement.x2 - activeDoc.measurement.x1, activeDoc.measurement.y2 - activeDoc.measurement.y1)
                const input = typeof window !== "undefined" ? window.prompt(`The active ruler is ${formatNumber(pixels)} px. Enter the real-world length in ${prefs.unit}:`) : null
                if (!input) return
                const real = Number(input)
                if (!Number.isFinite(real) || real <= 0) {
                  toast.error("Enter a positive number.")
                  return
                }
                setPrefs((current) => ({ ...current, pixelsPerUnit: pixels / real, calibrationSource: `ruler@${pixels.toFixed(2)}px=${real}${current.unit}` }))
                toast.success(`Calibration set to ${(pixels / real).toFixed(3)} px/${prefs.unit}.`)
              }}
            >
              <Target className="h-3 w-3" /> Calibrate from active ruler
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1">
          <select
            value={filterLabel}
            onChange={(event) => setFilterLabel(event.target.value)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            aria-label="Filter by label"
          >
            <option value="all">All labels</option>
            {labelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!visibleLogs.length} onClick={() => exportFile("csv")}>
            <Download className="h-3 w-3" /> CSV
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!visibleLogs.length} onClick={() => exportFile("tsv")}>
            <FileText className="h-3 w-3" /> TSV
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!visibleLogs.length} onClick={() => exportFile("json")}>
            <Download className="h-3 w-3" /> JSON
          </Button>
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => importInputRef.current?.click()}>
            <Upload className="h-3 w-3" /> Import log
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (file) await importLog(file)
              event.target.value = ""
            }}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 space-y-2">
        {countByGroup.length ? (
          <section className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              <Hash className="h-3 w-3" /> Count summary
            </div>
            <div className="grid grid-cols-2 gap-1">
              {countByGroup.map(([group, value]) => (
                <div key={group} className="flex items-center justify-between rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 py-1">
                  <span className="truncate">{group}</span>
                  <span className="font-mono">{value}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {visibleLogs.length ? visibleLogs.map(({ asset, payload }) => (
          <article key={asset.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            <header className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-[11px] text-[var(--ps-text)]">{asset.name}</span>
                <span className="text-[10px] text-[var(--ps-text-dim)]">{payload.label ?? "Untitled"} · {payload.tool ?? "ruler"} · {formatDate(payload.recordedAt ?? asset.createdAt)}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                {payload.tool === "ruler" ? (
                  <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => focusMeasurement(payload)}>
                    <Target className="h-3 w-3" /> Focus
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-red-300" onClick={() => removeLog(asset)}>
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
              </div>
            </header>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
              <Metric label="Length" value={formatLength(payload.length, payload.unit ?? prefs.unit, payload.pixelsPerUnit ?? prefs.pixelsPerUnit)} />
              <Metric label="Angle" value={formatAngle(payload.angle)} />
              <Metric label="Start" value={`${formatNumber(payload.x1)}, ${formatNumber(payload.y1)}`} />
              <Metric label="End" value={`${formatNumber(payload.x2)}, ${formatNumber(payload.y2)}`} />
            </div>
            {payload.calibrationSource || payload.unit ? (
              <div className="mt-1 text-[10px] text-[var(--ps-text-dim)]">
                Calibration: {payload.pixelsPerUnit ?? 1} px/{payload.unit ?? "px"} · source {payload.calibrationSource ?? "manual"}
              </div>
            ) : null}
            {payload.notes ? (
              <div className="mt-1 whitespace-pre-wrap rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel)] p-1.5 text-[10px] text-[var(--ps-text-dim)]">
                {payload.notes}
              </div>
            ) : null}
          </article>
        )) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            {logs.length === 0
              ? "No measurements yet. Use the Ruler tool, then record from this panel."
              : "No measurements match the current filter."}
          </div>
        )}
      </div>
      <div className="border-t border-[var(--ps-divider)] p-2 text-[10px] text-[var(--ps-text-dim)]">
        {visibleLogs.length} of {logs.length} shown · {prefs.unit} @ {prefs.pixelsPerUnit} px/unit · {prefs.calibrationSource}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1">
      <div className="text-[var(--ps-text-dim)]">{label}</div>
      <div className="truncate text-[var(--ps-text)]">{value}</div>
    </div>
  )
}
