"use client"

/**
 * The Plugins, Window and Help menus.
 *
 * Grouped into one file the way `media-workspace-menus.tsx` groups 3D and
 * Video: each is small, and they are adjacent in the bar.
 *
 * Presentation only: `menu-bar.tsx` owns the state and the commands and passes
 * them in, the same contract `file-menu.tsx` and `view-menu.tsx` already use.
 */

import {
  MenubarContent as DropdownMenuContent,
  MenubarItem as DropdownMenuItem,
  MenubarLabel as DropdownMenuLabel,
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
import {
  PANEL_CATEGORIES,
  PANEL_DEFINITIONS,
  WORKSPACE_PRESET_OPTIONS,
  type WorkspacePresetId,
} from "@/components/photoshop/panel-registry"
import type { AdvancedSubsystemTab, ColorWorkflowMode } from "@/editor/advanced/subsystems-dialog.types"
import type { PluginCommandDescriptor, PluginDescriptor } from "@/editor/types"
import type { SetValue } from "@/components/photoshop/menus/menu-shared"

export interface WorkspaceMenusProps {
  menuClass: string
  activeDoc: EditorContextValue["activeDoc"]
  openAdvancedTab: (tab: AdvancedSubsystemTab, colorWorkflow?: ColorWorkflowMode) => void
  pluginCommandItems: Array<{
    plugin: PluginDescriptor
    command: PluginCommandDescriptor
    disabledReason: string | undefined
  }>
  runPluginCommandFromMenu: (plugin: PluginDescriptor, command: PluginCommandDescriptor) => void
  applyWorkspacePreset: (preset: WorkspacePresetId) => void
  saveCurrentWorkspace: () => void
  deleteSavedWorkspace: () => void
  savedWorkspaces: { name: string; savedAt?: number }[]
  openPanel: (id: string) => void
  setColorLabelsOpen: SetValue<boolean>
  setLayerCompsOpen: SetValue<boolean>
  setWorkspaceManagerOpen: SetValue<boolean>
  setAboutOpen: SetValue<boolean>
  setFileInfoOpen: SetValue<boolean>
  setShortcutsOpen: SetValue<boolean>
}

export function WorkspaceMenus({
  menuClass,
  activeDoc,
  openAdvancedTab,
  pluginCommandItems,
  runPluginCommandFromMenu,
  applyWorkspacePreset,
  saveCurrentWorkspace,
  deleteSavedWorkspace,
  savedWorkspaces,
  openPanel,
  setColorLabelsOpen,
  setLayerCompsOpen,
  setWorkspaceManagerOpen,
  setAboutOpen,
  setFileInfoOpen,
  setShortcutsOpen,
}: WorkspaceMenusProps) {
  return (
    <>
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Plugins</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={() => openAdvancedTab("plugins")} disabled={!activeDoc}>Plugin Manager...</DropdownMenuItem>
            {pluginCommandItems.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Installed Commands</DropdownMenuLabel>
                {pluginCommandItems.slice(0, 12).map(({ plugin, command, disabledReason }) => (
                  <DropdownMenuItem
                    key={`${plugin.id}-${command.id}`}
                    disabled={!!disabledReason}
                    onSelect={() => runPluginCommandFromMenu(plugin, command)}
                  >
                    {command.title}
                    <DropdownMenuShortcut className="max-w-32 truncate">{plugin.name}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openAdvancedTab("libraries")} disabled={!activeDoc}>Creative Cloud Libraries...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("libraries")} disabled={!activeDoc}>Adobe Stock / Fonts...</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Window</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            {WORKSPACE_PRESET_OPTIONS.map((preset) => (
              <DropdownMenuItem key={preset.id} onSelect={() => applyWorkspacePreset(preset.id)}>
                {preset.id === "essentials" ? `${preset.label} (Default)` : preset.label}
              </DropdownMenuItem>
            ))}
            {savedWorkspaces.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Saved Workspaces</DropdownMenuLabel>
                {savedWorkspaces.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.name}
                    onSelect={() =>
                      dispatchPhotoshopEvent("ps-apply-workspace", { name: workspace.name })
                    }
                  >
                    {workspace.name}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={saveCurrentWorkspace}>Save Current Workspace...</DropdownMenuItem>
            <DropdownMenuItem onSelect={deleteSavedWorkspace} disabled={!savedWorkspaces.length}>
              Delete Saved Workspace...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setWorkspaceManagerOpen(true)}>
              Workspace Manager...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyWorkspacePreset("essentials")}>
              Reset Essentials
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Panels</DropdownMenuLabel>
            {PANEL_CATEGORIES.map((category) => {
              const panels = PANEL_DEFINITIONS.filter((panel) => panel.category === category)
              return (
                <DropdownMenuSub key={category}>
                  <DropdownMenuSubTrigger>{category}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-60">
                    {panels.map((panel) => (
                      <DropdownMenuItem key={panel.id} onSelect={() => openPanel(panel.id)}>
                        {panel.label}
                        <DropdownMenuShortcut className="capitalize">{panel.complexity}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openPanel("browser-diagnostics")}>
              Browser Diagnostics
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLayerCompsOpen(true)}>
              Layer Comps...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorLabelsOpen(true)}>
              Color Labels...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Help</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setAboutOpen(true)}>About Photoshop Web</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>Keyboard Shortcuts</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFileInfoOpen(true)} disabled={!activeDoc}>System Info…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
    </>
  )
}
