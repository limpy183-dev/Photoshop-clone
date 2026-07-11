import { afterEach, describe, expect, it, vi } from "vitest"
import { acquireServerConcurrencySlot, checkServerRateLimit } from "../../lib/rate-limit-store"

const originalEnvironment = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnvironment }
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("distributed concurrency adapter", () => {
  it("acquires and releases a remote lease", async () => {
    process.env.RATE_LIMIT_SERVICE_URL = "https://limits.example.test/check"
    process.env.RATE_LIMIT_SERVICE_TOKEN = "secret"
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        allowed: true,
        leaseId: "lease-1",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ released: true }), { status: 200 }))

    const slot = await acquireServerConcurrencySlot("genfill:concurrency:subject", 2, {
      leaseMs: 35_000,
    })

    expect(slot.acquired).toBe(true)
    if (!slot.acquired) return
    await slot.release()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      operation: "acquire-concurrency",
      key: "genfill:concurrency:subject",
      limit: 2,
      leaseMs: 35_000,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      operation: "release-concurrency",
      key: "genfill:concurrency:subject",
      leaseId: "lease-1",
    })
  })

  it("fails closed in production when no shared adapter is configured", async () => {
    vi.stubEnv("NODE_ENV", "production")
    delete process.env.RATE_LIMIT_SERVICE_URL
    delete process.env.ALLOW_LOCAL_SERVER_RATE_LIMIT

    await expect(acquireServerConcurrencySlot("subject", 1)).resolves.toEqual({
      acquired: false,
      reason: "unconfigured",
    })
  })

  it("rejects an unbounded response from a remote adapter", async () => {
    process.env.RATE_LIMIT_SERVICE_URL = "https://limits.example.test/check"
    process.env.RATE_LIMIT_SERVICE_TOKEN = "secret"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(65 * 1024), { status: 200 }),
    )

    await expect(checkServerRateLimit("subject", { limit: 1, windowMs: 1_000 }))
      .resolves.toEqual({ allowed: false, reason: "unavailable" })
  })

  it("requires authenticated, HTTPS remote adapters in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.RATE_LIMIT_SERVICE_URL = "http://limits.example.test/check"
    process.env.RATE_LIMIT_SERVICE_TOKEN = "secret"

    await expect(checkServerRateLimit("subject", { limit: 1, windowMs: 1_000 }))
      .resolves.toEqual({ allowed: false, reason: "unconfigured" })
  })
})
