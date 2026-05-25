import type {
  AssetLibraryItem,
  PluginActionDescriptor,
  PluginCommandAction,
  PluginCommandDescriptor,
  PluginDescriptor,
  PluginCepManifestSummary,
  PluginEightBfBinarySummary,
  PluginPermission,
  PluginUxpEntrypoint,
  PluginUxpManifestSummary,
} from "./types"

export const PLUGIN_MANIFEST_FORMAT = "ps-plugin-manifest"
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1
export const PLUGIN_MANIFEST_SCHEMA_ID = "https://photoshop-web.local/schemas/plugin-manifest.v1.json"
export const PLUGIN_PACKAGE_FORMAT = "ps-plugin-package"
export const PLUGIN_MESSAGE_CHANNEL = "photoshop-web-plugin"

export const MAX_PLUGIN_IMPORT_BYTES = 3_000_000
const MAX_PLUGIN_COUNT = 64
const MAX_PLUGIN_HTML_LENGTH = 64_000
const MAX_PLUGIN_STRING_LENGTH = 4_000
const MAX_PLUGIN_JSON_DEPTH = 6
const MAX_PLUGIN_JSON_ARRAY = 256
const MAX_PLUGIN_JSON_KEYS = 128
const MAX_PLUGIN_STORAGE_KEYS = 128
const MAX_PLUGIN_STORAGE_BYTES = 64_000

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/
const SAFE_JSON_KEY = /^[A-Za-z0-9_\-:.]{1,80}$/
const PLUGIN_KINDS: ReadonlySet<PluginDescriptor["kind"]> = new Set(["cep-panel", "ux-plugin", "8bf-filter"])
const PLUGIN_PERMISSIONS: ReadonlySet<PluginPermission> = new Set([
  "document:read",
  "layers:read",
  "layers:write",
  "filters:write",
  "commands",
  "storage",
  "ui",
])
export const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  "document:read": "Document read",
  "layers:read": "Layer read",
  "layers:write": "Layer write",
  "filters:write": "Filter write",
  commands: "Commands",
  storage: "Storage",
  ui: "Host UI",
}

export const PLUGIN_PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> = {
  "document:read": "Read document name, dimensions, color mode, and layer count.",
  "layers:read": "Read active layer metadata.",
  "layers:write": "Create or update layer records through approved host actions.",
  "filters:write": "Modify active layer pixels through JSON-described filters.",
  commands: "Run commands declared in the plugin manifest.",
  storage: "Read and write the plugin's project-local storage namespace.",
  ui: "Render host-native controls through message passing.",
}

export const PLUGIN_ALLOWED_PANEL_METHODS = [
  "plugin.ready",
  "host.getInfo",
  "document.getInfo",
  "layers.getActive",
  "layers.create",
  "layers.update",
  "action.batchPlay",
  "uxp.executeAsModal",
  "cep.evalScript",
  "cep.dispatchEvent",
  "8bf.getInfo",
  "8bf.run",
  "commands.run",
  "storage.get",
  "storage.set",
  "storage.remove",
  "storage.clear",
  "storage.keys",
  "ui.render",
  "ui.toast",
] as const

const PANEL_METHODS = new Set<string>(PLUGIN_ALLOWED_PANEL_METHODS)
const ASSET_KINDS: ReadonlySet<AssetLibraryItem["kind"]> = new Set([
  "brush",
  "gradient",
  "pattern",
  "style",
  "swatch",
  "shape",
  "export",
  "tool-preset",
  "plugin",
  "cloud-library",
  "stock",
  "font",
  "icc-profile",
  "variable-data",
  "prepress",
])

export type PluginStorageOperation =
  | { operation: "set"; key: string; value: unknown }
  | { operation: "remove"; key: string }
  | { operation: "clear" }

export interface NormalizePluginImportOptions {
  fileSizeBytes: number
  now: number
  makeId?: (prefix: string, index: number) => string
}

export interface PluginPanelRequest {
  channel: typeof PLUGIN_MESSAGE_CHANNEL
  pluginId: string
  token: string
  requestId: string
  method: string
  params?: unknown
}

export type PluginUiNode =
  | { type: "stack" | "row"; id?: string; children?: PluginUiNode[] }
  | { type: "text"; id?: string; text: string; tone?: "normal" | "muted" | "strong" | "danger" }
  | { type: "badge"; id?: string; label: string; tone?: "info" | "success" | "warning" | "danger" }
  | { type: "button"; id: string; label: string; action: string; variant?: "primary" | "secondary" | "danger" }
  | { type: "input"; id: string; label?: string; value?: string; placeholder?: string }
  | { type: "meter"; id?: string; label?: string; value: number; max?: number }
  | { type: "divider"; id?: string }

export interface NormalizePluginPackageResult {
  plugins: PluginDescriptor[]
  assets: AssetLibraryItem[]
}

export interface PluginInstallPermissionReview {
  pluginId: string
  name: string
  requiresPrompt: boolean
  permissions: Array<{ id: PluginPermission; label: string; description: string }>
  capabilities: string[]
}

