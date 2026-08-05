"use client"

import { ThreeDWorkspace } from "@/components/photoshop/advanced/subsystems-dialog-three-d"
import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  ADVANCED_SUBSYSTEM_TABS,
  type AdvancedSubsystemTab,
  type AdvancedSubsystemsDialogProps,
  type ColorWorkflowMode,
} from "@/editor/advanced/subsystems-dialog.types"
import { PluginWorkspace } from "@/components/photoshop/advanced/subsystems-plugin-workspace"
import { VideoWorkspace } from "@/components/photoshop/advanced/subsystems-video-workspace"
import { PrintWorkspace } from "@/components/photoshop/advanced/subsystems-print-workspace"
import { DevicePreviewWorkspace } from "@/components/photoshop/advanced/subsystems-device-preview-workspace"
import { AutomationWorkspace } from "@/components/photoshop/advanced/subsystems-automation-workspace"
import { ProvenanceWorkspace } from "@/components/photoshop/advanced/subsystems-provenance-workspace"
import { LibrariesWorkspace } from "@/components/photoshop/advanced/subsystems-libraries-workspace"
import { ColorWorkspace } from "@/components/photoshop/advanced/subsystems-color-workspace"
import { FormatsWorkspace } from "@/components/photoshop/advanced/subsystems-formats-workspace"
import { VariablesWorkspace } from "@/components/photoshop/advanced/subsystems-variables-workspace"
export type { AdvancedSubsystemTab, ColorWorkflowMode } from "@/editor/advanced/subsystems-dialog.types"

export function AdvancedSubsystemsDialog({ open, onOpenChange, initialTab, initialColorWorkflow = "assign" }: AdvancedSubsystemsDialogProps) {
  const [tab, setTab] = React.useState<AdvancedSubsystemTab>(initialTab)
  React.useEffect(() => {
    if (open) setTab(initialTab)
  }, [initialTab, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(92vh,880px)] w-[min(96vw,1440px)] max-w-[min(96vw,1440px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)] sm:max-w-[min(96vw,1440px)]">
        <DialogHeader className="shrink-0 border-b border-[var(--ps-divider)] px-4 py-3">
          <DialogTitle className="text-sm">Advanced Photoshop Subsystems</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[176px_minmax(0,1fr)]">
          <AdvancedSubsystemTabList activeTab={tab} onTabChange={setTab} />
          <div className="min-h-0 min-w-0 overflow-auto p-4">
            <AdvancedSubsystemTabContent tab={tab} initialColorWorkflow={initialColorWorkflow} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AdvancedSubsystemTabList({ activeTab, onTabChange }: { activeTab: AdvancedSubsystemTab; onTabChange: (tab: AdvancedSubsystemTab) => void }) {
  return (
    <div className="overflow-y-auto border-r border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      {ADVANCED_SUBSYSTEM_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTabChange(item.id)}
          className={`mb-1 flex h-8 w-full items-center rounded-sm px-3 text-left text-[12px] ${activeTab === item.id ? "bg-[var(--ps-accent)] text-white" : "hover:bg-[var(--ps-tool-hover)]"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function AdvancedSubsystemTabContent({ tab, initialColorWorkflow }: { tab: AdvancedSubsystemTab; initialColorWorkflow: ColorWorkflowMode }) {
  switch (tab) {
    case "3d":
      return <ThreeDWorkspace />
    case "video":
      return <VideoWorkspace />
    case "print":
      return <PrintWorkspace />
    case "preview":
      return <DevicePreviewWorkspace />
    case "automation":
      return <AutomationWorkspace />
    case "provenance":
      return <ProvenanceWorkspace />
    case "plugins":
      return <PluginWorkspace />
    case "libraries":
      return <LibrariesWorkspace />
    case "color":
      return <ColorWorkspace initialWorkflow={initialColorWorkflow} />
    case "formats":
      return <FormatsWorkspace />
    case "variables":
      return <VariablesWorkspace />
  }

  const _exhaustive: never = tab
  return _exhaustive
}
