"use client"

/**
 * The Type menu — anti-alias mode, orientation, warp, and the type command
 * services that load on demand.
 *
 * Presentation only: `menu-bar.tsx` owns the state and the commands and passes
 * them in, the same contract `file-menu.tsx` and `view-menu.tsx` already use.
 */

import {
  MenubarContent as DropdownMenuContent,
  MenubarItem as DropdownMenuItem,
  MenubarLabel as DropdownMenuLabel,
  MenubarMenu as DropdownMenu,
  MenubarTrigger as DropdownMenuTrigger,
} from "@/components/ui/menubar"
import type { EditorContextValue } from "@/editor/context-contract"
import { toast } from "sonner"
import { makeCanvas } from "@/editor/canvas/utils"
import type { Layer, TextAntiAliasMode } from "@/editor/types"
import { loadTypeCommands } from "@/editor/menus/type-command-service"
import { loadImageCommands } from "@/editor/menus/image-command-service"
import { loadAdvancedCommands } from "@/editor/menus/advanced-command-service"
import type { SetValue } from "@/components/photoshop/menus/menu-shared"
export interface TypeMenuProps {
  menuClass: string
  activeDoc: EditorContextValue["activeDoc"]
  activeLayer: EditorContextValue["activeLayer"]
  commit: EditorContextValue["commit"]
  dispatch: EditorContextValue["dispatch"]
  setPreflightOpen: SetValue<boolean>
  setWarpTextOpen: SetValue<boolean>
}

export function TypeMenu({
  menuClass,
  activeDoc,
  activeLayer,
  commit,
  dispatch,
  setPreflightOpen,
  setWarpTextOpen,
}: TypeMenuProps) {
  return (
    <>
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Type</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const { rasterizeText } = await loadImageCommands()
                const enabled = activeLayer.text.antiAlias === false
                const next = { ...activeLayer.text, antiAlias: enabled, antiAliasMode: enabled ? "smooth" : "none" as TextAntiAliasMode }
                dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
                rasterizeText(activeLayer.canvas, next)
                setTimeout(() => commit(`Anti-Alias ${enabled ? "On" : "Off"}`, [activeLayer.id]), 0)
              }}
            >
              {activeLayer?.text?.antiAlias === false ? "" : "✓ "}Anti-Alias
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const { convertTextToEditablePath } = await loadTypeCommands()
                const path = convertTextToEditablePath(activeLayer.text)
                dispatch({ type: "set-layer-path", id: activeLayer.id, path })
                dispatch({ type: "set-layer-kind", id: activeLayer.id, kind: "shape" })
                setTimeout(() => commit("Convert Text to Path", [activeLayer.id]), 0)
              }}
            >
              Convert to Shape/Path
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeDoc) {
                  toast.info("Open a document before placing text inside a shape.")
                  return
                }
                if (!activeLayer?.text) {
                  toast.info("Select a text layer before placing text inside a shape.")
                  return
                }
                const shapeLayer = activeDoc.layers.find((layer) => layer.id !== activeLayer.id && layer.shape)
                if (!shapeLayer?.shape) {
                  toast.info("Select or create a shape layer to use as the text container.")
                  return
                }
                const { applyTextInsideShape } = await loadTypeCommands()
                const { rasterizeText } = await loadImageCommands()
                const next = applyTextInsideShape(activeLayer.text, shapeLayer.shape, { inset: activeLayer.text.textShapeInset ?? 8 })
                dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
                rasterizeText(activeLayer.canvas, next)
                setTimeout(() => commit("Text Inside Shape", [activeLayer.id]), 0)
              }}
            >
              Text Inside Shape
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setWarpTextOpen(true)}
            >
              Warp Text…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const { matchFontForLayer } = await loadTypeCommands()
                const { rasterizeText } = await loadImageCommands()
                const match = matchFontForLayer(activeLayer.text)
                const next = {
                  ...activeLayer.text,
                  font: match.best.family,
                  variableAxisDefinitions: match.best.variableAxes,
                  variableAxes: match.best.variableAxes?.length ? { wght: activeLayer.text.weight === "bold" ? 700 : 400 } : activeLayer.text.variableAxes,
                }
                dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
                rasterizeText(activeLayer.canvas, next)
                setTimeout(() => commit(`Match Font: ${next.font}`, [activeLayer.id]), 0)
              }}
            >
              Match Font…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeDoc) return
                const { diagnoseDocumentFonts } = await loadTypeCommands()
                const diagnostics = diagnoseDocumentFonts(activeDoc.layers)
                if (diagnostics.missingFonts.length) {
                  toast.warning(`Missing fonts: ${diagnostics.missingFonts.join(", ")}`)
                } else {
                  toast.success("All text layer fonts are available in this browser.")
                }
                setPreflightOpen(true)
              }}
              disabled={!activeDoc}
            >
              Font Diagnostics...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeDoc) {
                  toast.info("Open a document before creating 3D text.")
                  return
                }
                if (!activeLayer?.text) {
                  toast.info("Select a text layer before creating 3D text extrusion.")
                  return
                }
                const { createTextExtrusionScene } = await loadTypeCommands()
                const { renderThreeDScene } = await loadAdvancedCommands()
                const scene = createTextExtrusionScene({
                  ...activeLayer.text,
                  extrusion: activeLayer.text.extrusion ?? { enabled: true, depth: 30, bevel: 3, angle: 35, color: activeLayer.text.color },
                })
                const rendered = renderThreeDScene(scene, activeDoc.width, activeDoc.height)
                const canvas = makeCanvas(activeDoc.width, activeDoc.height)
                canvas.getContext("2d")!.drawImage(rendered, 0, 0)
                const layer: Layer = {
                  id: `layer_text3d_${Date.now()}`,
                  name: `${activeLayer.name} 3D Text`,
                  kind: "3d",
                  visible: true,
                  locked: false,
                  opacity: 1,
                  blendMode: "normal",
                  canvas,
                  threeD: scene,
                }
                dispatch({ type: "add-layer", layer })
                setTimeout(() => commit("Create 3D Text", [layer.id]), 0)
              }}
            >
              3D Text Extrusion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    </>
  )
}
