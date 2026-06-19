import { expect, test } from "@playwright/test"

import {
  estimateClipboardPurgeBytes,
  estimateHistoriesPurgeBytes,
  estimateUndoPurgeBytes,
  estimateVideoCachePurgeBytes,
  isCompressedCanvas,
  prepareEntryForRestore,
  purgeFilterPreviewCache,
  scheduleHistoryCompression,
  stripVideoCacheFromDoc,
  stripVideoCacheFromEntry,
  stripVideoCacheFromHistory,
  stripVideoCacheFromSnapshots,
} from "../components/photoshop/editor-history-storage"
import type { HistoryEntry, HistorySnapshot, Layer, PsDocument, TimelineFrame, VideoLayerProps } from "../components/photoshop/types"
import { fixtureCanvas, installFixtureDom } from "./photoshop-fixtures"

function layerSnapshot(id: string, canvas = fixtureCanvas(4, 3)): HistoryEntry["layers"][number] {
  return {
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
  }
}

function historyEntry(id: string, canvas = fixtureCanvas(4, 3)): HistoryEntry {
  return {
    id,
    label: id,
    layers: [layerSnapshot(`layer-${id}`, canvas)],
    activeLayerId: `layer-${id}`,
    selectedLayerIds: [`layer-${id}`],
  }
}

function videoProps(posterDataUrl = "data:image/png;base64,AAAA"): VideoLayerProps {
  return {
    sourceName: "clip.mp4",
    durationMs: 1000,
    currentTimeMs: 0,
    playbackRate: 1,
    inPointMs: 0,
    outPointMs: 1000,
    keyframes: [],
    posterDataUrl,
  }
}

function timelineFrame(thumbnail = "data:image/png;base64,AAAA"): TimelineFrame {
  return {
    id: "frame-1",
    name: "Frame 1",
    durationMs: 100,
    layerVisibility: {},
    thumbnail,
  }
}

function videoLayer(id: string, posterDataUrl = "data:image/png;base64,AAAA"): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(3, 2),
    video: videoProps(posterDataUrl),
  }
}

function documentWithVideo(): PsDocument {
  const layer = videoLayer("layer-video")
  return {
    id: "doc-video",
    name: "Video",
    width: 3,
    height: 2,
    zoom: 1,
    layers: [layer],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    timelineFrames: [timelineFrame()],
  }
}

test.beforeEach(() => {
  installFixtureDom()
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "requestIdleCallback")
  Reflect.deleteProperty(globalThis, "createImageBitmap")
})

test("compresses older history canvases on idle and restores them before history replay", async () => {
  const entries = Array.from({ length: 14 }, (_, index) => {
    const canvas = fixtureCanvas(5, 4)
    canvas.toBlob = (callback: BlobCallback) => callback(new Blob([`blob-${index}`], { type: "image/webp" }))
    return historyEntry(`entry-${index}`, canvas)
  })
  Object.defineProperty(globalThis, "requestIdleCallback", {
    configurable: true,
    value: (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 })
      return 1
    },
  })
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({
      close: () => {},
      fill: "#restored",
    }),
  })

  scheduleHistoryCompression(entries, 13)
  await Promise.resolve()

  const compressed = entries[0].layers[0].canvas
  expect(isCompressedCanvas(compressed)).toBe(true)
  expect(compressed?.__origW).toBe(5)
  expect(compressed?.__origH).toBe(4)

  await prepareEntryForRestore(entries[0])

  expect(isCompressedCanvas(entries[0].layers[0].canvas)).toBe(false)
  expect(entries[0].layers[0].canvas?.width).toBe(5)
  expect(entries[0].layers[0].canvas?.height).toBe(4)
})

test("estimates purge memory without double-counting shared canvases", () => {
  const shared = fixtureCanvas(10, 10)
  const current = historyEntry("current", shared)
  const older = historyEntry("older", shared)
  const snapshot = { id: "snapshot-1", name: "Snapshot", createdAt: 1, entry: historyEntry("snap", fixtureCanvas(2, 2)) }
  const state = {
    activeDocId: "doc-1",
    documents: [{ id: "doc-1", layers: [], timelineFrames: [] }],
    histories: { "doc-1": { entries: [older, current], index: 1 } },
    snapshots: { "doc-1": [snapshot] },
    closedDocuments: [],
    actions: [],
    clipboard: { canvas: fixtureCanvas(3, 2) },
    styleClipboard: { dropShadow: { enabled: true, color: "#000", size: 2, offsetX: 1, offsetY: 1, opacity: 0.5 } },
  }

  expect(estimateUndoPurgeBytes(state)).toBe(400)
  expect(estimateHistoriesPurgeBytes(state)).toBe(416)
  expect(estimateClipboardPurgeBytes(state)).toBeGreaterThan(24)
})

test("purges filter previews and reports the cleared canvas memory", () => {
  const previews = {
    a: fixtureCanvas(2, 2),
    b: fixtureCanvas(3, 1),
  }

  expect(purgeFilterPreviewCache(previews)).toBe(28)
  expect(previews).toEqual({})
})

test("estimates and strips video poster and timeline thumbnail caches immutably", () => {
  const doc = documentWithVideo()
  const entry = historyEntry("video-entry")
  entry.layers = [{ ...entry.layers[0], video: videoProps() }]
  const snapshot: HistorySnapshot = { id: "snapshot-video", name: "Video", createdAt: 1, entry }
  const state = {
    activeDocId: doc.id,
    documents: [doc],
    histories: { [doc.id]: { entries: [entry], index: 0 } },
    snapshots: { [doc.id]: [snapshot] },
    closedDocuments: [{ id: "closed", doc, history: { entries: [entry], index: 0 }, snapshots: [snapshot], closedAt: 1 }],
    actions: [{ id: "action", name: "Action", createdAt: 1, updatedAt: 1, steps: [{ id: "step", label: "Step", createdAt: 1, entry }] }],
    clipboard: null,
    styleClipboard: null,
  }

  expect(estimateVideoCachePurgeBytes(state)).toBe(27)

  const strippedDoc = stripVideoCacheFromDoc(doc)
  const strippedEntry = stripVideoCacheFromEntry(entry)
  const strippedSnapshots = stripVideoCacheFromSnapshots([snapshot])
  const strippedHistory = stripVideoCacheFromHistory({ entries: [entry], index: 0 })

  expect(strippedDoc).not.toBe(doc)
  expect(strippedDoc.layers[0].video?.posterDataUrl).toBeUndefined()
  expect(strippedDoc.timelineFrames?.[0].thumbnail).toBeUndefined()
  expect(strippedEntry.layers[0].video?.posterDataUrl).toBeUndefined()
  expect(strippedSnapshots[0]).not.toBe(snapshot)
  expect(strippedHistory?.entries[0].layers[0].video?.posterDataUrl).toBeUndefined()
  expect(stripVideoCacheFromDoc(strippedDoc)).toBe(strippedDoc)
})
