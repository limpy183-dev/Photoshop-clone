const ALLOWED_DIMENSIONS = new Set([
  "adapter",
  "operation",
  "outcome",
  "reason",
  "status",
])

export function recordOperationalMetric(
  name: string,
  dimensions: Record<string, unknown>,
): void {
  const sanitized: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(dimensions)) {
    if (!ALLOWED_DIMENSIONS.has(key)) continue
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean" &&
      value !== null
    ) continue
    sanitized[key] = typeof value === "string" ? value.slice(0, 80) : value
  }
  console.info(`[metric] ${name.slice(0, 80)}`, sanitized)
}
