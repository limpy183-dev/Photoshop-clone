import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { z } from "zod"
import {
  appendRecord,
  isAllowedOrigin,
  MARKETING_LIMITS,
  MarketingStoreQuotaError,
  MarketingStoreUnavailableError,
  RequestBodyTooLargeError,
  readJsonWithLimit,
} from "@/lib/marketing-store"
import { checkServerRateLimit } from "@/lib/rate-limit-store"
import { productionIdentityIsUsable, resolveClientIdentity } from "@/lib/client-identity"

export const runtime = "nodejs"

const SubscribeSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address.")
    .max(254, "That email is suspiciously long."),
  source: z.string().max(64).optional(),
})

type SubscribeRecord = {
  id: string
  email: string
  source?: string
  createdAt?: string
}

function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 16)
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    )
  }

  const identity = resolveClientIdentity(request)
  if (!productionIdentityIsUsable(identity)) {
    return NextResponse.json(
      { ok: false, error: "Rate limiting is unavailable. Try again later." },
      { status: 503 },
    )
  }
  const rateLimit = await checkServerRateLimit(
    `subscribe:${identity.key}`,
    MARKETING_LIMITS.subscribers.rateLimit,
  )
  if (!rateLimit.allowed) {
    const rateLimitUnavailable = Boolean(rateLimit.reason)
    return NextResponse.json(
      {
        ok: false,
        error: rateLimitUnavailable
          ? "Rate limiting is unavailable. Try again later."
          : "Too many requests. Try again later.",
      },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) },
        status: rateLimitUnavailable ? 503 : 429,
      },
    )
  }

  let body: unknown
  try {
    body = await readJsonWithLimit(request, MARKETING_LIMITS.subscribers.bodyBytes)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { ok: false, error: "Request body is too large." },
        { status: 413 },
      )
    }
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON." },
      { status: 400 },
    )
  }

  const parsed = SubscribeSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { ok: false, error: issue?.message ?? "Invalid request." },
      { status: 400 },
    )
  }

  const { email, source } = parsed.data
  const record: SubscribeRecord = {
    id: hashEmail(email),
    email,
    source: source ?? "marketing-site",
  }

  try {
    await appendRecord<SubscribeRecord>("subscribers", record, {
      ...MARKETING_LIMITS.subscribers.store,
      dedupeById: true,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof MarketingStoreQuotaError || error instanceof MarketingStoreUnavailableError) {
      console.warn(
        error instanceof MarketingStoreQuotaError
          ? "marketing_record_store_quota"
          : "marketing_record_store_unavailable",
        {
          operation: "subscribers.append",
          reason: error.reason,
        },
      )
      return NextResponse.json(
        { ok: false, error: "Could not record subscription. Try again later." },
        { status: 503 },
      )
    }
    console.error("subscribe failed", error)
    return NextResponse.json(
      { ok: false, error: "Could not record subscription. Try again later." },
      { status: 500 },
    )
  }
}