export function getPluginManifestSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: PLUGIN_MANIFEST_SCHEMA_ID,
    title: "Photoshop Web Browser Plugin Manifest",
    type: "object",
    additionalProperties: false,
    required: ["format", "version", "plugins"],
    properties: {
      format: { const: PLUGIN_MANIFEST_FORMAT },
      version: { const: PLUGIN_MANIFEST_SCHEMA_VERSION },
      app: { type: "string", maxLength: 80 },
      plugins: {
        type: "array",
        minItems: 1,
        maxItems: MAX_PLUGIN_COUNT,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "kind"],
          properties: {
            id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,80}$" },
            name: { type: "string", minLength: 1, maxLength: 80 },
            kind: { enum: [...PLUGIN_KINDS] },
            enabled: { type: "boolean" },
            version: { type: "string", maxLength: 32 },
            author: { type: "string", maxLength: 80 },
            description: { type: "string", maxLength: 240 },
            permissions: {
              type: "array",
              uniqueItems: true,
              maxItems: PLUGIN_PERMISSIONS.size,
              items: { enum: [...PLUGIN_PERMISSIONS] },
            },
            runtimeAdapters: {
              type: "array",
              uniqueItems: true,
              maxItems: 4,
              items: { enum: ["browser", "uxp", "cep", "8bf-native"] },
            },
            capabilities: {
              type: "array",
              maxItems: 16,
              items: { type: "string", maxLength: 80 },
            },
            uxpManifest: { type: "object" },
            cepManifest: { type: "object" },
            binary8bf: { type: "object" },
            panelHtml: { type: "string", maxLength: MAX_PLUGIN_HTML_LENGTH },
            commands: {
              type: "array",
              maxItems: 32,
              items: {
                type: "object",
                required: ["id", "title", "action"],
                properties: {
                  id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,80}$" },
                  title: { type: "string", minLength: 1, maxLength: 80 },
                  group: { type: "string", maxLength: 40 },
                  description: { type: "string", maxLength: 180 },
                  requiredPermissions: {
                    type: "array",
                    uniqueItems: true,
                    items: { enum: [...PLUGIN_PERMISSIONS] },
                  },
                  action: {
                    oneOf: [
                      { type: "object", required: ["type"], properties: { type: { const: "open-panel" } } },
                      { type: "object", required: ["type"], properties: { type: { const: "apply-filter" } } },
                      { type: "object", required: ["type"], properties: { type: { const: "post-message" }, message: true } },
                      { type: "object", required: ["type"], properties: { type: { const: "batch-play" }, descriptors: { type: "array" } } },
                      { type: "object", required: ["type"], properties: { type: { const: "eval-script" }, source: { type: "string" } } },
                    ],
                  },
                },
              },
            },
            storageDefaults: { type: "object" },
            filterKernel: {
              type: "array",
              minItems: 9,
              maxItems: 9,
              items: { type: "number", minimum: -128, maximum: 128 },
            },
            filterBias: { type: "number" },
            filterDivisor: { type: "number" },
          },
        },
      },
    },
  } as const
}

