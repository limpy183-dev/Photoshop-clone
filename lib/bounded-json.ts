const DEFAULT_MAX_JSON_RESPONSE_BYTES = 64 * 1024

/** Read a JSON HTTP response without allowing an adapter to allocate unbounded memory. */
export async function readBoundedJsonResponse(
  response: Response,
  maxBytes = DEFAULT_MAX_JSON_RESPONSE_BYTES,
): Promise<unknown | null> {
  const contentLength = response.headers.get("content-length")
  if (contentLength) {
    const declared = Number(contentLength)
    if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) return null
  }

  const reader = response.body?.getReader()
  if (!reader) return null

  const decoder = new TextDecoder()
  const chunks: string[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return JSON.parse(chunks.join(""))
  } catch {
    return null
  }
}
