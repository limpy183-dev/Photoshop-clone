import { getRuntimeEvents } from "./runtime-telemetry"

export interface DiagnosticsExportInput {
  appVersion: string
  capabilities?: Record<string, boolean | number | string | null>
  recovery?: {
    available: boolean
    lastSuccessfulAutosaveAt: string | null
  }
}

export interface DiagnosticsExport {
  schemaVersion: 1
  generatedAt: string
  appVersion: string
  runtime: {
    userAgent: string | null
    language: string | null
  }
  capabilities: Record<string, boolean | number | string | null>
  recovery: {
    available: boolean
    lastSuccessfulAutosaveAt: string | null
  }
  runtimeEvents: ReturnType<typeof getRuntimeEvents>
}

export function buildDiagnosticsExport(input: DiagnosticsExportInput): DiagnosticsExport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    appVersion: input.appVersion,
    runtime: {
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
      language: typeof navigator === "undefined" ? null : navigator.language,
    },
    capabilities: { ...(input.capabilities ?? {}) },
    recovery: {
      available: input.recovery?.available ?? false,
      lastSuccessfulAutosaveAt: input.recovery?.lastSuccessfulAutosaveAt ?? null,
    },
    runtimeEvents: getRuntimeEvents(),
  }
}

export function downloadDiagnosticsExport(input: DiagnosticsExportInput) {
  if (typeof document === "undefined") return
  const blob = new Blob([`${JSON.stringify(buildDiagnosticsExport(input), null, 2)}\n`], {
    type: "application/json",
  })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.download = "photoshop-web-diagnostics.json"
  anchor.click()
  URL.revokeObjectURL(href)
}
