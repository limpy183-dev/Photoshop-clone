"use client"

import {
  MenubarContent as DropdownMenuContent,
  MenubarItem as DropdownMenuItem,
  MenubarMenu as DropdownMenu,
  MenubarSeparator as DropdownMenuSeparator,
  MenubarTrigger as DropdownMenuTrigger,
} from "@/components/ui/menubar"
import type { AdvancedSubsystemTab, ColorWorkflowMode } from "../advanced-subsystems-dialog"
import type { PsDocument } from "../types"

type MediaWorkspaceMenusProps = {
  menuClass: string
  activeDoc: PsDocument | null | undefined
  applyInstant: (id: string) => void
  openFilterDialog: (id: string) => void
  openAdvancedTab: (tab: AdvancedSubsystemTab, colorWorkflow?: ColorWorkflowMode) => void
}

export function MediaWorkspaceMenus({
  menuClass,
  activeDoc,
  applyInstant,
  openFilterDialog,
  openAdvancedTab,
}: MediaWorkspaceMenusProps) {
  return (
    <>
      {/* 3D */}
      <DropdownMenu>
        <DropdownMenuTrigger className={menuClass}>3D</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => openAdvancedTab("3d")} disabled={!activeDoc}>3D Workspace...</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openAdvancedTab("3d")} disabled={!activeDoc}>New Mesh from Primitive...</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openAdvancedTab("3d")} disabled={!activeDoc}>Import / Export OBJ or DAE...</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Video */}
      <DropdownMenu>
        <DropdownMenuTrigger className={menuClass}>Video</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => openFilterDialog("de-interlace")} disabled={!activeDoc}>De-Interlace...</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => applyInstant("ntsc-colors")} disabled={!activeDoc}>NTSC Colors</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openAdvancedTab("video")} disabled={!activeDoc}>Video Timeline...</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openAdvancedTab("video")} disabled={!activeDoc}>Import Video Layer...</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openAdvancedTab("video")} disabled={!activeDoc}>Render Video...</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
