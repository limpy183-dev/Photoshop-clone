import { checkRateLimit, type RateLimitOptions } from "./marketing-store"

export interface RateLimitDecision {
  allowed: boolean
  reason?: "capacity" | "unavailable" | "unconfigured"
  retryAfterSeconds?: number
}

export type ConcurrencyDecision =
  | { acquired: true; release(): Promise<void> }
  | { acquired: false; reason?: RateLimitDecision["reason"]; retryAfterSeconds?: number }

function normalizeRetryAfterSeconds(value: unknown): number {
  return Math.max(1, Number(value) || 1)
}

function normalizeDeniedReason(value: unknown): RateLimitDecision["reason"] | null {
  if (value === "capacity" || value === "unavailable" || value === "unconfigured") {
    return value
  }
  return null
}

function normalizeRemoteDecision(value: unknown): RateLimitDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { allowed: false, reason: "unavailable" }
  }

  const result = value as {
    allowed?: unknown
    reason?: unknown
    retryAfterSeconds?: unknown
  }
  if (result.allowed === true) {
    return { allowed: true }
  }

  const retryAfterSeconds = normalizeRetryAfterSeconds(result.retryAfterSeconds)
  if (result.allowed !== false) {
    return { allowed: false, reason: "unavailable", retryAfterSeconds }
  }

  const reason = normalizeDeniedReason(result.reason)
  if (result.reason !== undefined && !reason) {
    return { allowed: false, reason: "unavailable", retryAfterSeconds }
  }

  return reason
    ? { allowed: false, reason, retryAfterSeconds }
    : { allowed: false, retryAfterSeconds }
}

/**
 * Shared deployments can point this adapter at an edge/Redis-backed HTTP
 * service. Production refuses to silently fall back to per-process limits.
 */
export async function checkServerRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitDecision> {
  const endpoint = process.env.RATE_LIMIT_SERVICE_URL?.trim()
  if (!endpoint) {
    const localAllowed =
      process.env.NODE_ENV !== "production" ||
      process.env.ALLOW_LOCAL_SERVER_RATE_LIMIT === "true"
    if (!localAllowed) return { allowed: false, reason: "unconfigured" }
    return checkRateLimit(key, options)
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: process.env.RATE_LIMIT_SERVICE_TOKEN
          ? `Bearer ${process.env.RATE_LIMIT_SERVICE_TOKEN}`
          : "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key,
        limit: options.limit,
        windowMs: options.windowMs,
      }),
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return { allowed: false, reason: "unavailable" }
    return normalizeRemoteDecision(await response.json())
  } catch {
    return { allowed: false, reason: "unavailable" }
  }
}

const activeConcurrency = new Map<string, number>()

export function acquireConcurrencySlot(
  key: string,
  limit: number,
  maxKeys = 1_000,
): { acquired: true; release(): void } | { acquired: false } {
  const active = activeConcurrency.get(key) ?? 0
  if (active >= limit || (!active && activeConcurrency.size >= maxKeys)) {
    return { acquired: false }
  }
  activeConcurrency.set(key, active + 1)
  let released = false
  return {
    acquired: true,
    release() {
      if (released) return
      released = true
      const next = (activeConcurrency.get(key) ?? 1) - 1
      if (next <= 0) activeConcurrency.delete(key)
      else activeConcurrency.set(key, next)
    },
  }
}

function adapterHeaders(): HeadersInit {
  return {
    authorization: process.env.RATE_LIMIT_SERVICE_TOKEN
      ? `Bearer ${process.env.RATE_LIMIT_SERVICE_TOKEN}`
      : "",
    "content-type": "application/json",
  }
}

export async function acquireServerConcurrencySlot(
  key: string,
  limit: number,
  options: { leaseMs?: number } = {},
): Promise<ConcurrencyDecision> {
  const endpoint = process.env.RATE_LIMIT_SERVICE_URL?.trim()
  if (!endpoint) {
    const localAllowed =
      process.env.NODE_ENV !== "production" ||
      process.env.ALLOW_LOCAL_SERVER_RATE_LIMIT === "true"
    if (!localAllowed) return { acquired: false, reason: "unconfigured" }
    const local = acquireConcurrencySlot(key, limit)
    return local.acquired
      ? { acquired: true, release: async () => local.release() }
      : { acquired: false }
  }

  const leaseMs = Math.max(1_000, Math.min(120_000, options.leaseMs ?? 35_000))
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: adapterHeaders(),
      body: JSON.stringify({
        operation: "acquire-concurrency",
        key,
        limit,
        leaseMs,
      }),
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return { acquired: false, reason: "unavailable" }
    const value = await response.json() as {
      allowed?: unknown
      leaseId?: unknown
      reason?: unknown
      retryAfterSeconds?: unknown
    }
    if (value.allowed !== true || typeof value.leaseId !== "string" || !value.leaseId) {
      const reason = normalizeDeniedReason(value.reason)
      return {
        acquired: false,
        ...(reason ? { reason } : {}),
        ...(value.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: normalizeRetryAfterSeconds(value.retryAfterSeconds) }),
      }
    }

    let released = false
    return {
      acquired: true,
      async release() {
        if (released) return
        released = true
        try {
          await fetch(endpoint, {
            method: "POST",
            headers: adapterHeaders(),
            body: JSON.stringify({
              operation: "release-concurrency",
              key,
              leaseId: value.leaseId,
            }),
            signal: AbortSignal.timeout(3_000),
          })
        } catch {
          // The lease expires server-side; release remains best effort.
        }
      },
    }
  } catch {
    return { acquired: false, reason: "unavailable" }
  }
}
