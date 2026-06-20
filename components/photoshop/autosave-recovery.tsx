"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { planAutosaveDocuments, planIncrementalAutosave, type IncrementalAutosaveManifest } from "./autosave-planner"
import { deserializeProject, serializeProject } from "./document-io"
import { useEditor } from "./editor-context"
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

export function AutosaveRecovery() {
  const { documents, createDocument, documentStatuses, documentHistoryVersions } = useEditor()
  const [candidate, setCandidate] = React.useState<AutosaveDocument | null>(null)
  const [prefs, setPrefs] = React.useState<{ enabled: boolean; intervalMs: number } | null>(null)

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

  const runAutosave = React.useCallback(() => {
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
        void writeAutosaves(payload).then((persisted) => {
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
  }, [])

  const scheduleAutosave = React.useCallback(() => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(runAutosave, { timeout: 3000 })
    } else {
      window.setTimeout(runAutosave, 0)
    }
  }, [runAutosave])

  React.useEffect(() => {
    const refresh = () => setPrefs(autosavePreferences())
    refresh()
    window.addEventListener("ps-preferences-changed", refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener("ps-preferences-changed", refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  React.useEffect(() => {
    if (prefs === null) return
    if (!prefs.enabled) {
      clearAutosave()
      setCandidate(null)
      return
    }
    // Try IndexedDB first (larger capacity), then fall back to localStorage
    let cancelled = false
    readAutosavesAsync().then((entries) => {
      if (cancelled) return
      const saved = entries.find((entry) => Date.now() - entry.updatedAt >= 10_000)
      if (saved) { setCandidate(saved); return }
      // Fallback to sync localStorage reader
      const lsEntry = readAutosaves().find((entry) => Date.now() - entry.updatedAt >= 10_000)
      if (lsEntry) setCandidate(lsEntry)
    }).catch(() => {
      if (cancelled) return
      const saved = readAutosaves().find((entry) => Date.now() - entry.updatedAt >= 10_000)
      if (saved) setCandidate(saved)
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

  const restore = async () => {
    if (!candidate) return
    try {
      const doc = await deserializeProject(candidate.serialized)
      doc.name = `${doc.name} (Recovered)`
      createDocument(doc, "Recover Autosave")
      removeAutosave(candidate.documentId)
      setCandidate(null)
      toast.success("Recovered autosaved document")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not recover autosave")
    }
  }

  const dismiss = () => {
    if (candidate) removeAutosave(candidate.documentId)
    setCandidate(null)
  }

  return (
    <Dialog open={!!candidate} onOpenChange={(open) => !open && setCandidate(null)}>
      <DialogContent className="max-w-[420px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Recover Autosave?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-[var(--ps-text-dim)]">
          <p>An autosaved document is available.</p>
          <p className="text-[12px]">
            {candidate?.name} · {candidate ? new Date(candidate.updatedAt).toLocaleString() : ""}
          </p>
          <p className="text-[11px]">
            Recovery is stored in browser localStorage per open document, not in the original file.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>Discard</Button>
          <Button onClick={restore}>Recover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
