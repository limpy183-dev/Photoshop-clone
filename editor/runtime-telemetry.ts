export type RuntimeEventType =
  | "worker-fallback"
  | "codec-failure"
  | "webgl-context-loss"
  | "storage-failure"
  | "api-adapter-outage"
  | "hydration-runtime-error"
  | "editor-boundary-error"

export type RuntimeMetadataValue = string | number | boolean | null
export type RuntimeMetadata = Record<string, RuntimeMetadataValue>

export interface RuntimeEvent {
  type: RuntimeEventType
  at: string
  metadata: RuntimeMetadata
}

const ALLOWED_METADATA_KEYS = new Set([
  "adapter",
  "attempts",
  "browser",
  "capability",
  "code",
  "component",
  "fallback",
  "operation",
  "reason",
  "recoverable",
  "status",
])
const MAX_EVENTS = 100
const events: RuntimeEvent[] = []
let telemetrySink: ((event: RuntimeEvent) => void | Promise<void>) | null = null
let telemetryEnabled = false

export function sanitizeRuntimeMetadata(input: Record<string, unknown>): RuntimeMetadata {
  const output: RuntimeMetadata = {}
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean" &&
      value !== null
    ) continue
    output[key] = typeof value === "string" ? value.slice(0, 160) : value
  }
  return output
}

export function configureRuntimeTelemetry(options: {
  enabled: boolean
  sink?: ((event: RuntimeEvent) => void | Promise<void>) | null
}) {
  telemetryEnabled = options.enabled
  telemetrySink = options.sink ?? null
}

export function emitRuntimeEvent(
  type: RuntimeEventType,
  metadata: Record<string, unknown> = {},
): RuntimeEvent {
  const event: RuntimeEvent = {
    type,
    at: new Date().toISOString(),
    metadata: sanitizeRuntimeMetadata(metadata),
  }
  events.push(event)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  if (telemetryEnabled && telemetrySink) {
    try {
      void telemetrySink(event)
    } catch {
      // Telemetry must never become another runtime failure.
    }
  }
  return event
}

export function getRuntimeEvents(): RuntimeEvent[] {
  return events.map((event) => ({ ...event, metadata: { ...event.metadata } }))
}

export function clearRuntimeEvents() {
  events.length = 0
}