export function describePluginHostCapabilities() {
  return {
    app: "Photoshop Web",
    manifest: {
      format: PLUGIN_MANIFEST_FORMAT,
      schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
      schemaId: PLUGIN_MANIFEST_SCHEMA_ID,
      packageFormat: PLUGIN_PACKAGE_FORMAT,
    },
    sandbox: {
      iframeSandbox: "allow-scripts",
      csp: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'",
      lifecycle: ["plugin.ready", "mount", "reload", "unmount"],
    },
    messageApi: {
      channel: PLUGIN_MESSAGE_CHANNEL,
      allowedMethods: [...PLUGIN_ALLOWED_PANEL_METHODS],
      envelope: ["channel", "pluginId", "token", "requestId", "method", "params"],
    },
    adobeCompatibility: {
      uxp: {
        mode: "browser-compatible adapter",
        modules: ["require('photoshop')", "require('uxp')"],
        methods: ["core.executeAsModal", "action.batchPlay", "app.getActiveDocument"],
      },
      cep: {
        mode: "browser-compatible adapter",
        globals: ["CSInterface", "__adobe_cep__"],
        methods: ["evalScript", "dispatchEvent", "getHostEnvironment"],
      },
      eightBf: {
        mode: "browser-safe descriptor executor",
        nativeBinary: "metadata-only",
        executablePaths: ["manifest filterKernel", "future wasm adapter"],
      },
      actionManager: {
        mode: "allow-listed descriptor bridge",
        descriptors: ["get", "make", "set", "select", "hide", "show", "delete", "duplicate", "filter"],
      },
    },
    permissions: Object.entries(PLUGIN_PERMISSION_LABELS).map(([id, label]) => ({
      id: id as PluginPermission,
      label,
      description: PLUGIN_PERMISSION_DESCRIPTIONS[id as PluginPermission],
    })),
    limits: {
      importBytes: MAX_PLUGIN_IMPORT_BYTES,
      pluginCount: MAX_PLUGIN_COUNT,
      panelHtmlBytes: MAX_PLUGIN_HTML_LENGTH,
      storageBytes: MAX_PLUGIN_STORAGE_BYTES,
      storageKeys: MAX_PLUGIN_STORAGE_KEYS,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function cleanText(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") return fallback
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
  return cleaned || fallback
}

function cleanOptionalText(value: unknown, maxLength = 120) {
  const cleaned = cleanText(value, "", maxLength)
  return cleaned || undefined
}

function cleanLabel(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value === "string") return cleanText(value, fallback, maxLength)
  if (isRecord(value)) {
    return cleanText(value.default ?? value.en ?? Object.values(value)[0], fallback, maxLength)
  }
  return fallback
}

function cleanId(value: unknown, fallback: string) {
  const text = cleanText(value, "", 80)
  return SAFE_ID.test(text) && !RESERVED_KEYS.has(text) ? text : fallback
}

function pushUnique<T>(target: T[], value: T) {
  if (!target.includes(value)) target.push(value)
}

function cleanBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function cleanNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

export function safePluginJson(value: unknown, depth = 0): unknown {
  if (value === null) return null
  if (typeof value === "string") return value.slice(0, MAX_PLUGIN_STRING_LENGTH)
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  const type = typeof value
  if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") return undefined
  if (depth >= MAX_PLUGIN_JSON_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value.slice(0, MAX_PLUGIN_JSON_ARRAY)) {
      const next = safePluginJson(item, depth + 1)
      if (next !== undefined) out.push(next)
    }
    return out
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    let copied = 0
    for (const [key, nested] of Object.entries(value)) {
      if (copied >= MAX_PLUGIN_JSON_KEYS) break
      if (RESERVED_KEYS.has(key) || !SAFE_JSON_KEY.test(key)) continue
      const next = safePluginJson(nested, depth + 1)
      if (next === undefined) continue
      out[key] = next
      copied += 1
    }
    return out
  }
  return undefined
}

function normalizePermissions(value: unknown): PluginPermission[] {
  const source = Array.isArray(value) ? value : []
  const out: PluginPermission[] = []
  for (const item of source) {
    if (typeof item !== "string" || !PLUGIN_PERMISSIONS.has(item as PluginPermission)) continue
    if (!out.includes(item as PluginPermission)) out.push(item as PluginPermission)
  }
  return out
}

function normalizeCapabilities(value: unknown): string[] | undefined {
  const source = Array.isArray(value) ? value : []
  const out: string[] = []
  for (const item of source.slice(0, 16)) {
    const label = cleanOptionalText(item, 80)
    if (label && !out.includes(label)) out.push(label)
  }
  return out.length ? out : undefined
}

function normalizeRuntimeAdapters(value: unknown): PluginDescriptor["runtimeAdapters"] | undefined {
  const allowed = new Set(["browser", "uxp", "cep", "8bf-native"])
  const source = Array.isArray(value) ? value : []
  const out: NonNullable<PluginDescriptor["runtimeAdapters"]> = []
  for (const item of source) {
    if (typeof item === "string" && allowed.has(item) && !out.includes(item as never)) {
      out.push(item as NonNullable<PluginDescriptor["runtimeAdapters"]>[number])
    }
  }
  return out.length ? out : undefined
}

function normalizeUxpManifestSummary(value: unknown): PluginUxpManifestSummary | null {
  if (!isRecord(value)) return null
  const manifestVersion = cleanNumber(value.manifestVersion, 1, 1, 99)
  const entrypoints = normalizeUxpEntrypoints(value.entrypoints)
  return {
    manifestVersion,
    id: cleanText(value.id, "uxp-plugin", 120),
    main: cleanOptionalText(value.main, 160),
    hostApp: cleanOptionalText(value.hostApp, 20),
    minVersion: cleanOptionalText(value.minVersion, 32),
    entrypoints,
  }
}

function normalizeCepManifestSummary(value: unknown): PluginCepManifestSummary | null {
  if (!isRecord(value)) return null
  return {
    extensionId: cleanText(value.extensionId, "cep-extension", 120),
    bundleName: cleanText(value.bundleName, "CEP Extension", 80),
    bundleVersion: cleanOptionalText(value.bundleVersion, 32),
    host: cleanOptionalText(value.host, 32),
    mainPath: cleanOptionalText(value.mainPath, 180),
  }
}

function normalizeEightBfSummary(value: unknown): PluginEightBfBinarySummary | undefined {
  if (!isRecord(value)) return undefined
  return {
    fileName: cleanText(value.fileName, "plugin.8bf", 160),
    byteLength: Math.round(cleanNumber(value.byteLength, 0, 0, MAX_PLUGIN_IMPORT_BYTES)),
    signature: cleanText(value.signature, "", 64).replace(/[^0-9a-f]/gi, "").slice(0, 64).toLowerCase(),
    executable: cleanBoolean(value.executable, false),
    reason: cleanText(value.reason, "Native 8BF binaries cannot execute inside the browser sandbox.", 180),
  }
}

function sanitizePanelHtml(value: unknown) {
  if (typeof value !== "string") return undefined
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\bwindow\s*\.\s*(?:parent|top|opener)\b/gi, "blockedWindow")
    .replace(/\b(?:parent|top|opener)\s*\./gi, "blockedWindow.")
    .replace(/\bdocument\s*\.\s*cookie\b/gi, "undefined")
    .slice(0, MAX_PLUGIN_HTML_LENGTH)
  return cleaned || undefined
}

function normalizeCommandAction(value: unknown): PluginCommandAction | null {
  if (!isRecord(value) || typeof value.type !== "string") return null
  if (value.type === "open-panel") return { type: "open-panel" }
  if (value.type === "apply-filter") return { type: "apply-filter" }
  if (value.type === "post-message") return { type: "post-message", message: safePluginJson(value.message) }
  if (value.type === "batch-play") return { type: "batch-play", descriptors: normalizePluginActionDescriptors(value.descriptors) }
  if (value.type === "eval-script") return { type: "eval-script", source: cleanText(value.source, "", MAX_PLUGIN_STRING_LENGTH) }
  return null
}

function normalizeCommands(value: unknown): PluginCommandDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: PluginCommandDescriptor[] = []
  for (const raw of value.slice(0, 32)) {
    if (!isRecord(raw)) continue
    const action = normalizeCommandAction(raw.action)
    const title = cleanText(raw.title, "", 80)
    if (!action || !title) continue
    const command: PluginCommandDescriptor = {
      id: cleanId(raw.id, `command_${out.length}`),
      title,
      action,
    }
    const group = cleanOptionalText(raw.group, 40)
    const description = cleanOptionalText(raw.description, 180)
    const requiredPermissions = normalizePermissions(raw.requiredPermissions)
    if (group) command.group = group
    if (description) command.description = description
    if (requiredPermissions.length) command.requiredPermissions = requiredPermissions
    out.push(command)
  }
  return out.length ? out : undefined
}

function normalizeFilterKernel(value: unknown) {
  if (!Array.isArray(value) || value.length !== 9) return undefined
  const kernel = value.map((item) =>
    typeof item === "number" && Number.isFinite(item) ? Math.max(-128, Math.min(128, item)) : NaN,
  )
  return kernel.every((item) => Number.isFinite(item)) ? kernel : undefined
}

