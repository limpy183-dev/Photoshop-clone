"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { planAutosaveDocuments, planIncrementalAutosave, type IncrementalAutosaveManifest } from "./autosave-planner"
import { useEditorSelector } from "./editor-context"
import { addPhotoshopEventListener } from "./events"
import { writeScratchBlob } from "./opfs-scratch"
import { loadPreferencesFromStorage } from "./preferences-engine"
import { clearAutosave, readAutosaves, readAutosavesAsync, removeAutosave, writeAutosaves, type AutosaveDocument } from "./recent-documents"

function autosavePreferences() {
  try {
    const prefs = loadPreferencesFromStorage()
    return {
      enabled: prefs.fileHandling.autoSave,
      intervalMs: Math.max(15, prefs.fileHandling.autosaveIntervalSec) * 1000,
    }
  } catch {
    return { enabled: false, intervalMs: 120_000 }
  }
}

/**
 * Every recoverable snapshot is offered, newest first, one snapshot per
 * document. Recovering or discarding one entry must never touch the others.
 */
function collectRecoveryCandidates(entries: AutosaveDocument[]): AutosaveDocument[] {
  const seen = new Set<string>()
  return entries
    .filter((entry) => Date.now() - entry.updatedAt >= 10_000)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((entry) => {
      if (seen.has(entry.documentId)) return false
      seen.add(entry.documentId)
      return true
    })
}

