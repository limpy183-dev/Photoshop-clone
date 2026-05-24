import type {
  PluginCommandAction,
  PluginCommandDescriptor,
  PluginDescriptor,
  PluginPermission,
} from "./types"

export const PLUGIN_MANIFEST_FORMAT = "ps-plugin-manifest"
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
const PANEL_METHODS = new Set([
  "document.getInfo",
  "layers.getActive",
  "commands.run",
  "storage.get",
  "storage.set",
  "storage.remove",
  "storage.clear",
  "storage.keys",
  "ui.render",
  "ui.toast",
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

function cleanId(value: unknown, fallback: string) {
  const text = cleanText(value, "", 80)
  return SAFE_ID.test(text) && !RESERVED_KEYS.has(text) ? text : fallback
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

function normalizeOnePlugin(value: unknown, index: number, options: NormalizePluginImportOptions): PluginDescriptor | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (typeof kind !== "string" || !PLUGIN_KINDS.has(kind as PluginDescriptor["kind"])) return null
  const makeId = options.makeId ?? ((prefix: string, itemIndex: number) => `${prefix}_${itemIndex}`)
  const plugin: PluginDescriptor = {
    id: makeId("plugin", index),
    name: cleanText(value.name, "Imported Plugin", 80),
    kind: kind as PluginDescriptor["kind"],
    enabled: cleanBoolean(value.enabled, true),
    version: cleanOptionalText(value.version, 32),
    author: cleanOptionalText(value.author, 80),
    permissions: normalizePermissions(value.permissions),
    createdAt: options.now,
  }

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

export function buildPluginExportPayload(plugins: PluginDescriptor[], options?: { exportedAt?: string }) {
  return {
    app: "Photoshop Web",
    format: PLUGIN_MANIFEST_FORMAT,
    version: 1,
    exportedAt: options?.exportedAt ?? new Date().toISOString(),
    plugins,
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
  window.photoshopWeb = {
    request,
    document: { getInfo: () => request("document.getInfo") },
    layers: { getActive: () => request("layers.getActive") },
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
