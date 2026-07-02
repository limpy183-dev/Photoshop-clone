import { createHash } from "node:crypto"

export interface ClientIdentity {
  key: string
  source: "authenticated-subject" | "deployment-header" | "trusted-proxy" | "header-fingerprint"
  strength: "strong" | "weak"
}

function trustedProxyEnabled() {
  return process.env.MARKETING_TRUSTED_PROXY === "true" ||
    process.env.MARKETING_TRUSTED_PROXY === "1"
}

function safeIdentity(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized && /^[a-zA-Z0-9:._@+-]{1,256}$/.test(normalized)
    ? normalized
    : null
}

function weakFingerprint(request: Request) {
  const parts = [
    request.headers.get("user-agent")?.trim().slice(0, 512) ?? "",
    request.headers.get("accept-language")?.trim().slice(0, 256) ?? "",
    request.headers.get("sec-ch-ua-platform")?.trim().slice(0, 128) ?? "",
  ]
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 24)
}

export function resolveClientIdentity(
  request: Request,
  options: { authenticatedSubject?: string | null } = {},
): ClientIdentity {
  const subject = safeIdentity(options.authenticatedSubject)
  if (subject) {
    return { key: `subject:${subject}`, source: "authenticated-subject", strength: "strong" }
  }

  if (trustedProxyEnabled()) {
    const deploymentHeader = safeIdentity(
      request.headers.get(process.env.TRUSTED_CLIENT_IDENTITY_HEADER?.trim() || "x-client-identity"),
    )
    if (deploymentHeader) {
      return {
        key: `deployment:${deploymentHeader}`,
        source: "deployment-header",
        strength: "strong",
      }
    }
    const ip = safeIdentity(
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-vercel-forwarded-for")?.split(",")[0] ??
      request.headers.get("x-real-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0],
    )
    if (ip) return { key: `ip:${ip}`, source: "trusted-proxy", strength: "strong" }
  }

  return {
    key: `fingerprint:${weakFingerprint(request)}`,
    source: "header-fingerprint",
    strength: "weak",
  }
}

export function productionIdentityIsUsable(identity: ClientIdentity) {
  return process.env.NODE_ENV !== "production" || identity.strength === "strong"
}

