import { NextRequest, NextResponse } from "next/server"
import { createContentSecurityPolicy } from "./lib/security-policy.mjs"

/**
 * Per-request CSP nonce proxy.
 *
 * The static headers in next.config.mjs cover everything except scripts.
 * Scripts need a per-request nonce so Next.js's framework boot scripts
 * (chunk loader, App Router streaming hydration data) can run while
 * cross-origin / inline-injected scripts are blocked.
 *
 * Flow:
 *   1. Generate a 128-bit nonce in proxy.
 *   2. Forward it to the React tree via the `x-nonce` request header
 *      (Next.js exposes this to <Script nonce> via headers()).
 *   3. Build the CSP with `script-src 'self' 'nonce-...' 'strict-dynamic'
 *      https://va.vercel-scripts.com` and ship it on the response.
 *
 * Tests and certain non-browser callers (curl, Playwright) hit the API
 * directly; we still ship the same headers but they are inert there.
 */

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // base64 without padding so the nonce is shorter; CSP accepts both.
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  if (typeof btoa === "function") return btoa(binary).replace(/=+$/g, "")
  // Edge runtime always exposes btoa; the fallback exists for unit tests.
  return Buffer.from(bytes).toString("base64").replace(/=+$/g, "")
}

export function proxy(request: NextRequest) {
  const nonce = generateNonce()
  const csp = createContentSecurityPolicy({ nonce })

  // Forward the nonce to the rendered tree. layout.tsx (and any nested
  // server component that injects a <Script>) can read it via
  // `headers().get("x-nonce")`.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", csp)
  // Keep the nonce header on the response too so client-side debug tools
  // and integration tests can assert on it. It is not sensitive.
  response.headers.set("x-nonce", nonce)
  return response
}

// Skip proxy for static assets and the Next.js internals — those
// paths have no scripts that need nonces and rewriting their headers
// regresses caching.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.js$|.*\\.map$).*)",
  ],
}
