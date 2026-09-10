import { describe, expect, it } from "vitest"
import { createDocumentPath, removeDocumentPath, renameDocumentPath, upsertDocumentPath } from "../../components/photoshop/document-paths"
import { buildExportPreflight } from "../../components/photoshop/export-preflight"
import { preflightDecoderDimensions } from "../../components/photoshop/decoder-preflight"

describe("completeness foundations", () => {
  it("manages independent document path records", () => {
    const path = createDocumentPath({ id: "work", name: "Work Path", kind: "work", path: { points: [{ x: 1, y: 2 }], closed: false }, now: 10 })
    const renamed = renameDocumentPath(path, "Saved Path", 20)
    const updated = upsertDocumentPath([], renamed)
    expect(updated[0].name).toBe("Saved Path")
    expect(removeDocumentPath(updated, "work")).toEqual([])
  })

  it("reports lossy PSD export conditions", () => {
    const findings = buildExportPreflight({ format: "psd", colorMode: "CMYK", bitDepth: 16, hasProxyAdjustments: true })
    expect(findings.map((finding) => finding.id)).toEqual(["psd-rgb8", "proxy-adjustments"])
  })

  it("rejects oversized decoded allocations before decode", () => {
    const result = preflightDecoderDimensions({ width: 10000, height: 10000, channels: 4, bitDepth: 8 }, { maxWidth: 12000, maxHeight: 12000, maxPixels: 33_200_000, maxBytes: 128 * 1024 * 1024 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("pixels")
  })
})
