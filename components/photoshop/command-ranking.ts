import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "./client-storage"

export interface RankableCommand {
  id: string
  group: string
  title: string
  hint?: string
  searchText?: string
  disabled?: boolean
}

export type CommandUsageMap = Record<string, { count: number; lastUsed: number }>

export const COMMAND_USAGE_STORAGE_KEY = CLIENT_STORAGE_KEYS.commandPaletteUsage.key

const GROUP_PRIORITY: Record<string, number> = {
  Tools: 90,
  File: 82,
  Edit: 78,
  Layer: 74,
  Select: 72,
  Image: 70,
  Adjustments: 68,
  Filters: 62,
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function acronym(value: string) {
  return compact(value)
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
}

function fuzzySubsequenceScore(haystack: string, needle: string) {
  let cursor = 0
  let score = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor)
    if (found < 0) return 0
    score += found === cursor ? 4 : 1
    cursor = found + 1
  }
  return score
}

function textScore(value: string, query: string, weight: number) {
  const text = compact(value)
  if (!query) return 0
  if (text === query) return 1600 * weight
  if (text.startsWith(query)) return 900 * weight
  if (text.split(/\s+/).some((part) => part === query)) return 760 * weight
  if (text.includes(query)) return 520 * weight
  if (acronym(value).startsWith(query)) return 430 * weight
  return fuzzySubsequenceScore(text, query) * 12 * weight
}

function groupPriority(group: string) {
  if (group.startsWith("Panels")) return 58
  return GROUP_PRIORITY[group] ?? 45
}

function usageScore(id: string, usage: CommandUsageMap, now: number) {
  const item = usage[id]
  if (!item) return 0
  const ageHours = Math.max(0, (now - item.lastUsed) / 3_600_000)
  const recency = Math.max(0, 90 - ageHours * 4)
  return Math.min(120, item.count * 12 + recency)
}

export function rankCommandPaletteItems<T extends RankableCommand>(
  commands: readonly T[],
  query: string,
  usage: CommandUsageMap = {},
  options: { limit?: number; now?: number } = {},
): T[] {
  const q = compact(query)
  const now = options.now ?? Date.now()
  const ranked = commands
    .map((command, index) => {
      const base =
        q.length === 0
          ? groupPriority(command.group) + usageScore(command.id, usage, now)
          : textScore(command.title, q, 1)
            + textScore(command.group, q, 0.28)
            + textScore(command.hint ?? "", q, 0.16)
            + textScore(command.searchText ?? "", q, 0.36)
            + usageScore(command.id, usage, now) * 0.45
      return {
        command,
        index,
        score: base - (command.disabled ? 10_000 : 0),
      }
    })
    .filter((item) => q.length === 0 || item.score > (item.command.disabled ? -9_900 : 0))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const groupDelta = groupPriority(b.command.group) - groupPriority(a.command.group)
      if (groupDelta) return groupDelta
      return a.index - b.index
    })
    .map((item) => item.command)

  return typeof options.limit === "number" ? ranked.slice(0, options.limit) : ranked
}

export function recordCommandPaletteUsage(usage: CommandUsageMap, id: string, now = Date.now()): CommandUsageMap {
  const current = usage[id]
  return {
    ...usage,
    [id]: {
      count: Math.min(999, (current?.count ?? 0) + 1),
      lastUsed: now,
    },
  }
}

export function loadCommandPaletteUsage(): CommandUsageMap {
  if (typeof window === "undefined") return {}
  return readClientStorageJson(CLIENT_STORAGE_KEYS.commandPaletteUsage)
}

export function saveCommandPaletteUsage(usage: CommandUsageMap) {
  if (typeof window === "undefined") return
  writeClientStorageJson(CLIENT_STORAGE_KEYS.commandPaletteUsage, usage)
}
