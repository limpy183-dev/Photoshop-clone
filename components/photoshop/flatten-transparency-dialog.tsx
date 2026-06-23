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
import { Label } from "@/components/ui/label"
import { useEditor } from "./editor-context"
import { dispatchPhotoshopEvent } from "./events"
import { layerHasPartialAlpha } from "./flatten-transparency"

type Scope = "document" | "selected" | "visible"

const SCOPE_LABEL: Record<Scope, string> = {
  document: "Entire document",
  selected: "Selected layers",
  visible: "Visible only",
}

const SCOPE_DESCRIPTION: Record<Scope, string> = {
  document: "Composite partial alpha on every unlocked layer in the document.",
  selected: "Composite partial alpha on the currently selected layers.",
  visible: "Composite partial alpha on every visible (eye-on) unlocked layer.",
}

/**
 * Flatten Transparency dialog (Item 9).
 *
 * Composites pixels with alpha<255 against a matte color, optionally clearing
 * the resulting alpha to 255. Defaults to the document Background color and
 * "selected layers" scope so it remains useful when invoked without further
 * configuration.
 */
export function FlattenTransparencyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, activeLayer, selectedLayers, background, dispatch, commit, requestRender } =
    useEditor()
  const [scope, setScope] = React.useState<Scope>("selected")
  const [matte, setMatte] = React.useState(background)
  const [clearAlpha, setClearAlpha] = React.useState(true)

  // Reset matte to current Background color whenever the dialog opens so the
  // default reflects the live swatch rather than a stale snapshot.
  React.useEffect(() => {
    if (open) {
      setMatte(background)
      setScope((s) => {
        if (s === "selected" && !selectedLayers.length && !activeLayer) return "document"
        return s
      })
    }
  }, [open, background, selectedLayers.length, activeLayer])

  // Compute candidate layers + alpha-loss warning for the current scope so the
  // dialog can surface preflight feedback without leaving the dialog.
  const { candidateIds, partialAlphaCount } = React.useMemo(() => {
    if (!activeDoc) return { candidateIds: [] as string[], partialAlphaCount: 0 }
    const all = activeDoc.layers
    let list: typeof all
    if (scope === "document") list = all
    else if (scope === "visible") list = all.filter((l) => l.visible)
    else
      list = selectedLayers.length
        ? selectedLayers
        : activeLayer
          ? [activeLayer]
          : []
    const candidates = list.filter(
      (layer) => layer.kind !== "group" && !layer.locked,
    )
    const partial = candidates.filter((layer) => layerHasPartialAlpha(layer)).length
    return { candidateIds: candidates.map((l) => l.id), partialAlphaCount: partial }
  }, [activeDoc, scope, selectedLayers, activeLayer])

  if (!activeDoc) return null

  const submit = () => {
    if (!candidateIds.length) {
      onOpenChange(false)
      return
    }
    dispatch({
      type: "flatten-transparency",
      matte,
      alphaMode: clearAlpha ? "clear" : "preserve",
      layerIds: candidateIds,
      scope,
    })
    // commit() snapshots the new state; dispatch is synchronous so the
    // setTimeout(0) used by the existing submenu path is no longer necessary
    // here, but the editor reducer batches its render side-effects per RAF.
    setTimeout(() => commit("Flatten Transparency", candidateIds), 0)
    requestRender()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Flatten Transparency</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label className="text-[11px]">Apply to</Label>
            <div className="grid grid-cols-3 gap-1">
              {(["document", "selected", "visible"] as Scope[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setScope(opt)}
                  className={
                    "h-8 text-[11px] border border-[var(--ps-divider)] rounded-sm " +
                    (scope === opt
                      ? "bg-[var(--ps-accent)] text-white"
                      : "bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]")
                  }
                >
                  {SCOPE_LABEL[opt]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--ps-text-dim)]">{SCOPE_DESCRIPTION[scope]}</p>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-[11px]">Matte color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={matte}
                onChange={(e) => setMatte(e.target.value)}
                className="h-8 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
                aria-label="Matte color"
              />
              <Input
                value={matte}
                onChange={(e) => setMatte(e.target.value)}
                className="font-mono text-[11px]"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMatte(background)}
                disabled={matte === background}
              >
                Use Background
              </Button>
            </div>
            <p className="text-[11px] text-[var(--ps-text-dim)]">
              Partial-alpha pixels are composited against this color: (r,g,b,a) becomes
              (r*a + matte*(1-a), …).
            </p>
          </div>

          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={clearAlpha}
              onChange={(e) => setClearAlpha(e.target.checked)}
            />
            Clear alpha after flatten (set every flattened pixel to alpha = 255)
          </label>

          <div className="rounded border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] text-[var(--ps-text-dim)]">
            <div>
              {candidateIds.length} eligible layer
              {candidateIds.length === 1 ? "" : "s"} in scope (group and locked layers are
              skipped).
            </div>
            {partialAlphaCount > 0 ? (
              <div className="mt-1 text-[var(--ps-warn,#d39e4d)]">
                {partialAlphaCount} layer{partialAlphaCount === 1 ? " carries" : "s carry"}{" "}
                semi-transparent pixels.{" "}
                {clearAlpha
                  ? "Clearing alpha will discard transparency that other tools or exports may depend on."
                  : "Compositing changes pixel color; downstream alpha-aware tools may interpret the result differently."}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-[var(--ps-text)]"
                  onClick={() => {
                    try {
                      dispatchPhotoshopEvent("ps-open-preflight")
                    } catch {}
                  }}
                >
                  Open Preflight
                </button>{" "}
                for the full warning.
              </div>
            ) : (
              <div className="mt-1">
                No partial-alpha pixels detected on the candidate layers.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!candidateIds.length}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
