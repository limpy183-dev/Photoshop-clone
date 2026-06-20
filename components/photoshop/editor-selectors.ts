import type { Layer, PsDocument } from "./types"

export interface EditorDocumentSlice {
  documents: PsDocument[]
  activeDocId: string | null
}

export function selectActiveDocument(state: EditorDocumentSlice): PsDocument | null {
  return state.documents.find((doc) => doc.id === state.activeDocId) ?? null
}

export function selectActiveLayer(doc: PsDocument | null | undefined): Layer | null {
  if (!doc) return null
  return doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null
}

export function selectSelectedLayers(doc: PsDocument | null | undefined): Layer[] {
  if (!doc) return []
  const ids = new Set(doc.selectedLayerIds)
  return doc.layers.filter((layer) => ids.has(layer.id))
}

export function selectVisibleLayers(doc: PsDocument | null | undefined): Layer[] {
  if (!doc) return []
  return doc.layers.filter((layer) => layer.visible !== false)
}
