import { createHash } from "node:crypto"

const MAX_ENCODED_SUBJECT_LENGTH = 120

function quotaSubject(subject: string): string {
  const encoded = encodeURIComponent(subject.trim())
  if (encoded.length <= MAX_ENCODED_SUBJECT_LENGTH) return encoded
  const digest = createHash("sha256").update(subject).digest("hex").slice(0, 16)
  return `${encoded.slice(0, MAX_ENCODED_SUBJECT_LENGTH)}:${digest}`
}

export function generativeFillMinuteKey(subject: string): string {
  return `genfill:minute:${quotaSubject(subject)}`
}

export function generativeFillDailyKey(subject: string): string {
  return `genfill:day:${quotaSubject(subject)}`
}

export function generativeFillConcurrencyKey(subject: string): string {
  return `genfill:concurrency:${quotaSubject(subject)}`
}
