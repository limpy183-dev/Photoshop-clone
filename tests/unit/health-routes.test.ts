import { afterEach, describe, expect, it, vi } from "vitest"
import { GET as getReadiness } from "../../app/api/health/route"
import { GET as getLiveness } from "../../app/api/health/live/route"
import { getAdapterHealth } from "../../lib/adapter-health"

describe("health routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps liveness independent of adapter readiness", async () => {
    const response = getLiveness()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it("labels the dependency-aware endpoint as readiness", async () => {
    const response = getReadiness()
    const body = await response.json()
    expect(body).toMatchObject({ readiness: true })
    expect(Array.isArray(body.adapters)).toBe(true)
  })

  it("reports readiness false when a required production adapter is unhealthy", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MARKETING_RECORD_STORE_URL", "https://records.example")
    vi.stubEnv("RATE_LIMIT_SERVICE_URL", "https://limits.example")
    vi.stubEnv("MARKETING_TRUSTED_PROXY", "false")

    const response = getReadiness()
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      readiness: false,
    })
  })

  it("uses the same true-or-one trusted proxy contract as request identity", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MARKETING_TRUSTED_PROXY", "false")
    expect(getAdapterHealth().find((adapter) => adapter.name === "client-identity"))
      .toMatchObject({ configured: false, reason: "unconfigured" })

    vi.stubEnv("MARKETING_TRUSTED_PROXY", "1")
    expect(getAdapterHealth().find((adapter) => adapter.name === "client-identity"))
      .toMatchObject({ configured: true, reason: "configured" })
  })

  it("does not call a remote adapter healthy without its bearer credential", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MARKETING_RECORD_STORE_URL", "https://records.example")
    vi.stubEnv("RATE_LIMIT_SERVICE_URL", "https://limits.example")
    vi.stubEnv("MARKETING_TRUSTED_PROXY", "true")
    vi.stubEnv("MARKETING_RECORD_STORE_TOKEN", "")
    vi.stubEnv("RATE_LIMIT_SERVICE_TOKEN", "")

    const adapters = getAdapterHealth()
    expect(adapters.find((adapter) => adapter.name === "marketing-record-store"))
      .toMatchObject({ configured: false, reason: "unconfigured" })
    expect(adapters.find((adapter) => adapter.name === "rate-limit-service"))
      .toMatchObject({ configured: false, reason: "unconfigured" })
  })

  it("does not mask an explicitly misconfigured remote adapter in development", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("RATE_LIMIT_SERVICE_URL", "https://limits.example")
    vi.stubEnv("RATE_LIMIT_SERVICE_TOKEN", "")

    expect(getAdapterHealth().find((adapter) => adapter.name === "rate-limit-service"))
      .toMatchObject({ configured: false, reason: "unconfigured" })
  })
})
