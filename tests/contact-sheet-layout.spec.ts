import { expect, test } from "@playwright/test"

import {
  CONTACT_SHEET_TEMPLATES,
  buildContactSheetLayout,
  buildPicturePackageLayout,
  exportMimeForContactSheet,
} from "../components/photoshop/contact-sheet"

const sampleImages = [
  { name: "alpha.jpg", width: 800, height: 400 },
  { name: "beta.jpg", width: 300, height: 900 },
  { name: "gamma.jpg", width: 600, height: 600 },
  { name: "delta.jpg", width: 1200, height: 800 },
]

test("contact sheet layout expands rows to fit all imported images and reserves label space", () => {
  const layout = buildContactSheetLayout(sampleImages, {
    pageWidth: 900,
    pageHeight: 600,
    columns: 3,
    rows: 1,
    margin: 30,
    spacing: 15,
    includeLabels: true,
    labelFontSize: 12,
  })

  expect(layout.columns).toBe(3)
  expect(layout.rows).toBe(2)
  expect(layout.placements).toHaveLength(4)
  expect(layout.labelHeight).toBe(26)
  expect(layout.placements[0].slot).toMatchObject({ x: 30, y: 30 })
  expect(layout.placements[0].slot.width).toBeCloseTo(270)
  expect(layout.placements[0].imageRect.width).toBeCloseTo(270)
  expect(layout.placements[0].imageRect.height).toBeCloseTo(135)
  expect(layout.placements[0].labelRect?.y).toBeCloseTo(266.5)
  expect(layout.placements[3].slot.y).toBeCloseTo(307.5)
})

test("picture package templates expose common print grids and repeat imported images through slots", () => {
  expect(CONTACT_SHEET_TEMPLATES.map((template) => template.id)).toEqual(
    expect.arrayContaining(["package-2x2", "package-4x4", "wallet-8"]),
  )

  const layout = buildPicturePackageLayout(sampleImages.slice(0, 2), {
    templateId: "wallet-8",
    pageWidth: 800,
    pageHeight: 1000,
    margin: 40,
    spacing: 16,
    includeLabels: false,
    labelFontSize: 12,
  })

  expect(layout.placements).toHaveLength(8)
  expect(layout.placements.map((placement) => placement.source.name).slice(0, 4)).toEqual([
    "alpha.jpg",
    "beta.jpg",
    "alpha.jpg",
    "beta.jpg",
  ])
  expect(layout.placements[0].slot.width).toBeCloseTo(168)
  expect(layout.placements[0].slot.height).toBeCloseTo(235.2)
})

test("contact sheet export formats map to browser canvas mime types", () => {
  expect(exportMimeForContactSheet("png")).toBe("image/png")
  expect(exportMimeForContactSheet("jpeg")).toBe("image/jpeg")
})
