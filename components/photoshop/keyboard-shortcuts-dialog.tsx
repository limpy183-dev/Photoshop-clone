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
import { Input } from "@/components/ui/input"
import { Download, Search, RotateCcw, Upload } from "lucide-react"
import { toast } from "sonner"
import { downloadText } from "./document-io"
import {
  DEFAULT_SHORTCUTS,
  eventToShortcut,
  isShortcutAssigned,
  loadCustomShortcuts,
  saveCustomShortcuts,
  validShortcutOverrides,
} from "./shortcuts"

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [filter, setFilter] = React.useState("")
  const [overrides, setOverrides] = React.useState<Record<string, string>>(loadCustomShortcuts)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [pendingKeys, setPendingKeys] = React.useState<string | null>(null)
  const captureRef = React.useRef<HTMLDivElement>(null)
  const importRef = React.useRef<HTMLInputElement>(null)

  // Build the effective shortcut list with overrides applied
  const shortcuts = React.useMemo(
    () => DEFAULT_SHORTCUTS.map((s) => ({ ...s, keys: overrides[s.id] ?? s.keys })),
    [overrides],
  )

  const lowerFilter = filter.toLowerCase()
  const filtered = lowerFilter
    ? shortcuts.filter(
        (s) =>
          s.action.toLowerCase().includes(lowerFilter) ||
          s.keys.toLowerCase().includes(lowerFilter) ||
          s.category.toLowerCase().includes(lowerFilter),
      )
    : shortcuts

  const categories = [...new Set(filtered.map((s) => s.category))]

  // Check for duplicate key bindings
  const duplicateKeys = React.useMemo(() => {
    const seen = new Map<string, string>()
    const dupes = new Set<string>()
    for (const s of shortcuts) {
      if (!isShortcutAssigned(s.keys)) continue
      const norm = s.keys.toLowerCase()
      if (seen.has(norm) && seen.get(norm) !== s.id) {
        dupes.add(norm)
      }
      seen.set(norm, s.id)
    }
    return dupes
  }, [shortcuts])

  // Handle key capture when editing
  React.useEffect(() => {
    if (!editingId) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") {
        setEditingId(null)
        setPendingKeys(null)
        return
      }
      const combo = eventToShortcut(e)
      if (combo) {
        setPendingKeys(combo)
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [editingId])

  const confirmEdit = () => {
    if (!editingId || !pendingKeys) return
    const defaultEntry = DEFAULT_SHORTCUTS.find((s) => s.id === editingId)
    const newOverrides = { ...overrides }
    if (defaultEntry && pendingKeys === defaultEntry.keys) {
      // Same as default — remove override
      delete newOverrides[editingId]
    } else {
      newOverrides[editingId] = pendingKeys
    }
    setOverrides(newOverrides)
    saveCustomShortcuts(newOverrides)
    setEditingId(null)
    setPendingKeys(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setPendingKeys(null)
  }

  const resetSingle = (id: string) => {
    const newOverrides = { ...overrides }
    delete newOverrides[id]
    setOverrides(newOverrides)
    saveCustomShortcuts(newOverrides)
  }

  const resetAll = () => {
    setOverrides({})
    saveCustomShortcuts({})
    setEditingId(null)
    setPendingKeys(null)
  }

  const exportShortcuts = () => {
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "ps-shortcuts",
          version: 1,
          exportedAt: new Date().toISOString(),
          overrides,
        },
        null,
        2,
      ),
      "photoshop-shortcuts.psshortcuts.json",
    )
  }

  const importShortcuts = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text())
      const next = validShortcutOverrides(parsed)
      setOverrides(next)
      saveCustomShortcuts(next)
      setEditingId(null)
      setPendingKeys(null)
      toast.success(`Imported ${Object.keys(next).length} shortcut override${Object.keys(next).length === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import shortcuts")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  const isModified = (id: string) => id in overrides
  const modifiedCount = Object.keys(overrides).length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) cancelEdit(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[580px] max-h-[85vh] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <input
          ref={importRef}
          type="file"
          accept=".json,.psshortcuts,.psshortcuts.json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void importShortcuts(file)
          }}
        />
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="text-[10px] text-[var(--ps-text-dim)]">
            Click any shortcut to change it. Press the new key combination, then click Accept.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-[var(--ps-text-dim)]" />
          <Input
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-7 h-8 text-[11px] bg-[var(--ps-panel-2)] border-[var(--ps-divider)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" />
            Import
          </Button>
          <Button size="sm" variant="outline" onClick={exportShortcuts}>
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
          <span className="ml-auto text-[10px] text-[var(--ps-text-dim)]">
            {duplicateKeys.size ? `${duplicateKeys.size} conflict${duplicateKeys.size === 1 ? "" : "s"}` : "No conflicts"}
          </span>
        </div>

        {/* Editing banner */}
        {editingId && (
          <div className="flex items-center gap-2 p-2 rounded-sm bg-[var(--ps-accent)]/10 border border-[var(--ps-accent)]/30 text-[11px]">
            <span className="flex-1">
              Press new shortcut for <strong>{shortcuts.find((s) => s.id === editingId)?.action}</strong>:
              <span className="ml-2 font-mono font-semibold text-[var(--ps-accent)]">
                {pendingKeys ?? "waiting…"}
              </span>
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 text-[10px] px-2" disabled={!pendingKeys} onClick={confirmEdit}>
              Accept
            </Button>
          </div>
        )}

        <div ref={captureRef} className="overflow-y-auto max-h-[48vh] space-y-3 pr-1">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="text-[10px] uppercase text-[var(--ps-text-dim)] font-semibold mb-1 sticky top-0 bg-[var(--ps-panel)] py-0.5 z-10">
                {cat}
              </div>
              {filtered
                .filter((s) => s.category === cat)
                .map((s) => {
                  const isEditing = editingId === s.id
                  const isDupe = duplicateKeys.has(s.keys.toLowerCase())
                  const modified = isModified(s.id)
                  return (
                    <div
                      key={s.id}
                      className={`grid grid-cols-[1fr_160px_20px] gap-2 py-1.5 px-1 border-b border-[var(--ps-divider)] text-[11px] items-center rounded-sm cursor-pointer transition-colors ${
                        isEditing
                          ? "bg-[var(--ps-accent)]/15 border-[var(--ps-accent)]/40"
                          : "hover:bg-[var(--ps-tool-hover)]"
                      }`}
                      onClick={() => {
                        if (!isEditing) {
                          setEditingId(s.id)
                          setPendingKeys(null)
                        }
                      }}
                    >
                      <span className={modified ? "text-[var(--ps-accent)]" : ""}>{s.action}</span>
                      <span
                        className={`font-mono text-right ${
                          isEditing
                            ? "text-[var(--ps-accent)] font-semibold"
                            : isDupe
                              ? "text-orange-400"
                              : modified
                                ? "text-[var(--ps-accent)]"
                                : "text-[var(--ps-text-dim)]"
                        }`}
                      >
                        {isEditing && pendingKeys ? pendingKeys : s.keys}
                      </span>
                      {modified && !isEditing && (
                        <button
                          className="p-0.5 hover:bg-[var(--ps-tool-hover)] rounded-sm"
                          title="Reset to default"
                          onClick={(e) => { e.stopPropagation(); resetSingle(s.id) }}
                        >
                          <RotateCcw className="w-3 h-3 text-[var(--ps-text-dim)]" />
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center text-[var(--ps-text-dim)] text-[11px] py-8">No shortcuts found</div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            {modifiedCount > 0 && (
              <span className="text-[10px] text-[var(--ps-text-dim)]">
                {modifiedCount} custom shortcut{modifiedCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetAll} disabled={modifiedCount === 0}>
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Defaults
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
