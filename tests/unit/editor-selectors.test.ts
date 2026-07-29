import { describe, expect, it } from "vitest"
import {
  memoizeEditorSelector,
  selectActiveDocument,
  selectActiveLayer,
  selectPersistenceState,
  selectSelectedLayers,
  selectToolSettings,
} from "@/components/photoshop/editor-selectors"
import type { Layer, PsDocument } from "@/components/photoshop/types"

// These selectors run on the editor's hottest path: every store notification
// re-runs them, and their return identity decides whether consumers re-render
// under Object.is equality. The fixtures below only need the fields the
// selectors actually read, so they are built structurally and narrowed rather
// than constructed as complete documents.

type ToolSettingsState = Parameters<typeof selectToolSettings>[0]
type PersistenceState = Parameters<typeof selectPersistenceState>[0]

function makeLayer(id: string): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
  } as unknown as Layer
}

function makeDocument(
  id: string,
  layers: Layer[],
  options: { activeLayerId?: string; selectedLayerIds?: string[] } = {},
): PsDocument {
  return {
    id,
    name: id,
    width: 8,
    height: 8,
    zoom: 1,
    layers,
    activeLayerId: options.activeLayerId ?? layers[0]?.id ?? null,
    selectedLayerIds: options.selectedLayerIds ?? [],
    background: "#ffffff",
  } as unknown as PsDocument
}

function makeToolState(patch: Record<string, unknown> = {}): ToolSettingsState {
  return {
    documents: [],
    activeDocId: null,
    tool: "brush",
    brush: { size: 10 },
    gradient: { type: "linear" },
    eraser: { size: 5 },
    symmetry: { enabled: false },
    foreground: "#000000",
    background: "#ffffff",
    histories: {},
    ...patch,
  } as unknown as ToolSettingsState
}

describe("selectActiveDocument / selectActiveLayer", () => {
  it("resolves the active document and its active layer", () => {
    const first = makeDocument("doc-1", [makeLayer("a"), makeLayer("b")], { activeLayerId: "b" })
    const second = makeDocument("doc-2", [makeLayer("c")])
    const state = { documents: [first, second], activeDocId: "doc-1" }

    expect(selectActiveDocument(state)).toBe(first)
    expect(selectActiveLayer(selectActiveDocument(state))?.id).toBe("b")
  })

  it("returns null when there is no active document or matching layer", () => {
    expect(selectActiveDocument({ documents: [], activeDocId: null })).toBeNull()
    expect(selectActiveDocument({ documents: [], activeDocId: "missing" })).toBeNull()
    expect(selectActiveLayer(null)).toBeNull()

    const orphaned = makeDocument("doc-1", [makeLayer("a")], { activeLayerId: "gone" })
    expect(selectActiveLayer(orphaned)).toBeNull()
  })
})

describe("selectSelectedLayers", () => {
  it("returns the selected layers in document layer order", () => {
    const document = makeDocument("doc-1", [makeLayer("a"), makeLayer("b"), makeLayer("c")], {
      selectedLayerIds: ["c", "a"],
    })

    expect(selectSelectedLayers(document).map((layer) => layer.id)).toEqual(["a", "c"])
  })

  it("returns an empty list for a missing document", () => {
    expect(selectSelectedLayers(null)).toEqual([])
  })

  it("is identity-stable for the same document", () => {
    // The projection re-reads selected layers on every notification. Allocating
    // a fresh array per call made every consumer of `selectedLayers` compare
    // unequal and re-render, even when the document had not changed.
    const document = makeDocument("doc-1", [makeLayer("a"), makeLayer("b")], {
      selectedLayerIds: ["b"],
    })

    expect(selectSelectedLayers(document)).toBe(selectSelectedLayers(document))
  })

  it("recomputes for a new document object", () => {
    const layers = [makeLayer("a"), makeLayer("b")]
    const before = makeDocument("doc-1", layers, { selectedLayerIds: ["a"] })
    const after = makeDocument("doc-1", layers, { selectedLayerIds: ["a", "b"] })

    expect(selectSelectedLayers(before).map((layer) => layer.id)).toEqual(["a"])
    expect(selectSelectedLayers(after).map((layer) => layer.id)).toEqual(["a", "b"])
  })
})

