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

// Selected layers are read on every projection of the editor context, and the
// naive implementation allocated a fresh array each call. Under `Object.is`
// equality that made any selector reading `selectedLayers` re-render on every
// store notification. Documents are replaced immutably by the reducer, so
// caching the derived array per document keeps the contents identical while
// making the identity stable.
const selectedLayersCache = new WeakMap<PsDocument, Layer[]>()
export const selectSelectedLayers = (document: PsDocument | null): Layer[] => {
  if (!document) return []
  const cached = selectedLayersCache.get(document)
  if (cached !== undefined) return cached
  const ids = new Set(document.selectedLayerIds)
  const selected = document.layers.filter((layer) => ids.has(layer.id))
  selectedLayersCache.set(document, selected)
  return selected
}

export const selectVisibleLayers = (document: PsDocument | null): Layer[] =>
  document?.layers.filter((layer) => layer.visible) ?? []
export const selectActiveHistory = (state: EditorSelectorState) =>
  state.activeDocId ? state.histories[state.activeDocId] : undefined

interface ToolSettingsSelection {
  tool: ToolId
  brush: BrushSettings
  gradient: GradientSettings
  eraser: EraserSettings
}

// A single module-level memo slot was shared by every caller of this selector.
// React's own `useSyncExternalStore` consistency checks call selectors with
// different snapshots in the same tick, which thrashed that slot and returned
// a brand new object identity each time - defeating `Object.is` equality and
// forcing a re-render on every notification. Memoising per snapshot removes
// the thrash; the `lastToolSettings` reuse preserves the previous behaviour of
// returning the same identity when the underlying inputs are unchanged.
const toolSettingsByState = new WeakMap<EditorSelectorState, ToolSettingsSelection>()
let lastToolSettings: ToolSettingsSelection | undefined
export const selectToolSettings = (state: EditorSelectorState): ToolSettingsSelection => {
  const cached = toolSettingsByState.get(state)
  if (cached !== undefined) return cached
  let value = lastToolSettings
  if (
    !value ||
    !Object.is(value.tool, state.tool) ||
    !Object.is(value.brush, state.brush) ||
    !Object.is(value.gradient, state.gradient) ||
    !Object.is(value.eraser, state.eraser)
  ) {
    value = {
      tool: state.tool,
      brush: state.brush,
      gradient: state.gradient,
      eraser: state.eraser,
    }
    lastToolSettings = value
  }
  toolSettingsByState.set(state, value)
  return value
}

interface PersistenceSelection {
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  symmetry: SymmetrySettings
}

const persistenceByState = new WeakMap<EditorSelectorState, PersistenceSelection>()
let lastPersistenceState: PersistenceSelection | undefined
export const selectPersistenceState = (state: EditorSelectorState): PersistenceSelection => {
  const cached = persistenceByState.get(state)
  if (cached !== undefined) return cached
  let value = lastPersistenceState
  if (
    !value ||
    !Object.is(value.foreground, state.foreground) ||
    !Object.is(value.background, state.background) ||
    !Object.is(value.brush, state.brush) ||
    !Object.is(value.gradient, state.gradient) ||
    !Object.is(value.symmetry, state.symmetry)
  ) {
    value = {
      foreground: state.foreground,
      background: state.background,
      brush: state.brush,
      gradient: state.gradient,
      symmetry: state.symmetry,
    }
    lastPersistenceState = value
  }
  persistenceByState.set(state, value)
  return value
}

export const selectRenderingDocument = selectActiveDocument
export const selectPanelLayer = (state: EditorDocumentState): Layer | null => {
  const document = selectActiveDocument(state)
  return selectActiveLayer(document)
}

// Keeps the original single-slot fast path but adds a per-state cache so that
// interleaved calls with alternating snapshots stop recomputing (and stop
// returning fresh identities for a snapshot that was already selected).
export function memoizeEditorSelector<TState, T>(selector: (state: TState) => T) {
  const cache = new WeakMap<object, T>()
  let previousState: TState | undefined
  let previousValue: T
  return (state: TState) => {
    if (state === previousState) return previousValue
    const key: object | null =
      typeof state === "object" && state !== null ? (state as unknown as object) : null
    if (key !== null && cache.has(key)) {
      const cachedValue = cache.get(key) as T
      previousState = state
      previousValue = cachedValue
      return cachedValue
    }
    const nextValue = selector(state)
    if (key !== null) cache.set(key, nextValue)
    previousState = state
    previousValue = nextValue
    return nextValue
  }
}
