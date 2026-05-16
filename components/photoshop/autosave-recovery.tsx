"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { deserializeProject, serializeProject } from "./document-io"
import { useEditor } from "./editor-context"
import { clearAutosave, readAutosaves, readAutosavesAsync, writeAutosaves, type AutosaveDocument } from "./recent-documents"

const PREFERENCES_KEY = "ps-preferences"

function autoSaveEnabled() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}")
    return parsed?.autoSave === true
  } catch {
    return false
  }
}

export function AutosaveRecovery() {
  const { documents, createDocument } = useEditor()
  const [candidate, setCandidate] = React.useState<AutosaveDocument | null>(null)
  const [enabled, setEnabled] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    const refresh = () => setEnabled(autoSaveEnabled())
    refresh()
    window.addEventListener("ps-preferences-changed", refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener("ps-preferences-changed", refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  React.useEffect(() => {
    if (enabled === null) return
    if (!enabled) {
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
  }, [enabled])

  React.useEffect(() => {
    if (!documents.length) return
    if (enabled === null) return
    if (!enabled) {
      clearAutosave()
      return
    }
    const timer = window.setTimeout(() => {
      try {
        writeAutosaves(documents.map((doc) => ({
          documentId: doc.id,
          name: doc.name,
          serialized: serializeProject(doc),
        })))
      } catch {
        clearAutosave()
      }
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [documents, enabled])

  const restore = async () => {
    if (!candidate) return
    try {
      const doc = await deserializeProject(candidate.serialized)
      doc.name = `${doc.name} (Recovered)`
      createDocument(doc, "Recover Autosave")
      clearAutosave()
      setCandidate(null)
      toast.success("Recovered autosaved document")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not recover autosave")
    }
  }

  const dismiss = () => {
    clearAutosave()
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
