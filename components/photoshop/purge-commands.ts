import {
  EDIT_PURGE_COMMANDS,
  type ConcretePurgeTarget,
  type PhotoshopCommandDefinition,
  type PurgeTarget,
} from "./command-registry"

export type { ConcretePurgeTarget, PurgeTarget }

export interface PurgeCommandDefinition {
  id: string
  target: PurgeTarget
  label: string
  menuLabel: string
  group: "Edit"
  searchText: string
  telemetry: PhotoshopCommandDefinition["telemetry"]
  testMetadata: PhotoshopCommandDefinition["testMetadata"]
}

export interface PurgeResult {
  target: PurgeTarget
  freedBytes: number
  details: string[]
}

export const PURGE_COMMANDS: PurgeCommandDefinition[] = EDIT_PURGE_COMMANDS.map((command) => {
  if (command.sideEffect.type !== "purge-cache") {
    throw new Error(`Unexpected side effect for purge command: ${command.id}`)
  }
  return {
    id: command.id,
    target: command.sideEffect.target,
    label: command.label,
    menuLabel: command.menuLabel ?? command.label,
    group: "Edit",
    searchText: command.searchText ?? "",
    telemetry: command.telemetry,
    testMetadata: command.testMetadata,
  }
})

const COMMAND_BY_TARGET = new Map(PURGE_COMMANDS.map((command) => [command.target, command]))

export function purgeCommandForTarget(target: PurgeTarget): PurgeCommandDefinition {
  return COMMAND_BY_TARGET.get(target) ?? PURGE_COMMANDS[0]
}

export function planPurgeTargets(target: PurgeTarget): ConcretePurgeTarget[] {
  if (target === "all") return ["undo", "clipboard", "histories", "video-cache"]
  return [target]
}

export function estimateCanvasBytes(canvas: { width: number; height: number } | null | undefined, bytesPerPixel = 4): number {
  if (!canvas) return 0
  const width = Number.isFinite(canvas.width) ? Math.max(0, Math.round(canvas.width)) : 0
  const height = Number.isFinite(canvas.height) ? Math.max(0, Math.round(canvas.height)) : 0
  const bpp = Number.isFinite(bytesPerPixel) ? Math.max(1, Math.round(bytesPerPixel)) : 4
  return width * height * bpp
}

export function estimateDataUrlBytes(value: unknown): number {
  if (typeof value !== "string" || !value.startsWith("data:")) return 0
  const comma = value.indexOf(",")
  if (comma === -1) return value.length * 2
  const header = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  if (/;base64/i.test(header)) return Math.max(0, Math.floor((payload.length * 3) / 4))
  return payload.length
}

function formatBytes(bytes: number): string {
  const safe = Math.max(0, Math.round(bytes))
  if (safe < 1024) return `${safe} B`
  const kib = safe / 1024
  if (kib < 1024) return `${kib.toFixed(1)} KB`
  const mib = kib / 1024
  if (mib < 1024) return `${mib.toFixed(1)} MB`
  return `${(mib / 1024).toFixed(1)} GB`
}

export function formatPurgeStatus(target: PurgeTarget, freedBytes: number): string {
  const command = purgeCommandForTarget(target)
  const pastTense = command.label.replace(/^Purge /, "Purged ")
  const safeBytes = Math.max(0, Math.round(freedBytes))
  if (safeBytes === 0) {
    return `${pastTense} - no cached memory was available to release.`
  }
  return `${pastTense} - freed about ${formatBytes(safeBytes)}.`
}
