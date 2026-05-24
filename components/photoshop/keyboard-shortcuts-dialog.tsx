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
import { AlertTriangle, Download, Search, RotateCcw, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { downloadText } from "./document-io"
import {
  DEFAULT_SHORTCUTS,
  buildShortcutOverrideUpdate,
  eventToShortcut,
  isShortcutAssigned,
  loadCustomShortcuts,
  saveCustomShortcuts,
  shortcutConflictMap,
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
  const [categoryFilter, setCategoryFilter] = React.useState("All")
  const [viewFilter, setViewFilter] = React.useState<"all" | "modified" | "conflicts" | "unassigned">("all")
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

  const conflicts = React.useMemo(() => shortcutConflictMap(shortcuts), [shortcuts])
  const conflictIds = React.useMemo(() => new Set(conflicts.flatMap((conflict) => conflict.shortcutIds)), [conflicts])
  const allCategories = React.useMemo(() => ["All", ...new Set(shortcuts.map((s) => s.category))], [shortcuts])
  const isModified = React.useCallback((id: string) => id in overrides, [overrides])
  const lowerFilter = filter.toLowerCase()
  const filtered = shortcuts.filter((s) => {
    if (categoryFilter !== "All" && s.category !== categoryFilter) return false
    if (viewFilter === "modified" && !isModified(s.id)) return false
    if (viewFilter === "conflicts" && !conflictIds.has(s.id)) return false
    if (viewFilter === "unassigned" && isShortcutAssigned(s.keys)) return false
    return (
      !lowerFilter ||
      s.action.toLowerCase().includes(lowerFilter) ||
      s.keys.toLowerCase().includes(lowerFilter) ||
      s.category.toLowerCase().includes(lowerFilter)
    )
  })

  const categories = [...new Set(filtered.map((s) => s.category))]

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
    let newOverrides = buildShortcutOverrideUpdate(shortcuts, overrides, editingId, pendingKeys, {
      clearConflicts: true,
    })
    if (defaultEntry && pendingKeys === defaultEntry.keys && newOverrides[editingId] === pendingKeys) {
      newOverrides = { ...newOverrides }
      delete newOverrides[editingId]
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

  const resetCategory = () => {
    if (categoryFilter === "All") return
    const ids = new Set(DEFAULT_SHORTCUTS.filter((shortcut) => shortcut.category === categoryFilter).map((shortcut) => shortcut.id))
    const next = { ...overrides }
    for (const id of ids) delete next[id]
    setOverrides(next)
    saveCustomShortcuts(next)
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
            placeholder="Search shortcuts..."
            aria-label="Search shortcuts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-7 h-8 text-[11px] bg-[var(--ps-panel-2)] border-[var(--ps-divider)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Shortcut category"
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
          >
            {allCategories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <select
            value={viewFilter}
            onChange={(event) => setViewFilter(event.target.value as typeof viewFilter)}
            aria-label="Shortcut view"
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
          >
            <option value="all">All shortcuts</option>
            <option value="modified">Modified only</option>
            <option value="conflicts">Conflicts only</option>
            <option value="unassigned">Unassigned only</option>
          </select>
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
            {conflicts.length ? `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}` : "No conflicts"}
          </span>
        </div>

        {conflicts.length > 0 && (
          <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 p-2 text-[10px] text-amber-100">
            <div className="mb-1 flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Conflicting assignments
            </div>
            <div className="space-y-0.5">
              {conflicts.slice(0, 3).map((conflict) => (
                <div key={conflict.keys}>
                  {conflict.keys}: {conflict.actions.join(" / ")}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Editing banner */}
        {editingId && (
          <div className="flex items-center gap-2 p-2 rounded-sm bg-[var(--ps-accent)]/10 border border-[var(--ps-accent)]/30 text-[11px]">
            <span className="flex-1">
              Press new shortcut for <strong>{shortcuts.find((s) => s.id === editingId)?.action}</strong>:
              <span className="ml-2 font-mono font-semibold text-[var(--ps-accent)]">
                {pendingKeys ?? "waiting..."}
              </span>
            </span>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setPendingKeys("None")}>
              <X className="h-3 w-3" />
              Clear
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
                  const isDupe = conflictIds.has(s.id)
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
            <Button variant="outline" size="sm" onClick={resetCategory} disabled={categoryFilter === "All"}>
              Reset Category
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
