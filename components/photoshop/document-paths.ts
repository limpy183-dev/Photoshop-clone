import type { PathProps } from "./types"

export interface DocumentPathRecord {
  id: string
  name: string
  kind: "work" | "saved" | "clipping"
  path: PathProps
  createdAt: number
  updatedAt: number
}

export function createDocumentPath(input: Omit<DocumentPathRecord, "createdAt" | "updatedAt"> & { now?: number }): DocumentPathRecord {
  const now = input.now ?? Date.now()
  return { ...input, createdAt: now, updatedAt: now }
}

export function upsertDocumentPath(paths: readonly DocumentPathRecord[], next: DocumentPathRecord): DocumentPathRecord[] {
  const index = paths.findIndex((path) => path.id === next.id)
  if (index < 0) return [...paths, next]
  return paths.map((path, current) => current === index ? next : path)
}

export function removeDocumentPath(paths: readonly DocumentPathRecord[], id: string): DocumentPathRecord[] {
  return paths.filter((path) => path.id !== id)
}

export function renameDocumentPath(path: DocumentPathRecord, name: string, now = Date.now()): DocumentPathRecord {
  const trimmed = name.trim()
  if (!trimmed) return path
  return { ...path, name: trimmed.slice(0, 120), updatedAt: now }
}
