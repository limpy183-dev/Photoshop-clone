"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useEditorSelector } from "./editor-context"
import { fitImageDimensions } from "./automation-commands"

export function FitImageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const [maxWidth, setMaxWidth] = React.useState(1920)
  const [maxHeight, setMaxHeight] = React.useState(1080)
  const [constrain, setConstrain] = React.useState(true)
  const [dontEnlarge, setDontEnlarge] = React.useState(false)

  React.useEffect(() => {
    if (open && activeDoc) {
      setMaxWidth(activeDoc.width)
      setMaxHeight(activeDoc.height)
    }
  }, [open, activeDoc])

  if (!activeDoc) return null

  const preview = fitImageDimensions(activeDoc.width, activeDoc.height, {
    maxWidth,
    maxHeight,
    constrainProportions: constrain,
    dontEnlarge,
  })

  const noChange = preview.width === activeDoc.width && preview.height === activeDoc.height

  const handleApply = () => {
    if (noChange) {
      onOpenChange(false)
      return
    }
    dispatch({ type: "resize-document", width: preview.width, height: preview.height })
    setTimeout(() => commit(`Fit Image ${preview.width}×${preview.height}`, "all"), 0)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Fit Image</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-[11px] text-[var(--ps-text-dim)]">
            Current: {activeDoc.width} × {activeDoc.height} px
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px]">Max Width (px)</span>
              <Input
                type="number"
                min={1}
                max={30000}
                value={maxWidth}
                onChange={(e) => setMaxWidth(Math.max(1, Number(e.target.value) || 1))}
                className="h-7 text-[11px] bg-[var(--ps-panel)] border-[var(--ps-divider)]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px]">Max Height (px)</span>
              <Input
                type="number"
                min={1}
                max={30000}
                value={maxHeight}
                onChange={(e) => setMaxHeight(Math.max(1, Number(e.target.value) || 1))}
                className="h-7 text-[11px] bg-[var(--ps-panel)] border-[var(--ps-divider)]"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={constrain}
                onCheckedChange={(v) => setConstrain(v === true)}
              />
              Constrain Proportions
            </label>
            <label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={dontEnlarge}
                onCheckedChange={(v) => setDontEnlarge(v === true)}
              />
              Don&apos;t Enlarge
            </label>
          </div>
          <div className="rounded border border-[var(--ps-divider)] bg-[var(--ps-panel-2,var(--ps-chrome))] px-3 py-2 text-[11px]">
            <span className="text-[var(--ps-text-dim)]">Result: </span>
            <span className="font-medium">
              {preview.width} × {preview.height} px
            </span>
            <span className="ml-2 text-[var(--ps-text-dim)]">
              ({Math.round(preview.scale * 100)}%)
            </span>
            {noChange && (
              <span className="ml-2 text-[var(--ps-text-dim)]">(no change)</span>
            )}
          </div>
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
            onClick={handleApply}
            className="text-[11px] bg-[var(--ps-accent)] hover:bg-[var(--ps-accent)]/90"
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
