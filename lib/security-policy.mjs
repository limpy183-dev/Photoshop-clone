const DEFAULT_SOURCES = Object.freeze({
  style: ["'self'", "'unsafe-inline'"],
  image: ["'self'", "data:", "blob:"],
  font: ["'self'", "data:"],
  connect: ["'self'", "https://vitals.vercel-insights.com", "https://va.vercel-scripts.com"],
  worker: ["'self'", "blob:"],
})

/**
 * Creates the CSP used by both static Next headers and nonce-bearing
 * per-request responses.
 *
 * @param {{ nonce?: string; development?: boolean }} [options]
 */
export function createContentSecurityPolicy(options = {}) {
  const { nonce, development = process.env.NODE_ENV !== "production" } = options
  const scripts = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : []),
    ...(development ? ["'unsafe-eval'"] : []),
    "https://va.vercel-scripts.com",
  ]
  return [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    `style-src ${DEFAULT_SOURCES.style.join(" ")}`,
    `img-src ${DEFAULT_SOURCES.image.join(" ")}`,
    `font-src ${DEFAULT_SOURCES.font.join(" ")}`,
    `connect-src ${DEFAULT_SOURCES.connect.join(" ")}`,
    `worker-src ${DEFAULT_SOURCES.worker.join(" ")}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}
