"use client"

import * as React from "react"
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
import type { AdvancedSubsystemTab, ColorWorkflowMode } from "../advanced-subsystems-dialog"
import type { Action } from "../editor-context"
import { dispatchPhotoshopEvent } from "../events"
import type { GapWorkflowKind } from "../gap-workflow-dialog"
import type { ColorManagementSettings, PsDocument } from "../types"
import { supportedIccProfileNames } from "../color-pipeline"
import { requestCanvasZoom, requestPrintSizeView } from "../zoom-events"

export type ViewMenuProps = {
  menuClass: string
  activeDoc: PsDocument | null | undefined
  colorSettings: ColorManagementSettings
  dispatch: React.Dispatch<Action>
  onToggleStatusBar?: () => void
  statusBarVisible: boolean
  openAdvancedTab: (tab: AdvancedSubsystemTab, colorWorkflow?: ColorWorkflowMode) => void
  updateColorManagement: (patch: Partial<ColorManagementSettings>, label: string) => void
  toggleProofChannel: (channel: NonNullable<ColorManagementSettings["proofChannels"]>[number]) => void
  setGridSettingsOpen: (open: boolean) => void
  setNewGuideOpen: (open: boolean) => void
  setGuideLayoutOpen: (open: boolean) => void
  setGapWorkflow: (kind: GapWorkflowKind) => void
  toggleQuickMask: () => void
}

export function ViewMenu({
  menuClass,
  activeDoc,
  colorSettings,
  dispatch,
  onToggleStatusBar,
  statusBarVisible,
  openAdvancedTab,
  updateColorManagement,
  toggleProofChannel,
  setGridSettingsOpen,
  setNewGuideOpen,
  setGuideLayoutOpen,
  setGapWorkflow,
  toggleQuickMask,
}: ViewMenuProps) {
  return (
    <>        {/* View */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>View</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem
              onSelect={() => activeDoc && requestCanvasZoom({ factor: 2 })}
            >
              Zoom In <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => activeDoc && requestCanvasZoom({ factor: 0.5 })}
            >
              Zoom Out <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => requestCanvasZoom({ zoom: 1 })}>
              100% <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => requestCanvasZoom({ zoom: 0.5 })}>
              Fit on Screen <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => requestPrintSizeView()} disabled={!activeDoc}>
              Print Size
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("preview")} disabled={!activeDoc}>
              Device Preview...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Proof Setup</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => updateColorManagement({ proofColors: !colorSettings.proofColors }, colorSettings.proofColors ? "Proof Colors Off" : "Proof Colors On")}
                  disabled={!activeDoc}
                >
                  {colorSettings.proofColors ? "✓ " : ""}Proof Colors
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => updateColorManagement({ gamutWarning: !colorSettings.gamutWarning }, colorSettings.gamutWarning ? "Gamut Warning Off" : "Gamut Warning On")}
                  disabled={!activeDoc}
                >
                  {colorSettings.gamutWarning ? "✓ " : ""}Gamut Warning
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Proof Profile</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => updateColorManagement({ proofProfile: "None", proofColors: false }, "Proof Profile: None")} disabled={!activeDoc}>
                      {colorSettings.proofProfile === "None" ? "✓ " : ""}None
                    </DropdownMenuItem>
                    {supportedIccProfileNames().map((profile) => (
                      <DropdownMenuItem
                        key={profile}
                        onSelect={() => updateColorManagement({ proofProfile: profile, proofColors: true }, `Proof Profile: ${profile}`)}
                        disabled={!activeDoc}
                      >
                        {colorSettings.proofProfile === profile ? "✓ " : ""}{profile}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Plate Channels</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => updateColorManagement({ proofChannels: [] }, "Proof Channels: Composite")} disabled={!activeDoc}>
                      {(colorSettings.proofChannels?.length ?? 0) === 0 ? "✓ " : ""}Composite
                    </DropdownMenuItem>
                    {(["cyan", "magenta", "yellow", "black", "red", "green", "blue"] as const).map((channel) => (
                      <DropdownMenuItem key={channel} onSelect={() => toggleProofChannel(channel)} disabled={!activeDoc}>
                        {colorSettings.proofChannels?.includes(channel) ? "✓ " : ""}{channel[0].toUpperCase() + channel.slice(1)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Plate View Mode</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(["composite", "ink", "mask"] as const).map((mode) => (
                      <DropdownMenuItem key={mode} onSelect={() => updateColorManagement({ proofPlateView: mode }, `Proof Plate View: ${mode}`)} disabled={!activeDoc}>
                        {(colorSettings.proofPlateView ?? "composite") === mode ? "✓ " : ""}{mode[0].toUpperCase() + mode.slice(1)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => onToggleStatusBar?.()} disabled={!onToggleStatusBar}>
              {statusBarVisible ? "Hide Info Bar" : "Show Info Bar"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => dispatch({ type: "toggle-grid" })}
            >
              {activeDoc?.showGrid ? "✓ " : ""}Show Grid <DropdownMenuShortcut>⌘'</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGridSettingsOpen(true)} disabled={!activeDoc}>
              Grid Settings…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-pixel-grid" })} disabled={!activeDoc}>
              {activeDoc?.showPixelGrid ? "✓ " : ""}Pixel Grid
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-snap" })}>
              {activeDoc?.snap ? "✓ " : ""}Snap
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-snap-grid" })}>
              {activeDoc?.snapToGrid ? "✓ " : ""}Snap to Grid
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-snap-guides" })}>
              {activeDoc?.snapToGuides ? "✓ " : ""}Snap to Guides
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setNewGuideOpen(true)}
              disabled={!activeDoc}
            >
              New Guide…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGuideLayoutOpen(true)} disabled={!activeDoc}>
              New Guide Layout…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => dispatch({ type: "clear-guides" })}
            >
              Clear Guides
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setGapWorkflow("scripted-pattern")} disabled={!activeDoc}>
              Pattern Preview / Scripted Patterns...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleQuickMask}>
              {activeDoc?.quickMask ? "✓ " : ""}Edit in Quick Mask <DropdownMenuShortcut>Q</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Screen Mode</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-set-screen-mode", { mode: "standard" })}>
                  Standard Screen Mode
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-set-screen-mode", { mode: "full-screen-with-menu" })}>
                  Full Screen Mode with Menu Bar
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-set-screen-mode", { mode: "full-screen" })}>
                  Full Screen Mode
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-cycle-screen-mode")}>
                  Cycle Screen Mode <DropdownMenuShortcut>F</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
    </>
  )
}