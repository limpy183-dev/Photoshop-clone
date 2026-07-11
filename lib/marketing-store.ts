import { createReadStream, promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { readBoundedJsonResponse } from "./bounded-json"
import { isAuthenticatedServiceConfigured } from "./remote-service"

/**
 * Lightweight JSON-Lines-ish store used by the marketing API routes.
 *
 * Records are written one-per-line as JSON to keep the file safe to
 * `cat` / inspect from the repo root. We dedupe on the optional `id`
 * field — primarily so the subscribe endpoint never adds the same
 * email twice.
 */
const DATA_DIR = path.join(process.cwd(), ".data")
const DEFAULT_MAX_RECORDS = 5_000
const DEFAULT_MAX_BYTES = 1_000_000

let writeChain: Promise<unknown> = Promise.resolve()
const recordCountCache = new Map<string, number>()
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
let lastRateLimitPruneAt = 0

export const MARKETING_LIMITS = {
  feedback: {
    bodyBytes: 8 * 1024,
    rateLimit: { limit: 10, windowMs: 10 * 60 * 1000 },
    store: { maxBytes: 1_000_000, maxRecords: 1_000 },
  },
  subscribers: {
    bodyBytes: 2 * 1024,
    rateLimit: { limit: 5, windowMs: 10 * 60 * 1000 },
    store: { maxBytes: 1_000_000, maxRecords: 5_000 },
  },
} as const

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.")
    this.name = "RequestBodyTooLargeError"
  }
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("Body must be valid JSON.")
    this.name = "InvalidJsonBodyError"
  }
}

export type MarketingStoreQuotaReason = "quota-exceeded" | "record-quota" | "byte-quota"
export type MarketingStoreUnavailableReason =
  | "invalid-response"
  | "request-failed"
  | "unconfigured"
  | "upstream-timeout"
  | "upstream-unavailable"

export class MarketingStoreQuotaError extends Error {
  reason: MarketingStoreQuotaReason

  constructor(
    message = "Marketing store quota exceeded.",
    reason: MarketingStoreQuotaReason = "quota-exceeded",
  ) {
    super(message)
    this.name = "MarketingStoreQuotaError"
    this.reason = reason
  }
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

function filePath(name: string): string {
  return path.join(DATA_DIR, `${name}.jsonl`)
}

export type StoredRecord = Record<string, unknown> & {
  id?: string
  createdAt?: string
}

export type AppendRecordOptions = {
  dedupeById?: boolean
  maxBytes?: number
  maxRecords?: number
}

export type RateLimitOptions = {
  limit: number
  maxBuckets?: number
  now?: number
  windowMs: number
}

export class MarketingStoreUnavailableError extends Error {
  reason: MarketingStoreUnavailableReason

  constructor(
    message = "Marketing record storage is unavailable.",
    reason: MarketingStoreUnavailableReason = "upstream-unavailable",
  ) {
    super(message)
    this.name = "MarketingStoreUnavailableError"
    this.reason = reason
  }
}

/**
 * Resolve the client IP from a request.
 *
 * Untrusted-proxy mode (default): we read no proxy headers because any
 * upstream client could spoof X-Forwarded-For and bypass per-IP rate
 * limits. Behind a trusted reverse proxy (Vercel, Cloudflare, an internal
 * NGINX/Envoy that strips and rewrites the header) set
 * `MARKETING_TRUSTED_PROXY=true` so we honour the platform-provided
 * forwarded-for chain.
 *
 * When trusted-proxy mode is on we prefer the platform-specific single-
 * IP headers (`cf-connecting-ip`, `x-vercel-forwarded-for`, `x-real-ip`)
 * before falling back to the leftmost entry of `x-forwarded-for`, which
 * is the conventional "client closest to the proxy chain" address.
 */
export function getClientIp(request: Request): string {
  const trustProxy =
    process.env.MARKETING_TRUSTED_PROXY === "true" ||
    process.env.MARKETING_TRUSTED_PROXY === "1"
  if (!trustProxy) {
    return getClientFingerprint(request)
  }
  const cfIp = request.headers.get("cf-connecting-ip")?.trim()
  if (cfIp) return cfIp
  const vercelIp = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
  if (vercelIp) return vercelIp
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  const forwarded = request.headers.get("x-forwarded-for")
  const forwardedIp = forwarded?.split(",")[0]?.trim()
  return forwardedIp || getClientFingerprint(request)
}

function getClientFingerprint(request: Request): string {
  const parts = [
    request.headers.get("user-agent")?.trim().slice(0, 512) ?? "",
    request.headers.get("accept-language")?.trim().slice(0, 256) ?? "",
    request.headers.get("sec-ch-ua-platform")?.trim().slice(0, 128) ?? "",
  ]
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 24)
  return `fingerprint:${digest}`
}