const ACTION_DESCRIPTOR_OBJECTS = new Set([
  "delete",
  "duplicate",
  "filter",
  "get",
  "hide",
  "make",
  "move",
  "select",
  "set",
  "show",
  "transform",
])

export function normalizePluginActionDescriptors(value: unknown): PluginActionDescriptor[] {
  const source = Array.isArray(value) ? value : isRecord(value) ? [value] : []
  const out: PluginActionDescriptor[] = []
  for (const raw of source.slice(0, 32)) {
    const safe = safePluginJson(raw)
    if (!isRecord(safe)) continue
    const action = cleanText(safe._obj, "", 80)
    if (!action || !SAFE_JSON_KEY.test(action)) continue
    const descriptor: PluginActionDescriptor = { ...(safe as Record<string, unknown>), _obj: action }
    out.push(descriptor)
  }
  return out
}

function descriptorText(descriptor: PluginActionDescriptor) {
  return JSON.stringify(descriptor).toLowerCase()
}

export function permissionsForPluginActionDescriptors(descriptors: readonly PluginActionDescriptor[]): PluginPermission[] {
  const permissions: PluginPermission[] = []
  for (const descriptor of descriptors) {
    const action = descriptor._obj.toLowerCase()
    const text = descriptorText(descriptor)
    if (text.includes("document")) pushUnique(permissions, "document:read")
    if (text.includes("layer")) pushUnique(permissions, "layers:read")
    if (
      action === "make" ||
      action === "set" ||
      action === "delete" ||
      action === "duplicate" ||
      action === "move" ||
      action === "hide" ||
      action === "show" ||
      action === "transform"
    ) {
      pushUnique(permissions, "layers:write")
    }
    if (action === "filter" || text.includes("filter")) pushUnique(permissions, "filters:write")
    if (!ACTION_DESCRIPTOR_OBJECTS.has(action)) pushUnique(permissions, "commands")
  }
  return permissions
}

function firstHostDefinition(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null
  return isRecord(value) ? value : null
}

function normalizeUxpEntrypoints(value: unknown): PluginUxpEntrypoint[] {
  const source = Array.isArray(value) ? value : []
  return source.slice(0, 32).flatMap((item) => {
    if (!isRecord(item)) return []
    const type: PluginUxpEntrypoint["type"] | null = item.type === "panel" || item.type === "command" ? item.type : null
    const id = cleanId(item.id, "")
    if (!type || !id) return []
    return [{ id, type, label: cleanLabel(item.label, id, 80) }]
  })
}

function permissionsFromUxpManifest(value: Record<string, unknown>, entrypoints: ReturnType<typeof normalizeUxpEntrypoints>) {
  const permissions: PluginPermission[] = []
  const required = isRecord(value.requiredPermissions) ? value.requiredPermissions : {}
  if (
    required.localFileSystem !== undefined ||
    required.launchProcess !== undefined ||
    required.webview !== undefined ||
    value.storageDefaults !== undefined
  ) {
    pushUnique(permissions, "storage")
  }
  if (entrypoints.some((entry) => entry.type === "panel")) pushUnique(permissions, "ui")
  if (entrypoints.some((entry) => entry.type === "command")) pushUnique(permissions, "commands")
  return permissions
}

function normalizeUxpPlugin(value: unknown, index: number, options: NormalizePluginImportOptions): PluginDescriptor | null {
  if (!isRecord(value)) return null
  const manifestVersion = typeof value.manifestVersion === "number" && Number.isFinite(value.manifestVersion)
    ? Math.max(1, Math.round(value.manifestVersion))
    : null
  const host = firstHostDefinition(value.host)
  const hostApp = cleanOptionalText(host?.app, 20)
  if (!manifestVersion || hostApp !== "PS") return null
  const makeId = options.makeId ?? ((prefix: string, itemIndex: number) => `${prefix}_${itemIndex}`)
  const entrypoints = normalizeUxpEntrypoints(value.entrypoints)
  const name = cleanLabel(value.name, cleanText(value.id, "UXP Plugin", 80), 80)
  const commands = entrypoints.map((entry): PluginCommandDescriptor => ({
    id: entry.id,
    title: entry.label,
    group: "UXP",
    action: entry.type === "panel"
      ? { type: "open-panel" }
      : { type: "post-message", message: { entrypoint: entry.id, runtime: "uxp" } },
    requiredPermissions: entry.type === "panel" ? ["ui"] : ["commands"],
  }))
  return {
    id: makeId("plugin", index),
    name,
    kind: "ux-plugin",
    enabled: cleanBoolean(value.enabled, true),
    manifestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    version: cleanOptionalText(value.version, 32),
    author: cleanOptionalText(value.author, 80),
    description: cleanOptionalText(value.description, 240),
    permissions: permissionsFromUxpManifest(value, entrypoints),
    capabilities: [`UXP manifest adapter`, `${entrypoints.length} UXP entrypoint${entrypoints.length === 1 ? "" : "s"}`],
    runtimeAdapters: ["uxp"],
    uxpManifest: {
      manifestVersion,
      id: cleanText(value.id, makeId("uxp", index), 120),
      main: cleanOptionalText(value.main, 160),
      hostApp,
      minVersion: cleanOptionalText(host?.minVersion, 32),
      entrypoints,
    },
    commands: commands.length ? commands : undefined,
    storageDefaults: isRecord(value.storageDefaults) ? (safePluginJson(value.storageDefaults) as Record<string, unknown>) : undefined,
    createdAt: options.now,
    installedAt: options.now,
    source: "import",
  }
}

