import type { DocumentReport } from "./types"
import { uid } from "./uid"

type SafeJsonLimits = {
  maxString: number
  maxArray: number
  maxKeys: number
  maxDepth: number
}

export interface ProjectSanitizationDiagnostics {
  truncatedFields: string[]
}

export const SAFE_JSON_DEFAULT_LIMITS: SafeJsonLimits = {
  maxString: 4000,
  maxArray: 1024,
  maxKeys: 256,
  maxDepth: 6,
}

// Raised limits for project fields that legitimately carry large payloads
// (metadata.psdNativeSource base64, asset library fonts/ICC profiles,
// timeline frame thumbnails, plugin storage, layer-comp state snapshots).
// Truncating these silently corrupts the document on the next save, so
// callers should surface the returned diagnostics to users.
export const PROJECT_PAYLOAD_LIMITS: SafeJsonLimits = {
  maxString: 16_000_000,
  maxArray: 10_000,
  maxKeys: 4096,
  maxDepth: 12,
}

const PROJECT_RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])
const SAFE_JSON_KEY = /^[A-Za-z0-9_\-:.]{1,64}$/

function safeJsonValue(
  value: unknown,
  depth = 0,
  limits: SafeJsonLimits = SAFE_JSON_DEFAULT_LIMITS,
  state: { truncated: boolean } = { truncated: false },
): unknown {
  if (value === null) return null
  const type = typeof value
  if (type === "string") {
    if ((value as string).length > limits.maxString) state.truncated = true
    return (value as string).slice(0, limits.maxString)
  }
  if (type === "boolean") return value
  if (type === "number") {
    return Number.isFinite(value as number) ? value : undefined
  }
  if (type === "function" || type === "symbol" || type === "bigint" || type === "undefined") {
    return undefined
  }
  if (depth >= limits.maxDepth) {
    state.truncated = true
    return undefined
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArray) state.truncated = true
    const out: unknown[] = []
    for (const item of value.slice(0, limits.maxArray)) {
      const next = safeJsonValue(item, depth + 1, limits, state)
      if (next !== undefined) out.push(next)
    }
    return out
  }
  if (type === "object") {
    const out: Record<string, unknown> = {}
    let keysCopied = 0
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (keysCopied >= limits.maxKeys) {
        state.truncated = true
        break
      }
      if (PROJECT_RESERVED_KEYS.has(key)) continue
      if (!SAFE_JSON_KEY.test(key)) continue
      const cleaned = safeJsonValue(nested, depth + 1, limits, state)
      if (cleaned === undefined) continue
      out[key] = cleaned
      keysCopied += 1
    }
    return out
  }
  return undefined
}

function warnIfTruncated(
  state: { truncated: boolean },
  field?: string,
  diagnostics?: ProjectSanitizationDiagnostics,
) {
  if (!state.truncated) return
  const label = field ?? "value"
  console.warn(`Project field "${label}" exceeded sanitiser limits and was truncated on load.`)
  if (diagnostics && !diagnostics.truncatedFields.includes(label)) diagnostics.truncatedFields.push(label)
}

export function safeJsonArray<T>(
  value: unknown,
  limits: SafeJsonLimits = SAFE_JSON_DEFAULT_LIMITS,
  field?: string,
  diagnostics?: ProjectSanitizationDiagnostics,
): T[] | undefined {
  const state = { truncated: false }
  const cleaned = safeJsonValue(value, 0, limits, state)
  warnIfTruncated(state, field, diagnostics)
  return Array.isArray(cleaned) ? (cleaned as T[]) : undefined
}

export function safeJsonObject<T extends object>(
  value: unknown,
  limits: SafeJsonLimits = SAFE_JSON_DEFAULT_LIMITS,
  field?: string,
  diagnostics?: ProjectSanitizationDiagnostics,
): T | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const state = { truncated: false }
  const cleaned = safeJsonValue(value, 0, limits, state)
  warnIfTruncated(state, field, diagnostics)
  return cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)
    ? (cleaned as T)
    : undefined
}

export function createProjectSanitizationReport(
  documentName: string,
  diagnostics: ProjectSanitizationDiagnostics,
): DocumentReport | undefined {
  if (!diagnostics.truncatedFields.length) return undefined
  return {
    id: uid("report"),
    title: `Project Import: ${documentName}`,
    createdAt: Date.now(),
    source: "Project Import",
    items: diagnostics.truncatedFields.map((field) => ({
      label: "Sanitizer warning",
      status: "approximated" as const,
      detail: `Project field "${field}" exceeded sanitiser limits and was truncated on load.`,
    })),
  }
}