describe("selectToolSettings", () => {
  it("projects the tool slice", () => {
    const brush = { size: 24 }
    const state = makeToolState({ tool: "eraser", brush })
    const selected = selectToolSettings(state)

    expect(selected.tool).toBe("eraser")
    expect(selected.brush).toBe(brush)
  })

  it("is identity-stable for the same snapshot", () => {
    const state = makeToolState()

    expect(selectToolSettings(state)).toBe(selectToolSettings(state))
  })

  it("does not thrash when snapshots with different inputs are interleaved", () => {
    // Regression guard. This selector used to memoise into a single
    // module-level slot shared by every caller. React's own
    // useSyncExternalStore consistency checks call selectors with different
    // snapshots inside one tick, which evicted that slot and handed back a
    // brand new object identity each time a snapshot was revisited - defeating
    // Object.is equality and forcing a re-render on every notification.
    const first = makeToolState({ brush: { size: 4 } })
    const second = makeToolState({ brush: { size: 64 } })

    const firstSelection = selectToolSettings(first)
    const secondSelection = selectToolSettings(second)
    expect(secondSelection).not.toBe(firstSelection)

    expect(selectToolSettings(first)).toBe(firstSelection)
    expect(selectToolSettings(second)).toBe(secondSelection)
    expect(selectToolSettings(first)).toBe(firstSelection)
  })

  it("reuses the previous selection when a new snapshot carries the same slices", () => {
    const shared = {
      tool: "brush",
      brush: { size: 12 },
      gradient: { type: "radial" },
      eraser: { size: 3 },
    }
    const before = makeToolState(shared)
    const after = makeToolState(shared)

    expect(selectToolSettings(after)).toBe(selectToolSettings(before))
  })
})

describe("selectPersistenceState", () => {
  it("projects the persisted slice", () => {
    const symmetry = { enabled: true }
    const state = makeToolState({ foreground: "#112233", symmetry }) as unknown as PersistenceState
    const selected = selectPersistenceState(state)

    expect(selected.foreground).toBe("#112233")
    expect(selected.symmetry).toBe(symmetry)
  })

  it("is identity-stable and does not thrash across interleaved snapshots", () => {
    const first = makeToolState({ foreground: "#000000" }) as unknown as PersistenceState
    const second = makeToolState({ foreground: "#ffffff" }) as unknown as PersistenceState

    const firstSelection = selectPersistenceState(first)
    const secondSelection = selectPersistenceState(second)

    expect(secondSelection).not.toBe(firstSelection)
    expect(selectPersistenceState(first)).toBe(firstSelection)
    expect(selectPersistenceState(second)).toBe(secondSelection)
  })
})

describe("memoizeEditorSelector", () => {
  it("computes once per state object, including when states are interleaved", () => {
    let calls = 0
    const select = memoizeEditorSelector((state: { value: number }) => {
      calls += 1
      return { doubled: state.value * 2 }
    })

    const first = { value: 1 }
    const second = { value: 2 }

    const firstSelection = select(first)
    expect(firstSelection.doubled).toBe(2)
    expect(select(first)).toBe(firstSelection)
    expect(calls).toBe(1)

    const secondSelection = select(second)
    expect(secondSelection.doubled).toBe(4)
    expect(calls).toBe(2)

    // Revisiting the first state must not recompute or hand back a new identity.
    expect(select(first)).toBe(firstSelection)
    expect(calls).toBe(2)
  })

  it("still works for primitive state values", () => {
    let calls = 0
    const select = memoizeEditorSelector((state: number) => {
      calls += 1
      return state + 1
    })

    expect(select(1)).toBe(2)
    expect(select(1)).toBe(2)
    expect(calls).toBe(1)
    expect(select(2)).toBe(3)
    expect(calls).toBe(2)
  })
})