function xmlAttribute(source: string, name: string) {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(source)
  return match?.[1]
}

function xmlTagText(source: string, tag: string) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(source)
  return match?.[1]?.trim()
}

function normalizeCepPlugin(value: unknown, index: number, options: NormalizePluginImportOptions): PluginDescriptor | null {
  const xml = typeof value === "string"
    ? value
    : isRecord(value) && typeof value.cepManifestXml === "string"
      ? value.cepManifestXml
      : isRecord(value) && typeof value.cepManifest === "string"
        ? value.cepManifest
        : null
  if (!xml || !/ExtensionManifest/i.test(xml)) return null
  const makeId = options.makeId ?? ((prefix: string, itemIndex: number) => `${prefix}_${itemIndex}`)
  const extensionMatch = /<Extension\b[^>]*\bId\s*=\s*["']([^"']+)["'][^>]*>/i.exec(xml)
  const extensionId = cleanText(extensionMatch?.[1], makeId("cep", index), 120)
  const bundleName = cleanText(xmlAttribute(xml, "ExtensionBundleName"), extensionId, 80)
  const bundleVersion = cleanOptionalText(xmlAttribute(xml, "ExtensionBundleVersion") ?? xmlAttribute(xml, "Version"), 32)
  const hostMatch = /<Host\b[^>]*\bName\s*=\s*["']([^"']+)["'][^>]*>/i.exec(xml)
  const mainPath = cleanOptionalText(xmlTagText(xml, "MainPath"), 180)
  return {
    id: makeId("plugin", index),
    name: bundleName,
    kind: "cep-panel",
    enabled: true,
    manifestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    version: bundleVersion,
    permissions: ["ui", "commands"],
    capabilities: ["CEP CSInterface adapter"],
    runtimeAdapters: ["cep"],
    cepManifest: {
      extensionId,
      bundleName,
      bundleVersion,
      host: cleanOptionalText(hostMatch?.[1], 32),
      mainPath,
    },
    commands: [{ id: "open", title: `Open ${bundleName}`, group: "CEP", action: { type: "open-panel" }, requiredPermissions: ["ui"] }],
    createdAt: options.now,
    installedAt: options.now,
    source: "import",
  }
}

function normalizeOnePlugin(value: unknown, index: number, options: NormalizePluginImportOptions): PluginDescriptor | null {
  const uxpPlugin = normalizeUxpPlugin(value, index, options)
  if (uxpPlugin) return uxpPlugin
  const cepPlugin = normalizeCepPlugin(value, index, options)
  if (cepPlugin) return cepPlugin
  if (!isRecord(value)) return null
  const kind = value.kind
  if (typeof kind !== "string" || !PLUGIN_KINDS.has(kind as PluginDescriptor["kind"])) return null
  const makeId = options.makeId ?? ((prefix: string, itemIndex: number) => `${prefix}_${itemIndex}`)
  const plugin: PluginDescriptor = {
    id: makeId("plugin", index),
    name: cleanText(value.name, "Imported Plugin", 80),
    kind: kind as PluginDescriptor["kind"],
    enabled: cleanBoolean(value.enabled, true),
    manifestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    version: cleanOptionalText(value.version, 32),
    author: cleanOptionalText(value.author, 80),
    description: cleanOptionalText(value.description, 240),
    permissions: normalizePermissions(value.permissions),
    capabilities: normalizeCapabilities(value.capabilities),
    runtimeAdapters: normalizeRuntimeAdapters(value.runtimeAdapters),
    createdAt: options.now,
    installedAt: options.now,
    source: "import",
  }

  const uxpManifest = normalizeUxpManifestSummary(value.uxpManifest)
  if (uxpManifest) plugin.uxpManifest = uxpManifest
  const cepManifest = normalizeCepManifestSummary(value.cepManifest)
  if (cepManifest) plugin.cepManifest = cepManifest
  const binary8bf = normalizeEightBfSummary(value.binary8bf)
  if (binary8bf) plugin.binary8bf = binary8bf

  const panelHtml = sanitizePanelHtml(value.panelHtml)
  if (panelHtml) plugin.panelHtml = panelHtml

  const commands = normalizeCommands(value.commands)
  if (commands) plugin.commands = commands

  const storageDefaults = safePluginJson(value.storageDefaults)
  if (isRecord(storageDefaults)) plugin.storageDefaults = storageDefaults

  const kernel = normalizeFilterKernel(value.filterKernel)
  if (kernel) plugin.filterKernel = kernel
  if (typeof value.filterDivisor === "number" && Number.isFinite(value.filterDivisor)) plugin.filterDivisor = value.filterDivisor
  if (typeof value.filterBias === "number" && Number.isFinite(value.filterBias)) plugin.filterBias = value.filterBias

  return plugin
}

export function normalizePluginImportPayload(input: unknown, options: NormalizePluginImportOptions): PluginDescriptor[] {
  if (options.fileSizeBytes > MAX_PLUGIN_IMPORT_BYTES) {
    throw new Error("Plugin manifest files are limited to 3 MB.")
  }
  const candidates = isRecord(input) && Array.isArray(input.plugins)
    ? input.plugins
    : isRecord(input) && input.plugin !== undefined
      ? [input.plugin]
      : Array.isArray(input)
        ? input
        : [input]

  const out: PluginDescriptor[] = []
  for (const item of candidates.slice(0, MAX_PLUGIN_COUNT)) {
    const plugin = normalizeOnePlugin(item, out.length, options)
    if (plugin) out.push(plugin)
  }
  if (!out.length) throw new Error("Plugin file does not contain any importable plugin descriptors.")
  return out
}

