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

export function projectEditorContextValue(
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
