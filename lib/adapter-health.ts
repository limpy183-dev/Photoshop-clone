export interface AdapterHealth {
  name: "client-identity" | "marketing-record-store" | "rate-limit-service"
  configured: boolean
  reason: "configured" | "development-fallback" | "unconfigured"
}

function configured(name: AdapterHealth["name"], value: string | undefined, localFallback: boolean): AdapterHealth {
  if (value?.trim()) return { name, configured: true, reason: "configured" }
  if (process.env.NODE_ENV !== "production" || localFallback) {
    return { name, configured: true, reason: "development-fallback" }
  }
  return { name, configured: false, reason: "unconfigured" }
}

function enabled(value: string | undefined) {
  return value === "true" || value === "1"
}

export function getAdapterHealth(): AdapterHealth[] {
  return [
    configured(
      "marketing-record-store",
      process.env.MARKETING_RECORD_STORE_URL,
      process.env.ALLOW_LOCAL_MARKETING_STORE === "true",
    ),
    configured(
      "rate-limit-service",
      process.env.RATE_LIMIT_SERVICE_URL,
      process.env.ALLOW_LOCAL_SERVER_RATE_LIMIT === "true",
    ),
    configured(
      "client-identity",
      enabled(process.env.MARKETING_TRUSTED_PROXY) ? "true" : undefined,
      false,
    ),
  ]
}
