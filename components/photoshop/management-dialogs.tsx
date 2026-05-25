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
import { makeCanvas, useEditor } from "./editor-context"
import { selectionToMaskCanvas } from "./tool-helpers"
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
import { uid } from "./uid"
import type { AlphaChannel } from "./types"

type WorkspaceSummary = { name: string; savedAt?: number }
export type SelectionOperation = "expand" | "contract" | "grow" | "similar" | "transform" | "feather" | "border" | "smooth"
type SelectionChannelMode = "replace" | "add" | "subtract" | "intersect"

const selectionConfigs: Record<
  SelectionOperation,
  { title: string; label: string; defaultValue: number; min: number; max: number; actionLabel: string }
> = {
  expand: { title: "Expand Selection", label: "Expand by", defaultValue: 10, min: 1, max: 1000, actionLabel: "Expand" },
  contract: { title: "Contract Selection", label: "Contract by", defaultValue: 10, min: 1, max: 1000, actionLabel: "Contract" },
  grow: { title: "Grow Selection", label: "Tolerance", defaultValue: 32, min: 0, max: 255, actionLabel: "Grow" },
  similar: { title: "Similar Selection", label: "Tolerance", defaultValue: 32, min: 0, max: 255, actionLabel: "Select Similar" },
  transform: { title: "Transform Selection", label: "Scale", defaultValue: 1, min: 0.01, max: 20, actionLabel: "Transform" },
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

function cloneMaskCanvas(src: HTMLCanvasElement) {
  const out = makeCanvas(src.width, src.height)
  out.getContext("2d")!.drawImage(src, 0, 0)
  return out
}

function invertMaskInPlace(mask: HTMLCanvasElement) {
  const ctx = mask.getContext("2d")!
  const img = ctx.getImageData(0, 0, mask.width, mask.height)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 255
    img.data[i + 1] = 255
    img.data[i + 2] = 255
    img.data[i + 3] = 255 - img.data[i + 3]
  }
  ctx.putImageData(img, 0, 0)
  return mask
}

