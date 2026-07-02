import { expect, test } from "@playwright/test"

import {
  runEditorTransitionEffects,
  transitionEditorState,
  type EditorTransitionEffect,
} from "../components/photoshop/editor-context"
import type { HistoryEntry, PsDocument } from "../components/photoshop/types"
import { fixtureCanvas, installFixtureDom } from "./photoshop-fixtures"

function entry(id: string): HistoryEntry {
  return {
    id,
    label: id,
    layers: [
      {
        id: `layer-${id}`,
        name: `Layer ${id}`,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: fixtureCanvas(2, 2),
      },
    ],
    activeLayerId: `layer-${id}`,
    selectedLayerIds: [`layer-${id}`],
  }
}

function document(id = "doc-1"): PsDocument {
  const layerCanvas = fixtureCanvas(2, 2)
  return {
    id,
    name: "Fixture",
    width: 2,
    height: 2,
    zoom: 1,
    layers: [
      {
        id: "layer-live",
        name: "Layer",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: layerCanvas,
      },
    ],
    activeLayerId: "layer-live",
    selectedLayerIds: ["layer-live"],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
  }
}

function stateWithHistory(entries: HistoryEntry[], index: number) {
  const doc = document()
  return {
    documents: [doc],
    activeDocId: doc.id,
    histories: { [doc.id]: { entries, index } },
    snapshots: {},
    documentLifecycle: {},
    closedDocuments: [],
  }
}

test.beforeEach(() => {
  installFixtureDom()
})

test("push-history returns release and compression effects separately from state", () => {
  const current = entry("current")
  const redo = entry("redo")
  const nextEntry = entry("next")
  const result = transitionEditorState(
    stateWithHistory([current, redo], 0) as never,
    { type: "push-history", entry: nextEntry } as never,
  )

  expect(result.state.histories["doc-1"].entries).toEqual([current, nextEntry])
  expect(result.effects).toEqual([
    { type: "release-history-entries", entries: [redo] },
  ] satisfies EditorTransitionEffect[])
})

test("history transition effect runner delegates side effects exactly once", () => {
  const entries = Array.from({ length: 14 }, (_, index) => entry(`entry-${index}`))
  const result = transitionEditorState(
    stateWithHistory(entries.slice(0, 13), 12) as never,
    { type: "push-history", entry: entries[13] } as never,
  )
  const calls: string[] = []

  runEditorTransitionEffects(result.effects, {
    releaseEntries: (released) => calls.push(`release:${released.map((item) => item.id).join(",")}`),
    scheduleCompression: (scheduled, index) => calls.push(`compress:${scheduled.length}:${index}`),
  })

  expect(calls).toEqual(["compress:14:13"])
})

test("document lifecycle transitions replay deterministically with fixed services", () => {
  const initial = stateWithHistory([entry("current")], 0)
  const services = {
    makeId: (prefix: string) => `${prefix}-fixed`,
    now: () => 1_234,
  }

  const first = transitionEditorState(
    initial as never,
    { type: "close-document", id: "doc-1" } as never,
    services as never,
  )
  const second = transitionEditorState(
    initial as never,
    { type: "close-document", id: "doc-1" } as never,
    services as never,
  )

  expect(first).toEqual(second)
  expect(first.state.closedDocuments[0]).toMatchObject({
    id: "closed-fixed",
    closedAt: 1_234,
  })
})
