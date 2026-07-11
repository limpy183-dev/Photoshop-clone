import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"

test("reference marketing adapter persists and deduplicates records", async () => {
  const { createMarketingRecordStoreServer } = await import("../docs/reference-adapters/marketing-record-store.mjs")
  const directory = mkdtempSync(join(tmpdir(), "marketing-adapter-test-"))
  const server = createMarketingRecordStoreServer({ directory, token: "test-token" })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not bind")
  const url = `http://127.0.0.1:${address.port}/records`
  try {
    const request = () => fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({
        name: "subscribers",
        record: { id: "person@example.test" },
        options: { dedupeById: true, maxBytes: 10_000, maxRecords: 10 },
      }),
    })
    await expect((await request()).json()).resolves.toMatchObject({ added: true, total: 1 })
    await expect((await request()).json()).resolves.toMatchObject({ added: false, total: 1 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})

test("reference adapters refuse unauthenticated startup and requests", async () => {
  const { createMarketingRecordStoreServer } = await import("../docs/reference-adapters/marketing-record-store.mjs")
  const { createRateLimitServer } = await import("../docs/reference-adapters/rate-limit-service.mjs")
  const directory = mkdtempSync(join(tmpdir(), "adapter-auth-test-"))
  try {
    expect(() => createMarketingRecordStoreServer({ directory, token: undefined })).toThrow(/TOKEN is required/)
    expect(() => createRateLimitServer({ directory, token: undefined })).toThrow(/TOKEN is required/)

    const server = createMarketingRecordStoreServer({ directory, token: "test-token" })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Server did not bind")
    const response = await fetch(`http://127.0.0.1:${address.port}/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "feedback", record: { message: "blocked" } }),
    })
    expect(response.status).toBe(401)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("reference rate-limit adapter persists atomic window decisions", async () => {
  const { createRateLimitServer } = await import("../docs/reference-adapters/rate-limit-service.mjs")
  const directory = mkdtempSync(join(tmpdir(), "rate-adapter-test-"))
  const server = createRateLimitServer({ directory, token: "test-token" })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not bind")
  const url = `http://127.0.0.1:${address.port}/check`
  try {
    const request = () => fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ key: "client", limit: 1, windowMs: 60_000 }),
    })
    await expect((await request()).json()).resolves.toEqual({ allowed: true })
    await expect((await request()).json()).resolves.toMatchObject({
      allowed: false,
      reason: "capacity",
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})

test("reference rate-limit adapter supports bounded concurrency leases", async () => {
  const { createRateLimitServer } = await import("../docs/reference-adapters/rate-limit-service.mjs")
  const directory = mkdtempSync(join(tmpdir(), "rate-lease-adapter-test-"))
  const server = createRateLimitServer({ directory, token: "test-token" })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not bind")
  const url = `http://127.0.0.1:${address.port}/check`
  const request = (body: unknown) => fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  try {
    const acquired = await (await request({
      operation: "acquire-concurrency",
      key: "subject",
      limit: 1,
      leaseMs: 60_000,
    })).json() as { allowed: boolean; leaseId: string }
    expect(acquired.allowed).toBe(true)
    expect(acquired.leaseId).toBeTruthy()
    await expect((await request({
      operation: "acquire-concurrency",
      key: "subject",
      limit: 1,
      leaseMs: 60_000,
    })).json()).resolves.toMatchObject({ allowed: false, reason: "capacity" })
    await expect((await request({
      operation: "release-concurrency",
      key: "subject",
      leaseId: acquired.leaseId,
    })).json()).resolves.toEqual({ released: true })
    await expect((await request({
      operation: "acquire-concurrency",
      key: "subject",
      limit: 1,
      leaseMs: 60_000,
    })).json()).resolves.toMatchObject({ allowed: true })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
