import { expect, test } from "@playwright/test"

import { buildPrintPreviewReport } from "../components/photoshop/advanced-subsystems"
import { analyzePreflightDocument } from "../components/photoshop/preflight-engine"
import { fixtureCanvas, installFixtureDom, richFixtureDocument } from "./photoshop-fixtures"

function semiTransparentCanvas(width = 8, height = 8) {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 120
    data[i + 1] = 80
    data[i + 2] = 40
    data[i + 3] = i === 0 ? 128 : 255
  }
  canvas.getContext("2d")!.putImageData(new ImageData(data, width, height), 0, 0)
  return canvas
}

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

test("preflight warns when editable layers still contain partial alpha transparency", () => {
  const doc = richFixtureDocument()
  const transparentLayer = {
    ...doc.layers[0],
    id: "partial_alpha",
    name: "Partially Transparent Edge",
    opacity: 1,
    fillOpacity: 1,
    blendMode: "normal" as const,
    mask: null,
    canvas: semiTransparentCanvas(),
  }

  const report = analyzePreflightDocument({
    ...doc,
    layers: [transparentLayer],
  })

  expect(report.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "flatten-transparency",
        category: "separations",
        severity: "warn",
        fixAction: expect.objectContaining({ kind: "rasterize-or-flatten", autoFixable: false }),
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
