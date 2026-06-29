"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  MenubarContent as DropdownMenuContent,
  MenubarItem as DropdownMenuItem,
  MenubarMenu as DropdownMenu,
  MenubarSeparator as DropdownMenuSeparator,
  MenubarShortcut as DropdownMenuShortcut,
  MenubarSub as DropdownMenuSub,
  MenubarSubContent as DropdownMenuSubContent,
  MenubarSubTrigger as DropdownMenuSubTrigger,
  MenubarTrigger as DropdownMenuTrigger,
} from "@/components/ui/menubar"
import { dispatchPhotoshopEvent } from "../events"
import { makeCanvas, type Action } from "../editor-context"
import type { ChangedLayerIds } from "../editor-history-geometry"
import type { Layer, PsDocument } from "../types"

export type SelectMenuProps = {
  menuClass: string
  activeDoc: PsDocument | null | undefined
  activeLayer: Layer | null | undefined
  lastSelection: PsDocument["selection"] | null
  dispatch: React.Dispatch<Action>
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  loadImageCommands: () => Promise<{
    selectSubjectMask: (canvas: HTMLCanvasElement, tolerance?: number) => HTMLCanvasElement
    selectSkyMask: (canvas: HTMLCanvasElement) => HTMLCanvasElement
    focusAreaMask: (canvas: HTMLCanvasElement) => HTMLCanvasElement
    selectionFromMask: (mask: HTMLCanvasElement, shape: "freehand") => PsDocument["selection"]
  }>
  openSelectionOperation: (operation: "expand" | "contract" | "grow" | "similar" | "feather" | "border" | "smooth") => void
  setColorRangeOpen: (open: boolean) => void
  setRefineEdgeOpen: (open: boolean) => void
  setSelectMaskOpen: (open: boolean) => void
  setSaveSelectionOpen: (open: boolean) => void
  setLoadSelectionOpen: (open: boolean) => void
}

export function SelectMenu({
  menuClass,
  activeDoc,
  activeLayer,
  lastSelection,
  dispatch,
  commit,
  loadImageCommands,
  openSelectionOperation,
  setColorRangeOpen,
  setRefineEdgeOpen,
  setSelectMaskOpen,
  setSaveSelectionOpen,
  setLoadSelectionOpen,
}: SelectMenuProps) {
  return (
    <>        {/* Select */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Select</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                dispatch({
                  type: "set-selection",
                  selection: {
                    bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height },
                    shape: "rect",
                  },
                })
              }}
            >
              All <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
              }
            >
              Deselect <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                if (lastSelection) {
                  dispatch({ type: "set-selection", selection: lastSelection })
                }
              }}
            >
              Reselect <DropdownMenuShortcut>⌘⇧D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) {
                  toast.info("Open a document before saving a selection.")
                  return
                }
                if (!activeDoc.selection.bounds) {
                  toast.info("Create a selection before saving it.")
                  return
                }
                const sel = activeDoc.selection
                const inverseMask = makeCanvas(activeDoc.width, activeDoc.height)
                const ictx = inverseMask.getContext("2d")!
                ictx.fillStyle = "#fff"
                ictx.fillRect(0, 0, activeDoc.width, activeDoc.height)
                ictx.globalCompositeOperation = "destination-out"
                if (sel.mask) {
                  ictx.drawImage(sel.mask, 0, 0)
                } else if (sel.bounds) {
                  if (sel.shape === "ellipse") {
                    ictx.beginPath()
                    ictx.ellipse(
                      sel.bounds.x + sel.bounds.w / 2,
                      sel.bounds.y + sel.bounds.h / 2,
                      sel.bounds.w / 2,
                      sel.bounds.h / 2,
                      0,
                      0,
                      Math.PI * 2,
                    )
                    ictx.fill()
                  } else {
                    ictx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
                  }
                }
                dispatch({
                  type: "set-selection",
                  selection: {
                    bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height },
                    shape: "freehand",
                    mask: inverseMask,
                  },
                })
              }}
            >
              Inverse <DropdownMenuShortcut>⌘⇧I</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                const ids = activeDoc.layers.map((l) => l.id)
                dispatch({ type: "set-selected-layers", ids, activeId: activeDoc.activeLayerId })
              }}
            >
              All Layers <DropdownMenuShortcut>⌘⌥A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorRangeOpen(true)} disabled={!activeDoc}>
              Color Range…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRefineEdgeOpen(true)}>
              Refine Edge…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSelectMaskOpen(true)} disabled={!activeDoc}>
              Select and Mask… <DropdownMenuShortcut>⌘⌥R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeDoc || !activeLayer) return
                if (typeof activeLayer.canvas.getContext !== "function") return
                const { selectSubjectMask, selectionFromMask } = await loadImageCommands()
                const mask = selectSubjectMask(activeLayer.canvas, 48)
                dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
                commit("Select Subject", [])
              }}
              disabled={!activeLayer}
            >
              Select Subject
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeDoc || !activeLayer) return
                if (typeof activeLayer.canvas.getContext !== "function") return
                // "Sky" — heuristic: pick top 30% pixels with high blue and low red
                const { selectSkyMask, selectionFromMask } = await loadImageCommands()
                const mask = selectSkyMask(activeLayer.canvas)
                dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
                commit("Select Sky", [])
              }}
              disabled={!activeLayer}
            >
              Select Sky
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeDoc || !activeLayer || !activeLayer.canvas) return
                if (typeof activeLayer.canvas.getContext !== "function") return
                const { focusAreaMask, selectionFromMask } = await loadImageCommands()
                const mask = focusAreaMask(activeLayer.canvas)
                dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
                commit("Focus Area", [])
              }}
              disabled={!activeLayer}
            >
              Focus Area
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => openSelectionOperation("expand")}
            >
              Expand...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => openSelectionOperation("contract")}
            >
              Contract...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => openSelectionOperation("grow")}
            >
              Grow...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => openSelectionOperation("similar")}
            >
              Similar…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => dispatchPhotoshopEvent("ps-transform-selection-begin")}
            >
              Transform Selection...
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Modify</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("feather")}
                >
                  Feather… <DropdownMenuShortcut>⇧F6</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("border")}
                >
                  Border…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("smooth")}
                >
                  Smooth…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc?.selection.bounds) {
                  toast.info("Create a selection before saving it.")
                  return
                }
                setSaveSelectionOpen(true)
              }}
            >
              Save Selection…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger onClick={() => setLoadSelectionOpen(true)}>
                Load Selection...
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(activeDoc?.channels ?? []).map((ch) => (
                  <DropdownMenuSub key={ch.id}>
                    <DropdownMenuSubTrigger>{ch.name}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {([
                        ["replace", "Replace"],
                        ["add", "Add"],
                        ["subtract", "Subtract"],
                        ["intersect", "Intersect"],
                      ] as const).map(([mode, label]) => (
                        <DropdownMenuItem
                          key={mode}
                          onSelect={() => {
                            dispatch({ type: "load-selection", channelId: ch.id, mode })
                            commit("Load Selection", [])
                          }}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
                {!(activeDoc?.channels?.length) && (
                  <DropdownMenuItem disabled>No saved channels</DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
    </>
  )
}
