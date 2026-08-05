"use client"

/**
 * The Layer menu — new layers and groups, layer styles, masks, smart objects,
 * rasterize, and the flatten/merge commands.
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
import { toast } from "sonner"
import type { SetValue } from "@/components/photoshop/menus/menu-shared"
export interface LayerMenuProps {
  menuClass: string
  activeDoc: EditorContextValue["activeDoc"]
  activeLayer: EditorContextValue["activeLayer"]
  commit: EditorContextValue["commit"]
  dispatch: EditorContextValue["dispatch"]
  foreground: EditorContextValue["foreground"]
  background: EditorContextValue["background"]
  selectedLayers: EditorContextValue["selectedLayers"]
  newLayer: EditorContextValue["newLayer"]
  newGroup: EditorContextValue["newGroup"]
  addLayerMask: EditorContextValue["addLayerMask"]
  copyLayerStyle: () => void
  pasteLayerStyle: () => void
  clearLayerStyle: () => void
  flattenAllLayerEffects: () => void
  flattenAllMasks: () => void
  deleteAllEmptyLayers: () => void
  toggleLayerMaskEnabled: () => void
  applyLayerMask: () => void
  editSmartObjectContentsFromMenu: () => void
  updateSmartObjectParentFromMenu: () => void
  exportSmartObjectContentsFromMenu: () => void | Promise<void>
  replaceSmartObjectFromFile: (linkType: "embedded" | "linked") => void | Promise<void>
  updateLinkedSmartObjectFromMenu: () => void | Promise<void>
  revealSmartObjectSourceFromMenu: () => void | Promise<void>
  rasterizeLayers: (option: "layer" | "type" | "shape" | "smart-object" | "layer-style" | "video" | "3d" | "all") => void
  flattenTransparency: (alphaMode: "clear" | "preserve", matte: string, label: string) => void
  setFlattenTransparencyOpen: SetValue<boolean>
  setLayerStyleOpen: SetValue<boolean>
  setSelectMaskOpen: SetValue<boolean>
}

export function LayerMenu({
  menuClass,
  activeDoc,
  activeLayer,
  commit,
  dispatch,
  foreground,
  background,
  selectedLayers,
  newLayer,
  newGroup,
  addLayerMask,
  copyLayerStyle,
  pasteLayerStyle,
  clearLayerStyle,
  flattenAllLayerEffects,
  flattenAllMasks,
  deleteAllEmptyLayers,
  toggleLayerMaskEnabled,
  applyLayerMask,
  editSmartObjectContentsFromMenu,
  updateSmartObjectParentFromMenu,
  exportSmartObjectContentsFromMenu,
  replaceSmartObjectFromFile,
  updateLinkedSmartObjectFromMenu,
  revealSmartObjectSourceFromMenu,
  rasterizeLayers,
  flattenTransparency,
  setFlattenTransparencyOpen,
  setLayerStyleOpen,
  setSelectMaskOpen,
}: LayerMenuProps) {
  return (
    <>
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Layer</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[calc(100vh-56px)] w-72 overflow-y-auto">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>New</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => newLayer()}>
                  Layer… <DropdownMenuShortcut>⌘⇧N</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => newGroup()}
                  disabled={!selectedLayers.length}
                >
                  Group from Layers… <DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Layer Style</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setLayerStyleOpen(true)} disabled={!activeLayer}>
                  Blending Options...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={copyLayerStyle}>
                  Copy Layer Style
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={pasteLayerStyle}>
                  Paste Layer Style
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={clearLayerStyle}>
                  Clear Layer Style
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={flattenAllLayerEffects} disabled={!activeDoc}>
                  Flatten All Layer Effects
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Layer Mask</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={addLayerMask}
                  disabled={!activeLayer || !!activeLayer?.mask}
                >
                  Reveal All
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    if (!activeDoc || !activeLayer) return
                    addLayerMask()
                    setTimeout(() => {
                      if (activeLayer.mask) {
                        const ctx = activeLayer.mask.getContext("2d")!
                        ctx.fillStyle = "#000"
                        ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
                        commit("Hide All Mask", [activeLayer.id])
                      }
                    }, 16)
                  }}
                  disabled={!activeLayer || !!activeLayer?.mask}
                >
                  Hide All
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={toggleLayerMaskEnabled}
                >
                  {activeLayer?.maskEnabled === false ? "Enable Mask" : "Disable Mask"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setSelectMaskOpen(true)}
                >
                  Refine Mask...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={applyLayerMask}
                >
                  Apply Mask
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    if (!activeLayer) {
                      toast.info("Select a layer before deleting a mask.")
                      return
                    }
                    if (!activeLayer.mask) {
                      toast.info("Add a layer mask before deleting it.")
                      return
                    }
                    dispatch({ type: "set-layer-mask", id: activeLayer.id, mask: null })
                    setTimeout(() => commit("Delete Mask", [activeLayer.id]), 0)
                  }}
                >
                  Delete Mask
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={flattenAllMasks} disabled={!activeDoc}>
                  Flatten All Masks
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Rasterize</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => rasterizeLayers("type")} disabled={!activeLayer || activeLayer.kind !== "text"}>
                  Type
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("shape")} disabled={!activeLayer || (activeLayer.kind !== "shape" && !activeLayer.path)}>
                  Shape
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("smart-object")} disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}>
                  Smart Object
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("layer-style")} disabled={!activeLayer?.style}>
                  Layer Style
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => rasterizeLayers("video")}
                  disabled={!activeLayer || (activeLayer.kind !== "video" && !activeLayer.video)}
                >
                  Video
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => rasterizeLayers("3d")}
                  disabled={!activeLayer || (activeLayer.kind !== "3d" && !activeLayer.threeD)}
                >
                  3D
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => rasterizeLayers("layer")} disabled={!activeLayer}>
                  Layer
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("all")} disabled={!activeDoc}>
                  All Layers
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeLayer) return
                dispatch({ type: "set-layer-smart", id: activeLayer.id, smart: true })
                setTimeout(() => commit("Convert to Smart Object", [activeLayer.id]), 0)
              }}
              disabled={!activeLayer || activeLayer.smartObject}
            >
              Convert to Smart Object
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={editSmartObjectContentsFromMenu}
            >
              Edit Smart Object Contents
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void replaceSmartObjectFromFile("embedded")}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Replace Contents...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void replaceSmartObjectFromFile("linked")}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Relink to File...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void updateLinkedSmartObjectFromMenu()}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Update Linked Smart Object
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void revealSmartObjectSourceFromMenu()}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Reveal Smart Object Source...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void exportSmartObjectContentsFromMenu()}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Export Contents...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={updateSmartObjectParentFromMenu}
            >
              Update Parent Smart Object
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeLayer) return
                dispatch({ type: "toggle-layer-clipped", id: activeLayer.id })
                setTimeout(() => commit("Toggle Clipping Mask", [activeLayer.id]), 0)
              }}
              disabled={!activeLayer}
            >
              Create Clipping Mask <DropdownMenuShortcut>⌘⌥G</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => activeLayer && dispatch({ type: "duplicate-layer", id: activeLayer.id })}
              disabled={!activeLayer}
            >
              Duplicate Layer… <DropdownMenuShortcut>⌘J</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => activeLayer && dispatch({ type: "remove-layer", id: activeLayer.id })}
              disabled={!activeLayer}
            >
              Delete Layer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={deleteAllEmptyLayers} disabled={!activeDoc}>
              Delete All Empty Layers
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => dispatch({ type: "link-selected" })}
            >
              Link Layers
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "unlink-selected" })}>
              Unlink Layers
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => activeLayer && dispatch({ type: "merge-down", id: activeLayer.id })}
            >
              Merge Down <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                dispatch({ type: "merge-selected" })
                setTimeout(() => commit("Merge Layers", "all"), 0)
              }}
            >
              Merge Selected
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!activeDoc}
              onSelect={() => setFlattenTransparencyOpen(true)}
            >
              Flatten Transparency…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!activeLayer}>
                Flatten Transparency
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => flattenTransparency("clear", background, "Background Color")}>
                  Background Color
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => flattenTransparency("clear", foreground, "Foreground Color")}>
                  Foreground Color
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => flattenTransparency("preserve", background, "Preserve Alpha")}>
                  Preserve Alpha
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                dispatch({ type: "flatten" })
                setTimeout(() => commit("Flatten", "all"), 0)
              }}
            >
              Flatten Image
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                dispatch({ type: "stamp-visible" })
                setTimeout(() => commit("Stamp Visible", "all"), 0)
              }}
            >
              Stamp Visible <DropdownMenuShortcut>⌘⇧⌥E</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    </>
  )
}
