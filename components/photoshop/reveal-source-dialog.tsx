"use client"

import * as React from "react"
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
import { useEditor } from "./editor-context"
import {
  bestEffortPathString,
  revealSourceInBrowser,
  sourceInfoForDocument,
  type RevealSourceResult,
} from "./source-location"

function formatTimestamp(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return ""
  return new Date(value).toLocaleString()
}

function describeStatus(status: RevealSourceResult["status"]): string {
  switch (status) {
    case "folder-picker-verified":
      return "Verified"
    case "folder-picker-opened":
      return "Folder opened (parent not verified)"
    case "file-accessible":
      return "File handle accessible"
    case "permission-denied":
      return "Permission denied"
    case "unsupported":
      return "Browser does not support reveal"
    case "cancelled":
      return "Cancelled"
    case "missing-handle":
      return "No browser file handle"
    default:
      return "Unknown"
  }
}

export interface RevealSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, show info for this document; otherwise use the active doc. */
  docId?: string | null
}

/**
 * Item 11 — Reveal Source dialog.
 *
 * Browsers cannot open arbitrary OS file manager paths, but the File System
 * Access API exposes enough handle metadata to give the user a clear picture
 * of where a document came from on disk, and to attempt a best-effort
 * "Open containing folder" workflow when supported.
 *
 * This dialog shows the source file handle's `name`, `kind`, last verified
 * time, any parent directory handle that was granted during this session,
 * and offers buttons to copy the best-effort path string and to open the
 * containing folder (via `showDirectoryPicker` when available).
 *
 * Documents that came from a download or paste (no handle) get a clear
 * "No source file" notice instead of a broken reveal button.
 */
export function RevealSourceDialog({ open, onOpenChange, docId }: RevealSourceDialogProps) {
  const { activeDoc, documents, documentStatuses } = useEditor()

  const targetDoc = React.useMemo(() => {
    if (docId) return documents.find((d) => d.id === docId) ?? null
    return activeDoc ?? null
  }, [docId, documents, activeDoc])

  const sourceInfo = React.useMemo(() => {
    if (!targetDoc) return null
    return sourceInfoForDocument(targetDoc, documentStatuses[targetDoc.id])
  }, [targetDoc, documentStatuses])

  // Track the most recent verification result for this dialog session.
  // Each new dialog open resets state so a stale "verified at" timestamp
  // from a previous document does not leak across documents.
  const [lastResult, setLastResult] = React.useState<RevealSourceResult | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setLastResult(null)
      setBusy(false)
    }
  }, [open, targetDoc?.id])

  const handle = sourceInfo?.fileHandle
  const fileName = sourceInfo?.primaryName ?? ""
  const directoryName = lastResult?.directoryName
  const pathString = bestEffortPathString(fileName, directoryName)

  const copyPath = async () => {
    if (!pathString) {
      toast.info("No path to copy.")
      return
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pathString)
        toast.success(`Copied: ${pathString}`)
        return
      }
    } catch {}
    // Fallback for environments without async clipboard API.
    try {
      const textarea = document.createElement("textarea")
      textarea.value = pathString
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(textarea)
      if (ok) {
        toast.success(`Copied: ${pathString}`)
      } else {
        toast.error("Copy failed. Your browser blocked clipboard access.")
      }
    } catch {
      toast.error("Copy failed. Your browser blocked clipboard access.")
    }
  }

  const openContainingFolder = async () => {
    if (!handle) {
      toast.info(sourceInfo?.unavailableReason ?? "No source file handle is attached.")
      return
    }
    setBusy(true)
    try {
      const result = await revealSourceInBrowser(handle)
      setLastResult(result)
      if (result.status === "cancelled") return
      if (result.status === "folder-picker-verified") {
        toast.success(result.message)
        return
      }
      if (result.status === "folder-picker-opened") {
        toast.info(result.message)
        return
      }
      if (result.status === "file-accessible") {
        toast.info(
          `Your browser does not support reveal; the parent directory name is ${
            result.directoryName ?? "not exposed"
          }. ${result.message}`,
        )
        return
      }
      if (result.status === "unsupported") {
        toast.info(
          `Your browser does not support reveal; the parent directory name is ${
            result.directoryName ?? "not exposed"
          }.`,
        )
        return
      }
      toast.error(result.message)
    } finally {
      setBusy(false)
    }
  }

  const handleKindLabel = handle?.kind ?? (handle ? "file" : "")
  const lastVerifiedAt = lastResult?.verifiedAt
  const directoryLabel = directoryName || "Not granted in this session"
  const hasHandle = !!handle

  const rows: [string, string][] = sourceInfo
    ? [
        ...sourceInfo.rows,
        ["Handle Kind", handleKindLabel || "—"],
        ["Parent Directory", directoryLabel],
        ["Last Verified", formatTimestamp(lastVerifiedAt) || "Never (this session)"],
        ["Last Reveal Status", lastResult ? describeStatus(lastResult.status) : "Not attempted"],
        ["Best-Effort Path", pathString || "—"],
      ]
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Reveal Source</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Browsers cannot open the OS file manager directly. This dialog shows
            what the File System Access API exposes about the document&rsquo;s on-disk origin
            and offers a best-effort reveal workflow.
          </DialogDescription>
        </DialogHeader>

        {!targetDoc ? (
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3 text-[11px] text-[var(--ps-text-dim)]">
            Open a document before revealing its source.
          </div>
        ) : !hasHandle ? (
          <div className="space-y-2">
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3 text-[11px]">
              <div className="font-semibold mb-1">No source file</div>
              <p className="text-[var(--ps-text-dim)]">
                This document has no on-disk origin. It came from a browser
                download, a paste, or was created in this session. Save the
                document through the browser&rsquo;s file picker to attach a
                reusable handle.
              </p>
            </div>
            {sourceInfo ? (
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px]">
                <div className="text-[10px] font-semibold uppercase text-[var(--ps-text-dim)] mb-1">
                  Source metadata
                </div>
                <div className="space-y-0.5">
                  {sourceInfo.rows.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid grid-cols-[140px_1fr] gap-2 border-t border-[var(--ps-divider)] py-1"
                    >
                      <span className="text-[var(--ps-text-dim)]">{label}</span>
                      <span className="min-w-0 truncate font-medium tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px]">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <div className="font-semibold truncate" title={fileName}>
                  {fileName}
                </div>
                <div className="text-[10px] text-[var(--ps-text-dim)]">
                  {sourceInfo?.storageLabel}
                </div>
              </div>
              <div className="space-y-0.5">
                {rows.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[140px_1fr] gap-2 border-t border-[var(--ps-divider)] py-1"
                  >
                    <span className="text-[var(--ps-text-dim)]">{label}</span>
                    <span className="min-w-0 truncate font-medium tabular-nums" title={value}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {lastResult && lastResult.status !== "folder-picker-verified" ? (
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] text-[var(--ps-text-dim)]">
                {lastResult.message}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyPath()}
            disabled={!pathString}
          >
            Copy file path
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openContainingFolder()}
            disabled={!hasHandle || busy}
          >
            Open containing folder
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
