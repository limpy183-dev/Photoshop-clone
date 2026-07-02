import { existsSync } from "node:fs"
import { expect, test } from "@playwright/test"
import {
  clearRuntimeEvents,
  emitRuntimeEvent,
  getRuntimeEvents,
  sanitizeRuntimeMetadata,
} from "../components/photoshop/runtime-telemetry"
import { buildDiagnosticsExport } from "../components/photoshop/diagnostics-export"

test("runtime telemetry accepts structured diagnostics and rejects user content", () => {
  expect(sanitizeRuntimeMetadata({
    component: "filter-worker",
    reason: "worker-start-failed",
    documentPixels: new Uint8Array([1, 2, 3]),
    fileName: "private-client-design.psd",
    message: "user supplied free-form content",
    attempts: 2,
  })).toEqual({
    component: "filter-worker",
    reason: "worker-start-failed",
    attempts: 2,
  })
})

test("diagnostics export contains sanitized runtime events", () => {
  clearRuntimeEvents()
  emitRuntimeEvent("worker-fallback", {
    component: "filter-worker",
    reason: "startup-failed",
    fileName: "secret.psd",
  })

  const report = buildDiagnosticsExport({
    appVersion: "test",
    capabilities: { webgl: true },
  })

  expect(report.runtimeEvents).toEqual(getRuntimeEvents())
  expect(JSON.stringify(report)).toContain("worker-fallback")
  expect(JSON.stringify(report)).not.toContain("secret.psd")
})

test("route and editor error boundaries are present", () => {
  expect(existsSync("app/error.tsx")).toBe(true)
  expect(existsSync("app/global-error.tsx")).toBe(true)
  expect(existsSync("components/photoshop/editor-error-boundary.tsx")).toBe(true)
})

