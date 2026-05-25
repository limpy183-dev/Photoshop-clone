import type { Layer, PsDocument } from "./types"

export type SourceStorageKind = "new" | "download" | "file-system-access" | "opened-file" | "snapshot"
export type SourceFileKind = "project" | "psd" | "image"

export interface SourcePermissionDescriptor {
  mode?: "read" | "readwrite"
}

export interface SourceFileHandleLike {
  kind?: "file"
  name: string
  getFile?: () => Promise<File>
  queryPermission?: (descriptor?: SourcePermissionDescriptor) => Promise<PermissionState>
  requestPermission?: (descriptor?: SourcePermissionDescriptor) => Promise<PermissionState>
  isSameEntry?: (other: FileSystemHandle) => Promise<boolean>
}

export interface SourceDirectoryHandleLike {
  kind?: "directory"
  name: string
  getFileHandle?: (name: string) => Promise<SourceFileHandleLike>
}

export interface SourceDocumentLifecycleLike {
  dirty?: boolean
  savedHistoryIndex?: number
  savedAt?: number
  fileName?: string
  fileKind?: SourceFileKind
  storage?: SourceStorageKind
  fileHandle?: SourceFileHandleLike | null
  lastSaveNote?: string
}

export interface SourceLocationInfo {
  title: string
  primaryName: string
  storageLabel: string
  handleLabel: string
  pathLabel: string
  canReveal: boolean
  unavailableReason?: string
  fileHandle?: SourceFileHandleLike
  rows: [string, string][]
}

export type RevealSourceStatus =
  | "folder-picker-verified"
  | "folder-picker-opened"
  | "file-accessible"
  | "permission-denied"
  | "unsupported"
  | "cancelled"
  | "missing-handle"

export interface RevealSourceResult {
  status: RevealSourceStatus
  message: string
  verified: boolean
  permission?: PermissionState
  directoryName?: string
  directoryHandle?: SourceDirectoryHandleLike
  verifiedAt?: number
}

export interface RevealSourceEnvironment {
  showDirectoryPicker?: (options: {
    id?: string
    mode?: "read" | "readwrite"
    startIn?: SourceFileHandleLike | string
  }) => Promise<SourceDirectoryHandleLike>
}

function fileKindLabel(kind: SourceFileKind | undefined) {
  if (kind === "project") return "Project"
  if (kind === "psd") return "PSD/PSB"
  if (kind === "image") return "Image"
  return "Document"
}

function storageLabel(storage: SourceStorageKind | undefined) {
  if (storage === "file-system-access") return "File System Access handle"
  if (storage === "opened-file") return "Opened browser file"
  if (storage === "download") return "Browser download"
  if (storage === "snapshot") return "Recovered snapshot"
  return "Unsaved document"
}

function formatBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return ""
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatTimestamp(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return ""
  return new Date(value).toLocaleString()
}

function cleanRows(rows: [string, string | undefined | null][]): [string, string][] {
  return rows
    .map(([label, value]) => [label, typeof value === "string" ? value : ""] as [string, string])
    .filter(([, value]) => value.length > 0)
}

function handleName(handle: SourceFileHandleLike | null | undefined) {
  return handle?.name?.trim() || ""
}

export function sourceInfoForDocument(
  doc: Pick<PsDocument, "name" | "metadata">,
  lifecycle?: SourceDocumentLifecycleLike,
): SourceLocationInfo {
  const handle = lifecycle?.fileHandle ?? undefined
  const handleLabel = handleName(handle)
  const primaryName = lifecycle?.fileName || handleLabel || doc.metadata?.source || doc.name
  const canReveal = !!handle
  const pathLabel = canReveal ? "Absolute path not exposed by browser" : "No browser file handle"
  const unavailableReason = canReveal
    ? undefined
    : "This document was not opened or saved through a reusable browser file handle."

  return {
    title: "Document Source",
    primaryName,
    storageLabel: storageLabel(lifecycle?.storage),
    handleLabel: handleLabel || "None",
    pathLabel,
    canReveal,
    unavailableReason,
    fileHandle: handle,
    rows: cleanRows([
      ["File Name", primaryName],
      ["File Kind", fileKindLabel(lifecycle?.fileKind)],
      ["Storage", storageLabel(lifecycle?.storage)],
      ["Browser Handle", handleLabel || "None"],
      ["Location", pathLabel],
      ["Metadata Source", doc.metadata?.source],
      ["Last Saved", formatTimestamp(lifecycle?.savedAt)],
      ["Note", lifecycle?.lastSaveNote],
    ]),
  }
}

