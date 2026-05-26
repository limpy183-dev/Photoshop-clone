import { expect, test } from "@playwright/test"

import {
  playAction,
  type ActionEnvelope,
} from "../components/photoshop/action-conditionals"
import {
  buildVariableDataSetExportPayload,
  parseVariableDataSetImportPayload,
  serializeDatasetRowsCsv,
} from "../components/photoshop/variables-engine"
import {
  buildDropletBundle,
  dropletBundleToAutomationAsset,
  parseDropletBundle,
  serializeDropletBundle,
} from "../components/photoshop/droplets-bundle"
import { createAutomationWorkflow } from "../components/photoshop/automation-engine"
import type { Droplet } from "../components/photoshop/automation-store"
import type { HistoryEntry, MacroAction, PsDocument, VariableDataSet } from "../components/photoshop/types"

function historyEntry(id: string): HistoryEntry {
  return {
    id,
    label: id,
    layers: [
      {
        id: "layer-main",
        name: "Main",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 0.75,
        blendMode: "normal",
        canvas: {} as HTMLCanvasElement,
      },
    ],
    activeLayerId: "layer-main",
    selectedLayerIds: ["layer-main"],
    width: 800,
    height: 600,
    colorMode: "RGB",
  }
}

function documentContext(): PsDocument {
  return {
    id: "doc",
    name: "Campaign",
    width: 800,
    height: 600,
    zoom: 1,
    layers: [
      {
        id: "layer-main",
        name: "Main",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 0.75,
        blendMode: "normal",
        canvas: {} as HTMLCanvasElement,
      },
    ],
    activeLayerId: "layer-main",
    selectedLayerIds: ["layer-main"],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: { x: 10, y: 20, w: 300, h: 150 }, shape: "rect" },
  } as PsDocument
}

test("conditional action playback can jump on document checks and retry recoverable steps", async () => {
  const action: MacroAction = {
    id: "action-web",
    name: "Web export",
    createdAt: 1,
    updatedAt: 1,
    steps: [
      { id: "step-large", label: "Large-only prep", createdAt: 1, entry: historyEntry("large") },
      { id: "step-middle", label: "Middle", createdAt: 2, entry: historyEntry("middle") },
      { id: "step-export", label: "Export", createdAt: 3, entry: historyEntry("export") },
    ],
  }
  const envelope: ActionEnvelope = {
    steps: {
      "step-large": {
        condition: {
          attribute: "document.widthGte",
          value: 1200,
          onFail: "jump",
          jumpToStepId: "step-export",
        },
      },
      "step-export": {
        onError: "retry",
        retryLimit: 2,
        retryDelayMs: 0,
      },
    },
  }
  const doc = documentContext()
  const applied: string[] = []
  let exportAttempts = 0

  const result = await playAction(
    action,
    envelope,
    {
      getContext: (step) => ({
        doc,
        activeLayer: doc.layers[0],
        entry: step.entry,
        selection: doc.selection,
      }),
    },
    {
      applyStep: async (step) => {
        if (step.id === "step-export" && exportAttempts < 2) {
          exportAttempts++
          throw new Error("transient export failure")
        }
        applied.push(step.id)
      },
    },
  )

  expect(applied).toEqual(["step-export"])
  expect(exportAttempts).toBe(2)
  expect(result.executed).toEqual(["step-export"])
  expect(result.skipped).toEqual([
    { stepId: "step-large", reason: "document.widthGte did not match", decision: "jump", jumpToStepId: "step-export" },
  ])
  expect(result.failed).toEqual([])
  expect(result.aborted).toBe(false)
})

test("variable data sets export rows and round-trip bindings through the full JSON envelope", () => {
  const set: VariableDataSet = {
    id: "data-campaign",
    name: "Campaign",
    rows: [
      { headline: "Launch, today", show: "yes" },
      { headline: "Last call", show: "no" },
    ],
    activeRow: 99,
    bindings: [
      { id: "bind-title", layerId: "layer-main", property: "text", column: "headline" },
      { id: "bind-missing-column", layerId: "layer-main", property: "visibility", column: "missing" },
      { id: "bind-missing-layer", layerId: "missing", property: "opacity", column: "show" },
    ],
  }
  const payload = buildVariableDataSetExportPayload([set], { exportedAt: "2026-05-26T00:00:00.000Z" })
  const imported = parseVariableDataSetImportPayload(payload, {
    doc: documentContext(),
    makeId: (prefix, index) => `${prefix}_${index}`,
  })

  expect(payload).toMatchObject({
    app: "Photoshop Web",
    format: "ps-variable-data-sets",
    version: 1,
    exportedAt: "2026-05-26T00:00:00.000Z",
  })
  expect(imported).toEqual([
    {
      id: "dataset_0",
      name: "Campaign",
      rows: set.rows,
      activeRow: 1,
      bindings: [{ id: "binding_0_0", layerId: "layer-main", property: "text", column: "headline" }],
    },
  ])
  expect(serializeDatasetRowsCsv(set.rows)).toBe('"headline","show"\r\n"Launch, today","yes"\r\n"Last call","no"')
})

test("droplet bundles carry workflow, event routing, and sanitized automation asset payloads", () => {
  const workflow = createAutomationWorkflow(
    "Resize and brand",
    [
      { id: "resize", type: "resize", maxWidth: 1200, maxHeight: 800 },
      { id: "script", type: "script", source: 'report("done")' },
    ],
    { format: "webp", quality: 0.8, filenameTemplate: "{{name}}-web" },
  )
  const droplet: Droplet = {
    id: "droplet-web",
    name: "Web Export",
    actionId: "action-web",
    condition: "document-open",
    event: "Before Export",
    manualOnly: false,
    exportFormat: "webp",
    exportName: "{{name}}-web",
    createdAt: 1,
    updatedAt: 2,
  }

  const bundle = parseDropletBundle(serializeDropletBundle(buildDropletBundle(droplet, null, { workflow })))
  const asset = dropletBundleToAutomationAsset(bundle, { makeId: (prefix, index) => `${prefix}_${index}`, now: 1000 })

  expect(bundle.droplet).toMatchObject({
    id: "droplet-web",
    name: "Web Export",
    condition: "document-open",
    event: "Before Export",
    manualOnly: false,
    exportFormat: "webp",
  })
  expect(bundle.workflow).toMatchObject({
    name: "Resize and brand",
    output: { format: "webp", quality: 0.8, filenameTemplate: "{{name}}-web" },
  })
  expect(asset).toMatchObject({
    id: "automation_0",
    name: "Web Export",
    kind: "prepress",
    group: "Automation",
    createdAt: 1000,
    payload: {
      type: "workflow",
      actionId: "action-web",
      condition: "document-open",
      event: "Before Export",
      manualOnly: false,
      workflow: expect.objectContaining({ name: "Resize and brand" }),
    },
  })
})