function combineChannelCanvas(base: HTMLCanvasElement, incoming: HTMLCanvasElement, mode: SelectionChannelMode) {
  if (mode === "replace") return cloneMaskCanvas(incoming)
  const out = cloneMaskCanvas(base)
  const ctx = out.getContext("2d")!
  if (mode === "add") ctx.globalCompositeOperation = "source-over"
  if (mode === "subtract") ctx.globalCompositeOperation = "destination-out"
  if (mode === "intersect") ctx.globalCompositeOperation = "destination-in"
  ctx.drawImage(incoming, 0, 0)
  ctx.globalCompositeOperation = "source-over"
  return out
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
  const { activeDoc, dispatch, commit } = useEditor()
  const config = operation ? selectionConfigs[operation] : selectionConfigs.expand
  const [value, setValue] = React.useState(config.defaultValue)
  const [rotation, setRotation] = React.useState(0)
  const [smoothTransform, setSmoothTransform] = React.useState(true)
  const canApply = !!activeDoc?.selection.bounds

  React.useEffect(() => {
    if (open) {
      setValue(config.defaultValue)
      setRotation(0)
      setSmoothTransform(true)
    }
  }, [config.defaultValue, open, operation])

  const apply = () => {
    if (!operation || !canApply) return
    const amount = operation === "transform"
      ? Math.max(config.min, Math.min(config.max, value))
      : Math.max(config.min, Math.min(config.max, Math.round(value)))
    if (operation === "expand") dispatch({ type: "grow-selection", amount })
    if (operation === "contract") dispatch({ type: "contract-selection", amount })
    if (operation === "grow") dispatch({ type: "grow-similar-selection", tolerance: amount })
    if (operation === "similar") dispatch({ type: "similar-selection", tolerance: amount })
    if (operation === "transform") dispatch({ type: "transform-selection", scale: amount, rotationDeg: rotation, smoothing: smoothTransform })
    if (operation === "feather") dispatch({ type: "feather-selection", radius: amount })
    if (operation === "border") dispatch({ type: "border-selection", width: amount })
    if (operation === "smooth") dispatch({ type: "smooth-selection", radius: amount })
    window.setTimeout(() => commit(config.title, []), 0)
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
        <div className={operation === "transform" ? "grid gap-3" : "grid grid-cols-[1fr_110px] items-end gap-3"}>
          <div className="grid gap-1">
            <Label className="text-[11px]">{config.label}</Label>
            <Input
              autoFocus
              aria-label={operation === "transform" ? "Scale" : config.label}
              type="number"
              min={config.min}
              max={config.max}
              step={operation === "transform" ? 0.01 : 1}
              value={value}
              onChange={(event) => setValue(Number(event.target.value) || 0)}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply()
              }}
              className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
            />
          </div>
          {operation === "transform" ? (
            <>
              <div className="grid gap-1">
                <Label className="text-[11px]">Rotate degrees</Label>
                <Input
                  aria-label="Rotate degrees"
                  type="number"
                  min={-360}
                  max={360}
                  value={rotation}
                  onChange={(event) => setRotation(Number(event.target.value) || 0)}
                  className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                />
              </div>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  aria-label="Smooth transformed edge"
                  type="checkbox"
                  checked={smoothTransform}
                  onChange={(event) => setSmoothTransform(event.target.checked)}
                  className="accent-[var(--ps-accent)]"
                />
                Smooth transformed edge
              </label>
            </>
          ) : (
            <div className="pb-2 text-[11px] text-[var(--ps-text-dim)]">
              {operation === "similar" || operation === "grow" ? "0-255" : "px"}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!canApply}>{config.actionLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SaveSelectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, dispatch, commit } = useEditor()
  const channels = activeDoc?.channels ?? []
  const [name, setName] = React.useState("Alpha Selection")
  const [destination, setDestination] = React.useState("new")
  const [mode, setMode] = React.useState<SelectionChannelMode>("replace")
  const [kind, setKind] = React.useState<AlphaChannel["kind"]>("alpha")
  const [spotColor, setSpotColor] = React.useState("#ff3b30")
  const [spotOpacity, setSpotOpacity] = React.useState(50)
  const [invert, setInvert] = React.useState(false)
  const canSave = !!activeDoc?.selection.bounds

  React.useEffect(() => {
    if (!open) return
    setName(`Alpha ${channels.length + 1}`)
    setDestination("new")
    setMode("replace")
    setKind("alpha")
    setSpotColor("#ff3b30")
    setSpotOpacity(50)
    setInvert(false)
  }, [channels.length, open])

  const save = () => {
    if (!activeDoc || !canSave) return
    const selectionMask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
    if (!selectionMask) return
    const incoming = invert ? invertMaskInPlace(selectionMask) : selectionMask
    const cleanName = name.trim() || `Alpha ${channels.length + 1}`
    const patch = {
      name: cleanName,
      kind,
      spotColor: kind === "spot" ? spotColor : undefined,
      spotOpacity: kind === "spot" ? Math.max(0, Math.min(100, Math.round(spotOpacity))) : undefined,
    }

    if (destination === "new") {
      dispatch({
        type: "save-selection",
        channel: {
          id: uid("channel"),
          canvas: cloneMaskCanvas(incoming),
          ...patch,
        },
      })
    } else {
      const existing = channels.find((channel) => channel.id === destination)
      if (!existing) return
      dispatch({
        type: "update-channel",
        channelId: existing.id,
        patch: {
          ...patch,
          canvas: combineChannelCanvas(existing.canvas, incoming, mode),
        },
      })
    }
    window.setTimeout(() => commit("Save Selection", []), 0)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Save Selection</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Store the active selection as a named alpha channel or merge it into an existing channel.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-[11px]">
          <div className="grid gap-1">
            <Label className="text-[11px]">Channel name</Label>
            <Input aria-label="Channel name" value={name} onChange={(event) => setName(event.target.value)} className="h-8 bg-[var(--ps-panel-2)] text-[11px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Destination channel</span>
              <select
                aria-label="Destination channel"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
              >
                <option value="new">New channel</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Operation</span>
              <select
                aria-label="Save operation"
                value={mode}
                onChange={(event) => setMode(event.target.value as SelectionChannelMode)}
                disabled={destination === "new"}
                className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] disabled:opacity-50"
              >
                <option value="replace">Replace channel</option>
                <option value="add">Add to channel</option>
                <option value="subtract">Subtract from channel</option>
                <option value="intersect">Intersect with channel</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Channel kind</span>
              <select
                aria-label="Channel kind"
                value={kind ?? "alpha"}
                onChange={(event) => setKind(event.target.value as AlphaChannel["kind"])}
                className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
              >
                <option value="alpha">Alpha</option>
                <option value="spot">Spot preview</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Spot color</span>
              <input
                aria-label="Spot color"
                type="color"
                value={spotColor}
                onChange={(event) => setSpotColor(event.target.value)}
                disabled={kind !== "spot"}
                className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] disabled:opacity-50"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Spot opacity</span>
              <Input
                aria-label="Spot opacity"
                type="number"
                min={0}
                max={100}
                value={spotOpacity}
                disabled={kind !== "spot"}
                onChange={(event) => setSpotOpacity(Number(event.target.value) || 0)}
                className="h-8 bg-[var(--ps-panel-2)] text-[11px] disabled:opacity-50"
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input
              aria-label="Invert selection before saving"
              type="checkbox"
              checked={invert}
              onChange={(event) => setInvert(event.target.checked)}
              className="accent-[var(--ps-accent)]"
            />
            Invert selection before saving
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LoadSelectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, dispatch, commit } = useEditor()
  const channels = activeDoc?.channels ?? []
  const [channelId, setChannelId] = React.useState("")
  const [mode, setMode] = React.useState<SelectionChannelMode>("replace")
  const [invert, setInvert] = React.useState(false)
  const [rename, setRename] = React.useState("")
  const selected = channels.find((channel) => channel.id === channelId) ?? channels[0] ?? null

  React.useEffect(() => {
    if (!open) return
    const first = channels[0]
    setChannelId(first?.id ?? "")
    setRename(first?.name ?? "")
    setMode("replace")
    setInvert(false)
  }, [channels, open])

  React.useEffect(() => {
    if (selected) setRename(selected.name)
  }, [selected?.id])

  const load = () => {
    if (!selected) return
    const cleanRename = rename.trim()
    if (cleanRename && cleanRename !== selected.name) {
      dispatch({ type: "update-channel", channelId: selected.id, patch: { name: cleanRename } })
    }
    dispatch({ type: "load-selection", channelId: selected.id, mode, invert })
    window.setTimeout(() => commit("Load Selection", []), 0)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Load Selection</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Load a saved alpha channel into the active selection and choose how it combines.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-[11px]">
          <label className="grid gap-1">
            <span className="text-[var(--ps-text-dim)]">Source channel</span>
            <select
              aria-label="Source channel"
              value={selected?.id ?? ""}
              onChange={(event) => setChannelId(event.target.value)}
              disabled={!channels.length}
              className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] disabled:opacity-50"
            >
              {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Load operation</span>
              <select
                aria-label="Load operation"
                value={mode}
                onChange={(event) => setMode(event.target.value as SelectionChannelMode)}
                disabled={!selected}
                className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] disabled:opacity-50"
              >
                <option value="replace">Replace selection</option>
                <option value="add">Add to selection</option>
                <option value="subtract">Subtract from selection</option>
                <option value="intersect">Intersect with selection</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Rename selected channel</span>
              <Input
                aria-label="Rename selected channel"
                value={rename}
                onChange={(event) => setRename(event.target.value)}
                disabled={!selected}
                className="h-8 bg-[var(--ps-panel-2)] text-[11px] disabled:opacity-50"
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input
              aria-label="Invert channel before loading"
              type="checkbox"
              checked={invert}
              onChange={(event) => setInvert(event.target.checked)}
              disabled={!selected}
              className="accent-[var(--ps-accent)] disabled:opacity-50"
            />
            Invert channel before loading
          </label>
          {!channels.length ? (
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-3 text-center text-[var(--ps-text-dim)]">
              No saved channels
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={load} disabled={!selected}>Load</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
