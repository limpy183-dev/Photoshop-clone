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