function stripKnownExtension(fileName: string) {
  return cleanText(fileName.replace(/\.(?:8bf|plugin|psplugin|json)$/i, ""), "Native 8BF Plugin", 80)
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export function normalizeNativeEightBfPlugin(
  input: ArrayBuffer | Uint8Array,
  options: Omit<NormalizePluginImportOptions, "fileSizeBytes"> & { fileSizeBytes?: number; fileName: string; index?: number },
): PluginDescriptor {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > MAX_PLUGIN_IMPORT_BYTES) {
    throw new Error("8BF plugin binaries are limited to 3 MB for browser metadata import.")
  }
  const makeId = options.makeId ?? ((prefix: string, itemIndex: number) => `${prefix}_${itemIndex}`)
  const index = options.index ?? 0
  const binary8bf: PluginEightBfBinarySummary = {
    fileName: cleanText(options.fileName, "plugin.8bf", 160),
    byteLength: bytes.byteLength,
    signature: bytesToHex(bytes.slice(0, 16)),
    executable: false,
    reason: "Native 8BF binaries cannot execute inside the browser sandbox.",
  }
  return {
    id: makeId("plugin", index),
    name: stripKnownExtension(options.fileName),
    kind: "8bf-filter",
    enabled: false,
    manifestVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    permissions: [],
    capabilities: ["Native 8BF binary metadata", "Requires browser-safe kernel or WebAssembly adapter"],
    runtimeAdapters: ["8bf-native"],
    binary8bf,
    createdAt: options.now,
    installedAt: options.now,
    source: "import",
  }
}

export function describeNativeEightBfCompatibility(plugin: Pick<PluginDescriptor, "kind" | "filterKernel" | "binary8bf">) {
  if (plugin.kind === "8bf-filter" && Array.isArray(plugin.filterKernel) && plugin.filterKernel.length === 9) {
    return {
      executable: true,
      mode: "safe-kernel",
      reason: "This descriptor executes through the browser-safe 3x3 kernel engine.",
    }
  }
  if (plugin.binary8bf) {
    return {
      executable: false,
      mode: "metadata-only",
      reason: plugin.binary8bf.reason,
    }
  }
  return {
    executable: false,
    mode: "not-8bf",
    reason: "No browser-safe 8BF kernel or binary metadata is declared.",
  }
}

export function buildPluginExportPayload(plugins: PluginDescriptor[], options?: { exportedAt?: string }) {
  return {
    app: "Photoshop Web",
    format: PLUGIN_MANIFEST_FORMAT,
    version: 1,
    exportedAt: options?.exportedAt ?? new Date().toISOString(),
    plugins,
  }
}

function normalizePackageAsset(value: unknown, index: number, options: NormalizePluginImportOptions): AssetLibraryItem | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (typeof kind !== "string" || !ASSET_KINDS.has(kind as AssetLibraryItem["kind"])) return null
  const makeId = options.makeId ?? ((prefix: string, itemIndex: number) => `${prefix}_${itemIndex}`)
  return {
    id: makeId("asset", index),
    name: cleanText(value.name, "Imported Asset", 80),
    kind: kind as AssetLibraryItem["kind"],
    group: cleanOptionalText(value.group, 80),
    payload: safePluginJson(value.payload),
    createdAt: options.now,
  }
}

export function normalizePluginPackagePayload(input: unknown, options: NormalizePluginImportOptions): NormalizePluginPackageResult {
  if (options.fileSizeBytes > MAX_PLUGIN_IMPORT_BYTES) {
    throw new Error("Plugin packages are limited to 3 MB.")
  }

  const isPackage = isRecord(input) && input.format === PLUGIN_PACKAGE_FORMAT
  const manifest = isPackage
    ? input.manifest ?? { format: PLUGIN_MANIFEST_FORMAT, version: PLUGIN_MANIFEST_SCHEMA_VERSION, plugins: input.plugins }
    : input
  const plugins = normalizePluginImportPayload(manifest, options)
  const assetCandidates = isPackage && Array.isArray(input.assets) ? input.assets : []
  const assets: AssetLibraryItem[] = []
  for (const item of assetCandidates.slice(0, 250)) {
    const asset = normalizePackageAsset(item, assets.length, options)
    if (asset) assets.push(asset)
  }

  return { plugins, assets }
}

export function buildPluginPackagePayload(
  plugins: PluginDescriptor[],
  options?: { exportedAt?: string; assets?: AssetLibraryItem[] },
) {
  const exportedAt = options?.exportedAt ?? new Date().toISOString()
  return {
    app: "Photoshop Web",
    format: PLUGIN_PACKAGE_FORMAT,
    version: 1,
    exportedAt,
    manifest: buildPluginExportPayload(plugins, { exportedAt }),
    assets: options?.assets ?? [],
    host: describePluginHostCapabilities(),
  }
}

export function pluginInstallReview(plugin: PluginDescriptor): PluginInstallPermissionReview {
  const permissions = (plugin.permissions ?? []).map((id) => ({
    id,
    label: PLUGIN_PERMISSION_LABELS[id],
    description: PLUGIN_PERMISSION_DESCRIPTIONS[id],
  }))
  const capabilities: string[] = []
  if (plugin.panelHtml) capabilities.push("Sandboxed panel")
  if (plugin.commands?.length) {
    capabilities.push(`${plugin.commands.length} manifest command${plugin.commands.length === 1 ? "" : "s"}`)
  }
  if (plugin.uxpManifest) capabilities.push("UXP compatibility adapter")
  if (plugin.cepManifest) capabilities.push("CEP CSInterface adapter")
  if (plugin.binary8bf) capabilities.push("Native 8BF binary metadata")
  if ((plugin.permissions ?? []).includes("storage") || isRecord(plugin.storageDefaults)) {
    capabilities.push("Project-local storage")
  }
  if (plugin.kind === "8bf-filter" && Array.isArray(plugin.filterKernel)) {
    capabilities.push("8BF-style filter kernel")
  }
  if (plugin.capabilities?.length) {
    for (const capability of plugin.capabilities) {
      if (!capabilities.includes(capability)) capabilities.push(capability)
    }
  }

  return {
    pluginId: plugin.id,
    name: plugin.name,
    requiresPrompt: permissions.length > 0 || capabilities.length > 0,
    permissions,
    capabilities,
  }
}

