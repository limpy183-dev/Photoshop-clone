import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import {
  appendRecord,
  checkRateLimit,
  getClientIp,
  MARKETING_LIMITS,
  MarketingStoreQuotaError,
  RequestBodyTooLargeError,
  readJsonWithLimit,
} from "@/lib/marketing-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FeedbackSchema = z.object({
  message: z
    .string()
    .trim()
    .min(2, "Tell us a bit more.")
    .max(2000, "Keep it under 2000 characters."),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
})

type FeedbackRecord = {
  id: string
  message: string
  email?: string
  userAgent?: string
  createdAt?: string
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(
    `feedback:${getClientIp(request)}`,
    MARKETING_LIMITS.feedback.rateLimit,
  )
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again later." },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) },
        status: 429,
      },
    )
  }

  let body: unknown
  try {
    body = await readJsonWithLimit(request, MARKETING_LIMITS.feedback.bodyBytes)
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

  const parsed = FeedbackSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { ok: false, error: issue?.message ?? "Invalid request." },
      { status: 400 },
    )
  }

  const record: FeedbackRecord = {
    id: randomUUID(),
    message: parsed.data.message,
    email: parsed.data.email ? parsed.data.email : undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  }

  try {
    const result = await appendRecord<FeedbackRecord>("feedback", record, {
      ...MARKETING_LIMITS.feedback.store,
      dedupeById: false,
    })
    return NextResponse.json({
      ok: true,
      total: result.total,
    })
  } catch (error) {
    if (error instanceof MarketingStoreQuotaError) {
      return NextResponse.json(
        { ok: false, error: "Could not record feedback. Try again later." },
        { status: 503 },
      )
    }
    console.error("feedback failed", error)
    return NextResponse.json(
      { ok: false, error: "Could not record feedback. Try again later." },
      { status: 500 },
    )
  }
}
