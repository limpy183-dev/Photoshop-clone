import { canPluginUsePermission, permissionsForPluginActionDescriptors } from "../plugin-system"
import type { FileSystemFileHandleLike } from "../editor-context"
import type {
  Layer,
  LayerStyle,
  PluginCommandDescriptor,
  PluginDescriptor,
  PluginPermission,
} from "../types"

export const MENU_TRIGGER_CLASS =
  "h-7 px-2 inline-flex items-center text-[12px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)] data-[state=open]:bg-[var(--ps-tool-active)] rounded-none outline-none cursor-default"

export const LINKED_SMART_OBJECT_POLL_MS = 30_000

export function smartLinkFingerprint(source: Layer["smartSource"]): string {
  if (!source) return "none"
  return [
    source.status ?? "",
    source.fileName ?? "",
    source.fileHandleName ?? "",
    source.handlePermission ?? "",
    source.lastKnownModified ?? "",
    source.lastKnownSize ?? "",
    source.sourceHash ?? "",
  ].join("|")
}

function permissionsForPluginCommand(command: PluginCommandDescriptor): PluginPermission[] {
  if (command.requiredPermissions?.length) return command.requiredPermissions
  if (command.action.type === "apply-filter") return ["filters:write"]
  if (command.action.type === "post-message") return ["commands"]
  if (command.action.type === "batch-play") return permissionsForPluginActionDescriptors(command.action.descriptors)
  if (command.action.type === "eval-script") return ["commands"]
  return []
}

export function pluginCommandUnavailable(plugin: PluginDescriptor, command: PluginCommandDescriptor) {
  if (plugin.enabled === false) return "Plugin is disabled"
  const missing = permissionsForPluginCommand(command).filter((permission) => !canPluginUsePermission(plugin, permission))
  return missing[0] ? `Missing ${missing[0]} permission` : undefined
}

export function cloneLayerStyle(style: LayerStyle): LayerStyle {
  if (typeof structuredClone === "function") return structuredClone(style)
  return JSON.parse(JSON.stringify(style))
}

export type SaveMode = "save" | "save-as"

export type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandleLike>
}

export type ReadableFileHandle = FileSystemFileHandle & {
  getFile: () => Promise<File>
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
}

export type OpenPickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple?: boolean
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<ReadableFileHandle[]>
}
