import type {
  BrushSettings,
  EraserSettings,
  GradientSettings,
  Layer,
  PsDocument,
  SymmetrySettings,
  ToolId,
} from "./types"

export interface EditorDocumentState {
  documents: PsDocument[]
  activeDocId: string | null
}

interface EditorSelectorState extends EditorDocumentState {
  tool: ToolId
  brush: BrushSettings
  gradient: GradientSettings
  eraser: EraserSettings
  symmetry: SymmetrySettings
  foreground: string
  background: string
  histories: Record<string, unknown>
}

export const selectDocuments = (state: EditorDocumentState) => state.documents
export const selectActiveDocumentId = (state: EditorDocumentState) => state.activeDocId
export const selectActiveDocument = (state: EditorDocumentState): PsDocument | null =>
  state.documents.find((document) => document.id === state.activeDocId) ?? null
export const selectActiveLayer = (document: PsDocument | null): Layer | null =>
  document?.layers.find((layer) => layer.id === document.activeLayerId) ?? null
export const selectSelectedLayers = (document: PsDocument | null): Layer[] => {
  if (!document) return []
  const ids = new Set(document.selectedLayerIds)
  return document.layers.filter((layer) => ids.has(layer.id))
}
export const selectVisibleLayers = (document: PsDocument | null): Layer[] =>
  document?.layers.filter((layer) => layer.visible) ?? []
export const selectActiveHistory = (state: EditorSelectorState) =>
  state.activeDocId ? state.histories[state.activeDocId] : undefined
let toolInputs: [ToolId, BrushSettings, GradientSettings, EraserSettings] | undefined
let toolValue: {
  tool: ToolId
  brush: BrushSettings
  gradient: GradientSettings
  eraser: EraserSettings
}
export const selectToolSettings = (state: EditorSelectorState) => {
  const next: typeof toolInputs = [state.tool, state.brush, state.gradient, state.eraser]
  if (!toolInputs || next.some((value, index) => !Object.is(value, toolInputs?.[index]))) {
    toolInputs = next
    toolValue = { tool: state.tool, brush: state.brush, gradient: state.gradient, eraser: state.eraser }
  }
  return toolValue
}

let persistenceInputs:
  | [string, string, BrushSettings, GradientSettings, SymmetrySettings]
  | undefined
let persistenceValue: {
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  symmetry: SymmetrySettings
}
export const selectPersistenceState = (state: EditorSelectorState) => {
  const next: typeof persistenceInputs = [
    state.foreground,
    state.background,
    state.brush,
    state.gradient,
    state.symmetry,
  ]
  if (!persistenceInputs || next.some((value, index) => !Object.is(value, persistenceInputs?.[index]))) {
    persistenceInputs = next
    persistenceValue = {
      foreground: state.foreground,
      background: state.background,
      brush: state.brush,
      gradient: state.gradient,
      symmetry: state.symmetry,
    }
  }
  return persistenceValue
}
export const selectRenderingDocument = selectActiveDocument
export const selectPanelLayer = (state: EditorDocumentState): Layer | null => {
  const document = selectActiveDocument(state)
  return selectActiveLayer(document)
}

export function memoizeEditorSelector<TState, T>(selector: (state: TState) => T) {
  let previousState: TState | undefined
  let previousValue: T
  return (state: TState) => {
    if (state === previousState) return previousValue
    const nextValue = selector(state)
    previousState = state
    previousValue = nextValue
    return nextValue
  }
}