export function canPluginUsePermission(plugin: Pick<PluginDescriptor, "enabled" | "permissions">, permission: PluginPermission) {
  return plugin.enabled !== false && (plugin.permissions ?? []).includes(permission)
}

function estimateJsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function normalizeStorageKey(key: unknown) {
  const cleaned = cleanText(key, "", 80)
  return SAFE_JSON_KEY.test(cleaned) && !RESERVED_KEYS.has(cleaned) ? cleaned : ""
}

export function createPluginStoragePatch(
  current: Record<string, Record<string, unknown>> | undefined,
  pluginId: string,
  operation: PluginStorageOperation,
): Record<string, Record<string, unknown>> {
  const namespace = { ...(current?.[pluginId] ?? {}) }
  const next: Record<string, Record<string, unknown>> = { ...(current ?? {}), [pluginId]: namespace }

  if (operation.operation === "clear") {
    next[pluginId] = {}
    return next
  }

  const key = normalizeStorageKey(operation.key)
  if (!key) return next

  if (operation.operation === "remove") {
    delete namespace[key]
    return next
  }

  if (Object.keys(namespace).length >= MAX_PLUGIN_STORAGE_KEYS && !(key in namespace)) return next
  const safeValue = safePluginJson(operation.value)
  if (safeValue === undefined) return next
  const candidate = { ...namespace, [key]: safeValue }
  if (estimateJsonBytes(candidate) > MAX_PLUGIN_STORAGE_BYTES) return next
  next[pluginId] = candidate
  return next
}

function cleanTone(value: unknown, fallback: "normal" | "muted" | "strong" | "danger" = "normal") {
  return value === "muted" || value === "strong" || value === "danger" || value === "normal" ? value : fallback
}

function cleanBadgeTone(value: unknown) {
  return value === "success" || value === "warning" || value === "danger" || value === "info" ? value : undefined
}

function cleanButtonVariant(value: unknown) {
  return value === "primary" || value === "secondary" || value === "danger" ? value : undefined
}

export function normalizePluginUiTree(input: unknown, depth = 0): PluginUiNode | null {
  if (!isRecord(input) || typeof input.type !== "string" || depth > 5) return null
  const id = cleanOptionalText(input.id, 80)
  if (input.type === "stack" || input.type === "row") {
    const children = Array.isArray(input.children)
      ? input.children
          .slice(0, 32)
          .map((child) => normalizePluginUiTree(child, depth + 1))
          .filter((child): child is PluginUiNode => child !== null)
      : []
    return id ? { type: input.type, id, children } : { type: input.type, children }
  }
  if (input.type === "text") {
    const node: PluginUiNode = { type: "text", text: cleanText(input.text, "", 400), tone: cleanTone(input.tone) }
    if (id) node.id = id
    if (node.tone === "normal") delete node.tone
    return node
  }
  if (input.type === "badge") {
    const tone = cleanBadgeTone(input.tone)
    const node: PluginUiNode = { type: "badge", label: cleanText(input.label, "Badge", 80) }
    if (id) node.id = id
    if (tone) node.tone = tone
    return node
  }
  if (input.type === "button") {
    const buttonId = cleanId(input.id, "")
    const action = cleanId(input.action, "")
    if (!buttonId || !action) return null
    const variant = cleanButtonVariant(input.variant)
    const node: PluginUiNode = { type: "button", id: buttonId, label: cleanText(input.label, "Run", 80), action }
    if (variant) node.variant = variant
    return node
  }
  if (input.type === "input") {
    const inputId = cleanId(input.id, "")
    if (!inputId) return null
    const node: PluginUiNode = { type: "input", id: inputId }
    const label = cleanOptionalText(input.label, 80)
    const value = cleanOptionalText(input.value, 400)
    const placeholder = cleanOptionalText(input.placeholder, 120)
    if (label) node.label = label
    if (value) node.value = value
    if (placeholder) node.placeholder = placeholder
    return node
  }
  if (input.type === "meter") {
    const node: PluginUiNode = {
      type: "meter",
      value: cleanNumber(input.value, 0, 0, 10_000),
      max: cleanNumber(input.max, 100, 1, 10_000),
    }
    if (id) node.id = id
    const label = cleanOptionalText(input.label, 80)
    if (label) node.label = label
    return node
  }
  if (input.type === "divider") return id ? { type: "divider", id } : { type: "divider" }
  return null
}

function escapeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