export function AutosaveRecovery() {
  const documents = useEditorSelector((editor) => editor.documents)
  const activeDocId = useEditorSelector((editor) => editor.activeDocId)
  const createDocument = useEditorSelector((editor) => editor.createDocument)
  const documentStatuses = useEditorSelector((editor) => editor.documentStatuses)
  const documentHistoryVersions = useEditorSelector((editor) => editor.documentHistoryVersions)
  const [pending, setPending] = React.useState<AutosaveDocument[]>([])
  const [busy, setBusy] = React.useState(false)
  const [prefs, setPrefs] = React.useState<{ enabled: boolean; intervalMs: number } | null>(null)
  const candidate = pending[0] ?? null

  // Keep a live ref to documents so the autosave interval can read the
  // latest snapshot without re-running its effect (and resetting its
  // timer) on every reducer action that touches documents.
  const documentsRef = React.useRef(documents)
  React.useEffect(() => {
    documentsRef.current = documents
  }, [documents])
  const documentStatusesRef = React.useRef(documentStatuses)
  React.useEffect(() => {
    documentStatusesRef.current = documentStatuses
  }, [documentStatuses])
  const documentHistoryVersionsRef = React.useRef(documentHistoryVersions)
  React.useEffect(() => {
    documentHistoryVersionsRef.current = documentHistoryVersions
  }, [documentHistoryVersions])
  const lastSavedVersionsRef = React.useRef<Record<string, number>>({})
  const serializedAutosavesRef = React.useRef<Record<string, Omit<AutosaveDocument, "id" | "kind" | "updatedAt">>>({})
  const autosaveManifestRef = React.useRef<IncrementalAutosaveManifest>({ entries: {} })
  const writingRef = React.useRef(false)

  const runAutosave = React.useCallback(async () => {
    if (writingRef.current) return
    writingRef.current = true
    try {
      const docs = documentsRef.current
      const openIds = new Set(docs.map((doc) => doc.id))
      let pruned = false
      for (const id of Object.keys(serializedAutosavesRef.current)) {
        if (!openIds.has(id)) {
          delete serializedAutosavesRef.current[id]
          pruned = true
        }
      }

      const plan = planAutosaveDocuments({
        documents: docs.map((doc) => ({
          id: doc.id,
          name: doc.name,
          version: documentHistoryVersionsRef.current[doc.id] ?? 0,
          dirty: documentStatusesRef.current[doc.id]?.dirty === true,
        })),
        lastSavedVersions: lastSavedVersionsRef.current,
      })

      if (!plan.documentsToSerialize.length && !pruned) return

      const { serializeProject } = await import("./document-project-io")
      const serializedLengths: Record<string, number> = {}
      const serializedIds: string[] = []
      for (const planDoc of plan.documentsToSerialize) {
        const doc = docs.find((candidateDoc) => candidateDoc.id === planDoc.id)
        if (!doc) continue
        try {
          const serialized = serializeProject(doc, { pretty: false })
          serializedLengths[doc.id] = serialized.length
          serializedAutosavesRef.current[doc.id] = {
            documentId: doc.id,
            name: doc.name,
            serialized,
          }
          serializedIds.push(doc.id)
        } catch {
          // Serialization failed for this document — keep its last good
          // snapshot and retry on the next tick.
        }
      }

      const incremental = planIncrementalAutosave({
        documents: docs.map((doc) => {
          const existing = serializedAutosavesRef.current[doc.id]?.serialized
          const previous = autosaveManifestRef.current.entries[doc.id]
          return {
            id: doc.id,
            name: doc.name,
            version: documentHistoryVersionsRef.current[doc.id] ?? 0,
            dirty: documentStatusesRef.current[doc.id]?.dirty === true,
            serializedLength: serializedLengths[doc.id] ?? existing?.length ?? previous?.bytes ?? 0,
          }
        }),
        previousManifest: autosaveManifestRef.current,
      })
      autosaveManifestRef.current = incremental.nextManifest

      for (const write of incremental.documentsToWrite) {
        if (write.storage !== "scratch") continue
        const serialized = serializedAutosavesRef.current[write.id]?.serialized
        if (!serialized) continue
        writeScratchBlob(
          `autosave-${write.id}-${write.version}.psproj`,
          new Blob([serialized], { type: "application/json" }),
        ).catch(() => {})
      }

      const payload = Object.values(serializedAutosavesRef.current)
      if (payload.length) {
        const savedVersions: Record<string, number> = {}
        for (const id of serializedIds) {
          savedVersions[id] = plan.nextSavedVersions[id]
        }
        // Mark versions saved only once the write actually lands somewhere,
        // so failed writes are retried on the next tick.
        void writeAutosaves(payload, { activeDocumentId: activeDocId }).then((persisted) => {
          if (!persisted) return
          lastSavedVersionsRef.current = { ...lastSavedVersionsRef.current, ...savedVersions }
        })
      } else {
        clearAutosave()
      }
    } catch {
      // Keep the last good snapshots on unexpected failures.
    } finally {
      writingRef.current = false
    }
  }, [activeDocId])

  const scheduleAutosave = React.useCallback(() => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => void runAutosave(), { timeout: 3000 })
    } else {
      window.setTimeout(() => void runAutosave(), 0)
    }
  }, [runAutosave])

  React.useEffect(() => {
    const refresh = () => setPrefs(autosavePreferences())
    refresh()
    const removePreferences = addPhotoshopEventListener("ps-preferences-changed", refresh)
    window.addEventListener("storage", refresh)
    return () => {
      removePreferences()
      window.removeEventListener("storage", refresh)
    }
  }, [])

  React.useEffect(() => {
    if (prefs === null) return
    if (!prefs.enabled) {
      clearAutosave()
      setPending([])
      return
    }
    // Try IndexedDB first (larger capacity), then fall back to localStorage
    let cancelled = false
    readAutosavesAsync().then((entries) => {
      if (cancelled) return
      const found = collectRecoveryCandidates(entries)
      if (found.length) { setPending(found); return }
      // Fallback to sync localStorage reader
      const fallback = collectRecoveryCandidates(readAutosaves())
      if (fallback.length) setPending(fallback)
    }).catch(() => {
      if (cancelled) return
      const fallback = collectRecoveryCandidates(readAutosaves())
      if (fallback.length) setPending(fallback)
    })
    return () => { cancelled = true }
  }, [prefs])

  React.useEffect(() => {
    if (prefs === null) return
    if (!prefs.enabled) {
      clearAutosave()
      return
    }
    const interval = window.setInterval(() => {
      if (!documentsRef.current.length) return
      scheduleAutosave()
    }, prefs.intervalMs)
    return () => window.clearInterval(interval)
  }, [prefs, scheduleAutosave])

  React.useEffect(() => {
    if (!prefs?.enabled) return
    if (!documents.length) return
    scheduleAutosave()
  }, [prefs?.enabled, documents, documentStatuses, documentHistoryVersions, scheduleAutosave])

  const restoreEntry = async (entry: AutosaveDocument) => {
    const { deserializeProject } = await import("./document-project-io")
    const doc = await deserializeProject(entry.serialized)
    doc.name = `${doc.name} (Recovered)`
    createDocument(doc, "Recover Autosave")
    // Only this document's snapshot is consumed; the rest stay recoverable.
    removeAutosave(entry.documentId)
  }

  const restore = async () => {
    if (!candidate || busy) return
    setBusy(true)
    try {
      await restoreEntry(candidate)
      setPending((queue) => queue.filter((entry) => entry.documentId !== candidate.documentId))
      toast.success("Recovered autosaved document")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not recover autosave")
    } finally {
      setBusy(false)
    }
  }

  const restoreAll = async () => {
    if (!pending.length || busy) return
    setBusy(true)
    const queue = pending
    const failedIds = new Set<string>()
    let recovered = 0
    for (const entry of queue) {
      try {
        await restoreEntry(entry)
        recovered += 1
      } catch {
        failedIds.add(entry.documentId)
      }
    }
    setPending((current) => current.filter((entry) => failedIds.has(entry.documentId)))
    if (recovered) {
      toast.success(`Recovered ${recovered} autosaved document${recovered === 1 ? "" : "s"}`)
    }
    if (failedIds.size) {
      toast.error(`Could not recover ${failedIds.size} autosaved document${failedIds.size === 1 ? "" : "s"}`)
    }
    setBusy(false)
  }

  const dismiss = () => {
    if (busy) return
    if (!candidate) return
    removeAutosave(candidate.documentId)
    setPending((queue) => queue.filter((entry) => entry.documentId !== candidate.documentId))
  }

  const dismissAll = () => {
    if (busy) return
    for (const entry of pending) removeAutosave(entry.documentId)
    setPending([])
  }

  const total = pending.length

  return (
    // Closing the dialog keeps the snapshots on disk so they can be offered again.
    <Dialog open={!!candidate} onOpenChange={(open) => !open && setPending([])}>
      <DialogContent className="max-w-[420px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Recover Autosave?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-[var(--ps-text-dim)]">
          <p>
            {total > 1
              ? `${total} autosaved documents are available.`
              : "An autosaved document is available."}
          </p>
          <p className="text-[12px]">
            {total > 1 ? <span className="text-[var(--ps-text)]">1 of {total}: </span> : null}
            {candidate?.name} · {candidate ? new Date(candidate.updatedAt).toLocaleString() : ""}
          </p>
          {total > 1 ? (
            <ul className="max-h-24 overflow-y-auto text-[11px]">
              {pending.slice(1).map((entry) => (
                <li key={entry.documentId} className="truncate">
                  {entry.name} · {new Date(entry.updatedAt).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px]">
            Recovery snapshots are stored in this browser (IndexedDB, falling back to
            localStorage) per open document, not in the original file.
          </p>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {total > 1 ? (
            <Button variant="ghost" onClick={dismissAll} disabled={busy}>Discard All</Button>
          ) : null}
          <Button variant="outline" onClick={dismiss} disabled={busy}>Discard</Button>
          {total > 1 ? (
            <Button variant="secondary" onClick={restoreAll} disabled={busy}>Recover All</Button>
          ) : null}
          <Button onClick={restore} disabled={busy}>Recover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
