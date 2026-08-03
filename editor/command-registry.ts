export type CommandGroup = "File" | "Edit" | "Image" | "Layer" | "Select" | "Filter" | "View" | "Window" | "Plugins" | "Tools"

export type PurgeTarget = "undo" | "clipboard" | "histories" | "all" | "video-cache"
export type ConcretePurgeTarget = Exclude<PurgeTarget, "all">

export type CommandSideEffect =
  | {
      type: "purge-cache"
      target: PurgeTarget
      confirmation: "none" | "destructive"
    }

export interface CommandTelemetryMetadata {
  feature: string
  action: string
}

export interface CommandTestMetadata {
  surfaces: Array<"menu" | "palette" | "shortcut" | "workflow" | "plugin">
  destructive?: boolean
}

export interface PhotoshopCommandDefinition {
  id: string
  group: CommandGroup
  label: string
  menuLabel?: string
  paletteTitle?: string
  searchText?: string
  shortcuts: string[]
  sideEffect: CommandSideEffect
  telemetry: CommandTelemetryMetadata
  testMetadata: CommandTestMetadata
}

const PURGE_TARGETS: Array<{
  target: PurgeTarget
  label: string
  menuLabel: string
  searchText: string
}> = [
  {
    target: "undo",
    label: "Purge Undo",
    menuLabel: "Undo",
    searchText: "purge undo clear undo history memory",
  },
  {
    target: "clipboard",
    label: "Purge Clipboard",
    menuLabel: "Clipboard",
    searchText: "purge clipboard clear copy paste memory",
  },
  {
    target: "histories",
    label: "Purge Histories",
    menuLabel: "Histories",
    searchText: "purge histories clear history snapshots undo redo memory",
  },
  {
    target: "all",
    label: "Purge All",
    menuLabel: "All",
    searchText: "purge all clear undo clipboard histories video cache previews tiles memory",
  },
  {
    target: "video-cache",
    label: "Purge Video Cache",
    menuLabel: "Video Cache",
    searchText: "purge video cache clear timeline thumbnails poster frames memory",
  },
]

export const EDIT_PURGE_COMMANDS: readonly PhotoshopCommandDefinition[] = PURGE_TARGETS.map((command) => ({
  id: `edit-purge-${command.target}`,
  group: "Edit",
  label: command.label,
  menuLabel: command.menuLabel,
  paletteTitle: command.label,
  searchText: command.searchText,
  shortcuts: [],
  sideEffect: {
    type: "purge-cache",
    target: command.target,
    confirmation: command.target === "clipboard" ? "none" : "destructive",
  },
  telemetry: {
    feature: "purge",
    action: command.target,
  },
  testMetadata: {
    surfaces: ["menu", "palette"],
    destructive: command.target !== "clipboard",
  },
}))

export const COMMAND_REGISTRY: readonly PhotoshopCommandDefinition[] = [
  ...EDIT_PURGE_COMMANDS,
]

const COMMANDS_BY_ID = new Map(COMMAND_REGISTRY.map((command) => [command.id, command]))

export function commandById(id: string): PhotoshopCommandDefinition | undefined {
  return COMMANDS_BY_ID.get(id)
}

export function commandsForSideEffect(type: CommandSideEffect["type"]): PhotoshopCommandDefinition[] {
  return COMMAND_REGISTRY.filter((command) => command.sideEffect.type === type)
}
