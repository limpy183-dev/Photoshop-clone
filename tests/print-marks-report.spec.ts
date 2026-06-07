import { expect, test } from "@playwright/test"

import { buildPrintPreviewReport } from "../components/photoshop/advanced-subsystems"
import type { PrintSettings } from "../components/photoshop/types"
import { fixtureCanvas, richFixtureDocument } from "./photoshop-fixtures"

/**
 * Regression coverage for the print preview report mark enumeration.
 *
 * The dialog (PrintWorkspace in advanced-subsystems-dialog.tsx) exposes all
 * six PrintMarkType values: crop, center-crop, registration, color-bars,
 * description, labels. Earlier the report only carried four kinds (crop,
 * registration, center, bleed, label) and conflated center-crop into
 * registration; this pinned an incomplete report. The fix is the report
 * now emits a distinct entry per mark with the right `enabled` flag.
 */

function settingsWithAllMarks(overrides: Partial<PrintSettings> = {}): PrintSettings {
  return {
    paperSize: "Letter",
    orientation: "portrait",
    scale: 100,
    bleedMm: 3,
    cropMarks: true,
    registrationMarks: true,
    centerCropMarks: true,
    colorBars: true,
    description: true,
    labels: true,
    colorHandling: "app",
    proofPrint: false,
    printerProfile: "Working CMYK",
    paperColor: "#ffffff",
    marksOffsetMm: 4,
    pagePosition: "center",
    ...overrides,
  }
}

test("print preview report emits all six mark types when enabled", () => {
  const doc = richFixtureDocument()
  const flat = fixtureCanvas(640, 480, "#3366cc")
  const report = buildPrintPreviewReport(flat, settingsWithAllMarks(), doc.name, doc)

  const kinds = new Map(report.marks.map((m) => [m.kind, m]))
  for (const kind of ["crop", "center-crop", "registration", "color-bars", "description", "labels"] as const) {
    const entry = kinds.get(kind)
    expect(entry, `${kind} mark missing from report`).toBeTruthy()
    expect(entry?.enabled, `${kind} should be enabled`).toBe(true)
  }
})

test("print preview report disables individual marks when their flag is false", () => {
  const doc = richFixtureDocument()
  const flat = fixtureCanvas(640, 480, "#3366cc")
  const report = buildPrintPreviewReport(
    flat,
    settingsWithAllMarks({ colorBars: false, description: false }),
    doc.name,
    doc,
  )
  const kinds = new Map(report.marks.map((m) => [m.kind, m]))
  expect(kinds.get("color-bars")?.enabled).toBe(false)
  expect(kinds.get("description")?.enabled).toBe(false)
  // Others stay enabled.
  expect(kinds.get("crop")?.enabled).toBe(true)
  expect(kinds.get("center-crop")?.enabled).toBe(true)
  expect(kinds.get("labels")?.enabled).toBe(true)
})

test("print preview report reserves extra padding when only an extended mark (labels) is on", () => {
  const doc = richFixtureDocument()
  const flat = fixtureCanvas(320, 240, "#aabbcc")

  const noMarks = buildPrintPreviewReport(
    flat,
    settingsWithAllMarks({
      cropMarks: false,
      registrationMarks: false,
      centerCropMarks: false,
      colorBars: false,
      description: false,
      labels: false,
      bleedMm: 0,
    }),
    doc.name,
    doc,
  )

  const labelsOnly = buildPrintPreviewReport(
    flat,
    settingsWithAllMarks({
      cropMarks: false,
      registrationMarks: false,
      centerCropMarks: false,
      colorBars: false,
      description: false,
      labels: true,
      bleedMm: 0,
    }),
    doc.name,
    doc,
  )

  // Padding lives on trimRect.x — it grows when any mark needs room outside
  // the page edge. The pre-fix code only widened the pad for crop+registration
  // and bleed, leaving labels squashed against the page edge.
  expect(labelsOnly.trimRect.x).toBeGreaterThan(noMarks.trimRect.x)
})
