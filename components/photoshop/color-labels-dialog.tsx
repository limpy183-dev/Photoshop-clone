"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEditor } from "./editor-context"
import { COLOR_LABELS } from "./panels/layers-panel"
import type { Layer } from "./types"

export function ColorLabelsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeLayer, dispatch } = useEditor()

  const setColorLabel = (label: NonNullable<Layer["colorLabel"]>) => {
    if (!activeLayer) return
    dispatch({ type: "set-layer-color-label", id: activeLayer.id, label: label === "none" ? "none" : label })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Color Labels</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground mb-2">
            Set color label for selected layer: {activeLayer?.name ?? "None"}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {COLOR_LABELS.map((c) => (
              <button
                key={c.id}
                onClick={() => setColorLabel(c.id)}
                title={c.label}
                className={cn(
                  "w-10 h-10 rounded-full border",
                  activeLayer?.colorLabel === c.id ? "border-[var(--ps-accent)]" : "border-[var(--ps-divider)]",
                )}
                style={{ background: c.id === "none" ? "transparent" : c.bg }}
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function cn(...classes: string[]): string {
  return classes.filter(Boolean).join(" ")
}
