#!/usr/bin/env node
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

function json(response, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": data.length,
    "cache-control": "no-store",
  })
  response.end(data)
}

async function readJson(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 16 * 1024) throw new Error("body-too-large")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export function createRateLimitServer({ directory, token }) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("RATE_LIMIT_SERVICE_TOKEN is required to start the rate-limit service.")
  }
  let writeChain = Promise.resolve()
  const transact = (operation) => {
    const result = writeChain.then(operation, operation)
    writeChain = result.catch(() => undefined)
    return result
  }

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { ok: true, service: "rate-limit" })
      return
    }
    if (request.method !== "POST" || request.url !== "/check") {
      json(response, 404, { allowed: false, reason: "unavailable" })
      return
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { allowed: false, reason: "unavailable" })
      return
    }

    try {
      const input = await readJson(request)
      const key = typeof input?.key === "string" ? input.key.slice(0, 512) : ""
      const operation = typeof input?.operation === "string" ? input.operation : "check-rate-limit"
      if (!key) {
        json(response, 400, { allowed: false, reason: "unavailable" })
        return
      }

      if (operation === "acquire-concurrency") {
        const limit = Math.max(1, Math.min(1_000, Math.round(Number(input?.limit) || 0)))
        const leaseMs = Math.max(1_000, Math.min(120_000, Math.round(Number(input?.leaseMs) || 0)))
        if (!Number.isFinite(limit) || !Number.isFinite(leaseMs)) {
          json(response, 400, { allowed: false, reason: "unavailable" })
          return
        }
        const decision = await transact(async () => {
          await mkdir(directory, { recursive: true })
          const file = join(directory, "concurrency-leases.json")
          let leases = {}
          try {
            leases = JSON.parse(await readFile(file, "utf8"))
            if (!leases || typeof leases !== "object" || Array.isArray(leases)) leases = {}
          } catch (error) {
            if (error?.code !== "ENOENT") throw error
          }
          const now = Date.now()
          for (const [leaseId, lease] of Object.entries(leases)) {
            if (!lease || Number(lease.expiresAt) <= now) delete leases[leaseId]
          }
          const active = Object.entries(leases).filter(([, lease]) => lease?.key === key)
          if (active.length >= limit) {
            const nextExpiry = Math.min(...active.map(([, lease]) => Number(lease.expiresAt)))
            return {
              allowed: false,
              reason: "capacity",
              retryAfterSeconds: Math.max(1, Math.ceil((nextExpiry - now) / 1_000)),
            }
          }
          const leaseId = randomUUID()
          leases[leaseId] = { key, expiresAt: now + leaseMs }
          const temporary = `${file}.${process.pid}.tmp`
          await writeFile(temporary, `${JSON.stringify(leases)}\n`, { mode: 0o600 })
          await rename(temporary, file)
          return { allowed: true, leaseId }
        })
        json(response, 200, decision)
        return
      }

      if (operation === "release-concurrency") {
        const leaseId = typeof input?.leaseId === "string" ? input.leaseId : ""
        if (!leaseId || leaseId.length > 128) {
          json(response, 400, { allowed: false, reason: "unavailable" })
          return
        }
        await transact(async () => {
          await mkdir(directory, { recursive: true })
          const file = join(directory, "concurrency-leases.json")
          let leases = {}
          try {
            leases = JSON.parse(await readFile(file, "utf8"))
            if (!leases || typeof leases !== "object" || Array.isArray(leases)) leases = {}
          } catch (error) {
            if (error?.code !== "ENOENT") throw error
          }
          if (leases[leaseId]?.key === key) {
            delete leases[leaseId]
            const temporary = `${file}.${process.pid}.tmp`
            await writeFile(temporary, `${JSON.stringify(leases)}\n`, { mode: 0o600 })
            await rename(temporary, file)
          }
        })
        json(response, 200, { released: true })
        return
      }

      if (operation !== "check-rate-limit") {
        json(response, 400, { allowed: false, reason: "unavailable" })
        return
      }

      const limit = Math.max(1, Math.min(100_000, Math.round(Number(input?.limit) || 0)))
      const windowMs = Math.max(1_000, Math.min(86_400_000, Math.round(Number(input?.windowMs) || 0)))
      if (!Number.isFinite(limit) || !Number.isFinite(windowMs)) {
        json(response, 400, { allowed: false, reason: "unavailable" })
        return
      }

      const decision = await transact(async () => {
        await mkdir(directory, { recursive: true })
        const file = join(directory, "rate-limit.json")
        let buckets = {}
        try {
          buckets = JSON.parse(await readFile(file, "utf8"))
        } catch (error) {
          if (error?.code !== "ENOENT") throw error
        }
        const now = Date.now()
        for (const [bucketKey, bucket] of Object.entries(buckets)) {
          if (!bucket || Number(bucket.resetAt) <= now) delete buckets[bucketKey]
        }
        const current = buckets[key]
        if (!current && Object.keys(buckets).length >= 10_000) {
          return { allowed: false, reason: "capacity", retryAfterSeconds: 60 }
        }
        if (current && Number(current.count) >= limit) {
          return {
            allowed: false,
            reason: "capacity",
            retryAfterSeconds: Math.max(1, Math.ceil((Number(current.resetAt) - now) / 1_000)),
          }
        }
        buckets[key] = current
          ? { count: Number(current.count) + 1, resetAt: Number(current.resetAt) }
          : { count: 1, resetAt: now + windowMs }
        const temporary = `${file}.${process.pid}.tmp`
        await writeFile(temporary, `${JSON.stringify(buckets)}\n`, { mode: 0o600 })
        await rename(temporary, file)
        return { allowed: true }
      })
      json(response, 200, decision)
    } catch {
      json(response, 503, { allowed: false, reason: "unavailable", retryAfterSeconds: 60 })
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.env.ADAPTER_DATA_DIR || ".adapter-data/rate-limit"
  const token = process.env.RATE_LIMIT_SERVICE_TOKEN
  const port = Number(process.env.PORT || 8788)
  const host = process.env.ADAPTER_HOST || "127.0.0.1"
  createRateLimitServer({ directory, token }).listen(port, host, () => {
    console.log(`rate-limit adapter listening on ${port}`)
  })
}
