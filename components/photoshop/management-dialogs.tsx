"use client"

import * as React from "react"
import { Clock, Download, FolderOpen, LayoutPanelLeft, RotateCcw, Save, Search, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEditor } from "./editor-context"
import { WORKSPACE_PRESET_OPTIONS, type WorkspacePresetId } from "./panel-registry"
import type { RecentDocument } from "./recent-documents"
import { downloadText } from "./document-io"
import {
  mergeWorkspaceLibraries,
  normalizeWorkspaceLibrary,
  readWorkspaceLibrary,
  serializeWorkspaceLibrary,
  writeWorkspaceLibrary,
} from "./workspace-layouts"

type WorkspaceSummary = { name: string; savedAt?: number }
export type SelectionOperation = "expand" | "contract" | "similar" | "feather" | "border" | "smooth"

const selectionConfigs: Record<
  SelectionOperation,
  { title: string; label: string; defaultValue: number; min: number; max: number; actionLabel: string }
> = {
  expand: { title: "Expand Selection", label: "Expand by", defaultValue: 10, min: 1, max: 1000, actionLabel: "Expand" },
  contract: { title: "Contract Selection", label: "Contract by", defaultValue: 10, min: 1, max: 1000, actionLabel: "Contract" },
  similar: { title: "Similar Selection", label: "Tolerance", defaultValue: 32, min: 0, max: 255, actionLabel: "Select Similar" },
  feather: { title: "Feather Selection", label: "Radius", defaultValue: 5, min: 0, max: 250, actionLabel: "Feather" },
  border: { title: "Border Selection", label: "Width", defaultValue: 3, min: 1, max: 500, actionLabel: "Border" },
  smooth: { title: "Smooth Selection", label: "Radius", defaultValue: 3, min: 1, max: 250, actionLabel: "Smooth" },
}

function fmtDate(value?: number) {
  return value ? new Date(value).toLocaleString() : "Not saved"
}

function matchesFilter(parts: string[], filter: string) {
  const q = filter.trim().toLowerCase()
  return !q || parts.some((part) => part.toLowerCase().includes(q))
}

