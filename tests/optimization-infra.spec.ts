import fs from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { planAutosaveDocuments, shouldMirrorAutosaveToLocalStorage } from "../components/photoshop/autosave-planner"
import { BLUR_GALLERY_CONTROL_STATE_KEY, formatFieldBlurPins } from "../components/photoshop/blur-gallery-controls"
import { planFilterPreviewExecution } from "../components/photoshop/filter-preview"
import { createRenderBus, mergeRenderChanges } from "../components/photoshop/render-bus"

test("render bus merges layer-specific invalidations into one animation frame", () => {
  const emitted: unknown[] = []
  const scheduled: FrameRequestCallback[] = []
  const bus = createRenderBus(
    (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
    () => undefined,
  )

  bus.subscribe((change) => emitted.push(change))
  bus.requestRender({ layerIds: ["layer-a"], reason: "paint" })
  bus.requestRender({ layerIds: ["layer-b"], reason: "visibility" })
  bus.requestRender({ layerIds: ["layer-a"], reason: "paint" })

  expect(scheduled).toHaveLength(1)
  expect(emitted).toEqual([])

  scheduled[0](16)

  expect(emitted).toEqual([
    {
      layerIds: ["layer-a", "layer-b"],
      reasons: ["paint", "visibility"],
      dirtyRects: [],
      dirtyByLayer: {},
      fullFrame: false,
    },
  ])
})

test("render bus escalates mixed full and partial invalidations to full render", () => {
  expect(mergeRenderChanges(
    { layerIds: ["layer-a"], reason: "thumbnail" },
    { layerIds: "all", reason: "composite" },
  )).toEqual({
    layerIds: "all",
    reasons: ["thumbnail", "composite"],
    dirtyRects: [],
    dirtyByLayer: {},
    fullFrame: true,
  })
})

test("filter preview planner prefers cancellable worker paths for expensive full-frame previews", () => {
  expect(planFilterPreviewExecution("gaussian-blur", 4096, 2048, { radius: 18 })).toEqual({
    mode: "tiled-worker",
    pixelCount: 8_388_608,
    previewScale: 0.5,
    tileSize: 512,
    reason: "expensive-filter-large-preview",
  })

  expect(planFilterPreviewExecution("invert", 640, 480, {})).toEqual({
    mode: "sync",
    pixelCount: 307_200,
    previewScale: 1,
    reason: "small-preview",
  })
})

test("filter preview planner downscales expensive blur gallery drags", () => {
  expect(planFilterPreviewExecution("field-blur", 4096, 2048, {
    blur: 72,
    pins: formatFieldBlurPins([
      { x: 15, y: 30, blur: 70 },
      { x: 48, y: 52, blur: 64 },
      { x: 82, y: 20, blur: 58 },
    ]),
    [BLUR_GALLERY_CONTROL_STATE_KEY]: JSON.stringify({ previewQuality: "interactive" }),
  })).toEqual({
    mode: "downsample-sync",
    pixelCount: 8_388_608,
    previewScale: 0.25,
    reason: "interactive-blur-gallery-preview",
  })
})

test("autosave planner skips unchanged documents and avoids large localStorage mirrors", () => {
  const plan = planAutosaveDocuments({
    documents: [
      { id: "a", name: "A", version: 2, dirty: true },
      { id: "b", name: "B", version: 7, dirty: true },
      { id: "c", name: "C", version: 1, dirty: false },
    ],
    lastSavedVersions: { a: 2, b: 5, c: 0 },
  })

  expect(plan.documentsToSerialize.map((doc) => doc.id)).toEqual(["b"])
  expect(plan.nextSavedVersions).toEqual({ a: 2, b: 7, c: 0 })
  expect(shouldMirrorAutosaveToLocalStorage(512_000)).toBe(true)
  expect(shouldMirrorAutosaveToLocalStorage(6_000_000)).toBe(false)

  const firstSnapshot = planAutosaveDocuments({
    documents: [
      { id: "clean-new", name: "Clean", version: 0, dirty: false },
      { id: "dirty-new", name: "Dirty", version: 1, dirty: true },
    ],
    lastSavedVersions: {},
  })
  expect(firstSnapshot.documentsToSerialize.map((doc) => doc.id)).toEqual(["clean-new", "dirty-new"])
  expect(firstSnapshot.nextSavedVersions).toEqual({ "clean-new": 0, "dirty-new": 1 })
})

test("PSD codec is dynamically imported instead of bundled into the editor shell", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/photoshop/document-io.ts"), "utf8")

  expect(source).not.toContain('import { readPsd, writePsd } from "ag-psd"')
  expect(source).toContain('import("ag-psd")')
})
