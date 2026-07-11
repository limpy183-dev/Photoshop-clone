import { promises as fs } from "node:fs"
import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { appendRecord, getClientIp } from "../lib/marketing-store"
import { resolveClientIdentity } from "../lib/client-identity"
import { acquireConcurrencySlot, checkServerRateLimit } from "../lib/rate-limit-store"
import { generativeFillConcurrencyKey } from "../lib/generative-fill-quota"
import { createServerCapability, verifyServerCapability } from "../lib/server-capabilities"
import { POST as postFeedback } from "../app/api/feedback/route"
import { POST as postGenerativeFill } from "../app/api/photoshop/generative-fill/route"
import { POST as postSubscribe } from "../app/api/subscribe/route"

type AppendOptions = {
  dedupeById?: boolean
  maxBytes?: number
  maxRecords?: number
}

type AppendRecordWithOptions = (
  name: string,
  record: { id?: string; [key: string]: unknown },
  options?: AppendOptions,
) => Promise<{ added: boolean; total: number; record: Record<string, unknown> }>

const appendWithOptions = appendRecord as unknown as AppendRecordWithOptions
const capabilitySecret = "test-capability-secret-that-is-at-least-32-characters"
const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

function uniqueStoreName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function uniqueClientHeader(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function removeStore(name: string) {
  await fs.rm(path.join(process.cwd(), ".data", `${name}.jsonl`), { force: true })
}

function snapshotEnv(keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function configureGenerativeFillEnv(patch: Record<string, string> = {}) {
  Object.assign(process.env, {
    ALLOW_LOCAL_SERVER_RATE_LIMIT: "true",
    GENERATIVE_FILL_CAPABILITY_SECRET: capabilitySecret,
    GENERATIVE_FILL_DAILY_REQUEST_LIMIT: "1",
    GENERATIVE_FILL_MAX_CONCURRENCY: "2",
    GENERATIVE_IMAGE_API_KEY: "test-api-key",
    GENERATIVE_IMAGE_ENDPOINT: "https://model.example.test/generate",
    ...patch,
  })
  delete process.env.RATE_LIMIT_SERVICE_URL
  delete process.env.RATE_LIMIT_SERVICE_TOKEN
}

function generativeFillRequest(subject: string, payload: unknown, userAgent = subject) {
  const now = Math.floor(Date.now() / 1000)
  const token = createServerCapability({
    exp: now + 600,
    iat: now,
    nonce: `nonce-${subject}`,
    scope: "generative-fill",
    sub: subject,
  }, capabilitySecret)

  return new Request("https://app.example.test/api/photoshop/generative-fill", {
    body: JSON.stringify(payload),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "user-agent": userAgent,
    },
    method: "POST",
  })
}

test("append-only marketing writes can skip full-file read before append", async () => {
  const name = uniqueStoreName("feedback-append-only")
  const originalReadFile = fs.readFile
  let storeReadCount = 0

  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]).endsWith(`${name}.jsonl`)) {
      storeReadCount += 1
    }
    return originalReadFile(...args)
  }) as typeof fs.readFile

  try {
    await appendWithOptions(name, { id: "feedback-a", message: "First" }, {
      dedupeById: false,
      maxBytes: 4096,
      maxRecords: 10,
    })
    await appendWithOptions(name, { id: "feedback-b", message: "Second" }, {
      dedupeById: false,
      maxBytes: 4096,
      maxRecords: 10,
    })

    expect(storeReadCount).toBe(0)
  } finally {
    fs.readFile = originalReadFile
    await removeStore(name)
  }
})

test("appendRecord rejects writes after the configured record quota", async () => {
  const name = uniqueStoreName("quota")

  try {
    await expect(appendWithOptions(name, { id: "one" }, {
      dedupeById: false,
      maxBytes: 4096,
      maxRecords: 1,
    })).resolves.toMatchObject({ added: true, total: 1 })

    await expect(appendWithOptions(name, { id: "two" }, {
      dedupeById: false,
      maxBytes: 4096,
      maxRecords: 1,
    })).rejects.toThrow(/quota|limit|capacity/i)
  } finally {
    await removeStore(name)
  }
})

