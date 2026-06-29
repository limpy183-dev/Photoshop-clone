import { NextResponse } from "next/server"
import { z } from "zod"
import {
  getClientIp,
  isAllowedOrigin,
  RequestBodyTooLargeError,
  readJsonWithLimit,
} from "@/lib/marketing-store"
import { acquireConcurrencySlot, checkServerRateLimit } from "@/lib/rate-limit-store"
import { verifyServerCapability } from "@/lib/server-capabilities"

export const runtime = "nodejs"

const MAX_BODY_BYTES = 24 * 1024 * 1024
const MAX_UPSTREAM_BYTES = 32 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 30_000
const RATE_LIMIT = { limit: 10, windowMs: 60_000 }
const DAY_MS = 24 * 60 * 60 * 1000

// Mirrors the body produced by createModelBackedGenerativeFillRequest in
// components/photoshop/generative-fill-engine.ts. Only these fields are
// forwarded upstream — never the raw request body.
const dataImageSchema = z.string().startsWith("data:image/").max(24_000_000)

const GenerativeFillSchema = z.object({
  sourcePng: dataImageSchema,
  maskPng: dataImageSchema.optional(),
  prompt: z.string().max(2000),
  negativePrompt: z.string().max(2000).optional(),
  mode: z.enum(["fill", "remove", "expand"]).optional(),
  seed: z.number().int().nonnegative().optional(),
  strength: z.number().min(0).max(1).optional(),
})

async function readUpstreamTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const reader = response.body?.getReader()
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
      return null
    }

    chunks.push(decoder.decode(value, { stream: true }))
  }

  chunks.push(decoder.decode())
  return chunks.join("")
}

export async function POST(request: Request) {
  const endpoint = process.env.GENERATIVE_IMAGE_ENDPOINT
  const apiKey = process.env.GENERATIVE_IMAGE_API_KEY
  if (!endpoint || !apiKey) {
    return NextResponse.json(
      { error: "GENERATIVE_IMAGE_ENDPOINT and GENERATIVE_IMAGE_API_KEY are required for model-backed generative fill." },
      { status: 501 },
    )
  }

  if (!isAllowedOrigin(request, { requireRequestMetadata: true })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const capability = verifyServerCapability(request, "generative-fill")
  if (!capability.ok) {
    const unavailable = capability.reason === "unconfigured"
    return NextResponse.json(
      {
        error: unavailable
          ? "Generative fill authorization is not configured."
          : "Authentication required.",
      },
      { status: unavailable ? 503 : 401 },
    )
  }

  const subject = capability.claims.sub
  const clientIdentity = getClientIp(request)
  const rateLimit = await checkServerRateLimit(
    `genfill:minute:${subject}:${clientIdentity}`,
    RATE_LIMIT,
  )
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: rateLimit.reason
          ? "Generative fill rate limiting is unavailable."
          : "Too many requests. Try again later.",
      },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) },
        status: rateLimit.reason ? 503 : 429,
      },
    )
  }
  let body: unknown
  try {
    body = await readJsonWithLimit(request, MAX_BODY_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Request body is too large." },
        { status: 413 },
      )
    }
    return NextResponse.json(
      { error: "Body must be valid JSON." },
      { status: 400 },
    )
  }

  const parsed = GenerativeFillSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid generative fill request.", issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const concurrencyLimit = Math.max(1, Number(process.env.GENERATIVE_FILL_MAX_CONCURRENCY) || 2)
  const concurrency = acquireConcurrencySlot(`genfill:${subject}`, concurrencyLimit)
  if (!concurrency.acquired) {
    return NextResponse.json(
      { error: "Too many concurrent generative fill requests." },
      { headers: { "Retry-After": "1" }, status: 429 },
    )
  }

  try {
    const dailyLimit = Math.max(1, Number(process.env.GENERATIVE_FILL_DAILY_REQUEST_LIMIT) || 100)
    const dailyQuota = await checkServerRateLimit(
      `genfill:day:${subject}`,
      { limit: dailyLimit, windowMs: DAY_MS },
    )
    if (!dailyQuota.allowed) {
      return NextResponse.json(
        {
          error: dailyQuota.reason
            ? "Generative fill quota service is unavailable."
            : "Daily generative fill quota exceeded.",
        },
        {
          headers: { "Retry-After": String(dailyQuota.retryAfterSeconds ?? 3600) },
          status: dailyQuota.reason ? 503 : 429,
        },
      )
    }

    let upstream: Response
    try {
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        return NextResponse.json(
          { error: "Generative fill request timed out." },
          { status: 504 },
        )
      }
      return NextResponse.json(
        { error: "Generative fill request failed." },
        { status: 502 },
      )
    }

    const contentLength = upstream.headers.get("content-length")
    if (contentLength) {
      const contentBytes = Number(contentLength)
      if (Number.isFinite(contentBytes) && contentBytes > MAX_UPSTREAM_BYTES) {
        return NextResponse.json(
          { error: "Generative fill response is too large." },
          { status: 502 },
        )
      }
    }

    const text = await readUpstreamTextWithLimit(upstream, MAX_UPSTREAM_BYTES)
    if (text === null) {
      return NextResponse.json(
        { error: "Generative fill response is too large." },
        { status: 502 },
      )
    }
    const contentType = upstream.headers.get("content-type") ?? "application/json"

    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": contentType },
    })
  } finally {
    concurrency.release()
  }
}
