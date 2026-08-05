"use client"

/**
 * The Image menu — mode and size, the auto adjustments, crop/trim/reveal,
 * rotation and flips, and the adjustment sub-menu.
 *
 * Presentation only: `menu-bar.tsx` owns the state and the commands and passes
 * them in, the same contract `file-menu.tsx` and `view-menu.tsx` already use.
 */

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
import type { EditorContextValue } from "@/editor/context-contract"
import type { AdjustmentType, DocumentModeSettings } from "@/editor/types"
import type { ColorModeDialogTarget } from "@/components/photoshop/color/mode-dialog"
import type { ColorWorkflowMode } from "@/editor/advanced/subsystems-dialog.types"
import type { AutoAlgorithmId } from "@/components/photoshop/menus/menu-dialogs"
import type { GapWorkflowKind } from "@/components/photoshop/gap-workflow-dialog"
import type { SelectionOperation } from "@/components/photoshop/management-dialogs"
import type { SetValue } from "@/components/photoshop/menus/menu-shared"
export interface ImageMenuProps {
  menuClass: string
  activeDoc: EditorContextValue["activeDoc"]
  activeLayer: EditorContextValue["activeLayer"]
  commit: EditorContextValue["commit"]
  documents: EditorContextValue["documents"]
  addAdjustmentLayer: (filterId: AdjustmentType) => void
  autoColor: () => void
  autoContrast: () => void
  autoWhiteBalance: () => void
  contentBounds: () => { x: number; y: number; w: number; h: number } | null
  cropDocumentToBounds: (bounds: { x: number; y: number; w: number; h: number }, label: string) => void
  revealAll: () => void
  flipImage: (axis: "horizontal" | "vertical") => void
  rotateImage: (deg: number) => void
  setColorMode: (mode: DocumentModeSettings["mode"]) => void
  openColorWorkflow: (mode?: ColorWorkflowMode) => void
  openSelectionOperation: (operation: SelectionOperation) => void
  setAlgorithmOpen: SetValue<boolean>
  setAutoOptions: SetValue<{ algorithm: AutoAlgorithmId; label: string } | null>
  setCanvasSizeOpen: SetValue<boolean>
  setColorModeTarget: SetValue<ColorModeDialogTarget | null>
  setEqualizePromptOpen: SetValue<boolean>
  setFitImageOpen: SetValue<boolean>
  setGapWorkflow: SetValue<GapWorkflowKind | null>
  setHdrToningOpen: SetValue<boolean>
  setImageSizeOpen: SetValue<boolean>
  setMatchColorOpen: SetValue<boolean>
  setReplaceColorOpen: SetValue<boolean>
  setShadowsHighlightsOpen: SetValue<boolean>
}

