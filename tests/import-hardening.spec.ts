import { expect, test } from "@playwright/test"

import * as actionsPanel from "../components/photoshop/panels/actions-panel"
import { parsePreferencesSet } from "../components/photoshop/preferences-engine"

const parseActionImportPayload = (actionsPanel as {
  parseActionImportPayload?: (value: unknown) => unknown[]
}).parseActionImportPayload

const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

function actionWithLayer(layer: Record<string, unknown>) {
  return {
    actions: [
      {
        id: "action-a",
        name: "Imported action",
        createdAt: 1,
        updatedAt: 1,
        steps: [
          {
            id: "step-a",
            label: "Step",
            createdAt: 1,
            entry: {
              id: "entry-a",
              label: "Entry",
              activeLayerId: "layer-a",
              selectedLayerIds: ["layer-a"],
              layers: [layer],
            },
          },
        ],
      },
    ],
  }
}

function rasterLayer(patch: Record<string, unknown> = {}) {
  return {
    id: "layer-a",
    name: "Layer",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvasDataUrl: pngDataUrl,
    ...patch,
  }
}

test("preference imports reject oversized payloads before normalization", () => {
  const oversizedJson = JSON.stringify({
    preferences: {
      defaultBackground: "#ffffff",
      historyLog: {
        entries: [{ id: "hist-a", label: "x".repeat(1_100_000) }],
      },
    },
  })

  expect(() => parsePreferencesSet(oversizedJson)).toThrow(/limited/i)
})

test("preference imports reject oversized arrays before mapping", () => {
  const tooManyScratchDisks = Array.from({ length: 33 }, (_, index) => ({
    id: `scratch-${index}`,
    label: `Scratch ${index}`,
    enabled: true,
    priority: index + 1,
    quotaMB: 1024,
    kind: "opfs",
  }))

  expect(() => parsePreferencesSet({ scratchDisks: tooManyScratchDisks })).toThrow(/scratch disks/i)
})

test("action imports reject too many nested layers before deserialization", () => {
  expect(typeof parseActionImportPayload).toBe("function")

  const layers = Array.from({ length: 251 }, (_, index) => rasterLayer({ id: `layer-${index}` }))
  const payload = actionWithLayer(rasterLayer())
  ;(payload.actions[0].steps[0].entry.layers as unknown[]) = layers

  expect(() => parseActionImportPayload?.(payload)).toThrow(/layers/i)
})

test("action imports reject oversized canvas patches and smart filters before deserialization", () => {
  expect(typeof parseActionImportPayload).toBe("function")

  expect(() =>
    parseActionImportPayload?.(
      actionWithLayer(
        rasterLayer({
          canvasPatches: Array.from({ length: 201 }, (_, index) => ({
            x: index,
            y: 0,
            w: 1,
            h: 1,
            canvasDataUrl: pngDataUrl,
          })),
        }),
      ),
    ),
  ).toThrow(/canvas patches/i)

  expect(() =>
    parseActionImportPayload?.(
      actionWithLayer(
        rasterLayer({
          smartFilters: Array.from({ length: 51 }, (_, index) => ({
            id: `filter-${index}`,
            filterId: "gaussian-blur",
            name: "Gaussian Blur",
            enabled: true,
            params: { radius: 2 },
            maskDataUrl: null,
          })),
        }),
      ),
    ),
  ).toThrow(/smart filters/i)
})

test("action imports reject unknown nested payloads but preserve valid action imports", () => {
  expect(typeof parseActionImportPayload).toBe("function")

  expect(() =>
    parseActionImportPayload?.(
      actionWithLayer(
        rasterLayer({
          unexpectedPayload: { nested: Array.from({ length: 10 }, () => pngDataUrl) },
        }),
      ),
    ),
  ).toThrow(/unknown/i)

  const imported = parseActionImportPayload?.(
    actionWithLayer(
      rasterLayer({
        canvasPatches: [{ x: 0, y: 0, w: 1, h: 1, canvasDataUrl: pngDataUrl }],
        smartFilters: [{ id: "filter-a", filterId: "gaussian-blur", name: "Gaussian Blur", enabled: true, params: { radius: 2 } }],
      }),
    ),
  )

  expect(imported).toHaveLength(1)
})
