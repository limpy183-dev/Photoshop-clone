import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import {
  createLinkedSmartObjectSyncDaemon,
  exportSmartObjectContents,
  planLinkedSmartObjectSync,
  relinkSmartObjectToFile,
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

test("relink workflow requests persisted file handle permission before reading source pixels", async () => {
  const doc = richFixtureDocument()
  const layer = doc.layers.find((item) => item.id === "layer_smart")!
  const file = new File(["permission-source"], "permission-source.png", {
    type: "image/png",
    lastModified: 1_800_000_040_000,
  })
  const calls: string[] = []
  const handle = {
    name: "permission-source.png",
    queryPermission: async () => {
      calls.push("query")
      return "prompt" as PermissionState
    },
    requestPermission: async () => {
      calls.push("request")
      return "granted" as PermissionState
    },
    getFile: async () => {
      calls.push("getFile")
      return file
    },
  } as unknown as FileSystemFileHandle

  const result = await relinkSmartObjectToFile(layer, handle, {
    hashContents: true,
    readCanvas: async () => fixtureCanvas(24, 16, "#3366ff"),
    now: () => 1_800_000_045_000,
  })

  expect(calls).toEqual(["query", "request", "getFile"])
  expect(result.changed).toBe(true)
  expect(result.status).toBe("current")
  expect(result.layer.smartSource).toMatchObject({
    fileName: "permission-source.png",
    fileHandleName: "permission-source.png",
    handlePermission: "granted",
    lastKnownModified: 1_800_000_040_000,
    lastKnownSize: file.size,
    linkType: "linked",
    relinkedAt: 1_800_000_045_000,
    status: "current",
    width: 24,
    height: 16,
  })
  expect(result.layer.smartSource?.sourceHash).toMatch(/^fnv1a32:/)
})

test("linked smart object polling does not prompt and marks denied or missing handles", async () => {
  const doc = richFixtureDocument()
  const layer = doc.layers.find((item) => item.id === "layer_smart")!
  const handle = {
    name: "persisted-source.png",
    queryPermission: async () => "prompt" as PermissionState,
    requestPermission: async () => {
      throw new Error("polling must not request permission")
    },
    getFile: async () => {
      throw new Error("polling must not read without permission")
    },
  } as unknown as FileSystemFileHandle
  layer.smartSource = {
    ...layer.smartSource!,
    fileHandle: handle,
    fileHandleName: "persisted-source.png",
    handlePermission: "granted",
    status: "current",
  }

  const result = await syncLinkedSmartObjectSource(layer, { requestPermission: false })

  expect(result.changed).toBe(true)
  expect(result.status).toBe("missing")
  expect(result.layer.smartSource).toMatchObject({
    fileHandleName: "persisted-source.png",
    handlePermission: "prompt",
    status: "missing",
  })

  const missing = await syncLinkedSmartObjectSource({
    ...layer,
    smartSource: { ...layer.smartSource!, fileHandle: undefined, fileHandleName: "persisted-source.png" },
  })
  expect(missing.changed).toBe(true)
  expect(missing.status).toBe("missing")
  expect(missing.layer.smartSource).toMatchObject({
    fileHandleName: "persisted-source.png",
    status: "missing",
  })
})

test("editor reducer applies linked smart object polling results to the owning document", () => {
  const activeDoc = richFixtureDocument()
  const backgroundDoc = {
    ...richFixtureDocument(),
    id: "doc_background",
    name: "Background Document",
  }
  let state: FixtureState = {
    ...stateWithFixtureDoc(),
    documents: [activeDoc, backgroundDoc],
    activeDocId: activeDoc.id,
  }

  state = reducer(state as never, {
    type: "apply-linked-smart-object-sync",
    docId: backgroundDoc.id,
    id: "layer_smart",
    source: {
      fileName: "polled-source.png",
      fileHandleName: "polled-source.png",
      handlePermission: "prompt",
      lastKnownModified: 1_800_000_050_000,
      lastKnownSize: 2048,
      status: "missing",
    },
  } as never) as unknown as FixtureState

  const activeLayer = state.documents[0].layers.find((item) => item.id === "layer_smart")!
  const backgroundLayer = state.documents[1].layers.find((item) => item.id === "layer_smart")!

  expect(activeLayer.smartSource?.fileName).toBe("product-source.png")
  expect(backgroundLayer.smartSource).toMatchObject({
    fileName: "polled-source.png",
    fileHandleName: "polled-source.png",
    handlePermission: "prompt",
    lastKnownModified: 1_800_000_050_000,
    lastKnownSize: 2048,
    status: "missing",
  })
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
