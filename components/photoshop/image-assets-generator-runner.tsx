"use client"

import * as React from "react"
import { toast } from "sonner"
import { downloadBlob } from "./document-io"
import { useEditor } from "./editor-context"
import {
  collectImageAssetGeneratorPlan,
  createImageAssetGeneratorReport,
  createImageAssetGeneratorSignature,
  exportImageAssetsToZip,
  safeImageAssetArchiveName,
  shouldRunImageAssetGenerator,
  writeImageAssetsToDirectory,
  type FileSystemDirectoryHandleLike,
  type ImageAssetGeneratorTrigger,
} from "./image-assets-generator"
import type { PsDocument } from "./types"

type TimerId = number

export function ImageAssetsGeneratorRunner() {
  const { documents, activeDocId, dispatch } = useEditor()
  const documentsRef = React.useRef(documents)
  const activeDocIdRef = React.useRef(activeDocId)
  const directoriesRef = React.useRef<Record<string, FileSystemDirectoryHandleLike>>({})
  const signaturesRef = React.useRef<Record<string, string>>({})
  const timersRef = React.useRef<Record<string, TimerId>>({})
  const runningRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    documentsRef.current = documents
    activeDocIdRef.current = activeDocId
  }, [documents, activeDocId])

  const addReportForActiveDoc = React.useCallback((doc: PsDocument, result: Awaited<ReturnType<typeof exportImageAssetsToZip>>) => {
    if (doc.id !== activeDocIdRef.current) return
    dispatch({ type: "add-document-report", report: createImageAssetGeneratorReport(doc, result) })
  }, [dispatch])

  const runGenerator = React.useCallback(async (doc: PsDocument, trigger: ImageAssetGeneratorTrigger) => {
    const runKey = `${doc.id}:${trigger}`
    if (runningRef.current.has(runKey)) return
    const directory = directoriesRef.current[doc.id]
    if (trigger === "change" && !directory) return

    runningRef.current.add(runKey)
    try {
      const result = directory
        ? await writeImageAssetsToDirectory(doc, directory, { trigger })
        : await exportImageAssetsToZip(doc, { trigger })

      if (!directory && result.entries.length && trigger !== "change") {
        downloadBlob(result.zipBlob, safeImageAssetArchiveName(doc.name))
      }
      addReportForActiveDoc(doc, result)
      if (result.written.length) {
        toast.success(`Generated ${result.written.length} asset${result.written.length === 1 ? "" : "s"}`)
      } else if (result.issues.length && trigger !== "change") {
        toast.error("Image Assets Generator found issues; see the report.")
      }
    } catch (error) {
      if (trigger !== "change") {
        toast.error(error instanceof Error ? error.message : "Image Assets Generator failed")
      }
    } finally {
      runningRef.current.delete(runKey)
    }
  }, [addReportForActiveDoc])

  React.useEffect(() => {
    const onDirectory = (event: Event) => {
      const detail = (event as CustomEvent<{
        docId?: string
        directoryHandle?: FileSystemDirectoryHandleLike
      }>).detail
      if (!detail?.docId || !detail.directoryHandle) return
      directoriesRef.current[detail.docId] = detail.directoryHandle
      const doc = documentsRef.current.find((candidate) => candidate.id === detail.docId)
      if (doc) void runGenerator(doc, "manual")
    }
    window.addEventListener("ps-image-assets-generator-directory", onDirectory as EventListener)
    return () => window.removeEventListener("ps-image-assets-generator-directory", onDirectory as EventListener)
  }, [runGenerator])

  React.useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string; success?: boolean }>).detail
      if (detail?.success === false) return
      const doc = detail?.docId
        ? documentsRef.current.find((candidate) => candidate.id === detail.docId)
        : documentsRef.current.find((candidate) => candidate.id === activeDocIdRef.current)
      if (!doc) return
      const plan = collectImageAssetGeneratorPlan(doc)
      if (!shouldRunImageAssetGenerator({ trigger: "save", plan, settings: doc.metadata?.imageAssetGenerator })) return
      void runGenerator(doc, "save")
    }
    window.addEventListener("ps-document-saved", onSaved as EventListener)
    return () => window.removeEventListener("ps-document-saved", onSaved as EventListener)
  }, [runGenerator])

  React.useEffect(() => {
    for (const doc of documents) {
      const plan = collectImageAssetGeneratorPlan(doc)
      const currentSignature = createImageAssetGeneratorSignature(doc)
      const previousSignature = signaturesRef.current[doc.id]
      signaturesRef.current[doc.id] = currentSignature
      if (previousSignature === undefined) continue
      if (!shouldRunImageAssetGenerator({
        trigger: "change",
        plan,
        settings: doc.metadata?.imageAssetGenerator,
        previousSignature,
        currentSignature,
      })) {
        continue
      }
      if (!directoriesRef.current[doc.id]) continue
      window.clearTimeout(timersRef.current[doc.id])
      timersRef.current[doc.id] = window.setTimeout(() => {
        void runGenerator(doc, "change")
      }, 750)
    }
  }, [documents, runGenerator])

  React.useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of Object.values(timers)) window.clearTimeout(timer)
    }
  }, [])

  return null
}
