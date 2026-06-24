import { uid } from "./uid"
import type { AssetLibraryItem, ContentCredential } from "./types"

// Applied to credential / droplet imports (see app-security audit). Each helper
// rejects prototype-pollution keys, bounds value sizes, rejects non-finite
// numbers, and drops anything outside the allow-list before it reaches state.
const RESERVED_IMPORT_KEYS = new Set(["__proto__", "constructor", "prototype"])
const SAFE_IMPORT_KEY = /^[A-Za-z0-9_\-:.]{1,64}$/
const ASSET_KINDS: ReadonlySet<AssetLibraryItem["kind"]> = new Set([
  "brush", "gradient", "pattern", "style", "swatch", "shape", "export",
  "tool-preset", "plugin", "cloud-library", "stock", "font", "icc-profile",
  "variable-data", "prepress",
])
const HEX_HASH = /^[0-9a-fA-F]+$/

const IMPORT_MAX_DEPTH = 6
const IMPORT_MAX_STRING = 4000
const IMPORT_MAX_ARRAY = 1024
const IMPORT_MAX_KEYS = 256

export function isImportRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function cleanImportText(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") return fallback
  // Strip C0 controls, DEL, bidi/zero-width formatters; collapse whitespace.
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
  return cleaned || fallback
}

function cleanImportOptionalText(value: unknown, maxLength = 120) {
  if (typeof value !== "string") return undefined
  const cleaned = cleanImportText(value, "", maxLength)
  return cleaned || undefined
}

function cleanImportId(value: unknown, fallbackPrefix: string, maxLength = 80) {
  const cleaned = cleanImportOptionalText(value, maxLength)
  return cleaned && SAFE_IMPORT_KEY.test(cleaned) && !RESERVED_IMPORT_KEYS.has(cleaned)
    ? cleaned
    : uid(fallbackPrefix)
}

function cleanFiniteNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function cleanImportBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

/**
 * Bounded recursive sanitiser used for unstructured `payload` fields on
 * AssetLibraryItem (asset payloads vary by kind and are normalised again
 * at use sites). Drops dangerous keys and bounds size; pure data passes
 * through unchanged.
 */
function safeImportJson(value: unknown, depth = 0): unknown {
  if (value === null) return null
  const type = typeof value
  if (type === "string") return (value as string).slice(0, IMPORT_MAX_STRING)
  if (type === "boolean") return value
  if (type === "number") return Number.isFinite(value as number) ? value : undefined
  if (type === "function" || type === "symbol" || type === "bigint" || type === "undefined") return undefined
  if (depth >= IMPORT_MAX_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value.slice(0, IMPORT_MAX_ARRAY)) {
      const next = safeImportJson(item, depth + 1)
      if (next !== undefined) out.push(next)
    }
    return out
  }
  if (type === "object") {
    const out: Record<string, unknown> = {}
    let copied = 0
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (copied >= IMPORT_MAX_KEYS) break
      if (RESERVED_IMPORT_KEYS.has(key)) continue
      if (!SAFE_IMPORT_KEY.test(key)) continue
      const next = safeImportJson(nested, depth + 1)
      if (next === undefined) continue
      out[key] = next
      copied += 1
    }
    return out
  }
  return undefined
}

function normalizeImportedCredential(value: unknown): ContentCredential | null {
  if (!isImportRecord(value)) return null
  const documentHash = typeof value.documentHash === "string" ? value.documentHash : ""
  const hashOk = documentHash.length >= 8 && documentHash.length <= 128 && HEX_HASH.test(documentHash)
  if (!hashOk) return null

  const dimensionsRaw = isImportRecord(value.dimensions) ? value.dimensions : { width: 0, height: 0 }
  const ingredientsRaw = Array.isArray(value.ingredients) ? value.ingredients : []
  const ingredients = ingredientsRaw
    .slice(0, 256)
    .map((ing): ContentCredential["ingredients"][number] | null => {
      if (!isImportRecord(ing)) return null
      const ingHash = typeof ing.hash === "string" ? ing.hash : ""
      if (ingHash.length === 0 || ingHash.length > 128 || !HEX_HASH.test(ingHash)) return null
      return {
        id: cleanImportId(ing.id, "ingredient"),
        name: cleanImportText(ing.name, "Layer", 120),
        kind: typeof ing.kind === "string" ? (ing.kind as ContentCredential["ingredients"][number]["kind"]) : undefined,
        visible: cleanImportBoolean(ing.visible, true),
        hash: ingHash.toLowerCase(),
      }
    })
    .filter((ing): ing is ContentCredential["ingredients"][number] => ing !== null)

  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.length <= 64
      ? value.createdAt
      : new Date().toISOString()

  return {
    id: cleanImportId(value.id, "credential"),
    action: cleanImportText(value.action, "Imported Provenance", 120),
    actor: cleanImportText(value.actor, "Imported Actor", 120),
    software: cleanImportText(value.software, "Photoshop Web", 120),
    createdAt,
    documentName: cleanImportText(value.documentName, "Document", 200),
    documentHash: documentHash.toLowerCase(),
    layerCount: cleanFiniteNumber(value.layerCount, 0, 0, 100_000),
    dimensions: {
      width: cleanFiniteNumber(dimensionsRaw.width, 0, 0, 65_535),
      height: cleanFiniteNumber(dimensionsRaw.height, 0, 0, 65_535),
    },
    ingredients,
    assertion: cleanImportText(value.assertion, "Imported Provenance", 200),
  }
}

export function normalizeCredentialImportPayload(parsed: unknown): ContentCredential[] {
  const list = isImportRecord(parsed) && Array.isArray(parsed.credentials)
    ? (parsed.credentials as unknown[])
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [parsed]
  const out: ContentCredential[] = []
  for (const item of list.slice(0, 256)) {
    const next = normalizeImportedCredential(item)
    if (next) out.push(next)
  }
  if (!out.length) {
    throw new Error("Credential file did not contain any valid manifests.")
  }
  return out
}

function normalizeImportedAsset(value: unknown): AssetLibraryItem | null {
  if (!isImportRecord(value)) return null
  const kind = value.kind
  if (typeof kind !== "string" || !ASSET_KINDS.has(kind as AssetLibraryItem["kind"])) return null
  return {
    id: cleanImportId(value.id, "asset"),
    name: cleanImportText(value.name, "Imported Asset", 120),
    kind: kind as AssetLibraryItem["kind"],
    group: cleanImportOptionalText(value.group, 80),
    payload: safeImportJson(value.payload),
    createdAt: cleanFiniteNumber(value.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  }
}

export function normalizeDropletImportPayload(parsed: unknown): AssetLibraryItem {
  const candidate = isImportRecord(parsed) && parsed.asset !== undefined ? parsed.asset : parsed
  const cleaned = normalizeImportedAsset(candidate)
  if (!cleaned) {
    throw new Error("Droplet file does not contain a recognisable asset.")
  }
  return cleaned
}
