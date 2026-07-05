export interface BundleViolation {
  rule?: unknown
  route?: unknown
  file?: unknown
  value?: unknown
  bytes?: unknown
  decodedBodyBytes?: unknown
  budget?: unknown
}

export interface BundleReportLike {
  violations?: unknown
}

function violationValue(violation: BundleViolation): unknown {
  return violation.value ?? violation.bytes ?? violation.decodedBodyBytes ?? "unknown"
}

export function assertBundleReportHasNoViolations(report: BundleReportLike): void {
  if (!Array.isArray(report.violations)) {
    throw new Error("Bundle report is missing a violations array.")
  }
  if (report.violations.length === 0) return

  const details = report.violations.map((raw) => {
    const violation = (raw && typeof raw === "object" ? raw : {}) as BundleViolation
    const owner = violation.route ?? violation.file ?? "bundle"
    return `${String(owner)} ${String(violation.rule ?? "unknown")}: ${String(violationValue(violation))} exceeds ${String(violation.budget ?? "unknown")}`
  })
  throw new Error(`Bundle report contains ${details.length} violation(s):\n${details.join("\n")}`)
}
