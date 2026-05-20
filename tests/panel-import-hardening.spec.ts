import { expect, test } from "@playwright/test"

import {
  MAX_ASSET_IMPORT_BYTES,
  MAX_ASSET_IMPORT_COUNT,
  normalizeImportedAssetLibrary,
} from "../components/photoshop/panels/assets-panel"
import {
  MAX_BRUSH_IMPORT_BYTES,
  MAX_BRUSH_PRESET_IMPORT_COUNT,
  normalizeImportedBrushPayload,
  parseAbrPresets,
} from "../components/photoshop/panels/brush-panel"

function bytesFromText(text: string) {
  const bytes = new TextEncoder().encode(text)
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

test("asset import enforces file size count kind and payload schemas", () => {
  expect(() =>
    normalizeImportedAssetLibrary([], { fileSizeBytes: MAX_ASSET_IMPORT_BYTES + 1, now: 1000 }),
  ).toThrow(/limited/i)

  expect(() =>
    normalizeImportedAssetLibrary(
      { assets: Array.from({ length: MAX_ASSET_IMPORT_COUNT + 1 }, (_, index) => ({
        name: `Swatch ${index}`,
        kind: "swatch",
        payload: { color: "#112233" },
      })) },
      { fileSizeBytes: 512, now: 1000 },
    ),
  ).toThrow(/limited/i)

  expect(() =>
    normalizeImportedAssetLibrary(
      [{ name: "Unknown", kind: "script", payload: { code: "alert(1)" } }],
      { fileSizeBytes: 512, now: 1000 },
    ),
  ).toThrow(/unsupported asset kind/i)

  const imported = normalizeImportedAssetLibrary(
    {
      assets: [
        {
          id: "__proto__",
          name: "  Brand swatch  ",
          kind: "swatch",
          group: "  Colors  ",
          createdAt: "not-a-date",
          payload: { color: "#AABBCC", extra: "ignored" },
          extraTopLevel: true,
        },
        {
          name: "Soft brush",
          kind: "brush",
          payload: { size: 9999, hardness: -20, opacity: 60, flow: 70, smoothing: 15, tipShape: "triangle" },
        },
        {
          name: "PNG export",
          kind: "export",
          payload: { dialog: "export-as", format: "png", scale: 9999, quality: -5, transparent: true, matte: "#fff" },
        },
      ],
    },
    { fileSizeBytes: 512, now: 1000, makeId: (prefix, index) => `${prefix}_${index}` },
  )

  expect(imported).toEqual([
    {
      id: "asset_0",
      name: "Brand swatch",
      kind: "swatch",
      group: "Colors",
      payload: { color: "#aabbcc" },
      createdAt: 1000,
    },
    {
      id: "asset_1",
      name: "Soft brush",
      kind: "brush",
      group: undefined,
      payload: { size: 500, hardness: 0, opacity: 60, flow: 70, smoothing: 15 },
      createdAt: 1000,
    },
    {
      id: "asset_2",
      name: "PNG export",
      kind: "export",
      group: undefined,
      payload: { dialog: "export-as", format: "png", scale: 800, quality: 1, transparent: true, matte: "#ffffff" },
      createdAt: 1000,
    },
  ])
})

test("brush JSON import caps count validates thumbnails and normalizes settings", () => {
  expect(() =>
    normalizeImportedBrushPayload([], {
      fileSizeBytes: MAX_BRUSH_IMPORT_BYTES + 1,
      now: 1000,
      makeThumbnail: () => undefined,
    }),
  ).toThrow(/limited/i)

  expect(() =>
    normalizeImportedBrushPayload(
      Array.from({ length: MAX_BRUSH_PRESET_IMPORT_COUNT + 1 }, (_, index) => ({
        name: `Brush ${index}`,
        settings: { size: 10, hardness: 50 },
      })),
      { fileSizeBytes: 512, now: 1000, makeThumbnail: () => undefined },
    ),
  ).toThrow(/limited/i)

  expect(() =>
    normalizeImportedBrushPayload(
      [{ name: "Bad thumb", thumbnail: "javascript:alert(1)", settings: { size: 10, hardness: 50 } }],
      { fileSizeBytes: 512, now: 1000, makeThumbnail: () => undefined },
    ),
  ).toThrow(/thumbnail/i)

  const imported = normalizeImportedBrushPayload(
    [
      {
        id: "__proto__",
        name: "  Wet brush  ",
        folder: "  User  ",
        thumbnail: "data:image/png;base64,AAAA",
        settings: {
          size: 9999,
          hardness: -10,
          opacity: "bad",
          flow: 70,
          smoothing: 20,
          spacing: 0,
          tipShape: "square",
          sizeControl: "pressure",
          texture: { enabled: true, pattern: "paper", mode: "multiply", depth: 999, depthJitter: -5, minDepth: 10, scale: 9999 },
          dualBrush: { enabled: true, size: 0, spacing: 999, scatter: 999, count: 99, mode: "screen" },
          pose: { tiltX: -120, tiltY: 120, rotation: 999, pressure: 200, stylusAngle: -999 },
          extra: "ignored",
        },
        extraTopLevel: true,
      },
    ],
    { fileSizeBytes: 512, now: 1000, makeId: (prefix, index) => `${prefix}_${index}`, makeThumbnail: () => undefined },
  )

  expect(imported).toEqual({
    kind: "library",
    presets: [
      {
        id: "brush_0",
        name: "Wet brush",
        folder: "User",
        size: 500,
        hardness: 0,
        spacing: 1,
        settings: {
          size: 500,
          hardness: 0,
          opacity: 100,
          flow: 70,
          smoothing: 20,
          spacing: 1,
          tipShape: "square",
          sizeControl: "pressure",
          texture: { enabled: true, pattern: "paper", mode: "multiply", depth: 100, depthJitter: 0, minDepth: 10, scale: 400 },
          dualBrush: { enabled: true, size: 1, spacing: 200, scatter: 500, count: 8, mode: "screen" },
          pose: { tiltX: -90, tiltY: 90, rotation: 180, pressure: 100, stylusAngle: -180 },
        },
        thumbnail: "data:image/png;base64,AAAA",
      },
    ],
  })
})

test("single brush JSON import returns a normalized current-brush patch and preset", () => {
  const imported = normalizeImportedBrushPayload(
    {
      name: "Imported soft round",
      settings: { size: 24, hardness: 40, opacity: 80, flow: 55, smoothing: 12, wetEdges: true },
      thumbnail: "data:image/webp;base64,AAAA",
    },
    { fileSizeBytes: 512, now: 1000, makeId: (prefix, index) => `${prefix}_${index}`, makeThumbnail: () => undefined },
  )

  expect(imported).toEqual({
    kind: "single",
    brush: { size: 24, hardness: 40, opacity: 80, flow: 55, smoothing: 12, wetEdges: true },
    preset: {
      id: "brush_0",
      name: "Imported soft round",
      size: 24,
      hardness: 40,
      spacing: 25,
      settings: { size: 24, hardness: 40, opacity: 80, flow: 55, smoothing: 12, wetEdges: true },
      thumbnail: "data:image/webp;base64,AAAA",
    },
  })
})

test("ABR import scans bounded data and caps generated presets", () => {
  const namesPastScanWindow = bytesFromText(`8BIM${"x".repeat(80)}Detailed Round Brush`)
  const fallback = parseAbrPresets(namesPastScanWindow, "fallback.abr", "#000000", "#ffffff", {
    now: 1000,
    maxScanBytes: 32,
    makeThumbnail: () => undefined,
  })
  expect(fallback.map((preset) => preset.name)).toEqual(["fallback"])

  const manyNames = bytesFromText(
    Array.from({ length: MAX_BRUSH_PRESET_IMPORT_COUNT + 10 }, (_, index) => `Brush Name ${index + 1}`).join("\0"),
  )
  const capped = parseAbrPresets(manyNames, "many.abr", "#000000", "#ffffff", {
    now: 1000,
    makeThumbnail: () => undefined,
  })

  expect(capped).toHaveLength(MAX_BRUSH_PRESET_IMPORT_COUNT)
  expect(capped[0]).toMatchObject({
    id: "abr_1000_0",
    folder: "many",
    settings: expect.objectContaining({ size: expect.any(Number), hardness: expect.any(Number) }),
  })
})
