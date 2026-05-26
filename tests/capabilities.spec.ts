import { expect, test } from "@playwright/test"

import {
  CAPABILITY_STATUS_ORDER,
  capabilityWarningsForDocument,
  getCapability,
  listCapabilities,
  summarizeCapabilities,
} from "../components/photoshop/capabilities"
import { capabilityForAdvancedFormat } from "../components/photoshop/advanced-subsystems"
import { createDocumentReport } from "../components/photoshop/document-io"

test("capability registry classifies required report tracks", () => {
  expect(CAPABILITY_STATUS_ORDER).toEqual(["complete", "usable", "approximation", "stub", "unsupported"])
  expect(getCapability("tool.quick-selection").status).toBe("usable")
  expect(getCapability("tool.object-aware-selection").status).toBe("usable")
  expect(getCapability("tool.selection-matting").status).toBe("usable")
  expect(getCapability("tool.magnetic-lasso").status).toBe("usable")
  expect(getCapability("format.psb").status).toBe("usable")
  expect(getCapability("format.openexr").status).toBe("approximation")
  expect(getCapability("format.baseline-tiff").status).toBe("usable")
  expect(getCapability("format.tga-pnm").status).toBe("usable")
  expect(getCapability("color.high-bit-pipeline").status).toBe("usable")
  expect(getCapability("workflow.photomerge").status).toBe("usable")
  expect(getCapability("external.generative-fill").status).toBe("usable")
})

test("capability registry exposes summaries by kind", () => {
  const summary = summarizeCapabilities(listCapabilities({ kind: "format" }))

  expect(summary.usable).toBeGreaterThan(0)
  expect(summary.approximation).toBeGreaterThan(0)
  expect(summary.usable + summary.approximation + summary.unsupported).toBeGreaterThan(5)
})

test("document capability warnings explain browser pixel and color limitations", () => {
  const warnings = capabilityWarningsForDocument({
    colorMode: "CMYK",
    bitDepth: 16,
    layers: [{ kind: "smart-object", smartFilters: [{ enabled: true }] }],
  })

  expect(warnings.some((warning) => warning.label === "Browser pixel pipeline")).toBe(true)
  expect(warnings.some((warning) => warning.label === "Color mode")).toBe(true)
  expect(warnings.some((warning) => warning.label === "Smart filters")).toBe(true)
})

test("smart object capability wording reflects relink polling and materialization support", () => {
  const capability = getCapability("smart-object.linked")
  const warnings = capabilityWarningsForDocument({
    colorMode: "RGB",
    bitDepth: 8,
    layers: [{ kind: "smart-object", smartObject: true }],
  })
  const lifecycle = warnings.find((warning) => warning.label === "Smart object lifecycle")

  expect(capability.summary).toContain("permission-aware relink")
  expect(capability.summary).toContain("polling")
  expect((capability.limitations ?? []).join(" ")).not.toContain("No native file watcher")
  expect(lifecycle?.detail).toContain("polling")
  expect(lifecycle?.detail).not.toContain("incomplete")
})

test("document reports include capability-derived interoperability warnings", () => {
  const report = createDocumentReport({
    id: "doc_test",
    name: "Interop Test",
    width: 64,
    height: 64,
    zoom: 1,
    layers: [
      {
        id: "layer_1",
        name: "Smart",
        kind: "smart-object",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        smartFilters: [{ id: "sf_1", filterId: "gaussian-blur", name: "Gaussian Blur", enabled: true, params: {} }],
      },
    ],
    activeLayerId: "layer_1",
    selectedLayerIds: ["layer_1"],
    background: "#ffffff",
    colorMode: "CMYK",
    bitDepth: 16,
    selection: { bounds: null, shape: "rect" },
  } as never, "PSD Export")

  expect(report.items.some((item) => item.label === "Browser pixel pipeline")).toBe(true)
  expect(report.items.some((item) => item.label === "High-bit editing")).toBe(true)
  expect(report.items.some((item) => item.label === "Raster export")).toBe(true)
})

test("advanced format strategy aligns with capability registry limits", () => {
  expect(capabilityForAdvancedFormat("sample.psb").support).toBe("native")
  expect(capabilityForAdvancedFormat("sample.exr").support).toBe("preview")
  expect(capabilityForAdvancedFormat("sample.pdf").support).toBe("preview")
  expect(capabilityForAdvancedFormat("sample.heic", "image/heic").support).toBe("preview")
  expect(capabilityForAdvancedFormat("sample.hdr").support).toBe("preview")
  expect(capabilityForAdvancedFormat("sample.dng").support).toBe("preview")

  expect(getCapability("format.psb").status).toBe("usable")
  expect(getCapability("format.openexr").status).toBe("approximation")
  expect(getCapability("format.pdf").status).toBe("approximation")
  expect(getCapability("format.heif").status).toBe("approximation")
  expect(getCapability("format.radiance-hdr").status).toBe("usable")
  expect(getCapability("format.raw-dng").status).toBe("approximation")
})

test("advanced browser raster wording is reconciled with export and color capabilities", () => {
  const browserRaster = capabilityForAdvancedFormat("sample.png")
  const exportCapability = getCapability("export.browser-raster")
  const colorCapability = getCapability("color.icc-conversion")

  expect(exportCapability.summary).toMatch(/ICC/i)
  expect(colorCapability.summary).toMatch(/export/i)
  expect(browserRaster.exportPath).toMatch(/metadata|ICC|profile/i)
  expect(browserRaster.limitations).not.toMatch(/ICC profiles are not converted/i)
})
