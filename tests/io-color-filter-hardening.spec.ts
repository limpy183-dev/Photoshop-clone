import { expect, test } from "@playwright/test"

import {
  createCompatibilityManifest,
  createDocumentReport,
  createExportLimitationReport,
} from "../components/photoshop/document-io"
import { describeDocumentColorHonesty } from "../components/photoshop/color-pipeline"
import { applyFilterAsync, applyFilterTiled, getFilterWorkerSupport, isFilterWorkerSupported } from "../components/photoshop/filter-worker"
import { richFixtureDocument } from "./photoshop-fixtures"
import type { Page } from "@playwright/test"

async function openCommand(page: Page, query: string) {
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
  await page.keyboard.press("Enter")
}

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

function fixturePixels() {
  return [
    0, 0, 0, 255, 64, 64, 64, 255, 255, 255, 255, 255,
    32, 64, 96, 255, 128, 160, 192, 255, 240, 200, 160, 255,
    10, 20, 30, 255, 90, 100, 110, 255, 220, 230, 240, 255,
  ]
}

test("round-trip compatibility manifest classifies app-only features by target", () => {
  const doc = richFixtureDocument()
  const project = createCompatibilityManifest(doc, "project")
  const psd = createCompatibilityManifest(doc, "psd")
  const raster = createCompatibilityManifest(doc, "browser-raster")
  const report = createDocumentReport(doc, "PSD Export")

  expect(project.totals.preserved).toBeGreaterThan(psd.totals.preserved)
  expect(psd.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Guides", status: "unsupported" }),
      expect.objectContaining({ label: "Slices", status: "unsupported" }),
      expect.objectContaining({ label: "Smart object sources", status: "approximated" }),
    ]),
  )
  expect(raster.entries.find((entry) => entry.label === "Layer structure")?.status).toBe("flattened")
  expect(report.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Compatibility manifest" })]))
})

test("export limitation reports are explicit for browser raster and SVG exports", () => {
  const doc = richFixtureDocument()
  const png = createExportLimitationReport(doc, { format: "png", includeMetadata: true, interlaced: true })
  const jpeg = createExportLimitationReport(doc, { format: "jpeg", includeMetadata: true, progressive: true, quality: 82 })
  const svg = createExportLimitationReport(doc, { format: "svg", includeMetadata: true })

  expect(png.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Interlaced PNG", status: "unsupported" })]))
  expect(jpeg.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Progressive JPEG", status: "unsupported" })]))
  expect(jpeg.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "ICC profile embedding", status: "unsupported" })]))
  expect(svg.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Editable vector structure", status: "flattened" })]))
})

test("document color honesty warns about metadata modes versus browser canvas reality", () => {
  const doc = richFixtureDocument()
  const report = describeDocumentColorHonesty(doc)

  expect(report.badge).toBe("CMYK/16-bit metadata, 8-bit RGBA canvas")
  expect(report.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Browser canvas path", severity: "warn" }),
      expect.objectContaining({ label: "CMYK separations", severity: "warn" }),
      expect.objectContaining({ label: "High-bit editing", severity: "warn" }),
      expect.objectContaining({ label: "ICC transforms", severity: "warn" }),
    ]),
  )
})

test("status bar exposes color and bit-depth honesty warning for non-RGB or high-bit documents", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await openCommand(page, "New Document")
  await expect(page.getByRole("dialog", { name: "New Document" })).toBeVisible()
  await page.getByRole("button", { name: /Photo 6 x 4 in/ }).click()
  await page.getByRole("button", { name: "Create" }).click()

  await expect(page.getByText("16-bit metadata, 8-bit RGBA canvas")).toBeVisible()
})

test("expanded worker filters include Gaussian blur with a fixed golden output", async () => {
  const src = imageData(3, 3, fixturePixels())
  const expected = [
    81, 89, 97, 255, 115, 120, 124, 255, 149, 150, 151, 255,
    82, 92, 101, 255, 115, 121, 127, 255, 149, 151, 153, 255,
    83, 95, 105, 255, 116, 123, 130, 255, 148, 152, 156, 255,
  ]

  expect(getFilterWorkerSupport().supportedFilters).toContain("gaussian-blur")
  expect(isFilterWorkerSupported("gaussian-blur")).toBe(true)

  const actual = await applyFilterAsync("gaussian-blur", src, { radius: 3 })
  expect(Array.from(actual.data)).toEqual(expected)
})

test("tiled Gaussian filtering preserves full-frame output with overlap", async () => {
  const src = imageData(3, 3, fixturePixels())
  const expected = await applyFilterAsync("gaussian-blur", src, { radius: 3 })
  const tiled = await applyFilterTiled("gaussian-blur", src, { radius: 3 }, { tileSize: 2, overlap: 3, useWorker: true })

  expect(Array.from(tiled.data)).toEqual(Array.from(expected.data))
})
