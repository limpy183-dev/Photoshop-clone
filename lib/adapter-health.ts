export interface AdapterHealth {
  name: "client-identity" | "marketing-record-store" | "rate-limit-service"
  configured: boolean
  reason: "configured" | "development-fallback" | "unconfigured"
}

import { isAuthenticatedServiceConfigured } from "./remote-service"

function configured(name: AdapterHealth["name"], value: string | undefined, localFallback: boolean): AdapterHealth {
  if (value?.trim()) return { name, configured: true, reason: "configured" }
  if (process.env.NODE_ENV !== "production" || localFallback) {
    return { name, configured: true, reason: "development-fallback" }
  }
  return { name, configured: false, reason: "unconfigured" }
}

function configuredRemote(
  name: AdapterHealth["name"],
  endpoint: string | undefined,
  token: string | undefined,
  localFallback: boolean,
): AdapterHealth {
  // An explicitly configured but unusable adapter must never be masked by a
  // development fallback: callers will try the remote endpoint first.
  if (endpoint?.trim()) {
    return isAuthenticatedServiceConfigured(endpoint, token)
      ? { name, configured: true, reason: "configured" }
      : { name, configured: false, reason: "unconfigured" }
  }
  return configured(name, undefined, localFallback)
}

function enabled(value: string | undefined) {
  return value === "true" || value === "1"
}

export function getAdapterHealth(): AdapterHealth[] {
  return [
    configuredRemote(
      "marketing-record-store",
      process.env.MARKETING_RECORD_STORE_URL,
      process.env.MARKETING_RECORD_STORE_TOKEN,
      process.env.ALLOW_LOCAL_MARKETING_STORE === "true",
    ),
    configuredRemote(
      "rate-limit-service",
      process.env.RATE_LIMIT_SERVICE_URL,
      process.env.RATE_LIMIT_SERVICE_TOKEN,
      process.env.ALLOW_LOCAL_SERVER_RATE_LIMIT === "true",
    ),
    configured(
      "client-identity",
      enabled(process.env.MARKETING_TRUSTED_PROXY) ? "true" : undefined,
      false,
    ),
  ]
}
