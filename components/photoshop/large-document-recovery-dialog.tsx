"use client"

import * as React from "react"
import { Grid2X2, Search, Shrink, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { LargeDocumentOpenPlan } from "./large-document"

export function LargeDocumentRecoveryDialog({
  open,
  onOpenChange,
  plan,
  busy = false,
  onOpenReduced,
  onOpenTileOnly,
  onInspect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: LargeDocumentOpenPlan | null
  busy?: boolean
  onOpenReduced: () => void
  onOpenTileOnly: () => void
  onInspect: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Large Document Recovery</DialogTitle>
          <DialogDescription>
            Choose a browser-safe way to open this file.
          </DialogDescription>
        </DialogHeader>
        {plan ? (
          <div className="space-y-3 text-[12px]">
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3">
              <div className="font-medium text-[var(--ps-text)]">{plan.fileName}</div>
              <div className="mt-1 text-[var(--ps-text-dim)]">
                {plan.width} x {plan.height}px, limit {plan.browserLimit}
              </div>
            </div>
            {plan.parsedStructure ? (
              <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3">
                <div className="flex items-center gap-2 font-medium text-[var(--ps-text)]">
                  <Wrench className="h-4 w-4" />
                  Parsed PSD structure
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[var(--ps-text-dim)]">
                  <span>{plan.parsedStructure.layerCount ?? 0} layers</span>
                  <span>{plan.parsedStructure.colorMode ?? "Unknown"}</span>
                  <span>{plan.parsedStructure.bitDepth ? `${plan.parsedStructure.bitDepth}-bit` : "Unknown depth"}</span>
                </div>
                {plan.parsedStructure.repairableItems?.length ? (
                  <div className="mt-2 space-y-1 text-[11px] text-amber-100">
                    {plan.parsedStructure.repairableItems.slice(0, 3).map((item) => (
                      <div key={item}>{item}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !plan.reducedScale.editable}
                onClick={onOpenReduced}
                className="justify-start gap-2"
              >
                <Shrink className="h-4 w-4" />
                Open Reduced Scale ({plan.reducedScale.width} x {plan.reducedScale.height})
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !plan.tileOnly?.editable}
                onClick={onOpenTileOnly}
                className="justify-start gap-2"
              >
                <Grid2X2 className="h-4 w-4" />
                Open Tile-Only{plan.tileOnly ? ` (${plan.tileOnly.tileColumns} x ${plan.tileOnly.tileRows})` : ""}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onInspect}
                className="justify-start gap-2"
              >
                <Search className="h-4 w-4" />
                Inspect Only
              </Button>
            </div>
            {plan.warnings.length ? (
              <div className="rounded-sm border border-amber-400/30 bg-amber-400/10 p-2 text-amber-100">
                {plan.warnings.slice(0, 3).join(" ")}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-sm border border-[var(--ps-divider)] p-4 text-[12px] text-[var(--ps-text-dim)]">
            No recovery plan is available for this file.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