test("API JSON body reader rejects oversized content-length before consuming the body", async () => {
  const marketingStore = await import("../lib/marketing-store")
  const readJsonWithLimit = (marketingStore as Record<string, unknown>).readJsonWithLimit as
    | ((request: Request, maxBytes: number) => Promise<unknown>)
    | undefined
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("{}"))
      controller.close()
    },
  })
  const request = new Request("http://example.test/api/feedback", {
    body,
    headers: { "content-length": "128" },
    method: "POST",
    duplex: "half",
  } as RequestInit & { duplex: "half" })

  expect(readJsonWithLimit).toBeDefined()
  expect(request.bodyUsed).toBe(false)
  await expect(readJsonWithLimit!(request, 16)).rejects.toThrow(/too large/i)
  expect(request.bodyUsed).toBe(false)
})

test("API rate limiter blocks repeated requests in a fixed window", async () => {
  const marketingStore = await import("../lib/marketing-store")
  const checkRateLimit = (marketingStore as Record<string, unknown>).checkRateLimit as
    | ((
      key: string,
      options: { limit: number; now: number; windowMs: number },
    ) => { allowed: boolean; retryAfterSeconds?: number })
    | undefined

  expect(checkRateLimit).toBeDefined()
  expect(checkRateLimit!("feedback:203.0.113.9", {
    limit: 2,
    now: 1_000,
    windowMs: 10_000,
  })).toMatchObject({ allowed: true })
  expect(checkRateLimit!("feedback:203.0.113.9", {
    limit: 2,
    now: 2_000,
    windowMs: 10_000,
  })).toMatchObject({ allowed: true })
  expect(checkRateLimit!("feedback:203.0.113.9", {
    limit: 2,
    now: 3_000,
    windowMs: 10_000,
  })).toEqual({ allowed: false, retryAfterSeconds: 8 })
  expect(checkRateLimit!("feedback:203.0.113.9", {
    limit: 2,
    now: 11_000,
    windowMs: 10_000,
  })).toMatchObject({ allowed: true })
})

test("local rate limiter bounds attacker-controlled bucket growth", async () => {
  const { checkRateLimit } = await import("../lib/marketing-store")
  const options = { limit: 2, maxBuckets: 2, now: 50_000, windowMs: 10_000 }

  expect(checkRateLimit(`bounded-a-${Date.now()}`, options)).toMatchObject({ allowed: true })
  expect(checkRateLimit(`bounded-b-${Date.now()}`, options)).toMatchObject({ allowed: true })
  expect(checkRateLimit(`bounded-c-${Date.now()}`, options)).toMatchObject({
    allowed: false,
    reason: "capacity",
  })
})

test("server capabilities are short-lived, scoped, and signature-verified", () => {
  const secret = "test-capability-secret-that-is-at-least-32-characters"
  const token = createServerCapability({
    exp: 1_300,
    iat: 1_000,
    nonce: "nonce-1",
    scope: "generative-fill",
    sub: "account-123",
  }, secret)
  const request = new Request("https://app.example.test/api/photoshop/generative-fill", {
    headers: { authorization: `Bearer ${token}` },
  })

  expect(verifyServerCapability(request, "generative-fill", { now: 1_100, secret }))
    .toMatchObject({ ok: true, claims: { sub: "account-123" } })
  expect(verifyServerCapability(request, "generative-fill", { now: 1_301, secret }))
    .toEqual({ ok: false, reason: "expired" })
  expect(verifyServerCapability(new Request(request.url, {
    headers: { authorization: `Bearer ${token.slice(0, -1)}x` },
  }), "generative-fill", { now: 1_100, secret }))
    .toEqual({ ok: false, reason: "invalid" })
})

test("configured generative fill rejects same-origin callers without an authenticated capability", async () => {
  const source = readFileSync("app/api/photoshop/generative-fill/route.ts", "utf8")

  expect(source).toContain("verifyServerCapability")
  expect(source).toContain('"generative-fill"')
  expect(source).toContain("401")
  expect(source.indexOf("verifyServerCapability")).toBeLessThan(source.indexOf("fetch(endpoint"))
})