export function buildPluginIframeSrcDoc({
  pluginId,
  token,
  html,
}: {
  pluginId: string
  token: string
  html?: string
}) {
  const bootstrap = `
<script>
(() => {
  const channel = ${escapeScriptJson(PLUGIN_MESSAGE_CHANNEL)};
  const pluginId = ${escapeScriptJson(pluginId)};
  const token = ${escapeScriptJson(token)};
  let seq = 0;
  const pending = new Map();
  let cachedDocument = null;
  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.channel !== channel || data.pluginId !== pluginId) return;
    if (data.type === "response" && pending.has(data.requestId)) {
      const entry = pending.get(data.requestId);
      pending.delete(data.requestId);
      data.ok ? entry.resolve(data.result) : entry.reject(new Error(String(data.error || "Plugin request failed")));
    }
    if (data.type === "ui:event" && typeof window.onPhotoshopWebPluginEvent === "function") {
      window.onPhotoshopWebPluginEvent(data.event);
    }
  });
  function request(method, params) {
    const requestId = "req_" + (++seq);
    parent.postMessage({ channel, pluginId, token, requestId, method, params }, "*");
    return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
  }
  const host = {
    getInfo: () => request("host.getInfo"),
  };
  const documentApi = {
    getInfo: async () => {
      cachedDocument = await request("document.getInfo");
      return cachedDocument;
    },
  };
  const layers = {
    getActive: () => request("layers.getActive"),
    create: (options) => request("layers.create", options || {}),
    update: (id, patch) => request("layers.update", { id, patch }),
  };
  const action = {
    batchPlay: (descriptors, options) => request("action.batchPlay", { descriptors, options: options || {} }),
  };
  const core = {
    executeAsModal: async (targetFunction, options) => {
      const scope = await request("uxp.executeAsModal", { commandName: options && options.commandName });
      if (typeof targetFunction === "function") {
        return targetFunction({
          isCancelled: false,
          reportProgress: () => {},
          hostControl: {
            suspendHistory: async () => undefined,
            resumeHistory: async () => undefined,
          },
          descriptor: options && options.descriptor,
          scope,
        });
      }
      return scope;
    },
  };
  const app = {
    get activeDocument() { return cachedDocument; },
    get documents() { return cachedDocument ? [cachedDocument] : []; },
    getActiveDocument: documentApi.getInfo,
  };
  const photoshopModule = { app, action, core };
  const uxpModule = {
    host: {
      name: "photoshop",
      app: "PS",
      version: "web-compat",
      uiLocale: (navigator.language || "en-US").replace("-", "_"),
    },
    storage: {
      localStorage: {
        getItem: (key) => request("storage.get", { key }),
        setItem: (key, value) => request("storage.set", { key, value }),
        removeItem: (key) => request("storage.remove", { key }),
        clear: () => request("storage.clear"),
      },
    },
  };
  function require(name) {
    if (name === "photoshop") return photoshopModule;
    if (name === "uxp") return uxpModule;
    throw new Error("Module is not available in the browser-safe plugin adapter: " + name);
  }
  function CSEvent(type, scope, appId, extensionId) {
    this.type = type || "";
    this.scope = scope || "APPLICATION";
    this.appId = appId || "PHXS";
    this.extensionId = extensionId || pluginId;
    this.data = "";
  }
  function CSInterface() {}
  CSInterface.prototype.evalScript = function(source, callback) {
    request("cep.evalScript", { source }).then((result) => {
      if (typeof callback === "function") callback(typeof result === "string" ? result : JSON.stringify(result));
    }).catch((error) => {
      if (typeof callback === "function") callback("EvalScript error: " + error.message);
    });
  };
  CSInterface.prototype.dispatchEvent = function(event) {
    return request("cep.dispatchEvent", event || {});
  };
  CSInterface.prototype.addEventListener = function(type, listener) {
    window.addEventListener("photoshop-web-cep:" + type, listener);
  };
  CSInterface.prototype.removeEventListener = function(type, listener) {
    window.removeEventListener("photoshop-web-cep:" + type, listener);
  };
  CSInterface.prototype.getHostEnvironment = function() {
    return JSON.stringify({ appName: "PHXS", appVersion: "web-compat", appLocale: navigator.language || "en-US" });
  };
  const cep = {
    evalScript: (source) => request("cep.evalScript", { source }),
    dispatchEvent: (event) => request("cep.dispatchEvent", event || {}),
  };
  const eightBf = {
    getInfo: () => request("8bf.getInfo"),
    run: (params) => request("8bf.run", params || {}),
  };
  const api = {
    request,
    host,
    document: documentApi,
    layers,
    action,
    uxp: { app, action, core, require },
    cep,
    eightBf,
    commands: { run: (id, params) => request("commands.run", { id, params }) },
    storage: {
      get: (key) => request("storage.get", { key }),
      set: (key, value) => request("storage.set", { key, value }),
      remove: (key) => request("storage.remove", { key }),
      clear: () => request("storage.clear"),
      keys: () => request("storage.keys"),
    },
    ui: {
      render: (tree) => request("ui.render", { tree }),
      toast: (message) => request("ui.toast", { message }),
    },
  };
  window.photoshopWeb = api;
  window.require = require;
  window.photoshop = photoshopModule;
  window.uxp = uxpModule;
  window.CSInterface = CSInterface;
  window.CSEvent = CSEvent;
  window.__adobe_cep__ = cep;
  parent.postMessage({ channel, pluginId, token, requestId: "ready", method: "plugin.ready" }, "*");
})();
</script>`.trim()

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <style>html,body{margin:0;min-height:100%;background:#171717;color:#f2f2f2;font:13px system-ui,sans-serif}button,input,select,textarea{font:inherit}</style>
</head>
<body>
${bootstrap}
${html ?? ""}
</body>
</html>`
}

export function validatePluginPanelRequest(
  value: unknown,
  context: { pluginId: string; token: string; source: Window | null; eventSource: MessageEvent["source"] },
): PluginPanelRequest | null {
  if (!context.source || context.eventSource !== context.source || !isRecord(value)) return null
  if (value.channel !== PLUGIN_MESSAGE_CHANNEL) return null
  if (value.pluginId !== context.pluginId || value.token !== context.token) return null
  if (typeof value.requestId !== "string" || value.requestId.length > 80 || !value.requestId) return null
  if (typeof value.method !== "string" || !PANEL_METHODS.has(value.method)) return null
  return {
    channel: PLUGIN_MESSAGE_CHANNEL,
    pluginId: context.pluginId,
    token: context.token,
    requestId: value.requestId,
    method: value.method,
    params: safePluginJson(value.params),
  }
}
