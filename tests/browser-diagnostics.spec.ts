import fs from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import {
  createBrowserDiagnosticsReport,
  formatBrowserDiagnosticsReport,
  type BrowserDiagnosticsSnapshot,
} from "../components/photoshop/browser-diagnostics"
import { getCapability } from "../components/photoshop/capabilities"
import { PANEL_DEFINITIONS } from "../components/photoshop/panel-registry"

const MIB = 1024 * 1024

test("browser diagnostics report covers canvas webgl offscreen encoder opfs heap and fallback data", () => {
  const snapshot: BrowserDiagnosticsSnapshot = {
    generatedAt: "2026-05-25T12:00:00.000Z",
    userAgent: "UnitBrowser/1.0",
    document: {
      width: 12000,
      height: 9000,
      colorMode: "CMYK",
      bitDepth: 16,
      layers: [{ kind: "smart-object", smartFilters: [{ enabled: true }] }],
    },
    canvas: {
      safeMaxDimension: 8192,
      safeMaxPixels: 33_177_600,
      runtimeMaxDimension: 16384,
      runtimeMaxPixels: 268_435_456,
    },
    webgl: {
      webglSupported: true,
      webgl2Supported: true,
      maxTextureSize: 8192,
      renderer: "ANGLE Test Renderer",
      vendor: "Test GPU",
      extensions: ["EXT_color_buffer_float", "OES_texture_float_linear"],
    },
    offscreen: {
      offscreenCanvasSupported: true,
      transferToImageBitmapSupported: true,
      workerOffscreenSupported: false,
      webglOffscreenSupported: true,
    },
    mediaRecorder: {
      available: true,
      supportsTypeProbe: true,
      codecs: [
        { label: "WebM VP9 + Opus", mimeType: "video/webm;codecs=vp9,opus", supported: true },
        { label: "MP4 H.264 + AAC", mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", supported: false },
      ],
    },
    imageEncoders: [
      { label: "PNG", mimeType: "image/png", canvasToBlob: true, offscreenConvertToBlob: true, imageEncoder: false },
      { label: "AVIF", mimeType: "image/avif", canvasToBlob: false, offscreenConvertToBlob: false, imageEncoder: false },
    ],
    opfs: {
      supported: false,
      quota: null,
    },
    heap: {
      supported: true,
      usedJSHeapSize: 512 * MIB,
      totalJSHeapSize: 700 * MIB,
      jsHeapSizeLimit: 1024 * MIB,
      declaredBytes: 64 * MIB,
    },
  }

  const report = createBrowserDiagnosticsReport(snapshot)

  expect(report.sections.map((section) => section.id)).toEqual([
    "canvas",
    "webgl",
    "offscreen",
    "encoders",
    "opfs",
    "heap",
    "fallbacks",
  ])
  expect(report.sections.find((section) => section.id === "canvas")?.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Safe max size", value: "8192 px per side / 33.2 MP" }),
      expect.objectContaining({ label: "Runtime probe", value: "16384 px per side / 268.4 MP" }),
    ]),
  )
  expect(report.sections.find((section) => section.id === "webgl")?.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Renderer", value: "ANGLE Test Renderer" }),
      expect.objectContaining({ label: "Max texture", value: "8192 px" }),
      expect.objectContaining({ label: "Extensions", value: "EXT_color_buffer_float, OES_texture_float_linear" }),
    ]),
  )
  expect(report.sections.find((section) => section.id === "encoders")?.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "MP4 H.264 + AAC", value: "unavailable" }),
      expect.objectContaining({ label: "AVIF image", value: "unavailable" }),
    ]),
  )
  expect(report.fallbacks).toEqual(expect.arrayContaining([
    "Document exceeds the safe browser canvas budget; reduced-scale, tile-only, or inspection mode is required.",
    "WebGL texture limit is below the current document size; tiled WebGL or Canvas 2D fallback is active.",
    "OffscreenCanvas worker transfer is unavailable; worker previews fall back to main-thread canvas surfaces.",
    "MP4 H.264 + AAC MediaRecorder is unavailable; timeline export falls back to the frame/audio package when this preset is selected.",
    "OPFS scratch is unavailable; scratch data falls back to in-memory storage.",
    "CMYK document intent is displayed through the browser RGB canvas preview.",
    "16-bit document sources are preserved where supported, but display uses an 8-bit canvas preview.",
  ]))

  const text = formatBrowserDiagnosticsReport(report)
  expect(text).toContain("Browser Diagnostics Report")
  expect(text).toContain("Canvas")
  expect(text).toContain("WebGL")
  expect(text).toContain("EXT_color_buffer_float")
  expect(text).toContain("Fallbacks")
})

test("browser diagnostics panel is registered as a dedicated capability panel", () => {
  const panel = PANEL_DEFINITIONS.find((definition) => definition.id === "browser-diagnostics")

  expect(panel).toMatchObject({
    id: "browser-diagnostics",
    label: "Browser Diagnostics",
    stack: "lower",
    category: "Inspection and Guides",
    complexity: "specialized",
  })
  expect(panel?.keywords).toEqual(expect.arrayContaining([
    "diagnostics",
    "capabilities",
    "webgl",
    "opfs",
    "mediarecorder",
    "fallback",
  ]))
  expect(getCapability("panel.browser-diagnostics")).toMatchObject({
    kind: "panel",
    status: "usable",
  })
})

test("browser diagnostics panel source exposes copy export and section actions", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "components/photoshop/panels/browser-diagnostics-panel.tsx"),
    "utf8",
  )

  expect(source).toContain('data-testid="browser-diagnostics-panel"')
  expect(source).toContain('aria-label="Refresh diagnostic report"')
  expect(source).toContain('aria-label="Copy diagnostic report"')
  expect(source).toContain('aria-label="Export diagnostic report"')
  expect(source).toContain("formatBrowserDiagnosticsReport")
  expect(source).toContain("downloadText")
})