/**
 * Reject cross-origin POSTs.
 *
 * Browsers send `Origin` for all POSTs and `Sec-Fetch-Site` on every
 * request from any browser issued in the last few years. We accept the
 * request only when:
 *   - both headers are absent (likely a legitimate non-browser client
 *     such as curl/playwright; Origin can be absent for same-origin
 *     POSTs in some legacy browsers), OR
 *   - the Origin matches PUBLIC_ORIGIN exactly, OR
 *   - Sec-Fetch-Site is "same-origin" or "none".
 *
 * PUBLIC_ORIGIN should be set to the deployed origin (e.g.
 * "https://photoshop.example"). When unset, we fall back to verifying
 * Sec-Fetch-Site only — Origin will already match same-origin in that
 * case.
 */
export function isAllowedOrigin(
  request: Request,
  options: { requireRequestMetadata?: boolean } = {},
): boolean {
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  const publicOrigin = process.env.PUBLIC_ORIGIN?.trim()

  // Sec-Fetch-Site is the strongest signal when present.
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return true
    if (fetchSite === "same-site") {
      // Allow same-site only when Origin matches the configured PUBLIC_ORIGIN
      // (a sibling subdomain on the same registrable domain is still
      // attacker-controlled in many setups).
      if (publicOrigin && origin === publicOrigin) return true
      return false
    }
    // cross-site -> reject
    return false
  }

  // No Sec-Fetch-Site (very old browser or non-browser client). Fall back
  // to Origin comparison.
  if (origin) {
    if (publicOrigin) return origin === publicOrigin
    // Without PUBLIC_ORIGIN we cannot prove the request is same-origin.
    // Accept it only if the request also lacks Origin (handled below).
    return false
  }

  // Paid/browser-only capabilities must not treat generic scripted clients as
  // same-origin merely because both browser metadata headers are absent.
  return options.requireRequestMetadata !== true
}

export function checkRateLimit(
  key: string,
  { limit, maxBuckets = 10_000, now = Date.now(), windowMs }: RateLimitOptions,
): { allowed: boolean; retryAfterSeconds?: number; reason?: "capacity" } {
  if (now - lastRateLimitPruneAt > windowMs) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) {
        rateLimitBuckets.delete(bucketKey)
      }
    }
    lastRateLimitPruneAt = now
  }

  const bucket = rateLimitBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && rateLimitBuckets.size >= maxBuckets) {
      let nextResetAt = now + windowMs
      for (const candidate of rateLimitBuckets.values()) {
        nextResetAt = Math.min(nextResetAt, candidate.resetAt)
      }
      return {
        allowed: false,
        reason: "capacity",
        retryAfterSeconds: Math.max(1, Math.ceil((nextResetAt - now) / 1000)),
      }
    }
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    }
  }

  bucket.count += 1
  return { allowed: true }
}

export async function readJsonWithLimit(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length")
  if (contentLength) {
    const contentBytes = Number(contentLength)
    if (Number.isFinite(contentBytes) && contentBytes > maxBytes) {
      throw new RequestBodyTooLargeError()
    }
  }

  const text = await readTextWithLimit(request, maxBytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new InvalidJsonBodyError()
  }
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) {
    return ""
  }

  const decoder = new TextDecoder()
  const chunks: string[] = []
  let receivedBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    receivedBytes += value.byteLength
    if (receivedBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new RequestBodyTooLargeError()
    }

    chunks.push(decoder.decode(value, { stream: true }))
  }

  chunks.push(decoder.decode())
  return chunks.join("")
}

export async function readAll<T extends StoredRecord>(name: string): Promise<T[]> {
  await ensureDataDir()
  const file = filePath(name)
  let raw: string
  try {
    raw = await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
  const records = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as T
      } catch {
        return null
      }
    })
    .filter((value): value is T => value !== null)
  recordCountCache.set(name, records.length)
  return records
}

function normalizeQuotaReason(value: unknown): MarketingStoreQuotaReason {
  return value === "record-quota" || value === "byte-quota" ? value : "quota-exceeded"
}

function normalizeUnavailableReason(value: unknown): MarketingStoreUnavailableReason {
  if (
    value === "invalid-response" ||
    value === "request-failed" ||
    value === "unconfigured" ||
    value === "upstream-timeout" ||
    value === "upstream-unavailable"
  ) {
    return value
  }
  if (value === "unavailable") return "upstream-unavailable"
  return "upstream-unavailable"
}

