/**
 * Validate the configuration used for internal HTTP adapters. These adapters
 * receive bearer credentials and must not silently become public endpoints.
 */
export function isValidServiceUrl(value: string | undefined): value is string {
  if (!value?.trim()) return false
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    // Bearer credentials must not traverse a clear-text production network.
    return process.env.NODE_ENV !== "production" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function isAuthenticatedServiceConfigured(
  endpoint: string | undefined,
  token: string | undefined,
): boolean {
  return isValidServiceUrl(endpoint) && Boolean(token?.trim())
}
