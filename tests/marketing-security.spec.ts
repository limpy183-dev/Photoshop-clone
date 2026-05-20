import { promises as fs } from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { appendRecord } from "../lib/marketing-store"

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
