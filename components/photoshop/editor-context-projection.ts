import type { EditorContextValue } from "./editor-context-contract"
import {
  currentHistoryIndexFromHistories,
  documentLifecycleForSlices,
} from "./editor-document-lifecycle"
import { EMPTY_HISTORY, EMPTY_SNAPSHOTS } from "./editor-history-state"
import type { DocumentLifecycleState, EditorState } from "./editor-reducer"
import {
  selectActiveDocument,
  selectActiveLayer,
  selectSelectedLayers,
} from "./editor-selectors"

function computeEditorContextProjection(
  state: EditorState,
  base: EditorContextValue,
): EditorContextValue {
  const activeDoc = selectActiveDocument(state)
  const activeLayer = selectActiveLayer(activeDoc)
  const history = activeDoc ? state.histories[activeDoc.id] ?? EMPTY_HISTORY : EMPTY_HISTORY
  const snapshots = activeDoc ? state.snapshots[activeDoc.id] ?? EMPTY_SNAPSHOTS : EMPTY_SNAPSHOTS
  const documentStatuses: Record<string, DocumentLifecycleState> = {}
  const documentHistoryVersions: Record<string, number> = {}
  for (const document of state.documents) {
    const lifecycle = documentLifecycleForSlices(
      state.documentLifecycle,
      state.histories,
      document,
    )
    const historyIndex = currentHistoryIndexFromHistories(state.histories, document.id)
    documentStatuses[document.id] = {
      ...lifecycle,
      dirty: lifecycle.dirty || lifecycle.savedHistoryIndex !== historyIndex,
    }
    documentHistoryVersions[document.id] = historyIndex
  }

  return {
    ...base,
    documents: state.documents,
    activeDocId: state.activeDocId,
    tool: state.tool,
    foreground: state.foreground,
    background: state.background,
    brush: state.brush,
    gradient: state.gradient,
    paintBucket: state.paintBucket,
    eraser: state.eraser,
    cloneSource: state.cloneSource,
    symmetry: state.symmetry,
    selectionOptions: state.selectionOptions,
    transform: state.transform,
    brushPresets: state.brushPresets,
    history: history.entries,
    historyIndex: history.index,
    snapshots,
    closedDocuments: state.closedDocuments.map((record) => ({
      id: record.id,
      name: record.doc.name,
      width: record.doc.width,
      height: record.doc.height,
      closedAt: record.closedAt,
    })),
    documentStatuses,
    documentHistoryVersions,
    actions: state.actions,
    recordingActionId: state.recordingActionId,
    isPlayingAction: state.isPlayingAction,
    activeSmartFilterMaskTarget: state.activeSmartFilterMaskTarget,
    activeDoc,
    activeLayer,
    selectedLayers: selectSelectedLayers(activeDoc),
    clipboard: state.clipboard,
    styleClipboard: state.styleClipboard,
  }
}

// The projection is a pure function of the immutable reducer snapshot plus the
// provider's base context value, but it is far from free: it walks every
// document, recomputes lifecycle/history bookkeeping for each one, and
// allocates a fresh ~40-key object.
//
// `useEditorSelector` calls this from inside its `getSnapshot`. React invokes
// `getSnapshot` several times per render (and once per subscriber per store
// notification), so a single dispatch used to fan out into dozens of full
// projections. Worse, every call produced fresh `documentStatuses`,
// `selectedLayers` and `closedDocuments` identities, so selectors that derive
// objects from the projection (for example `useDocumentLifecycle`) compared
// unequal under `Object.is` on every notification and re-rendered even when
// nothing they actually read had changed.
//
// Memoising on `(state, base)` identity keeps every returned value exactly the
// same while making repeat calls O(1) and identity-stable. Both keys are
// replaced immutably by the reducer/provider, so a cached pair can never go
// stale, and the nested `WeakMap` means neither key is retained once React
// drops it.
const projectionCache = new WeakMap<
  EditorState,
  WeakMap<EditorContextValue, EditorContextValue>
>()

export function projectEditorContextValue(
  state: EditorState,
  base: EditorContextValue,
): EditorContextValue {
  let byBase = projectionCache.get(state)
  if (!byBase) {
    byBase = new WeakMap<EditorContextValue, EditorContextValue>()
    projectionCache.set(state, byBase)
  }
  const cached = byBase.get(base)
  if (cached !== undefined) return cached
  const projected = computeEditorContextProjection(state, base)
  byBase.set(base, projected)
  return projected
}
