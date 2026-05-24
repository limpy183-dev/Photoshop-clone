export const DEFAULT_AUTOSAVE_LOCAL_STORAGE_LIMIT = 5_000_000

export interface AutosavePlanDocument {
  id: string
  name: string
  version: number
  dirty: boolean
}

export interface AutosavePlanInput {
  documents: readonly AutosavePlanDocument[]
  lastSavedVersions: Record<string, number>
}

export interface AutosavePlan {
  documentsToSerialize: AutosavePlanDocument[]
  nextSavedVersions: Record<string, number>
}

export interface IncrementalAutosaveDocument extends AutosavePlanDocument {
  serializedLength: number
  changedLayerIds?: string[]
}

export interface IncrementalAutosaveManifestEntry {
  version: number
  storage: "inline" | "scratch"
  bytes: number
  changedLayerIds?: string[]
}

export interface IncrementalAutosaveManifest {
  entries: Record<string, IncrementalAutosaveManifestEntry>
}

export interface IncrementalAutosaveWrite {
  id: string
  name: string
  version: number
  storage: "inline" | "scratch"
  serializedLength: number
  changedLayerIds?: string[]
}

export interface IncrementalAutosavePlanInput {
  documents: readonly IncrementalAutosaveDocument[]
  previousManifest?: IncrementalAutosaveManifest
  maxInlineChars?: number
}

export interface IncrementalAutosavePlan {
  documentsToWrite: IncrementalAutosaveWrite[]
  nextManifest: IncrementalAutosaveManifest
  prunedDocumentIds: string[]
}

export function planAutosaveDocuments(input: AutosavePlanInput): AutosavePlan {
  const nextSavedVersions = { ...input.lastSavedVersions }
  const documentsToSerialize: AutosavePlanDocument[] = []

  for (const doc of input.documents) {
    const previousVersion = input.lastSavedVersions[doc.id]
    if (!doc.dirty && previousVersion !== undefined) continue
    if (previousVersion === doc.version) continue
    documentsToSerialize.push(doc)
    nextSavedVersions[doc.id] = doc.version
  }

  return { documentsToSerialize, nextSavedVersions }
}

export function shouldMirrorAutosaveToLocalStorage(
  serializedLength: number,
  maxChars = DEFAULT_AUTOSAVE_LOCAL_STORAGE_LIMIT,
) {
  return serializedLength <= maxChars
}

export function planIncrementalAutosave(input: IncrementalAutosavePlanInput): IncrementalAutosavePlan {
  const maxInlineChars = Math.max(1, Math.round(input.maxInlineChars ?? DEFAULT_AUTOSAVE_LOCAL_STORAGE_LIMIT))
  const previousEntries = input.previousManifest?.entries ?? {}
  const currentIds = new Set(input.documents.map((doc) => doc.id))
  const prunedDocumentIds = Object.keys(previousEntries).filter((id) => !currentIds.has(id)).sort()
  const nextManifest: IncrementalAutosaveManifest = { entries: {} }
  const documentsToWrite: IncrementalAutosaveWrite[] = []

  for (const doc of input.documents) {
    const previous = previousEntries[doc.id]
    const storage: "inline" | "scratch" = shouldMirrorAutosaveToLocalStorage(doc.serializedLength, maxInlineChars)
      ? "inline"
      : "scratch"
    const unchanged = previous && previous.version === doc.version && !doc.dirty
    if (unchanged) {
      nextManifest.entries[doc.id] = previous
      continue
    }

    const write: IncrementalAutosaveWrite = {
      id: doc.id,
      name: doc.name,
      version: doc.version,
      storage,
      serializedLength: doc.serializedLength,
      changedLayerIds: doc.changedLayerIds,
    }
    documentsToWrite.push(write)
    nextManifest.entries[doc.id] = {
      version: doc.version,
      storage,
      bytes: doc.serializedLength,
      changedLayerIds: doc.changedLayerIds,
    }
  }

  return { documentsToWrite, nextManifest, prunedDocumentIds }
}
