import { createReadStream, promises as fs } from "node:fs"
import path from "node:path"

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

export class MarketingStoreQuotaError extends Error {
  constructor(message = "Marketing store quota exceeded.") {
    super(message)
    this.name = "MarketingStoreQuotaError"
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
  now?: number
  windowMs: number
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const forwardedIp = forwarded?.split(",")[0]?.trim()
  return (
    forwardedIp ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  )
}

export function checkRateLimit(
  key: string,
  { limit, now = Date.now(), windowMs }: RateLimitOptions,
): { allowed: boolean; retryAfterSeconds?: number } {
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

export async function appendRecord<T extends StoredRecord>(
  name: string,
  record: T,
  options: AppendRecordOptions = {},
): Promise<{ added: boolean; total: number; record: T }> {
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
    throw new MarketingStoreQuotaError(`${name} record quota reached.`)
  }

  const currentBytes = await getFileSize(file)
  if (currentBytes + appendBytes > maxBytes) {
    throw new MarketingStoreQuotaError(`${name} byte quota reached.`)
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