export function sourceInfoForSmartObject(layer: Pick<Layer, "name" | "kind" | "smartObject" | "smartSource">): SourceLocationInfo {
  const source = layer.smartSource
  const handle = source?.fileHandle as SourceFileHandleLike | undefined
  const handleLabel = source?.fileHandleName || handleName(handle)
  const primaryName = source?.fileName || handleLabel || source?.name || layer.name
  const isLinked = source?.linkType === "linked"
  const canReveal = !!handle
  const pathLabel = canReveal ? "Absolute path not exposed by browser" : "No browser file handle"
  const unavailableReason = canReveal
    ? undefined
    : isLinked
      ? "Relink this smart object through the browser file picker to attach a reusable handle."
      : "Embedded smart object sources do not have a containing local folder."

  return {
    title: isLinked ? "Linked Smart Object Source" : "Embedded Smart Object Source",
    primaryName,
    storageLabel: isLinked && handle ? "Linked file handle" : isLinked ? "Linked metadata" : "Embedded source",
    handleLabel: handleLabel || "None",
    pathLabel,
    canReveal,
    unavailableReason,
    fileHandle: handle,
    rows: cleanRows([
      ["Layer", layer.name],
      ["File Name", primaryName],
      ["Link Type", source?.linkType ?? (layer.smartObject || layer.kind === "smart-object" ? "embedded" : "none")],
      ["Status", source?.status],
      ["Browser Handle", handleLabel || "None"],
      ["Permission", source?.handlePermission],
      ["Relative Path", source?.relativePath],
      ["Location", pathLabel],
      ["Last Known Size", formatBytes(source?.lastKnownSize)],
      ["Last Modified", formatTimestamp(source?.lastKnownModified)],
    ]),
  }
}

/**
 * Build a best-effort path-like string the user can copy. Browsers do not
 * expose absolute paths via the File System Access API, so we combine the
 * directory name (if a parent directory handle was granted) with the file
 * name, falling back to the file name alone.
 */
export function bestEffortPathString(
  fileName: string | undefined,
  directoryName?: string,
): string {
  const name = fileName?.trim() ?? ""
  const dir = directoryName?.trim() ?? ""
  if (!name && !dir) return ""
  if (!dir) return name
  if (!name) return `${dir}/`
  return `${dir}/${name}`
}

async function readPermission(handle: SourceFileHandleLike): Promise<PermissionState> {
  const descriptor = { mode: "read" as const }
  let permission: PermissionState = "granted"
  if (typeof handle.queryPermission === "function") {
    permission = await handle.queryPermission(descriptor)
  }
  if (permission === "prompt" && typeof handle.requestPermission === "function") {
    permission = await handle.requestPermission(descriptor)
  }
  return permission
}

function isAbort(error: unknown) {
  return typeof error === "object" && error != null && "name" in error && (error as { name?: string }).name === "AbortError"
}

async function pickDirectory(
  env: RevealSourceEnvironment,
  handle: SourceFileHandleLike,
): Promise<SourceDirectoryHandleLike> {
  const picker = env.showDirectoryPicker
  if (!picker) throw new Error("Directory picker unavailable")
  try {
    return await picker({ id: "ps-source-folder", mode: "read", startIn: handle })
  } catch (error) {
    if (isAbort(error)) throw error
    return picker({ id: "ps-source-folder", mode: "read" })
  }
}

async function verifyDirectoryContainsHandle(directory: SourceDirectoryHandleLike, handle: SourceFileHandleLike) {
  if (typeof directory.getFileHandle !== "function") return false
  try {
    const sibling = await directory.getFileHandle(handle.name)
    if (typeof handle.isSameEntry === "function") return handle.isSameEntry(sibling as unknown as FileSystemHandle)
    return sibling.name === handle.name
  } catch {
    return false
  }
}

export async function revealSourceInBrowser(
  handle: SourceFileHandleLike | null | undefined,
  env: RevealSourceEnvironment = typeof window === "undefined"
    ? {}
    : (window as unknown as RevealSourceEnvironment),
): Promise<RevealSourceResult> {
  if (!handle) {
    return {
      status: "missing-handle",
      verified: false,
      message: "No browser file handle is attached to this source.",
    }
  }

  let permission: PermissionState
  try {
    permission = await readPermission(handle)
  } catch {
    permission = "denied"
  }
  if (permission === "denied") {
    return {
      status: "permission-denied",
      verified: false,
      permission,
      message: `Permission denied for ${handle.name}.`,
    }
  }

  if (typeof env.showDirectoryPicker === "function") {
    try {
      const directory = await pickDirectory(env, handle)
      const verified = await verifyDirectoryContainsHandle(directory, handle)
      return {
        status: verified ? "folder-picker-verified" : "folder-picker-opened",
        verified,
        permission,
        directoryName: directory.name,
        directoryHandle: directory,
        verifiedAt: verified ? Date.now() : undefined,
        message: verified
          ? `Opened and verified a folder containing ${handle.name}.`
          : `Opened a browser folder picker for ${handle.name}. The browser does not expose an absolute path.`,
      }
    } catch (error) {
      if (isAbort(error)) {
        return {
          status: "cancelled",
          verified: false,
          permission,
          message: "Folder reveal was cancelled.",
        }
      }
      return {
        status: "unsupported",
        verified: false,
        permission,
        message: "This browser could not open a source folder picker.",
      }
    }
  }

  if (typeof handle.getFile === "function") {
    try {
      await handle.getFile()
      return {
        status: "file-accessible",
        verified: false,
        permission,
        verifiedAt: Date.now(),
        message: `The browser can access ${handle.name}, but cannot reveal its containing folder.`,
      }
    } catch {
      return {
        status: "unsupported",
        verified: false,
        permission,
        message: `The browser cannot reveal or refresh ${handle.name}.`,
      }
    }
  }

  return {
    status: "unsupported",
    verified: false,
    permission,
    message: "This browser does not expose a folder reveal workflow for file handles.",
  }
}
