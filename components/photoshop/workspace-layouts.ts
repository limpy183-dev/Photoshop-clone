import {
  WORKSPACE_PRESETS,
  panelById,
  panelsForStack,
  type PanelDockMode,
  type PanelStack,
} from "./panel-registry"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "./client-storage"
import { dispatchPhotoshopEvent } from "./events"

export const WORKSPACES_KEY = "ps-workspaces-v2"
export const LEGACY_WORKSPACES_KEY = "ps-workspaces-v1"

export interface WorkspaceLayout {
  name: string
  topHeight: number
  dockWidth: number
  topTab: string
  bottomTab: string
  upperPinned: string[]
  lowerPinned: string[]
  dockMode: PanelDockMode
  upperHidden?: boolean
  savedAt: number
}

const SAFE_WORKSPACE_NAME = /^[^<>:"/\\|?*\u0000-\u001f]{1,80}$/

function isDockMode(value: unknown): value is PanelDockMode {
  return value === "expanded" || value === "compact" || value === "hidden"
}

function validPanelIds(stack: PanelStack) {
  return new Set(panelsForStack(stack).map((panel) => panel.id))
}

export function normalizeWorkspacePinned(stack: PanelStack, ids: unknown, fallback: readonly string[]) {
  const valid = validPanelIds(stack)
  const source = Array.isArray(ids) ? ids : fallback
  const normalized = source
    .map((id) => String(id))
    .filter((id, index, list) => valid.has(id) && list.indexOf(id) === index)
  return normalized.length ? normalized : fallback.filter((id) => valid.has(id))
}

export function normalizeWorkspaceLayout(input: unknown): WorkspaceLayout | null {
  if (!input || typeof input !== "object") return null
  const source = input as Record<string, unknown>
  const name = String(source.name ?? "").trim().slice(0, 80)
  if (!name || !SAFE_WORKSPACE_NAME.test(name)) return null

  const fallback = WORKSPACE_PRESETS.essentials
  const topTab = String(source.topTab ?? source.topActive ?? fallback.topActive)
  const bottomTab = String(source.bottomTab ?? source.bottomActive ?? fallback.bottomActive)
  const safeTopTab = panelById(topTab)?.stack === "upper" ? topTab : fallback.topActive
  const safeBottomTab = panelById(bottomTab)?.stack === "lower" ? bottomTab : fallback.bottomActive
  const topHeight = Math.max(78, Math.min(1200, Number(source.topHeight) || fallback.topHeight))
  const dockWidth = Math.max(260, Math.min(720, Number(source.dockWidth) || fallback.dockWidth))

  return {
    name,
    topHeight,
    dockWidth,
    topTab: safeTopTab,
    bottomTab: safeBottomTab,
    upperPinned: normalizeWorkspacePinned("upper", source.upperPinned, fallback.upperPinned),
    lowerPinned: normalizeWorkspacePinned("lower", source.lowerPinned, fallback.lowerPinned),
    dockMode: isDockMode(source.dockMode) ? source.dockMode : isDockMode(source.mode) ? source.mode : fallback.mode,
    upperHidden: source.upperHidden === true,
    savedAt: Number.isFinite(Number(source.savedAt)) ? Number(source.savedAt) : Date.now(),
  }
}

export function normalizeWorkspaceLibrary(input: unknown): WorkspaceLayout[] {
  const source =
    input && typeof input === "object" && !Array.isArray(input) && "workspaces" in input
      ? (input as { workspaces?: unknown }).workspaces
      : input
  if (!Array.isArray(source)) return []

  const byName = new Map<string, WorkspaceLayout>()
  for (const item of source.slice(0, 64)) {
    const layout = normalizeWorkspaceLayout(item)
    if (!layout) continue
    byName.set(layout.name.toLowerCase(), layout)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function mergeWorkspaceLibraries(existing: readonly WorkspaceLayout[], incoming: readonly WorkspaceLayout[]) {
  const byName = new Map<string, WorkspaceLayout>()
  for (const workspace of existing) byName.set(workspace.name.toLowerCase(), workspace)
  for (const workspace of incoming) byName.set(workspace.name.toLowerCase(), workspace)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function serializeWorkspaceLibrary(workspaces: readonly WorkspaceLayout[]) {
  return JSON.stringify(
    {
      app: "Photoshop Web",
      format: "ps-workspaces",
      version: 2,
      exportedAt: new Date().toISOString(),
      workspaces,
    },
    null,
    2,
  )
}

export function readWorkspaceLibrary(): WorkspaceLayout[] {
  for (const descriptor of [CLIENT_STORAGE_KEYS.workspaces, CLIENT_STORAGE_KEYS.legacyWorkspaces]) {
    const parsed = readClientStorageJson(descriptor)
    const workspaces = normalizeWorkspaceLibrary(parsed)
    if (workspaces.length) return workspaces
  }
  return []
}

export function writeWorkspaceLibrary(workspaces: readonly WorkspaceLayout[]) {
  const normalized = normalizeWorkspaceLibrary(workspaces)
  writeClientStorageJson(CLIENT_STORAGE_KEYS.workspaces, normalized)
  dispatchPhotoshopEvent("ps-workspaces-changed", normalized)
}
