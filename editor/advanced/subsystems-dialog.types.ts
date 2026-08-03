export type AdvancedSubsystemTab =
  | "3d"
  | "video"
  | "print"
  | "preview"
  | "automation"
  | "provenance"
  | "plugins"
  | "libraries"
  | "color"
  | "formats"
  | "variables"

export type ColorWorkflowMode = "assign" | "convert" | "proof"

export interface AdvancedSubsystemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab: AdvancedSubsystemTab
  initialColorWorkflow?: ColorWorkflowMode
}

export const ADVANCED_SUBSYSTEM_TABS: ReadonlyArray<{ id: AdvancedSubsystemTab; label: string }> = [
  { id: "3d", label: "3D" },
  { id: "video", label: "Video" },
  { id: "print", label: "Print" },
  { id: "preview", label: "Preview" },
  { id: "automation", label: "Automation" },
  { id: "provenance", label: "Provenance" },
  { id: "plugins", label: "Plugins" },
  { id: "libraries", label: "Libraries" },
  { id: "color", label: "Color" },
  { id: "formats", label: "Formats" },
  { id: "variables", label: "Variables" },
]