test("configured generative fill rejects scripted clients without browser request metadata", async () => {
  const source = readFileSync("app/api/photoshop/generative-fill/route.ts", "utf8")

  expect(source).toContain("requireRequestMetadata: true")
  expect(source.indexOf("isAllowedOrigin")).toBeLessThan(source.indexOf("fetch(endpoint"))
})

test("invalid generative fill payloads do not consume daily quota", async () => {
  const env = snapshotEnv([
    "ALLOW_LOCAL_SERVER_RATE_LIMIT",
    "GENERATIVE_FILL_CAPABILITY_SECRET",
    "GENERATIVE_FILL_DAILY_REQUEST_LIMIT",
    "GENERATIVE_FILL_MAX_CONCURRENCY",
    "GENERATIVE_IMAGE_API_KEY",
    "GENERATIVE_IMAGE_ENDPOINT",
    "RATE_LIMIT_SERVICE_TOKEN",
    "RATE_LIMIT_SERVICE_URL",
  ])
  const originalFetch = globalThis.fetch
  const subject = `quota-invalid-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let upstreamCalls = 0

  try {
    configureGenerativeFillEnv()
    globalThis.fetch = (async () => {
      upstreamCalls += 1
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    }) as typeof fetch

    const invalid = await postGenerativeFill(generativeFillRequest(subject, {
      prompt: "fill the selected area",
      sourcePng: "not-a-data-url",
    }))

    expect(invalid.status).toBe(400)
    expect(upstreamCalls).toBe(0)

    const valid = await postGenerativeFill(generativeFillRequest(subject, {
      prompt: "fill the selected area",
      sourcePng: tinyPngDataUrl,
    }))

    expect(valid.status).toBe(200)
    await expect(valid.json()).resolves.toEqual({ ok: true })
    expect(upstreamCalls).toBe(1)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("concurrency-rejected generative fill requests do not consume daily quota", async () => {
  const env = snapshotEnv([
    "ALLOW_LOCAL_SERVER_RATE_LIMIT",
    "GENERATIVE_FILL_CAPABILITY_SECRET",
    "GENERATIVE_FILL_DAILY_REQUEST_LIMIT",
    "GENERATIVE_FILL_MAX_CONCURRENCY",
    "GENERATIVE_IMAGE_API_KEY",
    "GENERATIVE_IMAGE_ENDPOINT",
    "RATE_LIMIT_SERVICE_TOKEN",
    "RATE_LIMIT_SERVICE_URL",
  ])
  const originalFetch = globalThis.fetch
  const subject = `quota-concurrency-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const payload = { prompt: "fill the selected area", sourcePng: tinyPngDataUrl }
  const heldSlot = acquireConcurrencySlot(generativeFillConcurrencyKey(subject), 1)
  let upstreamCalls = 0

  if (!heldSlot.acquired) throw new Error("Could not reserve the test concurrency slot.")

  try {
    configureGenerativeFillEnv({ GENERATIVE_FILL_MAX_CONCURRENCY: "1" })
    globalThis.fetch = (async () => {
      upstreamCalls += 1
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    }) as typeof fetch

    const rejected = await postGenerativeFill(generativeFillRequest(subject, payload))
    expect(rejected.status).toBe(429)
    await expect(rejected.json()).resolves.toMatchObject({
      error: "Too many concurrent generative fill requests.",
    })
    expect(upstreamCalls).toBe(0)

    heldSlot.release()

    const valid = await postGenerativeFill(generativeFillRequest(subject, payload))
    expect(valid.status).toBe(200)
    await expect(valid.json()).resolves.toEqual({ ok: true })
    expect(upstreamCalls).toBe(1)
  } finally {
    if (heldSlot.acquired) heldSlot.release()
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("generative fill does not wait for a slow best-effort lease release", async () => {
  const env = snapshotEnv([
    "ALLOW_LOCAL_SERVER_RATE_LIMIT",
    "GENERATIVE_FILL_CAPABILITY_SECRET",
    "GENERATIVE_FILL_DAILY_REQUEST_LIMIT",
    "GENERATIVE_FILL_MAX_CONCURRENCY",
    "GENERATIVE_IMAGE_API_KEY",
    "GENERATIVE_IMAGE_ENDPOINT",
    "RATE_LIMIT_SERVICE_TOKEN",
    "RATE_LIMIT_SERVICE_URL",
  ])
  const originalFetch = globalThis.fetch
  const subject = `release-latency-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let releaseStarted = false

  try {
    configureGenerativeFillEnv()
    process.env.RATE_LIMIT_SERVICE_URL = "https://limits.example.test/check"
    process.env.RATE_LIMIT_SERVICE_TOKEN = "limit-token"
    globalThis.fetch = (async (input, init) => {
      if (String(input) === process.env.RATE_LIMIT_SERVICE_URL) {
        const operation = JSON.parse(String(init?.body ?? "{}")).operation
        if (operation === "acquire-concurrency") {
          return new Response(JSON.stringify({ allowed: true, leaseId: "lease-1" }), { status: 200 })
        }
        if (operation === "release-concurrency") {
          releaseStarted = true
          return new Promise<Response>(() => undefined)
        }
        return new Response(JSON.stringify({ allowed: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    }) as typeof fetch

    const response = await Promise.race([
      postGenerativeFill(generativeFillRequest(subject, {
        prompt: "fill the selected area",
        sourcePng: tinyPngDataUrl,
      })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("response was blocked by lease release")), 100)),
    ])

    expect(response.status).toBe(200)
    expect(releaseStarted).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("remote rate-limit adapter preserves outage reasons from successful JSON responses", async () => {
  const env = snapshotEnv(["RATE_LIMIT_SERVICE_TOKEN", "RATE_LIMIT_SERVICE_URL"])
  const originalFetch = globalThis.fetch
  let postedBody: unknown = null

  try {
    process.env.RATE_LIMIT_SERVICE_URL = "https://limits.example.test/check"
    process.env.RATE_LIMIT_SERVICE_TOKEN = "limit-token"
    globalThis.fetch = (async (_input, init) => {
      postedBody = JSON.parse(String(init?.body ?? "{}"))
      return new Response(JSON.stringify({
        allowed: false,
        reason: "unavailable",
        retryAfterSeconds: 7,
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    }) as typeof fetch

    await expect(checkServerRateLimit("remote-soft-outage", {
      limit: 3,
      windowMs: 60_000,
    })).resolves.toEqual({
      allowed: false,
      reason: "unavailable",
      retryAfterSeconds: 7,
    })
    expect(postedBody).toMatchObject({
      key: "remote-soft-outage",
      limit: 3,
      windowMs: 60_000,
    })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("malformed successful rate-limit responses fail closed as unavailable", async () => {
  const env = snapshotEnv(["RATE_LIMIT_SERVICE_TOKEN", "RATE_LIMIT_SERVICE_URL"])
  const originalFetch = globalThis.fetch

  try {
    process.env.RATE_LIMIT_SERVICE_URL = "https://limits.example.test/check"
    process.env.RATE_LIMIT_SERVICE_TOKEN = "limit-token"
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ retryAfterSeconds: 12 }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })) as typeof fetch

    await expect(checkServerRateLimit("remote-malformed", {
      limit: 3,
      windowMs: 60_000,
    })).resolves.toEqual({
      allowed: false,
      reason: "unavailable",
      retryAfterSeconds: 12,
    })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("remote marketing store quota responses preserve adapter reason", async () => {
  const env = snapshotEnv(["MARKETING_RECORD_STORE_TOKEN", "MARKETING_RECORD_STORE_URL"])
  const originalFetch = globalThis.fetch

  try {
    process.env.MARKETING_RECORD_STORE_URL = "https://records.example.test/append"
    process.env.MARKETING_RECORD_STORE_TOKEN = "record-token"
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ reason: "quota-exceeded" }), {
        headers: { "content-type": "application/json" },
        status: 429,
      })) as typeof fetch

    await expect(appendWithOptions("feedback", { id: "remote-quota", message: "full" }))
      .rejects.toMatchObject({
        name: "MarketingStoreQuotaError",
        reason: "quota-exceeded",
      })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("remote marketing store rejects oversized adapter responses", async () => {
  const env = snapshotEnv(["MARKETING_RECORD_STORE_TOKEN", "MARKETING_RECORD_STORE_URL"])
  const originalFetch = globalThis.fetch

  try {
    process.env.MARKETING_RECORD_STORE_URL = "https://records.example.test/append"
    process.env.MARKETING_RECORD_STORE_TOKEN = "record-token"
    globalThis.fetch = (async () => new Response("x".repeat(65 * 1024), { status: 200 })) as typeof fetch

    await expect(appendWithOptions("feedback", { id: "remote-oversized", message: "full" }))
      .rejects.toMatchObject({
        name: "MarketingStoreUnavailableError",
        reason: "invalid-response",
      })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("feedback route logs durable store outages without exposing adapter details", async () => {
  const env = snapshotEnv([
    "MARKETING_RECORD_STORE_TOKEN",
    "MARKETING_RECORD_STORE_URL",
    "RATE_LIMIT_SERVICE_TOKEN",
    "RATE_LIMIT_SERVICE_URL",
  ])
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const warnings: unknown[][] = []

  try {
    process.env.RATE_LIMIT_SERVICE_URL = "https://limits.example.test/check"
    process.env.RATE_LIMIT_SERVICE_TOKEN = "limit-token"
    process.env.MARKETING_RECORD_STORE_URL = "https://records.example.test/append"
    process.env.MARKETING_RECORD_STORE_TOKEN = "record-token"
    console.warn = ((...args: unknown[]) => {
      warnings.push(args)
    }) as typeof console.warn
    globalThis.fetch = (async (input) => {
      if (String(input) === process.env.RATE_LIMIT_SERVICE_URL) {
        return new Response(JSON.stringify({ allowed: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      }
      return new Response(JSON.stringify({ reason: "upstream-timeout" }), {
        headers: { "content-type": "application/json" },
        status: 503,
      })
    }) as typeof fetch

    const response = await postFeedback(new Request("https://app.example.test/api/feedback", {
      body: JSON.stringify({ message: "Remote store should fail closed." }),
      headers: {
        "content-type": "application/json",
        "user-agent": uniqueClientHeader("remote-store-outage"),
      },
      method: "POST",
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Could not record feedback. Try again later.",
      ok: false,
    })
    expect(warnings).toContainEqual([
      "marketing_record_store_unavailable",
      expect.objectContaining({
        operation: "feedback.append",
        reason: "upstream-timeout",
      }),
    ])
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv(env)
  }
})

test("marketing routes fail closed when production shared rate limiting is unconfigured", async () => {
  const env = snapshotEnv([
    "ALLOW_LOCAL_SERVER_RATE_LIMIT",
    "NODE_ENV",
    "PUBLIC_ORIGIN",
    "RATE_LIMIT_SERVICE_TOKEN",
    "RATE_LIMIT_SERVICE_URL",
  ])

  try {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
    delete process.env.ALLOW_LOCAL_SERVER_RATE_LIMIT
    delete process.env.PUBLIC_ORIGIN
    delete process.env.RATE_LIMIT_SERVICE_TOKEN
    delete process.env.RATE_LIMIT_SERVICE_URL

    const subscribeResponse = await postSubscribe(new Request("https://app.example.test/api/subscribe", {
      body: JSON.stringify({ email: "prod-limit@example.com" }),
      headers: {
        "content-type": "application/json",
        "user-agent": "marketing-production-limit-test",
      },
      method: "POST",
    }))
    expect(subscribeResponse.status).toBe(503)
    await expect(subscribeResponse.json()).resolves.toMatchObject({
      error: "Rate limiting is unavailable. Try again later.",
      ok: false,
    })

    const feedbackResponse = await postFeedback(new Request("https://app.example.test/api/feedback", {
      body: JSON.stringify({ message: "Rate limit adapter should be required." }),
      headers: {
        "content-type": "application/json",
        "user-agent": "marketing-production-limit-test",
      },
      method: "POST",
    }))
    expect(feedbackResponse.status).toBe(503)
    await expect(feedbackResponse.json()).resolves.toMatchObject({
      error: "Rate limiting is unavailable. Try again later.",
      ok: false,
    })
  } finally {
    restoreEnv(env)
  }
})

test("client IP fallback uses request fingerprint instead of a shared unknown bucket", () => {
  const originalTrustProxy = process.env.MARKETING_TRUSTED_PROXY
  delete process.env.MARKETING_TRUSTED_PROXY

  try {
    const first = getClientIp(new Request("http://example.test/api/subscribe", {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua-platform": "\"Windows\"",
        "user-agent": "Agent A",
      },
    }))
    const second = getClientIp(new Request("http://example.test/api/subscribe", {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua-platform": "\"Windows\"",
        "user-agent": "Agent B",
      },
    }))

    expect(first).toMatch(/^fingerprint:/)
    expect(second).toMatch(/^fingerprint:/)
    expect(first).not.toBe(second)
  } finally {
    if (originalTrustProxy === undefined) {
      delete process.env.MARKETING_TRUSTED_PROXY
    } else {
      process.env.MARKETING_TRUSTED_PROXY = originalTrustProxy
    }
  }
})

test("rate-limit buckets are isolated per fingerprint so two distinct clients each get a fresh window", async () => {
  const marketingStore = await import("../lib/marketing-store")
  const checkRateLimit = marketingStore.checkRateLimit as (
    key: string,
    options: { limit: number; now: number; windowMs: number },
  ) => { allowed: boolean; retryAfterSeconds?: number }

  const fingerprintA = getClientIp(new Request("http://example.test/api/subscribe", {
    headers: { "user-agent": `iso-test-A-${Date.now()}` },
  }))
  const fingerprintB = getClientIp(new Request("http://example.test/api/subscribe", {
    headers: { "user-agent": `iso-test-B-${Date.now()}` },
  }))
  expect(fingerprintA).not.toBe(fingerprintB)

  // Client A exhausts its 2-request bucket.
  expect(checkRateLimit(`isolation:${fingerprintA}`, { limit: 2, now: 1_000, windowMs: 10_000 }))
    .toMatchObject({ allowed: true })
  expect(checkRateLimit(`isolation:${fingerprintA}`, { limit: 2, now: 1_100, windowMs: 10_000 }))
    .toMatchObject({ allowed: true })
  expect(checkRateLimit(`isolation:${fingerprintA}`, { limit: 2, now: 1_200, windowMs: 10_000 }))
    .toMatchObject({ allowed: false })

  // Client B must NOT share that exhausted bucket — a regression that
  // collapses all callers to a single key would fail this assertion.
  expect(checkRateLimit(`isolation:${fingerprintB}`, { limit: 2, now: 1_300, windowMs: 10_000 }))
    .toMatchObject({ allowed: true })
  expect(checkRateLimit(`isolation:${fingerprintB}`, { limit: 2, now: 1_400, windowMs: 10_000 }))
    .toMatchObject({ allowed: true })
  expect(checkRateLimit(`isolation:${fingerprintB}`, { limit: 2, now: 1_500, windowMs: 10_000 }))
    .toMatchObject({ allowed: false })
})

test("feedback route rejects oversized request bodies", async ({ baseURL, request }) => {
  test.skip(!baseURL, "Requires the default browser Playwright config with a running web server.")

  const response = await request.post("/api/feedback", {
    data: JSON.stringify({ message: "x".repeat(9_000) }),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `2001:db8::${Date.now().toString(16)}`,
    },
  })

  expect(response.status()).toBe(413)
  await expect(response.json()).resolves.toMatchObject({
    error: "Request body is too large.",
    ok: false,
  })
})

test("subscribe route rate limits repeated malformed requests per client fingerprint", async () => {
  const userAgent = uniqueClientHeader("subscribe-rate-limit")
  const requestInit = {
    body: "{",
    headers: {
      "content-type": "application/json",
      "user-agent": userAgent,
    },
    method: "POST",
  } satisfies RequestInit

  for (let index = 0; index < 5; index += 1) {
    const response = await postSubscribe(new Request("https://app.example.test/api/subscribe", requestInit))
    const responseBody = await response.text()
    expect(response.status, responseBody).toBe(400)
  }

  const limited = await postSubscribe(new Request("https://app.example.test/api/subscribe", requestInit))

  expect(limited.status).toBe(429)
  expect(limited.headers.get("retry-after")).toBeTruthy()
  await expect(limited.json()).resolves.toMatchObject({
    ok: false,
  })
})

test("client identity labels header fingerprints as weak and trusted proxy identity as strong", () => {
  const original = process.env.MARKETING_TRUSTED_PROXY
  try {
    delete process.env.MARKETING_TRUSTED_PROXY
    const weak = resolveClientIdentity(new Request("http://example.test", {
      headers: { "user-agent": "identity-test" },
    }))
    expect(weak.strength).toBe("weak")
    expect(weak.source).toBe("header-fingerprint")

    process.env.MARKETING_TRUSTED_PROXY = "true"
    const trusted = resolveClientIdentity(new Request("http://example.test", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    }))
    expect(trusted).toEqual({
      key: "ip:203.0.113.7",
      source: "trusted-proxy",
      strength: "strong",
    })
  } finally {
    if (original === undefined) delete process.env.MARKETING_TRUSTED_PROXY
    else process.env.MARKETING_TRUSTED_PROXY = original
  }
})

test("subscribe route returns constant success without subscriber-count oracle", async ({ baseURL, request }) => {
  test.skip(!baseURL, "Requires the default browser Playwright config with a running web server.")

  const email = `security-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`

  const response = await request.post("/api/subscribe", {
    data: { email, source: "security-test" },
    headers: {
      "content-type": "application/json",
      "user-agent": `security-test-${Math.random().toString(16).slice(2)}`,
    },
  })

  expect(response.status()).toBe(200)
  await expect(response.json()).resolves.toEqual({ ok: true })
})

test("root page CSP carries a script nonce and permits React dev eval only in development", async ({ baseURL, request }) => {
  test.skip(!baseURL, "Requires the default browser Playwright config with a running web server.")

  const response = await request.get("/")
  const csp = response.headers()["content-security-policy"] ?? ""
  const nonce = response.headers()["x-nonce"] ?? ""

  expect(response.status()).toBe(200)
  expect(nonce).toMatch(/^[A-Za-z0-9+/]+$/)
  expect(csp).toContain(`'nonce-${nonce}'`)

  expect(csp).not.toContain("'unsafe-eval'")
})

test("response headers regression-protect the audit: no 'unsafe-inline' scripts, COOP/CORP and HSTS present", async ({ baseURL, request }) => {
  test.skip(!baseURL, "Requires the default browser Playwright config with a running web server.")

  const response = await request.get("/")
  const headers = response.headers()
  const csp = headers["content-security-policy"] ?? ""

  expect(response.status()).toBe(200)

  // Extract the script-src directive specifically — style-src is allowed to
  // keep 'unsafe-inline' (Tailwind + Radix inject inline style attributes).
  const scriptSrc = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("script-src "))
  expect(scriptSrc).toBeTruthy()
  expect(scriptSrc).not.toContain("'unsafe-inline'")

  // Cross-origin isolation defense-in-depth set in next.config.mjs.
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin")
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin")

  // HSTS is shipped at the app layer so self-hosted deployments without a
  // platform-managed HSTS still get the header.
  expect(headers["strict-transport-security"]).toMatch(/max-age=\d+/)

  // Frame-busting + content-sniffing + referrer hardening should always ship.
  expect(headers["x-frame-options"]).toBe("DENY")
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")

  // The CSP must lock down opener-tampering vectors via frame-ancestors / object-src / base-uri.
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("base-uri 'self'")
})
