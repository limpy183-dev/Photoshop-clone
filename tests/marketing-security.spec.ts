import { promises as fs } from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { appendRecord, getClientIp } from "../lib/marketing-store"

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

function uniqueStoreName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function removeStore(name: string) {
  await fs.rm(path.join(process.cwd(), ".data", `${name}.jsonl`), { force: true })
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

test("feedback route rejects oversized request bodies", async ({ request }) => {
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

test("subscribe route rate limits repeated malformed requests per IP", async ({ request }) => {
  const ip = `2001:db8::${Date.now().toString(16)}:${Math.random().toString(16).slice(2)}`

  for (let index = 0; index < 5; index += 1) {
    const response = await request.post("/api/subscribe", {
      data: "{",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
    })
    expect(response.status()).toBe(400)
  }

  const limited = await request.post("/api/subscribe", {
    data: "{",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
  })

  expect(limited.status()).toBe(429)
  expect(limited.headers()["retry-after"]).toBeTruthy()
  await expect(limited.json()).resolves.toMatchObject({
    ok: false,
  })
})

test("subscribe route returns constant success without subscriber-count oracle", async ({ request }) => {
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

test("root page CSP carries a script nonce and permits React dev eval only in development", async ({ request }) => {
  const response = await request.get("/")
  const csp = response.headers()["content-security-policy"] ?? ""
  const nonce = response.headers()["x-nonce"] ?? ""

  expect(response.status()).toBe(200)
  expect(nonce).toMatch(/^[A-Za-z0-9+/]+$/)
  expect(csp).toContain(`'nonce-${nonce}'`)

  if (process.env.NODE_ENV === "production") {
    expect(csp).not.toContain("'unsafe-eval'")
  } else {
    expect(csp).toContain("'unsafe-eval'")
  }
})

test("response headers regression-protect the audit: no 'unsafe-inline' scripts, COOP/CORP and HSTS present", async ({ request }) => {
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

test("localhost root page does not report script nonce hydration mismatch", async ({ browser }) => {
  const page = await browser.newPage()
  const hydrationMessages: string[] = []
  page.on("console", (message) => {
    const text = message.text()
    if (/hydrated|hydration|nonce/i.test(text)) hydrationMessages.push(text)
  })

  try {
    await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1_000)
  } finally {
    await page.close()
  }

  expect(hydrationMessages).toEqual([])
})
