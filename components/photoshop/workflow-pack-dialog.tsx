"use client"

import * as React from "react"
import { CheckCircle2, ClipboardList, Layers, Play, WandSparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEditor } from "./editor-context"
import { selectionToMaskCanvas } from "./tool-helpers"
import {
  WORKFLOW_PACKS,
  findWorkflowPack,
  type WorkflowPack,
  type WorkflowPackAction,
  type WorkflowPackId,
  type WorkflowPackStep,
} from "./workflow-presets"

export function WorkflowPackDialog({
  workflowId,
  onOpenChange,
}: {
  workflowId: WorkflowPackId | null
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, activeLayer, dispatch, commit } = useEditor()
  const open = workflowId !== null
  const activePack = findWorkflowPack(workflowId) ?? WORKFLOW_PACKS[0]
  const [selectedId, setSelectedId] = React.useState<WorkflowPackId>(activePack.id)
  const selectedPack = findWorkflowPack(selectedId) ?? activePack

  React.useEffect(() => {
    if (workflowId) setSelectedId(workflowId)
  }, [workflowId])

  const runAction = React.useCallback((action: WorkflowPackAction) => {
    if (action.kind === "tool") {
      dispatch({ type: "set-tool", tool: action.tool })
      toast.info(`Tool set to ${action.tool.replace(/-/g, " ")}`)
      onOpenChange(false)
      return
    }
    if (action.kind === "panel") {
      window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: action.panel }))
      onOpenChange(false)
      return
    }
    if (action.kind === "event") {
      window.dispatchEvent(action.detail === undefined
        ? new CustomEvent(action.event)
        : new CustomEvent(action.event, { detail: action.detail }))
      onOpenChange(false)
      return
    }
    if (action.kind === "duplicate-active-layer") {
      if (!activeLayer) {
        toast.info("Select a layer first")
        return
      }
      dispatch({ type: "duplicate-layer", id: activeLayer.id })
      window.setTimeout(() => commit("Duplicate Layer for Workflow", [activeLayer.id]), 0)
      onOpenChange(false)
      return
    }
    if (action.kind === "apply-selection-mask") {
      if (!activeDoc || !activeLayer || !activeDoc.selection.bounds) {
        toast.info("Create a selection on an active layer first")
        return
      }
      const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
      if (!mask) {
        toast.info("Selection could not be converted to a mask")
        return
      }
      dispatch({ type: "set-layer-mask", id: activeLayer.id, mask })
      window.setTimeout(() => commit("Create Mask from Workflow Selection", [activeLayer.id]), 0)
      toast.success("Layer mask created from selection")
      onOpenChange(false)
    }
  }, [activeDoc, activeLayer, commit, dispatch, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(82vh,720px)] w-[min(94vw,920px)] max-w-[min(94vw,920px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)] sm:max-w-[min(94vw,920px)]">
        <DialogHeader className="border-b border-[var(--ps-divider)] px-4 py-3">
          <div className="flex items-center gap-2">
            <WandSparkles className="h-4 w-4 text-[var(--ps-accent,#3b82f6)]" />
            <DialogTitle className="text-sm">Workflow Packs</DialogTitle>
          </div>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Guided task flows for the phase 2 roadmap workflows.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-2">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              <ClipboardList className="h-3 w-3" /> Packs
            </div>
            <div className="space-y-1">
              {WORKFLOW_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setSelectedId(pack.id)}
                  className={`w-full rounded-sm border px-2 py-2 text-left ${
                    selectedPack.id === pack.id
                      ? "border-[var(--ps-accent,#3b82f6)] bg-[var(--ps-panel-2)]"
                      : "border-transparent hover:bg-[var(--ps-tool-hover)]"
                  }`}
                >
                  <span className="block text-[11px] text-[var(--ps-text)]">{pack.shortTitle}</span>
                  <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">{pack.category}</span>
                </button>
              ))}
            </div>
          </aside>
          <WorkflowPackDetail
            pack={selectedPack}
            hasDocument={!!activeDoc}
            hasLayer={!!activeLayer}
            hasSelection={!!activeDoc?.selection.bounds}
            onRun={runAction}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WorkflowPackDetail({
  pack,
  hasDocument,
  hasLayer,
  hasSelection,
  onRun,
}: {
  pack: WorkflowPack
  hasDocument: boolean
  hasLayer: boolean
  hasSelection: boolean
  onRun: (action: WorkflowPackAction) => void
}) {
  return (
    <div className="min-h-0 overflow-y-auto p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <section className="min-w-0">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{pack.category} workflow</div>
          <h2 className="text-[18px] font-semibold leading-tight text-[var(--ps-text)]">{pack.title}</h2>
          <p className="mt-2 max-w-[680px] text-[12px] leading-5 text-[var(--ps-text-dim)]">{pack.summary}</p>
        </section>
        <section className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
            <Layers className="h-3 w-3" /> Current state
          </div>
          <StateRow label="Document" active={hasDocument} />
          <StateRow label="Layer" active={hasLayer} />
          <StateRow label="Selection" active={hasSelection} />
          <div className="mt-3 text-[10px] leading-4 text-[var(--ps-text-dim)]">{pack.expectedOutput}</div>
        </section>
      </div>
      <section className="mt-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Steps</div>
        {pack.steps.map((step, index) => {
          const disabledReason = disabledReasonForStep(step, { hasDocument, hasLayer, hasSelection })
          return (
            <div key={step.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[10px] tabular-nums text-[var(--ps-text-dim)]">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[12px] font-medium text-[var(--ps-text)]">{step.title}</h3>
                  {!disabledReason ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : null}
                </div>
                <p className="mt-1 text-[11px] leading-4 text-[var(--ps-text-dim)]">{step.detail}</p>
                {disabledReason ? <div className="mt-1 text-[10px] text-amber-200">{disabledReason}</div> : null}
              </div>
              <Button
                size="sm"
                variant={disabledReason ? "outline" : "secondary"}
                disabled={!!disabledReason}
                onClick={() => onRun(step.action)}
                className="h-7 gap-1 px-2 text-[10px]"
              >
                <Play className="h-3 w-3" /> Run
              </Button>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function StateRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--ps-divider)]/60 py-1 text-[11px] last:border-b-0">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <span className={active ? "text-emerald-300" : "text-amber-200"}>{active ? "Ready" : "Needed"}</span>
    </div>
  )
}

function disabledReasonForStep(
  step: WorkflowPackStep,
  state: { hasDocument: boolean; hasLayer: boolean; hasSelection: boolean },
) {
  if (step.requiresDocument && !state.hasDocument) return "Open or create a document first."
  if (step.requiresLayer && !state.hasLayer) return "Select a layer first."
  if (step.requiresSelection && !state.hasSelection) return "Create a selection first."
  return null
}
