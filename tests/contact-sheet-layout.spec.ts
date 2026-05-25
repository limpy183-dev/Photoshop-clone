import { expect, test } from "@playwright/test"

import {
  CONTACT_SHEET_PAGE_PRESETS,
  CONTACT_SHEET_TEMPLATES,
  buildContactSheetLayout,
  buildContactSheetPages,
  buildPicturePackageLayout,
  encodeStoredZip,
  exportMimeForContactSheet,
  formatContactSheetLabel,
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
    expect.arrayContaining([
      "package-2x2",
      "package-4x4",
      "wallet-8",
      "print-4x6-4up",
      "print-5x7-2up",
      "passport-photos",
      "school-portrait-pack",
      "proof-strip-12",
      "square-social-9",
      "one-8x10-two-5x7",
    ]),
  )
  expect(CONTACT_SHEET_PAGE_PRESETS.map((preset) => preset.id)).toEqual(
    expect.arrayContaining([
      "letter-portrait-300",
      "letter-landscape-300",
      "a4-portrait-300",
      "a4-landscape-300",
      "photo-4x6-300",
      "photo-8x10-300",
      "square-12x12-300",
    ]),
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

test("contact sheet pagination keeps requested rows and carries global label indexes", () => {
  const pages = buildContactSheetPages(sampleImages, {
    pageWidth: 600,
    pageHeight: 400,
    columns: 2,
    rows: 1,
    margin: 20,
    spacing: 10,
    includeLabels: true,
    labelFontSize: 10,
    labelTemplate: "Page {page}/{pages} - {index}: {name}",
  })

  expect(pages).toHaveLength(2)
  expect(pages[0]).toMatchObject({ rows: 1, columns: 2, pageIndex: 0, pageCount: 2 })
  expect(pages[1]).toMatchObject({ rows: 1, columns: 2, pageIndex: 1, pageCount: 2 })
  expect(pages[0].placements.map((placement) => placement.source.name)).toEqual(["alpha.jpg", "beta.jpg"])
  expect(pages[1].placements.map((placement) => placement.source.name)).toEqual(["gamma.jpg", "delta.jpg"])
  expect(pages[1].placements[0].index).toBe(2)
  expect(pages[1].placements[0].label).toBe("Page 2/2 - 3: gamma")
})

test("contact sheet pagination keeps an empty preview page without a source range", () => {
  const pages = buildContactSheetPages([], {
    pageWidth: 600,
    pageHeight: 400,
    columns: 2,
    rows: 2,
    margin: 20,
    spacing: 10,
    includeLabels: true,
    labelFontSize: 10,
  })

  expect(pages).toHaveLength(1)
  expect(pages[0]).toMatchObject({
    pageIndex: 0,
    pageCount: 1,
    sourceStartIndex: -1,
    sourceEndIndex: -1,
  })
  expect(pages[0].placements).toHaveLength(0)
})

test("label token templates expand filename, extension, dimensions, index, and page tokens", () => {
  expect(formatContactSheetLabel(
    { name: "portraits/Client.Final.JPG", width: 1200, height: 800 },
    {
      template: "{index}/{count} {name}.{extension} {dimensions} p{page}-{pages}",
      index: 4,
      pageIndex: 1,
      pageCount: 3,
      totalCount: 12,
    },
  )).toBe("5/12 Client.Final.JPG 1200x800 p2-3")
})

test("per-image fit and crop overrides replace global fit behavior", () => {
  const layout = buildContactSheetLayout([
    {
      name: "wide.jpg",
      width: 1000,
      height: 500,
      fitMode: "cover",
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    },
  ], {
    pageWidth: 200,
    pageHeight: 100,
    columns: 1,
    rows: 1,
    margin: 0,
    spacing: 0,
    includeLabels: false,
    labelFontSize: 12,
    fitMode: "contain",
  })

  expect(layout.placements[0].sourceRect).toMatchObject({ x: 250, y: 0, width: 500, height: 500 })
  expect(layout.placements[0].imageRect).toMatchObject({ x: 0, width: 200, height: 200 })
  expect(layout.placements[0].imageRect.y).toBeCloseTo(-50)
})

test("stored zip output writes page image entries with central directory records", () => {
  const zip = encodeStoredZip([
    { name: "contact-sheet-page-1.png", data: new Uint8Array([1, 2, 3]) },
    { name: "contact-sheet-page-2.png", data: new Uint8Array([4, 5]) },
  ])
  const text = new TextDecoder().decode(zip)

  expect(zip[0]).toBe(0x50)
  expect(zip[1]).toBe(0x4b)
  expect(text).toContain("contact-sheet-page-1.png")
  expect(text).toContain("contact-sheet-page-2.png")
  expect(zip.some((byte, index) => byte === 0x50 && zip[index + 1] === 0x4b && zip[index + 2] === 0x05 && zip[index + 3] === 0x06)).toBe(true)
})

test("contact sheet export formats map to browser canvas mime types", () => {
  expect(exportMimeForContactSheet("png")).toBe("image/png")
  expect(exportMimeForContactSheet("jpeg")).toBe("image/jpeg")
  expect(exportMimeForContactSheet("pdf")).toBe("application/pdf")
  expect(exportMimeForContactSheet("zip")).toBe("application/zip")
})
