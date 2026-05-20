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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { downloadText } from "./document-io"
import {
  DEFAULT_PREFERENCES,
  MAX_PREFERENCES_IMPORT_BYTES,
  PREFERENCES_STORAGE_KEY,
  type FileHandlingPreferences,
  type GpuPreferences,
  type HistoryLogPreferences,
  type MemoryPreferences,
  type PhotoshopPreferences,
  type RulerGridPreferences,
  type ScratchDiskPreference,
  type ToolBehaviorPreferences,
  deriveFileHandlingPolicy,
  exportPreferencesSet,
  formatHistoryLog,
  loadPreferencesFromStorage,
  normalizePreferences,
  parsePreferencesSet,
  resetPreferencesSet,
  savePreferencesToStorage,
  summarizePerformancePolicy,
} from "./preferences-engine"

type PreferenceTab =
  | "general"
  | "performance"
  | "scratch"
  | "gpu"
  | "files"
  | "history"
  | "cursors"
  | "units"
  | "sets"

const TABS: Array<{ id: PreferenceTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "performance", label: "Performance" },
  { id: "scratch", label: "Scratch Disks" },
  { id: "gpu", label: "GPU" },
  { id: "files", label: "File Handling" },
  { id: "history", label: "History Log" },
  { id: "cursors", label: "Cursors & Tools" },
  { id: "units", label: "Units & Grid" },
  { id: "sets", label: "Preference Sets" },
]

const TAB_SECTION: Partial<Record<PreferenceTab, Parameters<typeof resetPreferencesSet>[0]>> = {
  general: "general",
  performance: "memory",
  scratch: "scratchDisks",
  gpu: "gpu",
  files: "fileHandling",
  history: "historyLog",
  cursors: "toolBehavior",
  units: "rulerGrid",
}

function SelectField<T extends string>({
  value,
  onChange,
  children,
}: {
  value: T
  onChange: (value: T) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-8 rounded-sm bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] text-[11px] px-2 text-[var(--ps-text)]"
    >
      {children}
    </select>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-[11px] text-[var(--ps-text-muted)]">{children}</Label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[12px] font-semibold text-[var(--ps-text)]">{title}</h3>
      {children}
    </section>
  )
}

function ToggleRow({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-[var(--ps-text)]">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="border-[var(--ps-divider)]"
      />
      {label}
    </label>
  )
}

function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <Input
      type="number"
      value={Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)))
      }}
      className="h-8 text-[11px]"
    />
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="grid gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="grid grid-cols-[1fr_72px] gap-2 items-center">
        <Slider min={min} max={max} step={step} value={[value]} onValueChange={(next) => onChange(next[0] ?? value)} />
        <span className="text-[11px] tabular-nums text-right text-[var(--ps-text-muted)]">
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </span>
      </div>
    </div>
  )
}

function preferenceFileName(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-") || "photoshop-preferences"
}

