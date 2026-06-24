export type EditorDocumentStorageKind = "new" | "download" | "file-system-access" | "opened-file" | "snapshot"
export type EditorDocumentFileKind = "project" | "psd" | "image"

export interface FileSystemWritableFileStreamLike {
  write(data: Blob | string): Promise<void>
  close(): Promise<void>
}

export interface FileSystemFileHandleLike {
  name: string
  createWritable(): Promise<FileSystemWritableFileStreamLike>
  getFile?: () => Promise<File>
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
}

export interface EditorDocumentLifecycleState {
  dirty: boolean
  savedHistoryIndex: number
  savedAt?: number
  fileName?: string
  fileKind?: EditorDocumentFileKind
  storage?: EditorDocumentStorageKind
  fileHandle?: FileSystemFileHandleLike
  lastSaveNote?: string
}

export interface EditorLifecycleDocument {
  id: string
  name: string
}

export type HistoryIndexByDocument = Record<string, { index: number } | undefined>

export interface EditorDocumentLifecycleHost {
  documents: readonly EditorLifecycleDocument[]
  histories: HistoryIndexByDocument
  documentLifecycle: Record<string, EditorDocumentLifecycleState>
  activeDocId: string | null
}

export interface EditorDirtyActionLike {
  type: string
  copy?: boolean
  sourceDocId?: string
  targetDocId?: string
  parentDocId?: string
  docId?: string
}

const DOCUMENT_DIRTY_ACTIONS = new Set([
  "add-layer",
  "remove-layer",
  "duplicate-layer",
  "toggle-layer-visibility",
  "set-layer-visibility",
  "toggle-layer-lock",
  "toggle-layer-clipped",
  "set-layer-opacity",
  "set-layer-fill-opacity",
  "set-layer-blend",
  "set-layer-advanced-blending",
  "set-layer-style",
  "set-layer-mask",
  "set-layer-mask-enabled",
  "set-layer-text",
  "set-layer-shape",
  "set-layer-path",
  "set-layer-kind",
  "set-layer-3d",
  "set-layer-video",
  "set-layer-smart",
  "set-layer-smart-link",
  "set-layer-smart-link-status",
  "apply-linked-smart-object-sync",
  "replace-smart-object-contents",
  "rename-layer",
  "move-layer",
  "merge-down",
  "merge-selected",
  "flatten",
  "flatten-all-layer-effects",
  "flatten-all-masks",
  "delete-empty-layers",
  "rasterize-layers",
  "flatten-transparency",
  "link-selected",
  "unlink-selected",
  "group-selected",
  "ungroup",
  "resize-document",
  "resize-canvas",
  "set-layer-vector-mask",
  "set-layer-adjustment",
  "set-layer-smart-filters",
  "set-style-presets",
  "set-asset-library",
  "set-timeline-frames",
  "set-timeline-settings",
  "set-global-light",
  "set-document-metadata",
  "set-color-management",
  "set-print-settings",
  "set-document-mode-settings",
  "set-plugins",
  "set-plugin-storage",
  "set-variable-data-sets",
  "add-document-report",
  "clear-document-reports",
  "set-layer-color-label",
  "align-layers",
  "distribute-layers",
  "reorder-layer",
  "add-note",
  "update-note",
  "remove-note",
  "add-slice",
  "update-slice",
  "set-active-slice",
  "remove-slice",
  "clear-slices",
  "add-count",
  "remove-count",
  "clear-counts",
  "set-count-group",
  "add-color-sampler",
  "update-color-sampler",
  "remove-color-sampler",
  "clear-color-samplers",
  "save-comp",
  "apply-comp",
  "remove-comp",
  "set-measurement",
  "grow-selection",
  "contract-selection",
  "grow-similar-selection",
  "similar-selection",
  "transform-selection",
  "stamp-visible",
  "toggle-layer-lock-transparency",
  "toggle-layer-lock-draw",
  "toggle-layer-lock-move",
  "toggle-layer-lock-all",
  "feather-selection",
  "border-selection",
  "smooth-selection",
  "save-selection",
  "load-selection",
  "update-channel",
  "delete-channel",
])

