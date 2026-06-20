import { expect, test } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

import {
  createLargeDocumentInspectionDocument,
  createTileEditDocument,
  describeLargeDocumentRecovery,
  diagnoseBrowserLargeDocumentLimits,
  planLargeDocumentOpen,
} from "../components/photoshop/large-document"
import { createDocumentReport } from "../components/photoshop/document-io"
import { analyzePreflightDocument } from "../components/photoshop/preflight-engine"
import { installFixtureDom, fixtureCanvas } from "./photoshop-fixtures"

test("large document planner gives full, reduced, tile-only, and inspection choices", () => {
  const plan = planLargeDocumentOpen({
    fileName: "mural.psb",
    kind: "psb",
    width: 12000,
    height: 6000,
    layerCount: 8,
    memoryBudgetMB: 512,
  })

  expect(plan.fitsBrowserCanvas).toBe(false)
  expect(plan.defaultMode).toBe("reduced-scale")
  expect(plan.reducedScale).toMatchObject({
    mode: "reduced-scale",
    width: 8145,
    height: 4072,
    editable: true,
  })
  expect(plan.tileOnly).toMatchObject({
    mode: "tile-only",
    tileColumns: 24,
    tileRows: 12,
    editable: true,
  })
  expect(plan.inspection).toMatchObject({
    mode: "inspection",
    editable: false,
  })
  expect(plan.warnings.join("\n")).toContain("browser canvas limit")
  expect(describeLargeDocumentRecovery(plan)).toContain("Open reduced scale")
  expect(describeLargeDocumentRecovery(plan)).toContain("Open tile-only")
  expect(describeLargeDocumentRecovery(plan)).toContain("Inspect only")
})

test("large document planner falls back to inspection when reduced scale is still unsafe", () => {
  const plan = planLargeDocumentOpen({
    fileName: "scan.tif",
    kind: "raster",
    width: 220000,
    height: 180000,
    memoryBudgetMB: 128,
    tileable: false,
  })

  expect(plan.fitsBrowserCanvas).toBe(false)
  expect(plan.reducedScale.editable).toBe(false)
  expect(plan.tileOnly).toBeNull()
  expect(plan.defaultMode).toBe("inspection")
  expect(plan.inspection.reason).toContain("too large")
})

test("inspection documents preserve parsed dimensions without allocating full canvas", () => {
  installFixtureDom()

  const doc = createLargeDocumentInspectionDocument({
    fileName: "city.psd",
    kind: "psd",
    width: 18000,
    height: 12000,
    reason: "PSD parsed, but the full canvas exceeds this browser limit.",
    warnings: ["Use reduced scale or tile-only mode for pixels."],
  })

  expect(doc.name).toBe("city.psd (Inspection)")
  expect(doc.width).toBeLessThanOrEqual(1024)
  expect(doc.height).toBeLessThanOrEqual(1024)
  expect(doc.layers[0]).toMatchObject({ locked: true, lockAll: true })
  expect(doc.metadata?.largeDocumentInspection).toMatchObject({
    mode: "inspection",
    sourceName: "city.psd",
    originalWidth: 18000,
    originalHeight: 12000,
    editable: false,
  })

  const report = createDocumentReport(doc, "PSD Import")
  expect(report.items.map((item) => item.label)).toContain("Large document inspection")
  const preflight = analyzePreflightDocument(doc)
  expect(preflight.findings.map((finding) => finding.id)).toContain("large-document-inspection")
})

test("tile edit documents carry write-back metadata for tile-only editing", () => {
  installFixtureDom()
  const tile = fixtureCanvas(512, 256, "#cc6633")

  const doc = createTileEditDocument({
    parentDocId: "doc_parent",
    sourceName: "mural.psb",
    col: 3,
    row: 2,
    sourceX: 1536,
    sourceY: 1024,
    originalWidth: 12000,
    originalHeight: 6000,
    tileSize: 512,
    canvas: tile,
  })

  expect(doc.width).toBe(512)
  expect(doc.height).toBe(256)
  expect(doc.metadata?.largeDocumentTileEdit).toMatchObject({
    mode: "tile-edit",
    parentDocId: "doc_parent",
    tile: { col: 3, row: 2, x: 1536, y: 1024, width: 512, height: 256 },
    editable: true,
  })
})

test("browser diagnostics report canvas, GPU, memory, and fallback limits clearly", () => {
  const diagnostics = diagnoseBrowserLargeDocumentLimits({
    userAgent: "FixtureBrowser/1.0",
    canvas: { maxDimension: 8192, maxPixels: 33_177_600 },
    gpu: { webglSupported: true, webgl2Supported: false, maxTextureSize: 4096, renderer: "Fixture GPU" },
    memory: { heapSupported: true, usedJSHeapSize: 64 * 1024 * 1024, jsHeapSizeLimit: 512 * 1024 * 1024 },
    offscreen: { offscreenCanvasSupported: true, workerOffscreenSupported: false },
  })

  expect(diagnostics.summary).toContain("FixtureBrowser/1.0")
  expect(diagnostics.canvas.status).toBe("limited")
  expect(diagnostics.gpu.detail).toContain("4096px texture")
  expect(diagnostics.memory.detail).toContain("512.0 MB heap limit")
  expect(diagnostics.fallbacks).toEqual(expect.arrayContaining([
    expect.stringContaining("tile-only"),
    expect.stringContaining("reduced-scale"),
  ]))
})

test("advanced import wizard is wired before heavy decoder work", () => {
  const menuSource = fs.readFileSync(path.join(process.cwd(), "components/photoshop/menu-bar.tsx"), "utf8")
  const dialogSource = fs.readFileSync(path.join(process.cwd(), "components/photoshop/large-document-recovery-dialog.tsx"), "utf8")
  const openIndex = menuSource.indexOf("preflightLargeDocumentImport(file, \"open\", picked)")
  const placeIndex = menuSource.indexOf("preflightLargeDocumentImport(file, \"place\", picked)")

  expect(menuSource).toContain("preflightLargeDocumentImport")
  expect(openIndex).toBeLessThan(menuSource.indexOf("deserializePsdFile(file)", openIndex))
  expect(placeIndex).toBeLessThan(menuSource.indexOf("loadRasterCanvasFromFile(file)", placeIndex))
  expect(dialogSource).toContain("Advanced Import Wizard")
  expect(dialogSource).toContain("Safe Preview / Inspect Only")
})