export function PreferencesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [prefs, setPrefs] = React.useState<PhotoshopPreferences>(() => loadPreferencesFromStorage())
  const [tab, setTab] = React.useState<PreferenceTab>("general")
  const [importError, setImportError] = React.useState("")
  const importRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (open) {
      setPrefs(loadPreferencesFromStorage())
      setImportError("")
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const refreshHistory = () => setPrefs(loadPreferencesFromStorage())
    window.addEventListener("ps-preferences-history-log-changed", refreshHistory)
    return () => window.removeEventListener("ps-preferences-history-log-changed", refreshHistory)
  }, [open])

  const performancePolicy = React.useMemo(() => summarizePerformancePolicy(prefs), [prefs])
  const filePolicy = React.useMemo(
    () => deriveFileHandlingPolicy(prefs, { name: "large-layered-file.psd", format: "psd", sizeMB: 750, hasMissingFonts: true }),
    [prefs],
  )

  const setNormalized = React.useCallback((next: PhotoshopPreferences | ((current: PhotoshopPreferences) => PhotoshopPreferences)) => {
    setPrefs((current) => normalizePreferences(typeof next === "function" ? next(current) : next))
  }, [])

  const updateMemory = (patch: Partial<MemoryPreferences>) => setNormalized((current) => ({ ...current, memory: { ...current.memory, ...patch } }))
  const updateGpu = (patch: Partial<GpuPreferences>) => setNormalized((current) => ({ ...current, gpu: { ...current.gpu, ...patch } }))
  const updateFileHandling = (patch: Partial<FileHandlingPreferences>) =>
    setNormalized((current) => ({ ...current, fileHandling: { ...current.fileHandling, ...patch } }))
  const updateHistoryLog = (patch: Partial<HistoryLogPreferences>) =>
    setNormalized((current) => ({ ...current, historyLog: { ...current.historyLog, ...patch } }))
  const updateToolBehavior = (patch: Partial<ToolBehaviorPreferences>) =>
    setNormalized((current) => ({ ...current, toolBehavior: { ...current.toolBehavior, ...patch } }))
  const updateRulerGrid = (patch: Partial<RulerGridPreferences>) =>
    setNormalized((current) => ({ ...current, rulerGrid: { ...current.rulerGrid, ...patch } }))

  const updateScratchDisk = (id: string, patch: Partial<ScratchDiskPreference>) => {
    setNormalized((current) => ({
      ...current,
      scratchDisks: current.scratchDisks.map((disk) => (disk.id === id ? { ...disk, ...patch } : disk)),
    }))
  }

  const addScratchDisk = () => {
    setNormalized((current) => ({
      ...current,
      scratchDisks: [
        ...current.scratchDisks,
        {
          id: `custom-${Date.now()}`,
          label: "Custom browser scratch",
          enabled: true,
          priority: current.scratchDisks.length + 1,
          quotaMB: 1024,
          kind: "custom",
        },
      ],
    }))
  }

  const removeScratchDisk = (id: string) => {
    setNormalized((current) => ({
      ...current,
      scratchDisks: current.scratchDisks.filter((disk) => disk.id !== id),
    }))
  }

  const save = () => {
    try {
      const normalized = savePreferencesToStorage(prefs)
      window.dispatchEvent(new CustomEvent("ps-preferences-changed", { detail: normalized }))
    } catch {}
    onOpenChange(false)
  }

  const restoreDefaults = () => {
    const defaults = resetPreferencesSet()
    setPrefs(defaults)
    try {
      localStorage.removeItem(PREFERENCES_STORAGE_KEY)
      window.dispatchEvent(new CustomEvent("ps-preferences-changed", { detail: defaults }))
    } catch {}
  }

  const resetSection = () => {
    const section = TAB_SECTION[tab]
    if (!section) return
    setPrefs(resetPreferencesSet(section, prefs))
  }

  const exportSet = () => {
    const exported = exportPreferencesSet(prefs)
    downloadText(exported.json, exported.fileName, exported.mime)
  }

  const exportHistory = () => {
    downloadText(formatHistoryLog(prefs), `${preferenceFileName("photoshop-history-log")}.txt`, "text/plain")
  }

  const importSet = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (file.size > MAX_PREFERENCES_IMPORT_BYTES) {
        throw new Error(`Preference imports are limited to ${Math.round(MAX_PREFERENCES_IMPORT_BYTES / 1024)} KB.`)
      }
      const text = await file.text()
      setPrefs(parsePreferencesSet(text))
      setImportError("")
    } catch {
      setImportError("Could not import that preference set.")
    } finally {
      event.target.value = ""
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[820px] max-h-[calc(100vh-2rem)] overflow-hidden bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription className="sr-only">Application, performance, file handling, history, cursor, ruler, and grid settings.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-4 min-h-0 sm:min-h-[470px]">
          <nav className="grid grid-cols-2 gap-1 sm:block sm:space-y-0.5 sm:border-r border-[var(--ps-divider)] sm:pr-3">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`w-full text-left px-2 py-1.5 rounded-sm text-[11px] ${tab === item.id ? "bg-[var(--ps-accent)] text-white" : "hover:bg-[var(--ps-tool-hover)]"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="max-h-[calc(100vh-260px)] sm:max-h-[470px] overflow-y-auto pr-1">
            <div className="space-y-5">
              {tab === "general" && (
                <>
                  <Section title="Startup and Interface">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Default Background Color</FieldLabel>
                        <Input
                          type="color"
                          value={prefs.defaultBackground}
                          onChange={(event) => setNormalized({ ...prefs, defaultBackground: event.target.value })}
                          className="h-8 w-24 p-1"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Recent Files Limit</FieldLabel>
                        <NumberField
                          value={prefs.fileHandling.recentFilesLimit}
                          min={0}
                          max={100}
                          onChange={(value) => updateFileHandling({ recentFilesLimit: value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <ToggleRow checked={prefs.toolBehavior.showTooltips} onCheckedChange={(checked) => updateToolBehavior({ showTooltips: checked })} label="Show tooltips" />
                      <ToggleRow checked={prefs.fileHandling.askBeforeClosing} onCheckedChange={(checked) => updateFileHandling({ askBeforeClosing: checked })} label="Ask before closing dirty documents" />
                      <ToggleRow checked={prefs.fileHandling.preferProjectFormat} onCheckedChange={(checked) => updateFileHandling({ preferProjectFormat: checked })} label="Prefer project format for metadata" />
                      <ToggleRow checked={prefs.fileHandling.preserveMetadata} onCheckedChange={(checked) => updateFileHandling({ preserveMetadata: checked })} label="Preserve metadata when possible" />
                    </div>
                  </Section>
                </>
              )}

              {tab === "performance" && (
                <>
                  <Section title="RAM and Cache">
                    <SliderField label="RAM Allocation" value={prefs.memory.ramPercent} min={10} max={90} step={1} suffix="%" onChange={(value) => updateMemory({ ramPercent: value })} />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Max Cache MB</FieldLabel>
                        <NumberField value={prefs.memory.maxCacheMB} min={128} max={131072} step={128} onChange={(value) => updateMemory({ maxCacheMB: value })} />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Cache Levels</FieldLabel>
                        <NumberField value={prefs.memory.cacheLevels} min={1} max={8} onChange={(value) => updateMemory({ cacheLevels: value })} />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Tile Size</FieldLabel>
                        <SelectField value={String(prefs.memory.tileSize)} onChange={(value) => updateMemory({ tileSize: Number(value) })}>
                          <option value="64">64 px</option>
                          <option value="128">128 px</option>
                          <option value="256">256 px</option>
                          <option value="512">512 px</option>
                          <option value="1024">1024 px</option>
                        </SelectField>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>History States</FieldLabel>
                        <NumberField value={prefs.memory.historyStates} min={5} max={500} onChange={(value) => updateMemory({ historyStates: value })} />
                      </div>
                      <div className="pt-6">
                        <ToggleRow checked={prefs.memory.historyCompression} onCheckedChange={(checked) => updateMemory({ historyCompression: checked })} label="Compress older history states" />
                      </div>
                    </div>
                  </Section>
                  <Section title="Effective Policy">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                      <span>RAM: {performancePolicy.ramBudgetMB} MB</span>
                      <span>Cache: {performancePolicy.cacheBudgetMB} MB</span>
                      <span>Tiles: {performancePolicy.estimatedTileCapacity}</span>
                      <span>History: {performancePolicy.historyStates}</span>
                    </div>
                    {performancePolicy.warnings.length > 0 && (
                      <ul className="space-y-1 text-[11px] text-[var(--ps-text-muted)]">
                        {performancePolicy.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    )}
                  </Section>
                </>
              )}

              {tab === "scratch" && (
                <Section title="Scratch Disk Configuration">
                  <div className="space-y-3">
                    {prefs.scratchDisks.map((disk) => (
                      <div key={disk.id} className="grid grid-cols-1 sm:grid-cols-[24px_1.2fr_80px_100px_116px_70px] gap-2 items-end border-b border-[var(--ps-divider)] pb-3">
                        <Checkbox checked={disk.enabled} onCheckedChange={(checked) => updateScratchDisk(disk.id, { enabled: checked === true })} className="mb-2 border-[var(--ps-divider)]" />
                        <div className="grid gap-1.5">
                          <FieldLabel>Label</FieldLabel>
                          <Input value={disk.label} onChange={(event) => updateScratchDisk(disk.id, { label: event.target.value })} className="h-8 text-[11px]" />
                        </div>
                        <div className="grid gap-1.5">
                          <FieldLabel>Priority</FieldLabel>
                          <NumberField value={disk.priority} min={1} max={99} onChange={(value) => updateScratchDisk(disk.id, { priority: value })} />
                        </div>
                        <div className="grid gap-1.5">
                          <FieldLabel>Quota MB</FieldLabel>
                          <NumberField value={disk.quotaMB} min={128} max={1048576} step={128} onChange={(value) => updateScratchDisk(disk.id, { quotaMB: value })} />
                        </div>
                        <div className="grid gap-1.5">
                          <FieldLabel>Kind</FieldLabel>
                          <SelectField value={disk.kind} onChange={(value) => updateScratchDisk(disk.id, { kind: value })}>
                            <option value="opfs">OPFS</option>
                            <option value="browser-storage">Browser</option>
                            <option value="download-folder">Downloads</option>
                            <option value="custom">Custom</option>
                          </SelectField>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => removeScratchDisk(disk.id)} disabled={prefs.scratchDisks.length <= 1}>
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--ps-text-muted)]">
                    <span>Enabled scratch budget: {performancePolicy.scratchBudgetMB} MB</span>
                    <Button size="sm" variant="secondary" onClick={addScratchDisk}>Add Scratch</Button>
                  </div>
                </Section>
              )}

              {tab === "gpu" && (
                <>
                  <Section title="GPU and Worker Rendering">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <ToggleRow checked={prefs.gpu.enabled} onCheckedChange={(checked) => updateGpu({ enabled: checked })} label="Enable accelerated previews" />
                      <ToggleRow checked={prefs.gpu.useWebGL} onCheckedChange={(checked) => updateGpu({ useWebGL: checked })} label="Use WebGL when available" />
                      <ToggleRow checked={prefs.gpu.useWorkers} onCheckedChange={(checked) => updateGpu({ useWorkers: checked })} label="Use workers for filters" />
                      <ToggleRow checked={prefs.gpu.rayTracingPreview} onCheckedChange={(checked) => updateGpu({ rayTracingPreview: checked })} label="Use ray-traced 3D preview when practical" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Drawing Mode</FieldLabel>
                        <SelectField value={prefs.gpu.mode} onChange={(value) => updateGpu({ mode: value })}>
                          <option value="auto">Auto</option>
                          <option value="basic">Basic</option>
                          <option value="advanced">Advanced</option>
                        </SelectField>
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Compositing</FieldLabel>
                        <SelectField value={prefs.gpu.compositing} onChange={(value) => updateGpu({ compositing: value })}>
                          <option value="gpu-preferred">GPU preferred</option>
                          <option value="worker">Worker preferred</option>
                          <option value="cpu">CPU only</option>
                        </SelectField>
                      </div>
                    </div>
                  </Section>
                  <Section title="Current Path">
                    <div className="text-[11px] text-[var(--ps-text-muted)]">
                      Preview path: {performancePolicy.gpuPath}. Worker filters: {performancePolicy.workerFilters ? "enabled" : "disabled"}.
                    </div>
                  </Section>
                </>
              )}

              {tab === "files" && (
                <>
                  <Section title="Autosave and Open/Close Policies">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <ToggleRow checked={prefs.fileHandling.autoSave} onCheckedChange={(checked) => updateFileHandling({ autoSave: checked })} label="Auto-save projects" />
                      <ToggleRow checked={prefs.fileHandling.askBeforeClosing} onCheckedChange={(checked) => updateFileHandling({ askBeforeClosing: checked })} label="Confirm before closing unsaved work" />
                      <ToggleRow checked={prefs.fileHandling.appendCompatibilityWarnings} onCheckedChange={(checked) => updateFileHandling({ appendCompatibilityWarnings: checked })} label="Append compatibility warnings" />
                      <ToggleRow checked={prefs.fileHandling.preserveMetadata} onCheckedChange={(checked) => updateFileHandling({ preserveMetadata: checked })} label="Preserve metadata when possible" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Autosave Interval (sec)</FieldLabel>
                        <NumberField value={prefs.fileHandling.autosaveIntervalSec} min={15} max={3600} step={15} onChange={(value) => updateFileHandling({ autosaveIntervalSec: value })} />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Missing Fonts</FieldLabel>
                        <SelectField value={prefs.fileHandling.missingFontPolicy} onChange={(value) => updateFileHandling({ missingFontPolicy: value })}>
                          <option value="warn">Warn</option>
                          <option value="substitute">Substitute</option>
                          <option value="rasterize">Rasterize</option>
                        </SelectField>
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Large Files</FieldLabel>
                        <SelectField value={prefs.fileHandling.largeFilePolicy} onChange={(value) => updateFileHandling({ largeFilePolicy: value })}>
                          <option value="ask">Ask</option>
                          <option value="downsample-preview">Downsample preview</option>
                          <option value="block">Block</option>
                        </SelectField>
                      </div>
                    </div>
                  </Section>
                  <Section title="Policy Preview">
                    <div className="text-[11px] text-[var(--ps-text-muted)]">
                      Large-file action: {filePolicy.largeFileAction}. Missing-font action: {filePolicy.missingFontAction}. Autosave every {filePolicy.autosaveIntervalSec} seconds.
                    </div>
                  </Section>
                </>
              )}

              {tab === "history" && (
                <>
                  <Section title="History Log">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <ToggleRow checked={prefs.historyLog.enabled} onCheckedChange={(checked) => updateHistoryLog({ enabled: checked })} label="Record history log" />
                      <ToggleRow checked={prefs.historyLog.includeTimestamps} onCheckedChange={(checked) => updateHistoryLog({ includeTimestamps: checked })} label="Include timestamps" />
                      <ToggleRow checked={prefs.historyLog.includeToolSettings} onCheckedChange={(checked) => updateHistoryLog({ includeToolSettings: checked })} label="Include tool settings" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Destination</FieldLabel>
                        <SelectField value={prefs.historyLog.destination} onChange={(value) => updateHistoryLog({ destination: value })}>
                          <option value="metadata">Metadata</option>
                          <option value="text-file">Text file export</option>
                          <option value="both">Both</option>
                        </SelectField>
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Max Entries</FieldLabel>
                        <NumberField value={prefs.historyLog.maxEntries} min={1} max={10000} onChange={(value) => updateHistoryLog({ maxEntries: value })} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={exportHistory} disabled={!prefs.historyLog.entries.length}>Export Log</Button>
                      <Button size="sm" variant="outline" onClick={() => updateHistoryLog({ entries: [] })} disabled={!prefs.historyLog.entries.length}>Clear Log</Button>
                    </div>
                  </Section>
                  <Section title="Recent Entries">
                    <div className="space-y-1 text-[11px] text-[var(--ps-text-muted)]">
                      {prefs.historyLog.entries.length ? (
                        prefs.historyLog.entries.slice(-6).reverse().map((entry) => (
                          <div key={entry.id} className="grid grid-cols-1 sm:grid-cols-[150px_90px_1fr] gap-2">
                            <span>{entry.createdAt ?? "No timestamp"}</span>
                            <span>{entry.tool ?? "unknown"}</span>
                            <span>{entry.label}</span>
                          </div>
                        ))
                      ) : (
                        <span>No history entries recorded.</span>
                      )}
                    </div>
                  </Section>
                </>
              )}

              {tab === "cursors" && (
                <>
                  <Section title="Cursor and Tool Behavior">
                    <div className="grid gap-2">
                      {(["standard", "precise", "brush-size"] as const).map((style) => (
                        <label key={style} className="flex items-center gap-2 text-[11px]">
                          <input
                            type="radio"
                            name="cursor"
                            checked={prefs.toolBehavior.cursorStyle === style}
                            onChange={() => updateToolBehavior({ cursorStyle: style })}
                            className="accent-[var(--ps-accent)]"
                          />
                          {style === "standard" ? "Standard" : style === "precise" ? "Precise crosshair" : "Brush size circle"}
                        </label>
                      ))}
                    </div>
                    <SliderField label="Brush Smoothing" value={prefs.toolBehavior.brushSmoothing} min={0} max={100} suffix="%" onChange={(value) => updateToolBehavior({ brushSmoothing: value })} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <ToggleRow checked={prefs.toolBehavior.showBrushPreview} onCheckedChange={(checked) => updateToolBehavior({ showBrushPreview: checked })} label="Show brush preview" />
                      <ToggleRow checked={prefs.toolBehavior.precisePicking} onCheckedChange={(checked) => updateToolBehavior({ precisePicking: checked })} label="Precise layer picking" />
                      <ToggleRow checked={prefs.toolBehavior.shiftCyclesTools} onCheckedChange={(checked) => updateToolBehavior({ shiftCyclesTools: checked })} label="Shift cycles grouped tools" />
                      <ToggleRow checked={prefs.toolBehavior.springLoadedTools} onCheckedChange={(checked) => updateToolBehavior({ springLoadedTools: checked })} label="Spring-loaded tool switching" />
                      <ToggleRow checked={prefs.toolBehavior.autoSelectLayer} onCheckedChange={(checked) => updateToolBehavior({ autoSelectLayer: checked })} label="Auto-select layer with Move" />
                      <ToggleRow checked={prefs.toolBehavior.wheelZooms} onCheckedChange={(checked) => updateToolBehavior({ wheelZooms: checked })} label="Mouse wheel zooms canvas" />
                      <ToggleRow checked={prefs.toolBehavior.animatedZoom} onCheckedChange={(checked) => updateToolBehavior({ animatedZoom: checked })} label="Animated zoom" />
                    </div>
                  </Section>
                </>
              )}

              {tab === "units" && (
                <>
                  <Section title="Rulers and Units">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Ruler Units</FieldLabel>
                        <SelectField value={prefs.rulerGrid.rulerUnits} onChange={(value) => updateRulerGrid({ rulerUnits: value })}>
                          <option value="px">Pixels</option>
                          <option value="in">Inches</option>
                          <option value="cm">Centimeters</option>
                          <option value="mm">Millimeters</option>
                          <option value="pt">Points</option>
                          <option value="pc">Picas</option>
                        </SelectField>
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Type Units</FieldLabel>
                        <SelectField value={prefs.rulerGrid.typeUnits} onChange={(value) => updateRulerGrid({ typeUnits: value })}>
                          <option value="pt">Points</option>
                          <option value="px">Pixels</option>
                        </SelectField>
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Print Resolution</FieldLabel>
                        <NumberField value={prefs.rulerGrid.printResolution} min={1} max={2400} onChange={(value) => updateRulerGrid({ printResolution: value })} />
                      </div>
                    </div>
                  </Section>
                  <Section title="Grid and Guides">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Grid Size</FieldLabel>
                        <NumberField value={prefs.rulerGrid.gridSize} min={4} max={1000} onChange={(value) => updateRulerGrid({ gridSize: value })} />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Subdivisions</FieldLabel>
                        <NumberField value={prefs.rulerGrid.gridSubdivisions} min={1} max={16} onChange={(value) => updateRulerGrid({ gridSubdivisions: value })} />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Grid Color</FieldLabel>
                        <Input type="color" value={prefs.rulerGrid.gridColor.startsWith("#") ? prefs.rulerGrid.gridColor : DEFAULT_PREFERENCES.rulerGrid.gridColor} onChange={(event) => updateRulerGrid({ gridColor: event.target.value })} className="h-8 p-1" />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Guides Color</FieldLabel>
                        <Input type="color" value={prefs.rulerGrid.guidesColor} onChange={(event) => updateRulerGrid({ guidesColor: event.target.value })} className="h-8 p-1" />
                      </div>
                    </div>
                    <SliderField label="Grid Opacity" value={prefs.rulerGrid.gridOpacity} min={0.05} max={1} step={0.05} onChange={(value) => updateRulerGrid({ gridOpacity: value })} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <ToggleRow checked={prefs.rulerGrid.showGrid} onCheckedChange={(checked) => updateRulerGrid({ showGrid: checked })} label="Show grid by default" />
                      <ToggleRow checked={prefs.rulerGrid.showPixelGrid} onCheckedChange={(checked) => updateRulerGrid({ showPixelGrid: checked })} label="Show pixel grid" />
                      <ToggleRow checked={prefs.rulerGrid.snapToGrid} onCheckedChange={(checked) => updateRulerGrid({ snapToGrid: checked })} label="Snap to grid" />
                      <ToggleRow checked={prefs.rulerGrid.snapToGuides} onCheckedChange={(checked) => updateRulerGrid({ snapToGuides: checked })} label="Snap to guides" />
                      <ToggleRow checked={prefs.rulerGrid.smartGuides} onCheckedChange={(checked) => updateRulerGrid({ smartGuides: checked })} label="Smart guides" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <FieldLabel>Ruler Origin X</FieldLabel>
                        <NumberField value={prefs.rulerGrid.rulerOrigin.x} min={-100000} max={100000} onChange={(value) => updateRulerGrid({ rulerOrigin: { ...prefs.rulerGrid.rulerOrigin, x: value } })} />
                      </div>
                      <div className="grid gap-1.5">
                        <FieldLabel>Ruler Origin Y</FieldLabel>
                        <NumberField value={prefs.rulerGrid.rulerOrigin.y} min={-100000} max={100000} onChange={(value) => updateRulerGrid({ rulerOrigin: { ...prefs.rulerGrid.rulerOrigin, y: value } })} />
                      </div>
                    </div>
                  </Section>
                </>
              )}

              {tab === "sets" && (
                <Section title="Reset, Export, and Import">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={exportSet}>Export Preferences</Button>
                    <Button size="sm" variant="secondary" onClick={() => importRef.current?.click()}>Import Preferences</Button>
                    <Button size="sm" variant="outline" onClick={restoreDefaults}>Reset All</Button>
                  </div>
                  <input ref={importRef} type="file" accept="application/json,.json" onChange={importSet} className="hidden" />
                  {importError && <p className="text-[11px] text-red-300">{importError}</p>}
                  <div className="text-[11px] text-[var(--ps-text-muted)]">
                    Preference sets include performance, scratch, GPU, file handling, history log, cursor, tool behavior, unit, ruler, and grid settings.
                  </div>
                </Section>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={resetSection} disabled={!TAB_SECTION[tab]}>
            Reset Section
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={save}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