export function ImageMenu({
  menuClass,
  activeDoc,
  activeLayer,
  commit,
  documents,
  addAdjustmentLayer,
  autoColor,
  autoContrast,
  autoWhiteBalance,
  contentBounds,
  cropDocumentToBounds,
  revealAll,
  flipImage,
  rotateImage,
  setColorMode,
  openColorWorkflow,
  openSelectionOperation,
  setAlgorithmOpen,
  setAutoOptions,
  setCanvasSizeOpen,
  setColorModeTarget,
  setEqualizePromptOpen,
  setFitImageOpen,
  setGapWorkflow,
  setHdrToningOpen,
  setImageSizeOpen,
  setMatchColorOpen,
  setReplaceColorOpen,
  setShadowsHighlightsOpen,
}: ImageMenuProps) {
  return (
    <>
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Image</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Mode</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setColorMode("RGB")}>
                  {activeDoc?.colorMode === "RGB" ? "✓ " : ""}RGB Color
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Grayscale")}>
                  {activeDoc?.colorMode === "Grayscale" ? "✓ " : ""}Grayscale
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("CMYK")}>
                  {activeDoc?.colorMode === "CMYK" ? "✓ " : ""}CMYK Color
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorModeTarget("Duotone")}>
                  {activeDoc?.colorMode === "Duotone" ? "✓ " : ""}Duotone...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorModeTarget("Indexed")}>
                  {activeDoc?.colorMode === "Indexed" ? "✓ " : ""}Indexed Color...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Multichannel")}>
                  {activeDoc?.colorMode === "Multichannel" ? "✓ " : ""}Multichannel...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorModeTarget("Bitmap")}>
                  {activeDoc?.colorMode === "Bitmap" ? "✓ " : ""}Bitmap / Halftone...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorModeTarget("ColorTable")}>
                  Color Table...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>{activeDoc?.bitDepth ?? 8} Bits/Channel</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openColorWorkflow("assign")} disabled={!activeDoc}>
                  Assign Profile...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openColorWorkflow("convert")} disabled={!activeDoc}>
                  Convert to Profile...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openColorWorkflow("proof")} disabled={!activeDoc}>
                  Color Settings / Proof Setup...
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setGapWorkflow("apply-image")} disabled={!activeLayer}>
              Apply Image...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGapWorkflow("calculations")} disabled={!activeDoc}>
              Calculations...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGapWorkflow("split-channels")} disabled={!activeDoc}>
              Split Channels...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGapWorkflow("merge-channels")} disabled={!documents.length}>
              Merge Channels...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAlgorithmOpen(true)} disabled={!activeDoc}>
              Algorithmic Operations...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Adjustments</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("levels")}>
                  Levels… <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("curves")}>
                  Curves… <DropdownMenuShortcut>⌘M</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("brightness-contrast")}>
                  Brightness/Contrast…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("exposure")}>
                  Exposure…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("vibrance")}>
                  Vibrance…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("hue-saturation")}>
                  Hue/Saturation… <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("color-balance")}>
                  Color Balance… <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("black-white")}>
                  Black & White…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("photo-filter")}>
                  Photo Filter…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("channel-mixer")}>
                  Channel Mixer…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("color-lookup")}>
                  Color Lookup…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("invert")}>
                  Invert <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("posterize")}>
                  Posterize…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("threshold")}>
                  Threshold…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("gradient-map")}>
                  Gradient Map…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("selective-color")}>
                  Selective Color…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setShadowsHighlightsOpen(true)} disabled={!activeDoc}>
                  Shadows/Highlights…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHdrToningOpen(true)} disabled={!activeDoc}>
                  HDR Toning…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("desaturate")}>
                  Desaturate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMatchColorOpen(true)} disabled={!activeDoc}>
                  Match Color…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setReplaceColorOpen(true)} disabled={!activeDoc}>
                  Replace Color…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    // Photoshop's Equalize either runs immediately (no selection)
                    // or prompts the user when a selection is active. We
                    // reproduce that prompt only when a selection is present;
                    // otherwise we apply directly.
                    if (!activeDoc) return
                    if (activeDoc.selection.bounds || activeDoc.selection.mask) {
                      setEqualizePromptOpen(true)
                    } else {
                      addAdjustmentLayer("equalize")
                    }
                  }}
                  disabled={!activeDoc}
                >
                  Equalize…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Auto</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
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
                  onSelect={() => {
                    // Auto Tone: stretch luminance
                    if (!activeLayer || activeLayer.locked) return
                    if (typeof activeLayer.canvas.getContext !== "function") return
                    const ctx = activeLayer.canvas.getContext("2d")!
                    const src = ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
                    let min = 255
                    let max = 0
                    for (let i = 0; i < src.data.length; i += 4) {
                      const lum =
                        0.299 * src.data[i] +
                        0.587 * src.data[i + 1] +
                        0.114 * src.data[i + 2]
                      if (src.data[i + 3] === 0) continue
                      if (lum < min) min = lum
                      if (lum > max) max = lum
                    }
                    const range = Math.max(1, max - min)
                    for (let i = 0; i < src.data.length; i += 4) {
                      src.data[i] = Math.max(0, Math.min(255, ((src.data[i] - min) * 255) / range))
                      src.data[i + 1] = Math.max(0, Math.min(255, ((src.data[i + 1] - min) * 255) / range))
                      src.data[i + 2] = Math.max(0, Math.min(255, ((src.data[i + 2] - min) * 255) / range))
                    }
                    ctx.putImageData(src, 0, 0)
                    commit("Auto Tone", [activeLayer.id])
                  }}
                >
                  Auto Tone
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={autoContrast}>Auto Contrast</DropdownMenuItem>
                <DropdownMenuItem onSelect={autoColor}>Auto Color</DropdownMenuItem>
                <DropdownMenuItem onSelect={autoWhiteBalance}>Auto White Balance</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setAutoOptions({ algorithm: "per-channel-contrast", label: "Auto Tone" })}
                  disabled={!activeDoc}
                >
                  Auto Tone Options…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setAutoOptions({ algorithm: "monochromatic-contrast", label: "Auto Contrast" })}
                  disabled={!activeDoc}
                >
                  Auto Contrast Options…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setAutoOptions({ algorithm: "dark-light-colors", label: "Auto Color" })}
                  disabled={!activeDoc}
                >
                  Auto Color Options…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setImageSizeOpen(true)} disabled={!activeDoc}>
              Image Size… <DropdownMenuShortcut>⌘⌥I</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCanvasSizeOpen(true)} disabled={!activeDoc}>
              Canvas Size… <DropdownMenuShortcut>⌘⌥C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Image Rotation</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => rotateImage(180)}>180°</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rotateImage(90)}>90° Clockwise</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rotateImage(-90)}>
                  90° Counter Clockwise
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const raw = window.prompt("Rotate canvas by degrees", "15")
                    const deg = raw == null ? NaN : Number(raw)
                    if (Number.isFinite(deg) && deg !== 0) rotateImage(deg)
                  }}
                >
                  Arbitrary...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => flipImage("horizontal")}>
                  Flip Horizontal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => flipImage("vertical")}>
                  Flip Vertical
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                const bounds = contentBounds()
                if (bounds) cropDocumentToBounds(bounds, "Trim Transparent Pixels")
              }}
              disabled={!activeDoc}
            >
              Trim Transparent Pixels
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={revealAll} disabled={!activeDoc}>
              Reveal All
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFitImageOpen(true)} disabled={!activeDoc}>
              Fit Image…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    </>
  )
}