export function RecentDocumentsDialog({
  open,
  onOpenChange,
  recents,
  onOpenRecent,
  onRemoveRecent,
  onClearRecents,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recents: RecentDocument[]
  onOpenRecent: (recent: RecentDocument) => void | Promise<void>
  onRemoveRecent: (id: string) => void
  onClearRecents: () => void
}) {
  const [filter, setFilter] = React.useState("")
  const visible = recents.filter((recent) => matchesFilter([recent.name, recent.kind], filter))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Recent Documents</DialogTitle>
          <DialogDescription className="sr-only">Open, inspect, remove, or clear recent Photoshop Web documents.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
            <Input
              aria-label="Search recent documents"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search recent documents"
              className="h-8 bg-[var(--ps-panel-2)] pl-7 text-[11px]"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
            {visible.length ? (
              visible.map((recent) => (
                <div key={recent.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-b border-[var(--ps-divider)]/50 px-2 py-2 last:border-b-0">
                  {recent.thumbnail ? (
                    <img
                      src={recent.thumbnail}
                      alt=""
                      className="h-9 w-12 rounded-sm border border-[var(--ps-divider)] object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-12 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]">
                      <FolderOpen className="h-4 w-4 text-[var(--ps-text-dim)]" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[12px]">{recent.name}</div>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--ps-text-dim)]">
                      <span className="uppercase">{recent.kind}</span>
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(recent.updatedAt)}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void onOpenRecent(recent)}>
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${recent.name}`} onClick={() => onRemoveRecent(recent.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No recent documents.</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClearRecents} disabled={!recents.length}>Clear All</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceManagerDialog({
  open,
  onOpenChange,
  savedWorkspaces,
  onRefresh,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  savedWorkspaces: WorkspaceSummary[]
  onRefresh: () => void
}) {
  const [name, setName] = React.useState("My Workspace")
  const importRef = React.useRef<HTMLInputElement>(null)

  const refreshSoon = () => window.setTimeout(onRefresh, 0)
  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    window.dispatchEvent(new CustomEvent("ps-save-workspace", { detail: { name: trimmed } }))
    toast.success("Workspace saved")
    refreshSoon()
  }
  const applyPreset = (preset: WorkspacePresetId) => {
    window.dispatchEvent(new CustomEvent("ps-apply-workspace-preset", { detail: { preset } }))
  }
  const applySaved = (workspaceName: string) => {
    window.dispatchEvent(new CustomEvent("ps-apply-workspace", { detail: { name: workspaceName } }))
  }
  const deleteSaved = (workspaceName: string) => {
    window.dispatchEvent(new CustomEvent("ps-delete-workspace", { detail: { name: workspaceName } }))
    toast.success("Workspace deleted")
    refreshSoon()
  }
  const exportWorkspaces = () => {
    const workspaces = readWorkspaceLibrary()
    downloadText(serializeWorkspaceLibrary(workspaces), "photoshop-workspaces.psworkspaces.json")
  }
  const importWorkspaces = async (file: File) => {
    try {
      if (file.size > 512 * 1024) throw new Error("Workspace files are limited to 512 KB.")
      const incoming = normalizeWorkspaceLibrary(JSON.parse(await file.text()))
      if (!incoming.length) throw new Error("Workspace file does not contain valid workspaces.")
      writeWorkspaceLibrary(mergeWorkspaceLibraries(readWorkspaceLibrary(), incoming))
      toast.success(`Imported ${incoming.length} workspace${incoming.length === 1 ? "" : "s"}`)
      refreshSoon()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import workspaces")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }
  const clearSaved = () => {
    writeWorkspaceLibrary([])
    toast.success("Saved workspaces cleared")
    refreshSoon()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <input
          ref={importRef}
          type="file"
          accept=".json,.psworkspaces,.psworkspaces.json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void importWorkspaces(file)
          }}
        />
        <DialogHeader>
          <DialogTitle>Workspace Manager</DialogTitle>
          <DialogDescription className="sr-only">Save, apply, delete, or reset panel workspace layouts.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="grid gap-1">
              <Label className="text-[11px]">Workspace name</Label>
              <Input
                aria-label="Workspace name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
              />
            </div>
            <Button className="mt-5" size="sm" onClick={save}>
              <Save className="h-3.5 w-3.5" />
              Save Current
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {WORKSPACE_PRESET_OPTIONS.map((preset) => (
              <Button key={preset.id} variant="outline" size="sm" onClick={() => applyPreset(preset.id)}>
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
            <Button variant="outline" size="sm" onClick={exportWorkspaces} disabled={!savedWorkspaces.length}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={clearSaved} disabled={!savedWorkspaces.length}>
              <RotateCcw className="h-3.5 w-3.5" />
              Clear Saved
            </Button>
          </div>
          <div className="max-h-[300px] overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
            {savedWorkspaces.length ? (
              savedWorkspaces.map((workspace) => (
                <div key={workspace.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-[var(--ps-divider)]/50 px-2 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate text-[12px]">
                      <LayoutPanelLeft className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
                      {workspace.name}
                    </div>
                    <div className="pl-5 text-[10px] text-[var(--ps-text-dim)]">{fmtDate(workspace.savedAt)}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => applySaved(workspace.name)}>Apply</Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${workspace.name}`} onClick={() => deleteSaved(workspace.name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No saved workspaces.</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SelectionOperationDialog({
  operation,
  open,
  onOpenChange,
}: {
  operation: SelectionOperation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, dispatch } = useEditor()
  const config = operation ? selectionConfigs[operation] : selectionConfigs.expand
  const [value, setValue] = React.useState(config.defaultValue)
  const canApply = !!activeDoc?.selection.bounds

  React.useEffect(() => {
    if (open) setValue(config.defaultValue)
  }, [config.defaultValue, open, operation])

  const apply = () => {
    if (!operation || !canApply) return
    const amount = Math.max(config.min, Math.min(config.max, Math.round(value)))
    if (operation === "expand") dispatch({ type: "grow-selection", amount })
    if (operation === "contract") dispatch({ type: "contract-selection", amount })
    if (operation === "similar") dispatch({ type: "similar-selection", tolerance: amount })
    if (operation === "feather") dispatch({ type: "feather-selection", radius: amount })
    if (operation === "border") dispatch({ type: "border-selection", width: amount })
    if (operation === "smooth") dispatch({ type: "smooth-selection", radius: amount })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            {canApply ? "Adjust the active selection without leaving the menu flow." : "Create a selection before applying this command."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_110px] items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-[11px]">{config.label}</Label>
            <Input
              autoFocus
              aria-label={config.label}
              type="number"
              min={config.min}
              max={config.max}
              value={value}
              onChange={(event) => setValue(Number(event.target.value) || 0)}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply()
              }}
              className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
            />
          </div>
          <div className="pb-2 text-[11px] text-[var(--ps-text-dim)]">
            {operation === "similar" ? "0-255" : "px"}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!canApply}>{config.actionLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
