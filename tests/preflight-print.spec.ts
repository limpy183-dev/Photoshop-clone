import { expect, test } from "@playwright/test"

import { buildPrintPreviewReport } from "../components/photoshop/advanced-subsystems"
import { analyzePreflightDocument } from "../components/photoshop/preflight-engine"
import { fixtureCanvas, richFixtureDocument } from "./photoshop-fixtures"

test("preflight findings expose severity categories and fix action policy for print risks", () => {
  const doc = richFixtureDocument()
  const riskLayer = { ...doc.layers[0], opacity: 0.62, blendMode: "multiply" as const }
  const riskyDoc = {
    ...doc,
    colorMode: "RGB" as const,
    bitDepth: 8 as const,
    dpi: 96,
    layers: [riskLayer, ...doc.layers.slice(1)],
    colorManagement: undefined,
    channels: [
      ...(doc.channels ?? []),
      { id: "spot_uv", name: "Spot UV Varnish", canvas: fixtureCanvas(64, 48) },
    ],
    printSettings: {
      ...doc.printSettings!,
      bleedMm: 0,
      cropMarks: false,
      registrationMarks: false,
      proofPrint: true,
      printerProfile: "U.S. Web Coated SWOP v2" as const,
      pagePosition: "top-left" as const,
      scale: 175,
    },
  }

  const report = analyzePreflightDocument(riskyDoc)

  expect(report.scope.certifiedPrepressOutput).toBe(false)
  expect(report.counts.warn + report.counts.error).toBeGreaterThan(0)
  expect(report.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "print-resolution",
        category: "print",
        severity: "error",
        fixAction: expect.objectContaining({ autoFixable: false, kind: "warn-only" }),
      }),
      expect.objectContaining({
        id: "spot-channels",
        category: "separations",
        severity: "warn",
        fixAction: expect.objectContaining({ autoFixable: false, kind: "warn-only" }),
      }),
      expect.objectContaining({
        id: "print-marks-bleed",
        category: "print",
        severity: "warn",
        fixAction: expect.objectContaining({ autoFixable: true, kind: "set-print-defaults" }),
      }),
      expect.objectContaining({
        id: "icc-profile",
        category: "color",
        severity: "warn",
      }),
      expect.objectContaining({
        id: "overprint-transparency",
        category: "separations",
        severity: "warn",
      }),
    ]),
  )
})

test("print preview report includes machine-checkable marks geometry limitations and proof risks", () => {
  const doc = richFixtureDocument()
  const flat = fixtureCanvas(640, 480, "#3366cc")
  const settings = {
    ...doc.printSettings!,
    bleedMm: 1,
    cropMarks: true,
    registrationMarks: true,
    proofPrint: true,
    printerProfile: "Working CMYK" as const,
    marksOffsetMm: 4,
    pagePosition: "center" as const,
  }

  const report = buildPrintPreviewReport(flat, settings, doc.name, doc)

  expect(report.certifiedPrepressOutput).toBe(false)
  expect(report.marks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "crop", enabled: true }),
      expect.objectContaining({ kind: "registration", enabled: true }),
      expect.objectContaining({ kind: "center", enabled: true }),
      expect.objectContaining({ kind: "bleed", enabled: true }),
      expect.objectContaining({ kind: "label", enabled: true, label: expect.stringContaining(doc.name) }),
    ]),
  )
  expect(report.bleed.requestedMm).toBe(1)
  expect(report.risks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "bleed-below-3mm", severity: "warn" }),
      expect.objectContaining({ id: "browser-print-not-certified", severity: "info" }),
      expect.objectContaining({ id: "icc-profile-limitation", severity: "warn" }),
    ]),
  )
  expect(report.contentRect.width).toBeGreaterThan(0)
  expect(report.pagePosition).toBe("center")
})
