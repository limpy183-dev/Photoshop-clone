import { expect, test } from "@playwright/test"
import { makeHistoryEntry, restoreFromEntry } from "@/editor/history-state"
import { initialState } from "@/editor/initial-state"
import { reducer } from "@/editor/reducer"
import type { EditorState } from "@/components/photoshop/editor/context"
import type { ChangedLayerIds } from "@/editor/history-geometry"
import type { Action } from "@/editor/reducer-model"
import type { Layer } from "@/editor/types"

/**
 * Structural undo/redo over a grouped layer tree. Pixels are out of scope here
 * (the node lane has no 2D context) — what this guards is the layer *tree*:
 * deleting a folder must take its children with it, and every history step must
 * round-trip the exact tree it was taken from.
 */
function harness() {
  let state: EditorState = initialState
  const docOf = () => state.documents.find((d) => d.id === state.activeDocId)!
  const run = (a: Action) => { state = reducer(state, a) }
  const commit = (label: string, ids?: ChangedLayerIds) => {
    const doc = docOf()
    const history = state.histories[doc.id]
    run({ type: "push-history", entry: makeHistoryEntry(doc, label, history?.entries[history.index], ids) })
  }
  const jump = (delta: number) => {
    const doc = docOf()
    const history = state.histories[doc.id]
    const index = history.index + delta
    const entry = history.entries[index]
    run({
      type: "restore-history",
      index,
      entry,
      restoredLayers: restoreFromEntry(doc, entry, {
        currentEntry: history.entries[history.index],
        direction: delta < 0 ? "undo" : "redo",
      }),
      activeLayerId: entry.activeLayerId,
      selectedLayerIds: entry.selectedLayerIds,
    })
  }
  const addLayer = (id: string, name: string) => {
    const doc = docOf()
    run({
      type: "add-layer",
      layer: {
        id, name, kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal",
        canvas: { width: doc.width, height: doc.height, getContext: () => null } as unknown as HTMLCanvasElement,
      } satisfies Layer,
    })
    commit("New Layer", [id])
  }
  // Layer id + its parent, which is the whole point: an orphan is a layer whose
  // parentId names a group that is no longer in the document.
  const tree = () => docOf().layers.map((l) => `${l.id}${l.parentId ? `<${l.parentId}` : ""}`).join(" ")
  return { addLayer, commit, docOf, jump, run, tree, state: () => state }
}

test("deleting a folder deletes its contents", () => {
  const h = harness()
  h.commit("Open", "all")
  h.addLayer("A", "A")
  h.addLayer("B", "B")
  h.run({ type: "set-selected-layers", ids: ["A", "B"], activeId: "B" })
  h.run({ type: "group-selected", groupId: "G" })
  h.commit("New Group", ["G", "A", "B"])
  expect(h.tree()).toBe("layer_background layer_initial A<G B<G G")

  h.run({ type: "remove-layer", id: "G" })
  h.commit("Delete Layer", [])

  expect(h.tree()).toBe("layer_background layer_initial")
  expect(h.docOf().layers.some((l) => l.id === h.docOf().activeLayerId)).toBe(true)
})

test("undo/redo round-trips every step of a grouped edit sequence", () => {
  const h = harness()
  h.commit("Open", "all")
  h.addLayer("A", "A")
  h.addLayer("B", "B")
  h.run({ type: "set-selected-layers", ids: ["A", "B"], activeId: "B" })
  h.run({ type: "group-selected", groupId: "G" })
  h.commit("New Group", ["G", "A", "B"])
  h.addLayer("C", "C")
  h.run({ type: "reorder-layer", id: "C", targetId: "G", position: "into" })
  h.commit("Reorder Layer", [])
  h.run({ type: "remove-layer", id: "A" })
  h.commit("Delete Layer", [])
  h.run({ type: "remove-layer", id: "G" })
  h.commit("Delete Layer", [])

  // Walk back to the floor recording the tree at each index, then replay
  // forward and require the same trees in the same order.
  const seen: string[] = [h.tree()]
  const steps = h.state().histories[h.docOf().id].index
  for (let i = 0; i < steps; i += 1) {
    h.jump(-1)
    seen.unshift(h.tree())
  }
  const replayed: string[] = [h.tree()]
  for (let i = 0; i < steps; i += 1) {
    h.jump(1)
    replayed.push(h.tree())
  }

  expect(replayed).toEqual(seen)
  // No step may leave a layer parented to a group that is not in the document.
  for (const snapshot of seen) {
    const ids = new Set(snapshot.split(" ").map((token) => token.split("<")[0]))
    for (const token of snapshot.split(" ")) {
      const parent = token.split("<")[1]
      if (parent) expect(ids.has(parent)).toBe(true)
    }
  }
})
