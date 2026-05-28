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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { decodePdfPages } from "./advanced-subsystems"
import { makeDocument, useEditor } from "./editor-context"

type ImportMode = "page-per-document" | "pages-as-layers"

interface PdfPagePreview {
  pageNumber: number
  canvas: HTMLCanvasElement
  selected: boolean
}

export function PdfImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { createDocument } = useEditor()
  const [file, setFile] = React.useState<File | null>(null)
  const [pages, setPages] = React.useState<PdfPagePreview[]>([])
  const [mode, setMode] = React.useState<ImportMode>("page-per-document")
  const [maxWidth, setMaxWidth] = React.useState(2048)
  const [busy, setBusy] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [pageRange, setPageRange] = React.useState("")

  React.useEffect(() => {
    if (!open) {
      setFile(null)
      setPages([])
      setLoadError(null)
    }
  }, [open])

  const loadPages = async (f: File) => {
    setBusy(true)
    setLoadError(null)
    try {
      const decoded = await decodePdfPages(f, { maxWidth: 256, maxPages: 100 })
      setPages(
        decoded.map((p) => ({
          pageNumber: p.pageNumber,
          canvas: p.canvas,
          selected: true,
        })),
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to read PDF")
      setPages([])
    } finally {
      setBusy(false)
    }
  }

  const togglePage = (idx: number) => {
    setPages((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)),
    )
  }

  const selectAll = (selected: boolean) => {
    setPages((prev) => prev.map((p) => ({ ...p, selected })))
  }

  const parsePageRange = (range: string, maxPage: number): number[] => {
    const result: number[] = []
    const parts = range.split(",")
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      if (trimmed.includes("-")) {
        const [startStr, endStr] = trimmed.split("-")
        const start = Math.max(1, Math.min(maxPage, parseInt(startStr.trim(), 10) || 1))
        const end = Math.max(1, Math.min(maxPage, parseInt(endStr.trim(), 10) || maxPage))
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
          if (!result.includes(i)) result.push(i)
        }
      } else {
        const num = parseInt(trimmed, 10)
        if (num >= 1 && num <= maxPage && !result.includes(num)) result.push(num)
      }
    }
    return result.sort((a, b) => a - b)
  }

  const applyPageRange = () => {
    if (!pageRange.trim() || !pages.length) return
    const selected = parsePageRange(pageRange, pages.length)
    if (!selected.length) {
      toast.error("No valid pages in range")
      return
    }
    const selectedSet = new Set(selected)
    setPages((prev) =>
      prev.map((p) => ({ ...p, selected: selectedSet.has(p.pageNumber) })),
    )
  }

  const importSelected = async () => {
    if (!file) return
    const selectedPages = pages.filter((p) => p.selected)
    if (!selectedPages.length) {
      toast.error("Select at least one page")
      return
    }
    setBusy(true)
    try {
      // Re-render at full resolution
      const fullPages = await decodePdfPages(file, {
        maxWidth,
        maxPages: pages.length,
      })
      const wantedPageNumbers = new Set(selectedPages.map((p) => p.pageNumber))
      const fullSelected = fullPages.filter((p) =>
        wantedPageNumbers.has(p.pageNumber),
      )
      if (mode === "page-per-document") {
        for (const page of fullSelected) {
          const doc = makeDocument(
            `${stripExt(file.name)} (page ${page.pageNumber})`,
            page.canvas.width,
            page.canvas.height,
            "transparent",
          )
          const layer = doc.layers.find((l) => l.id === doc.activeLayerId)
          if (layer) {
            const ctx = layer.canvas.getContext("2d")
            if (ctx) ctx.drawImage(page.canvas, 0, 0)
          }
          createDocument(doc, "PDF Import")
        }
      } else {
        // pages-as-layers: single document, each page a layer
        const maxW = Math.max(...fullSelected.map((p) => p.canvas.width))
        const maxH = Math.max(...fullSelected.map((p) => p.canvas.height))
        const doc = makeDocument(stripExt(file.name), maxW, maxH, "transparent")
        if (doc.layers.length > 0) {
          // Replace default layer with first page
          const first = fullSelected[0]
          const layer = doc.layers[0]
          layer.name = `Page ${first.pageNumber}`
          const ctx = layer.canvas.getContext("2d")
          if (ctx) ctx.drawImage(first.canvas, 0, 0)
        }
        createDocument(doc, "PDF Import")
      }
      toast.success(
        `Imported ${fullSelected.length} page${fullSelected.length === 1 ? "" : "s"}`,
      )
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF import failed")
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = pages.filter((p) => p.selected).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Import PDF</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Select pages from a PDF file to open as documents or layers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid gap-1">
            <Label className="text-[11px] text-[var(--ps-text-dim)]">PDF file</Label>
            <Input
              type="file"
              accept="application/pdf,.pdf"
              onChange={async (e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                if (f) await loadPages(f)
              }}
              className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
            />
          </div>
          {loadError ? (
            <div className="rounded border border-red-400/40 bg-red-400/10 px-3 py-2 text-[11px] text-red-300">
              {loadError}
            </div>
          ) : null}
          {pages.length > 0 ? (
            <>
              <div className="flex items-center gap-2 text-[11px]">
                <span>
                  {selectedCount} of {pages.length} pages selected
                </span>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => selectAll(true)}
                  className="h-6 text-[11px]"
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => selectAll(false)}
                  className="h-6 text-[11px]"
                >
                  Select none
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder="e.g. 1-5, 8, 10-12"
                  className="h-7 flex-1 bg-[var(--ps-panel-2)] text-[11px]"
                  onKeyDown={(e) => { if (e.key === "Enter") applyPageRange() }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyPageRange}
                  disabled={!pageRange.trim()}
                  className="h-7 text-[11px] shrink-0"
                >
                  Apply Range
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2 max-h-72 overflow-auto border border-[var(--ps-divider)] rounded p-2 bg-[var(--ps-panel-2)]">
                {pages.map((p, i) => (
                  <label
                    key={p.pageNumber}
                    className={`flex flex-col items-center gap-1 rounded cursor-pointer border ${
                      p.selected
                        ? "border-[var(--ps-accent)] bg-[var(--ps-accent)]/10"
                        : "border-[var(--ps-divider)]"
                    } p-1`}
                  >
                    <PdfPageThumb canvas={p.canvas} />
                    <div className="flex items-center gap-1 text-[10px]">
                      <Checkbox
                        checked={p.selected}
                        onCheckedChange={() => togglePage(i)}
                      />
                      <span>Page {p.pageNumber}</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label className="text-[11px] text-[var(--ps-text-dim)]">
                    Max page width (px)
                  </Label>
                  <Input
                    type="number"
                    min={256}
                    max={8192}
                    value={maxWidth}
                    onChange={(e) =>
                      setMaxWidth(
                        Math.max(256, Math.min(8192, Number(e.target.value) || 2048)),
                      )
                    }
                    className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-[var(--ps-text-dim)]">Mode</Label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as ImportMode)}
                    className="h-8 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] text-[11px] px-2"
                  >
                    <option value="page-per-document">Each page as a document</option>
                    <option value="pages-as-layers">All pages in one document</option>
                  </select>
                </div>
              </div>
            </>
          ) : busy && file ? (
            <div className="text-[11px] text-[var(--ps-text-dim)]">Reading PDF pages...</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-[11px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={importSelected}
            disabled={!file || !selectedCount || busy}
            className="text-[11px] bg-[var(--ps-accent)] hover:bg-[var(--ps-accent)]/90"
          >
            {busy ? "Importing..." : `Import ${selectedCount} page${selectedCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PdfPageThumb({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const out = ref.current
    if (!out) return
    const maxDim = 90
    const scale = Math.min(maxDim / canvas.width, maxDim / canvas.height, 1)
    out.width = Math.max(1, Math.round(canvas.width * scale))
    out.height = Math.max(1, Math.round(canvas.height * scale))
    const ctx = out.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0, out.width, out.height)
  }, [canvas])

  return <canvas ref={ref} className="block bg-white" />
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "")
}
