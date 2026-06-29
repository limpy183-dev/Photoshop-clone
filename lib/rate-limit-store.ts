import { checkRateLimit, type RateLimitOptions } from "./marketing-store"

export interface RateLimitDecision {
  allowed: boolean
  reason?: "capacity" | "unavailable" | "unconfigured"
  retryAfterSeconds?: number
}

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
