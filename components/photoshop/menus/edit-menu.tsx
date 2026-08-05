"use client"

/**
 * The Edit menu — undo/redo, clipboard, fill and stroke, the purge commands,
 * and the preferences/preset/shortcut dialogs.
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
import { dispatchPhotoshopEvent } from "@/editor/events"
import { flattenVisibleLayers } from "@/editor/menus/image-operations"
import { PURGE_COMMANDS, type PurgeTarget } from "@/editor/purge-commands"
import type { SetValue } from "@/components/photoshop/menus/menu-shared"
export interface EditMenuProps {
  menuClass: string
  activeDoc: EditorContextValue["activeDoc"]
  activeLayer: EditorContextValue["activeLayer"]
  dispatch: EditorContextValue["dispatch"]
  copySelection: EditorContextValue["copySelection"]
  pasteAsLayer: EditorContextValue["pasteAsLayer"]
  undo: () => void
  redo: () => void
  fillForeground: (with_: "fg" | "bg" | "white" | "black" | "transparent") => void
  fillContentAware: () => void | Promise<void>
  runPurge: (target: PurgeTarget) => void
  setAlgorithmOpen: SetValue<boolean>
  setMenuCustomizationOpen: SetValue<boolean>
  setPreferencesOpen: SetValue<boolean>
  setPresetManagerOpen: SetValue<boolean>
  setShortcutsOpen: SetValue<boolean>
  setStrokeOpen: SetValue<boolean>
}

export function EditMenu({
  menuClass,
  activeDoc,
  activeLayer,
  dispatch,
  copySelection,
  pasteAsLayer,
  undo,
  redo,
  fillForeground,
  fillContentAware,
  runPurge,
  setAlgorithmOpen,
  setMenuCustomizationOpen,
  setPreferencesOpen,
  setPresetManagerOpen,
  setShortcutsOpen,
  setStrokeOpen,
}: EditMenuProps) {
  return (
    <>
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Edit</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={undo}>
              Undo <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={redo}>
              Redo <DropdownMenuShortcut>⌘Y</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={undo}>
              Step Backward <DropdownMenuShortcut>⌘⌥Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => copySelection(true)}
              disabled={!activeLayer || activeLayer.locked}
            >
              Cut <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => copySelection(false)}
              disabled={!activeLayer}
            >
              Copy <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                dispatch({ type: "set-clipboard", canvas: flattenVisibleLayers(activeDoc) })
              }}
              disabled={!activeDoc}
            >
              Copy Merged <DropdownMenuShortcut>⌘⇧C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={pasteAsLayer}>
              Paste <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => fillForeground("fg")}>
              Fill <DropdownMenuShortcut>⇧F5</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={fillContentAware}
            >
              Content-Aware Fill...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setStrokeOpen(true)} disabled={!activeLayer}>
              Stroke…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => dispatchPhotoshopEvent("ps-free-transform")}
              disabled={!activeLayer || activeLayer.locked}
            >
              Free Transform <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAlgorithmOpen(true)} disabled={!activeDoc}>
              Algorithmic Operations...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Transform</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-flip", "horizontal")} disabled={!activeLayer}>
                  Flip Horizontal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-flip", "vertical")} disabled={!activeLayer}>
                  Flip Vertical
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-rotate", 90)} disabled={!activeLayer}>
                  Rotate 90° CW
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-rotate", -90)} disabled={!activeLayer}>
                  Rotate 90° CCW
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-rotate", 180)} disabled={!activeLayer}>
                  Rotate 180°
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Purge</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PURGE_COMMANDS.map((command) => (
                  <DropdownMenuItem key={command.target} onSelect={() => runPurge(command.target)}>
                    {command.menuLabel}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Presets</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setPresetManagerOpen(true)}>
                  Preset Manager…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "brush")}>
                  Brushes Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "swatches")}>
                  Swatches Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "gradients")}>
                  Gradients Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "patterns")}>
                  Patterns Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "styles")}>
                  Styles Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "shapes")}>
                  Shapes Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "tool-presets")}>
                  Tool Presets Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "assets")}>
                  Assets Panel
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setPreferencesOpen(true)}>
              Preferences
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>Keyboard Shortcuts…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMenuCustomizationOpen(true)}>Menus…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    </>
  )
}
