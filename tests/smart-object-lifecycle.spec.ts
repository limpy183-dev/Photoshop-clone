import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import {
  createLinkedSmartObjectSyncDaemon,
  exportSmartObjectContents,
  planLinkedSmartObjectSync,
  smartObjectStatus,
  syncLinkedSmartObjectSource,
} from "../components/photoshop/smart-objects"
import { fixtureCanvas, richFixtureDocument } from "./photoshop-fixtures"

type FixtureState = ReturnType<typeof stateWithFixtureDoc>

function stateWithFixtureDoc() {
  const doc = richFixtureDocument()
  return {
    documents: [doc],
    activeDocId: doc.id,
    tool: "move",
    foreground: "#000000",
    background: "#ffffff",
    histories: {},
    snapshots: {},
    closedDocuments: [],
    documentLifecycle: {},
    clipboard: null,
    styleClipboard: null,
    brush: {},
    gradient: {},
    paintBucket: {},
    eraser: {},
    cloneSource: {},
    symmetry: {},
    selectionOptions: {},
    transform: null,
    brushPresets: [],
    actions: [],
    recordingActionId: null,
    isPlayingAction: false,
  }
}

test("editor reducer updates linked smart object lifecycle state", () => {
  let state: FixtureState = stateWithFixtureDoc()
  state = reducer(state as never, {
    type: "set-layer-smart-link",
    id: "layer_smart",
    source: {
      fileName: "updated.psb",
      relativePath: "links/updated.psb",
      status: "modified",
    },
  } as never) as unknown as FixtureState

  let layer = state.documents[0].layers.find((item) => item.id === "layer_smart")!
  expect(layer.smartSource).toMatchObject({
    linkType: "linked",
    fileName: "updated.psb",
    relativePath: "links/updated.psb",
    status: "modified",
  })
  expect(smartObjectStatus(layer)).toBe("modified")

  state = reducer(state as never, { type: "set-layer-smart-link-status", id: "layer_smart", status: "missing" } as never) as unknown as FixtureState
  layer = state.documents[0].layers.find((item) => item.id === "layer_smart")!
  expect(smartObjectStatus(layer)).toBe("missing")
})

test("editor reducer replaces smart object contents while preserving layer footprint", () => {
  const state = reducer(stateWithFixtureDoc() as never, {
    type: "replace-smart-object-contents",
    id: "layer_smart",
    canvas: fixtureCanvas(18, 14, "#00aa88"),
    source: {
      fileName: "replacement.png",
      relativePath: "links/replacement.png",
      linkType: "linked",
    },
  } as never) as unknown as FixtureState

  const layer = state.documents[0].layers.find((item) => item.id === "layer_smart")!
  expect(layer.canvas.width).toBe(64)
  expect(layer.canvas.height).toBe(48)
  expect(layer.smartSource).toMatchObject({
    width: 18,
    height: 14,
    fileName: "replacement.png",
    relativePath: "links/replacement.png",
    status: "current",
  })
  expect(exportSmartObjectContents(layer)?.filename).toBe("replacement.png")
})

test("linked smart object sync detects changed file handles and replaces source pixels", async () => {
  const doc = richFixtureDocument()
  const layer = doc.layers.find((item) => item.id === "layer_smart")!
  const file = new File(["updated-smart-source"], "replacement.png", {
    type: "image/png",
    lastModified: 1_800_000_010_000,
  })
  const handle = {
    name: "replacement.png",
    queryPermission: async () => "granted" as PermissionState,
    getFile: async () => file,
  } as unknown as FileSystemFileHandle
  layer.smartSource = {
    ...layer.smartSource!,
    fileHandle: handle,
    fileHandleName: "replacement.png",
    lastKnownModified: 1_800_000_000_000,
    lastKnownSize: 4,
    sourceHash: "fnv1a32:old",
  }

  expect(planLinkedSmartObjectSync(layer, {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sourceHash: "fnv1a32:new",
  })).toMatchObject({ changed: true, status: "modified" })

  const result = await syncLinkedSmartObjectSource(layer, {
    hashContents: true,
    readCanvas: async () => fixtureCanvas(20, 18, "#00aa88"),
  })

  expect(result.changed).toBe(true)
  expect(result.status).toBe("current")
  expect(result.layer.canvas.width).toBe(64)
  expect(result.layer.canvas.height).toBe(48)
  expect(result.layer.smartSource).toMatchObject({
    fileName: "replacement.png",
    fileHandleName: "replacement.png",
    lastKnownModified: 1_800_000_010_000,
    lastKnownSize: file.size,
    status: "current",
    width: 20,
    height: 18,
  })
  expect(result.layer.smartSource?.sourceHash).toMatch(/^fnv1a32:/)
})

test("linked smart object sync daemon polls concrete targets and reports sync events", async () => {
  const doc = richFixtureDocument()
  const layer = doc.layers.find((item) => item.id === "layer_smart")!
  const file = new File(["updated"], "product-source.png", {
    type: "image/png",
    lastModified: 1_800_000_020_000,
  })
  layer.smartSource = {
    ...layer.smartSource!,
    fileHandle: {
      name: "product-source.png",
      queryPermission: async () => "granted" as PermissionState,
      getFile: async () => file,
    } as unknown as FileSystemFileHandle,
    lastKnownModified: 1_800_000_000_000,
  }
  const events: Array<{ layerId: string; status: string; changed: boolean }> = []
  let scheduled: (() => void | Promise<void>) | null = null

  const daemon = createLinkedSmartObjectSyncDaemon({
    intervalMs: 250,
    getTargets: () => [{ docId: doc.id, layer }],
    onSync: (event) => {
      events.push({ layerId: event.layer.id, status: event.status, changed: event.changed })
    },
    setIntervalFn: (callback) => {
      scheduled = callback
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearIntervalFn: () => {},
  })

  daemon.start()
  expect(scheduled).not.toBeNull()
  await daemon.syncNow()
  expect(events).toEqual([{ layerId: "layer_smart", status: "modified", changed: true }])
  daemon.stop()
})
