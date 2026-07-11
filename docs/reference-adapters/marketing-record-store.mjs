#!/usr/bin/env node
import { createServer } from "node:http"
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

async function readJson(request, maxBytes = 64 * 1024) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error("body-too-large")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export function createMarketingRecordStoreServer({ directory, token }) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("MARKETING_RECORD_STORE_TOKEN is required to start the marketing record store.")
  }
  let writeChain = Promise.resolve()
  const transact = (operation) => {
    const result = writeChain.then(operation, operation)
    writeChain = result.catch(() => undefined)
    return result
  }

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { ok: true, service: "marketing-record-store" })
      return
    }
    if (request.method !== "POST" || request.url !== "/records") {
      json(response, 404, { ok: false })
      return
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { ok: false })
      return
    }

    try {
      const input = await readJson(request)
      if (
        !input ||
        !["feedback", "subscribers"].includes(input.name) ||
        !input.record ||
        typeof input.record !== "object" ||
        Array.isArray(input.record)
      ) {
        json(response, 400, { reason: "invalid-response" })
        return
      }
      const result = await transact(async () => {
        await mkdir(directory, { recursive: true })
        const file = join(directory, `${input.name}.json`)
        let records = []
        try {
          records = JSON.parse(await readFile(file, "utf8"))
          if (!Array.isArray(records)) records = []
        } catch (error) {
          if (error?.code !== "ENOENT") throw error
        }
        // These quotas are server-owned. Never let a caller expand them.
        const maxRecords = input.name === "feedback" ? 1_000 : 5_000
        const maxBytes = 1_000_000
        if (input.options?.dedupeById && input.record.id && records.some((item) => item?.id === input.record.id)) {
          return { added: false, total: records.length, record: input.record }
        }
        const next = [...records, input.record]
        const encoded = `${JSON.stringify(next)}\n`
        if (next.length > maxRecords) return { quota: "record-quota" }
        if (Buffer.byteLength(encoded) > maxBytes) return { quota: "byte-quota" }
        const temporary = `${file}.${process.pid}.tmp`
        await writeFile(temporary, encoded, { mode: 0o600 })
        await rename(temporary, file)
        return { added: true, total: next.length, record: input.record }
      })
      if (result.quota) {
        json(response, 429, { reason: "quota-exceeded", detail: result.quota })
        return
      }
      json(response, 200, result)
    } catch (error) {
      json(response, error?.message === "body-too-large" ? 413 : 503, {
        reason: error?.message === "body-too-large" ? "quota-exceeded" : "upstream-unavailable",
      })
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.env.ADAPTER_DATA_DIR || ".adapter-data/marketing"
  const token = process.env.MARKETING_RECORD_STORE_TOKEN
  const port = Number(process.env.PORT || 8787)
  const host = process.env.ADAPTER_HOST || "127.0.0.1"
  createMarketingRecordStoreServer({ directory, token }).listen(port, host, () => {
    console.log(`marketing record adapter listening on ${port}`)
  })
}