async function readRemoteStorePayload(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const payload = await readBoundedJsonResponse(response)
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function isTimeoutError(error: unknown) {
  return error instanceof DOMException && error.name === "TimeoutError"
}

export async function appendRecord<T extends StoredRecord>(
  name: string,
  record: T,
  options: AppendRecordOptions = {},
): Promise<{ added: boolean; total: number; record: T }> {
  const remoteStore = process.env.MARKETING_RECORD_STORE_URL?.trim()
  if (remoteStore) {
    if (!isAuthenticatedServiceConfigured(remoteStore, process.env.MARKETING_RECORD_STORE_TOKEN)) {
      throw new MarketingStoreUnavailableError(
        "Marketing record storage credentials are not configured.",
        "unconfigured",
      )
    }
    try {
      const response = await fetch(remoteStore, {
        method: "POST",
        headers: {
          authorization: process.env.MARKETING_RECORD_STORE_TOKEN
            ? `Bearer ${process.env.MARKETING_RECORD_STORE_TOKEN}`
            : "",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, options, record }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) {
        const payload = await readRemoteStorePayload(response)
        const reason = payload?.reason
        if (response.status === 409 || response.status === 413 || response.status === 429 || reason === "quota-exceeded") {
          throw new MarketingStoreQuotaError(
            "Marketing store quota exceeded.",
            normalizeQuotaReason(reason),
          )
        }
        throw new MarketingStoreUnavailableError(
          "Marketing record storage is unavailable.",
          normalizeUnavailableReason(reason),
        )
      }
      const payload = await readRemoteStorePayload(response)
      if (
        !payload ||
        typeof payload.added !== "boolean" ||
        !Number.isFinite(Number(payload.total)) ||
        !payload.record ||
        typeof payload.record !== "object" ||
        Array.isArray(payload.record)
      ) {
        throw new MarketingStoreUnavailableError(
          "Marketing record storage returned an invalid response.",
          "invalid-response",
        )
      }
      return {
        added: payload.added,
        total: Number(payload.total),
        record: payload.record as T,
      }
    } catch (error) {
      if (error instanceof MarketingStoreQuotaError) throw error
      if (error instanceof MarketingStoreUnavailableError) throw error
      throw new MarketingStoreUnavailableError(
        "Marketing record storage is unavailable.",
        isTimeoutError(error) ? "upstream-timeout" : "request-failed",
      )
    }
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_LOCAL_MARKETING_STORE !== "true"
  ) {
    throw new MarketingStoreUnavailableError(
      "MARKETING_RECORD_STORE_URL is required in production.",
      "unconfigured",
    )
  }

  // Serialise writes within this Node.js process so concurrent requests
  // don't race on read-then-write.
  const result = writeChain.then(async () => {
    await ensureDataDir()
    const file = filePath(name)
    const dedupeById = options.dedupeById ?? Boolean(record.id)
    let total = 0

    if (dedupeById && record.id) {
      const existing = await readAll<T>(name)
      total = existing.length
      const duplicate = existing.find((entry) => entry.id === record.id)
      if (duplicate) {
        return { added: false, total: existing.length, record: duplicate }
      }
    } else {
      total = await getRecordCount(name, file)
    }

    const payload: T = {
      ...record,
      createdAt: record.createdAt ?? new Date().toISOString(),
    }
    const line = `${JSON.stringify(payload)}\n`
    await assertStoreCanAppend(name, file, total, Buffer.byteLength(line, "utf8"), options)
    await fs.appendFile(file, line, "utf8")
    recordCountCache.set(name, total + 1)
    return { added: true, total: total + 1, record: payload }
  })

  writeChain = result.catch(() => undefined)

  return result as Promise<{ added: boolean; total: number; record: T }>
}

async function assertStoreCanAppend(
  name: string,
  file: string,
  currentRecords: number,
  appendBytes: number,
  options: AppendRecordOptions,
) {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  if (currentRecords >= maxRecords) {
    throw new MarketingStoreQuotaError(`${name} record quota reached.`, "record-quota")
  }

  const currentBytes = await getFileSize(file)
  if (currentBytes + appendBytes > maxBytes) {
    throw new MarketingStoreQuotaError(`${name} byte quota reached.`, "byte-quota")
  }
}

async function getFileSize(file: string): Promise<number> {
  try {
    const stats = await fs.stat(file)
    return stats.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0
    }
    throw error
  }
}

async function getRecordCount(name: string, file: string): Promise<number> {
  const cached = recordCountCache.get(name)
  if (cached !== undefined) {
    return cached
  }

  const count = await countNonEmptyLines(file)
  recordCountCache.set(name, count)
  return count
}

async function countNonEmptyLines(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file, { encoding: "utf8" })
    let count = 0
    let pending = ""

    stream.on("data", (chunk) => {
      const lines = `${pending}${chunk}`.split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) {
        if (line.trim().length > 0) {
          count += 1
        }
      }
    })
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve(0)
        return
      }
      reject(error)
    })
    stream.on("end", () => {
      if (pending.trim().length > 0) {
        count += 1
      }
      resolve(count)
    })
  })
}
