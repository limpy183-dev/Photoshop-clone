import { expect, test } from "@playwright/test"

import {
  currentHistoryIndex,
  currentHistoryIndexFromHistories,
  dirtyDocIdsForAction,
  documentLifecycleFor,
  documentLifecycleForSlices,
  isDocumentDirtyInState,
  makeDocumentLifecycle,
  withDocumentLifecyclePatch,
  type EditorDocumentLifecycleState,
} from "../components/photoshop/editor-document-lifecycle"

const docA = { id: "doc-a", name: "A.psprojson" }
const docB = { id: "doc-b", name: "B.psprojson" }

function state(overrides: Partial<{
  documents: typeof docA[]
  histories: Record<string, { index: number }>
  documentLifecycle: Record<string, EditorDocumentLifecycleState>
  activeDocId: string | null
}> = {}) {
  return {
    documents: [docA, docB],
    histories: {
      [docA.id]: { index: 3 },
      [docB.id]: { index: 1 },
    },
    documentLifecycle: {},
    activeDocId: docA.id,
    ...overrides,
  }
}

test("creates default lifecycle state from document identity and patch", () => {
  expect(makeDocumentLifecycle(docA, 7, { storage: "opened-file", dirty: true })).toEqual({
    dirty: true,
    savedHistoryIndex: 7,
    storage: "opened-file",
    fileName: "A.psprojson",
  })
})

test("resolves current history indexes with existing fallback", () => {
  const s = state()

  expect(currentHistoryIndexFromHistories(s.histories, docA.id)).toBe(3)
  expect(currentHistoryIndexFromHistories(s.histories, "missing")).toBe(0)
  expect(currentHistoryIndex(s, docB.id)).toBe(1)
})

test("resolves lifecycle from stored state or history fallback", () => {
  const stored = makeDocumentLifecycle(docA, 2, { dirty: true, fileName: "stored.psd" })
  const s = state({ documentLifecycle: { [docA.id]: stored } })

  expect(documentLifecycleForSlices(s.documentLifecycle, s.histories, docA)).toBe(stored)
  expect(documentLifecycleFor(s, docB)).toEqual({
    dirty: false,
    savedHistoryIndex: 1,
    storage: "new",
    fileName: "B.psprojson",
  })
})

test("derives dirty state from explicit flag and saved history index", () => {
  expect(isDocumentDirtyInState(state(), docA.id)).toBe(false)
  expect(isDocumentDirtyInState(state({ documentLifecycle: { [docA.id]: makeDocumentLifecycle(docA, 2) } }), docA.id)).toBe(true)
  expect(isDocumentDirtyInState(state({ documentLifecycle: { [docA.id]: makeDocumentLifecycle(docA, 3) } }), docA.id)).toBe(false)
  expect(isDocumentDirtyInState(state({ documentLifecycle: { [docA.id]: makeDocumentLifecycle(docA, 3, { dirty: true }) } }), docA.id)).toBe(true)
  expect(isDocumentDirtyInState(state(), "missing")).toBe(false)
})

test("patches lifecycle only for existing documents", () => {
  const s = state()
  const patched = withDocumentLifecyclePatch(s, docB.id, { dirty: true, savedAt: 123 })

  expect(patched).not.toBe(s)
  expect(patched.documentLifecycle[docB.id]).toMatchObject({
    dirty: true,
    savedAt: 123,
    savedHistoryIndex: 1,
    fileName: "B.psprojson",
  })
  expect(withDocumentLifecyclePatch(s, "missing", { dirty: true })).toBe(s)
})

test("routes dirty document ids for special document-scoped actions", () => {
  const s = state()

  expect(dirtyDocIdsForAction({ type: "move-layers-to-document", sourceDocId: docA.id, targetDocId: docB.id }, s)).toEqual([docA.id, docB.id])
  expect(dirtyDocIdsForAction({ type: "move-layers-to-document", sourceDocId: docA.id, targetDocId: docB.id, copy: true }, s)).toEqual([docB.id])
  expect(dirtyDocIdsForAction({ type: "update-smart-object-parent", parentDocId: docB.id }, s)).toEqual([docB.id])
  expect(dirtyDocIdsForAction({ type: "apply-linked-smart-object-sync", docId: docB.id }, s)).toEqual([docB.id])
  expect(dirtyDocIdsForAction({ type: "save-selection", targetDocId: docB.id }, s)).toEqual([docB.id])
  expect(dirtyDocIdsForAction({ type: "update-channel" }, s)).toEqual([docA.id])
})

test("routes configured document dirty actions to the active document only", () => {
  expect(dirtyDocIdsForAction({ type: "set-layer-opacity" }, state())).toEqual([docA.id])
  expect(dirtyDocIdsForAction({ type: "set-tool" }, state())).toEqual([])
  expect(dirtyDocIdsForAction({ type: "set-layer-opacity" }, state({ activeDocId: null }))).toEqual([])
})

test("routes plugin storage changes as active document mutations", () => {
  const before = state()
  const after = state({
    documents: [{ ...docA }, docB],
  })

  expect(dirtyDocIdsForAction({ type: "set-plugin-storage" }, before, after)).toEqual([docA.id])
})

test("does not dirty routed documents when reducer leaves document identity unchanged", () => {
  const before = state()
  const after = state({
    documents: before.documents,
  })

  expect(dirtyDocIdsForAction({ type: "remove-layer" }, before, after)).toEqual([])
})
