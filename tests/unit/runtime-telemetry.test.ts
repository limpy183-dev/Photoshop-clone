import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearRuntimeEvents,
  configureRuntimeTelemetry,
  emitRuntimeEvent,
  getRuntimeEvents,
  sanitizeRuntimeMetadata,
} from "../../components/photoshop/runtime-telemetry"
import { buildDiagnosticsExport } from "../../components/photoshop/diagnostics-export"
import { getStorageResourceRegistry } from "../../components/photoshop/storage-registry"

describe("runtime diagnostics", () => {
  beforeEach(() => {
    clearRuntimeEvents()
    configureRuntimeTelemetry({ enabled: false })
  })

  it("drops user content and binary data", () => {
    expect(sanitizeRuntimeMetadata({
      component: "codec",
      reason: "decode-failed",
      fileName: "private.psd",
      message: "free form",
      pixels: new Uint8Array([1]),
    })).toEqual({
      component: "codec",
      reason: "decode-failed",
    })
  })

  it("only sends events when telemetry is opted in", () => {
    const sink = vi.fn()
    configureRuntimeTelemetry({ enabled: false, sink })
    emitRuntimeEvent("codec-failure", { component: "jpeg", reason: "unsupported" })
    expect(sink).not.toHaveBeenCalled()

    configureRuntimeTelemetry({ enabled: true, sink })
    emitRuntimeEvent("worker-fallback", { component: "filter-worker", reason: "startup" })
    expect(sink).toHaveBeenCalledTimes(1)
    expect(getRuntimeEvents()).toHaveLength(2)
  })

  it("exports registered capabilities and sanitized events", () => {
    emitRuntimeEvent("storage-failure", { component: "opfs", reason: "quota" })
    const report = buildDiagnosticsExport({
      appVersion: "test",
      capabilities: { webgl: true },
      recovery: {
        available: true,
        lastSuccessfulAutosaveAt: "2026-07-03T10:00:00.000Z",
      },
    })
    expect(report.schemaVersion).toBe(1)
    expect(report.capabilities.webgl).toBe(true)
    expect(report.runtimeEvents[0].type).toBe("storage-failure")
    expect(report.recovery).toEqual({
      available: true,
      lastSuccessfulAutosaveAt: "2026-07-03T10:00:00.000Z",
    })
  })
})

describe("storage registry", () => {
  it("governs every registered resource", () => {
    for (const item of getStorageResourceRegistry()) {
      expect(item.owner).not.toBe("")
      expect(item.migrationVersions).toHaveLength(3)
      expect(item.quotaPolicy).not.toBe("")
    }
  })
})
