export type PurgeTarget = "undo" | "clipboard" | "histories" | "all" | "video-cache"
export type ConcretePurgeTarget = Exclude<PurgeTarget, "all">

export interface PurgeCommandDefinition {
  target: PurgeTarget
  label: string
  menuLabel: string
  group: "Edit"
  searchText: string
}

export interface PurgeResult {
  target: PurgeTarget
  freedBytes: number
  details: string[]
}

export const PURGE_COMMANDS: PurgeCommandDefinition[] = [
  {
    target: "undo",
    label: "Purge Undo",
    menuLabel: "Undo",
    group: "Edit",
    searchText: "purge undo clear undo history memory",
  },
  {
    target: "clipboard",
    label: "Purge Clipboard",
    menuLabel: "Clipboard",
    group: "Edit",
    searchText: "purge clipboard clear copy paste memory",
  },
  {
    target: "histories",
    label: "Purge Histories",
    menuLabel: "Histories",
    group: "Edit",
    searchText: "purge histories clear history snapshots undo redo memory",
  },
  {
    target: "all",
    label: "Purge All",
    menuLabel: "All",
    group: "Edit",
    searchText: "purge all clear undo clipboard histories video cache previews tiles memory",
  },
  {
    target: "video-cache",
    label: "Purge Video Cache",
    menuLabel: "Video Cache",
    group: "Edit",
    searchText: "purge video cache clear timeline thumbnails poster frames memory",
  },
]

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
