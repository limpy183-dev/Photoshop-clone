import { createHmac, timingSafeEqual } from "node:crypto"

export type ServerCapabilityScope = "generative-fill"

export interface ServerCapabilityClaims {
  exp: number
  iat: number
  nonce: string
  scope: ServerCapabilityScope
  sub: string
}

export type CapabilityVerification =
  | { ok: true; claims: ServerCapabilityClaims }
  | { ok: false; reason: "expired" | "invalid" | "missing" | "unconfigured" }

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url")
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest()
}

function capabilitySecret() {
  return process.env.GENERATIVE_FILL_CAPABILITY_SECRET?.trim() ?? ""
}

/**
 * Minting is exported for trusted server/session integrations and tests. Never
 * expose it from a public route: an authenticated application session must be
 * established before a caller receives a paid capability.
 */
export function createServerCapability(
  claims: Omit<ServerCapabilityClaims, "iat"> & { iat?: number },
  secret = capabilitySecret(),
): string {
  if (secret.length < 32) {
    throw new Error("Capability signing requires a secret of at least 32 characters.")
  }
  const normalized: ServerCapabilityClaims = {
    ...claims,
    iat: claims.iat ?? Math.floor(Date.now() / 1000),
  }
  const payload = encode(JSON.stringify(normalized))
  return `v1.${payload}.${encode(signature(payload, secret))}`
}

export function verifyServerCapability(
  request: Request,
  expectedScope: ServerCapabilityScope,
  options: { now?: number; secret?: string } = {},
): CapabilityVerification {
  const secret = options.secret ?? capabilitySecret()
  if (secret.length < 32) return { ok: false, reason: "unconfigured" }

  const authorization = request.headers.get("authorization")?.trim() ?? ""
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return { ok: false, reason: "missing" }
  }
  const token = authorization.slice(7).trim()
  const [version, payload, encodedSignature, ...rest] = token.split(".")
  if (version !== "v1" || !payload || !encodedSignature || rest.length) {
    return { ok: false, reason: "invalid" }
  }

  try {
    const actual = Buffer.from(encodedSignature, "base64url")
    const expected = signature(payload, secret)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return { ok: false, reason: "invalid" }
    }
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ServerCapabilityClaims>
    const issuedAt = claims.iat
    const expiresAt = claims.exp
    if (
      claims.scope !== expectedScope ||
      typeof claims.sub !== "string" ||
      !claims.sub.trim() ||
      claims.sub.length > 200 ||
      typeof claims.nonce !== "string" ||
      !claims.nonce ||
      claims.nonce.length > 200 ||
      typeof issuedAt !== "number" ||
      !Number.isInteger(issuedAt) ||
      typeof expiresAt !== "number" ||
      !Number.isInteger(expiresAt)
    ) {
      return { ok: false, reason: "invalid" }
    }
    const now = options.now ?? Math.floor(Date.now() / 1000)
    if (expiresAt <= now || issuedAt > now + 60 || expiresAt - issuedAt > 15 * 60) {
      return { ok: false, reason: "expired" }
    }
    return { ok: true, claims: claims as ServerCapabilityClaims }
  } catch {
    return { ok: false, reason: "invalid" }
  }
}