export function makeDocumentLifecycle(
  doc: EditorLifecycleDocument,
  savedHistoryIndex = 0,
  patch: Partial<EditorDocumentLifecycleState> = {},
): EditorDocumentLifecycleState {
  return {
    dirty: false,
    savedHistoryIndex,
    storage: "new",
    fileName: doc.name,
    ...patch,
  }
}

export function currentHistoryIndexFromHistories(histories: HistoryIndexByDocument, docId: string) {
  return histories[docId]?.index ?? 0
}

export function currentHistoryIndex(state: Pick<EditorDocumentLifecycleHost, "histories">, docId: string) {
  return currentHistoryIndexFromHistories(state.histories, docId)
}

export function documentLifecycleForSlices(
  documentLifecycle: Record<string, EditorDocumentLifecycleState>,
  histories: HistoryIndexByDocument,
  doc: EditorLifecycleDocument,
) {
  return documentLifecycle[doc.id] ?? makeDocumentLifecycle(doc, currentHistoryIndexFromHistories(histories, doc.id))
}

export function documentLifecycleFor(
  state: Pick<EditorDocumentLifecycleHost, "documentLifecycle" | "histories">,
  doc: EditorLifecycleDocument,
) {
  return documentLifecycleForSlices(state.documentLifecycle, state.histories, doc)
}

export function isDocumentDirtyInState(state: EditorDocumentLifecycleHost, docId: string) {
  const doc = state.documents.find((candidate) => candidate.id === docId)
  if (!doc) return false
  const lifecycle = documentLifecycleFor(state, doc)
  return lifecycle.dirty || lifecycle.savedHistoryIndex !== currentHistoryIndex(state, docId)
}

export function withDocumentLifecyclePatch<T extends Pick<EditorDocumentLifecycleHost, "documents" | "histories" | "documentLifecycle">>(
  state: T,
  docId: string,
  patch: Partial<EditorDocumentLifecycleState>,
): T {
  const doc = state.documents.find((candidate) => candidate.id === docId)
  if (!doc) return state
  return {
    ...state,
    documentLifecycle: {
      ...state.documentLifecycle,
      [docId]: {
        ...documentLifecycleFor(state, doc),
        ...patch,
      },
    },
  }
}

type DirtyRoutingState = Pick<EditorDocumentLifecycleHost, "activeDocId"> & Partial<Pick<EditorDocumentLifecycleHost, "documents">>

function changedDocumentIds(
  docIds: readonly string[],
  before: DirtyRoutingState,
  after?: DirtyRoutingState,
) {
  const unique = [...new Set(docIds)]
  if (!after?.documents || !before.documents) return unique
  return unique.filter((docId) => {
    const beforeDoc = before.documents?.find((doc) => doc.id === docId)
    const afterDoc = after.documents?.find((doc) => doc.id === docId)
    return beforeDoc !== afterDoc
  })
}

export function dirtyDocIdsForAction(
  action: EditorDirtyActionLike,
  state: DirtyRoutingState,
  nextState?: DirtyRoutingState,
) {
  if (action.type === "move-layers-to-document") {
    const ids = action.copy ? [action.targetDocId].filter(Boolean) as string[] : [action.sourceDocId, action.targetDocId].filter(Boolean) as string[]
    return changedDocumentIds(ids, state, nextState)
  }
  if (action.type === "update-smart-object-parent") return action.parentDocId ? changedDocumentIds([action.parentDocId], state, nextState) : []
  if (action.type === "apply-linked-smart-object-sync") return action.docId ? changedDocumentIds([action.docId], state, nextState) : []
  if (action.type === "save-selection" || action.type === "update-channel") {
    const targetId = action.targetDocId ?? state.activeDocId
    return targetId ? changedDocumentIds([targetId], state, nextState) : []
  }
  if (!DOCUMENT_DIRTY_ACTIONS.has(action.type)) return []
  return state.activeDocId ? changedDocumentIds([state.activeDocId], state, nextState) : []
}
