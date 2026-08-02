export type ExportPreflightSeverity = "info" | "warning" | "error"

export interface ExportPreflightFinding {
  id: string
  severity: ExportPreflightSeverity
  title: string
  detail: string
  remedy?: string
}

export interface ExportPreflightInput {
  format: string
  colorMode?: string
  bitDepth?: number
  hasProxyAdjustments?: boolean
  hasAppOnlyMetadata?: boolean
  hasLargeDocument?: boolean
}

export function buildExportPreflight(input: ExportPreflightInput): ExportPreflightFinding[] {
  const findings: ExportPreflightFinding[] = []
  const format = input.format.toLowerCase()
  if (format === "psd" && ((input.colorMode && input.colorMode !== "RGB") || (input.bitDepth && input.bitDepth !== 8))) {
    findings.push({ id: "psd-rgb8", severity: "warning", title: "PSD export will use the browser RGB/8-bit writer", detail: `Source intent is ${input.colorMode ?? "RGB"} ${input.bitDepth ?? 8}-bit, but the current PSD writer emits RGB/8-bit pixels.`, remedy: "Use the project format or a native color-managed editor when preserving source pixel precision matters." })
  }
  if (input.hasProxyAdjustments) findings.push({ id: "proxy-adjustments", severity: "warning", title: "Some adjustments will export as proxy layers", detail: "Adjustments without native PSD descriptors are represented by visually similar proxy adjustments plus app metadata.", remedy: "Keep a project-format copy for editable recovery." })
  if (input.hasAppOnlyMetadata) findings.push({ id: "app-metadata", severity: "info", title: "App-only metadata may not survive third-party editing", detail: "Some local metadata uses an application preservation envelope that other editors may ignore." })
  if (input.hasLargeDocument) findings.push({ id: "large-document", severity: "warning", title: "Large-document memory limits apply", detail: "Native layered export may exceed browser canvas, file or heap limits.", remedy: "Use tile-sequence export or export from a desktop tool for very large documents." })
  return findings
}
