import { expect, test } from "@playwright/test"

import {
  PLUGIN_MANIFEST_FORMAT,
  buildPluginExportPayload,
  buildPluginIframeSrcDoc,
  canPluginUsePermission,
  createPluginStoragePatch,
  normalizePluginImportPayload,
  normalizePluginUiTree,
  validatePluginPanelRequest,
  type PluginPanelRequest,
} from "../components/photoshop/plugin-system"
import type { PluginDescriptor } from "../components/photoshop/types"

test("plugin manifest import normalizes browser-safe manifests and legacy descriptors", () => {
  const imported = normalizePluginImportPayload(
    {
      format: PLUGIN_MANIFEST_FORMAT,
      version: 1,
      plugins: [
        {
          id: "../Bad Plugin",
          name: "  Unsafe HTML Panel  ",
          kind: "ux-plugin",
          version: "1.0.0",
          author: "Local Dev",
          enabled: true,
          permissions: ["document:read", "storage", "network", "ui", "storage"],
          panelHtml: "<script>window.parent.location='https://example.test'</script><main>Panel</main>",
          commands: [
            {
              id: "show-info",
              title: "Show Document Info",
              group: "Inspect",
              action: { type: "post-message", message: { kind: "show-info" } },
            },
            {
              id: "bad",
              title: "",
              action: { type: "external-url", url: "https://example.test" },
            },
          ],
          storageDefaults: {
            theme: "dark",
            nested: { ok: true, "__proto__": { polluted: true } },
          },
          unexpected: "ignored",
        },
        {
          id: "legacy",
          name: "Legacy Filter",
          kind: "8bf-filter",
          enabled: true,
          filterKernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
          filterDivisor: 1,
          filterBias: 0,
          createdAt: 42,
        },
      ],
    },
    { fileSizeBytes: 2048, now: 1000, makeId: (prefix, index) => `${prefix}_${index}` },
  )

  expect(imported).toEqual([
    expect.objectContaining({
      id: "plugin_0",
      name: "Unsafe HTML Panel",
      kind: "ux-plugin",
      enabled: true,
      version: "1.0.0",
      author: "Local Dev",
      permissions: ["document:read", "storage", "ui"],
      commands: [
        {
          id: "show-info",
          title: "Show Document Info",
          group: "Inspect",
          action: { type: "post-message", message: { kind: "show-info" } },
        },
      ],
      storageDefaults: { theme: "dark", nested: { ok: true } },
      createdAt: 1000,
    }),
    expect.objectContaining({
      id: "plugin_1",
      name: "Legacy Filter",
      kind: "8bf-filter",
      enabled: true,
      permissions: [],
      filterKernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
      filterDivisor: 1,
      filterBias: 0,
      createdAt: 1000,
    }),
  ])
  expect(imported[0].panelHtml).toContain("<main>Panel</main>")
  expect(imported[0].panelHtml).not.toContain("parent.location")
})

test("plugin import rejects oversized manifests and unsupported descriptors", () => {
  expect(() =>
    normalizePluginImportPayload([], {
      fileSizeBytes: 3_000_001,
      now: 1000,
      makeId: (prefix, index) => `${prefix}_${index}`,
    }),
  ).toThrow(/limited/i)

  expect(() =>
    normalizePluginImportPayload(
      { format: PLUGIN_MANIFEST_FORMAT, version: 1, plugins: [{ name: "Bad", kind: "native-code" }] },
      { fileSizeBytes: 512, now: 1000, makeId: (prefix, index) => `${prefix}_${index}` },
    ),
  ).toThrow(/importable plugin/i)
})

test("plugin export emits manifest format and strips runtime-only panel tokens", () => {
  const plugin: PluginDescriptor = {
    id: "plug_one",
    name: "Exportable",
    kind: "ux-plugin",
    enabled: true,
    version: "2.0",
    permissions: ["document:read", "storage"],
    panelHtml: "<main>Export</main>",
    commands: [{ id: "open", title: "Open Panel", action: { type: "open-panel" } }],
    storageDefaults: { mode: "compact" },
    createdAt: 1000,
  }

  expect(buildPluginExportPayload([plugin], { exportedAt: "2026-05-23T00:00:00.000Z" })).toEqual({
    app: "Photoshop Web",
    format: PLUGIN_MANIFEST_FORMAT,
    version: 1,
    exportedAt: "2026-05-23T00:00:00.000Z",
    plugins: [plugin],
  })
})

test("permission checks treat disabled plugins and missing grants as denied", () => {
  const plugin: PluginDescriptor = {
    id: "plug_perm",
    name: "Permissions",
    kind: "ux-plugin",
    enabled: true,
    permissions: ["document:read", "storage"],
    createdAt: 1000,
  }

  expect(canPluginUsePermission(plugin, "document:read")).toBe(true)
  expect(canPluginUsePermission(plugin, "layers:write")).toBe(false)
  expect(canPluginUsePermission({ ...plugin, enabled: false }, "document:read")).toBe(false)
})

test("plugin storage patches are namespaced and bounded", () => {
  const current = {
    plug_a: { existing: true, shared: "a" },
    plug_b: { shared: "b" },
  }

  const next = createPluginStoragePatch(current, "plug_a", {
    operation: "set",
    key: "nested",
    value: { ok: true, "__proto__": { polluted: true } },
  })

  expect(next).toEqual({
    plug_a: { existing: true, shared: "a", nested: { ok: true } },
    plug_b: { shared: "b" },
  })
  expect(createPluginStoragePatch(next, "plug_a", { operation: "remove", key: "shared" }).plug_a).toEqual({
    existing: true,
    nested: { ok: true },
  })
  expect(createPluginStoragePatch(next, "plug_a", { operation: "clear" }).plug_a).toEqual({})
})

test("plugin UI tree normalization keeps only supported components and events", () => {
  expect(
    normalizePluginUiTree({
      type: "stack",
      id: "root",
      children: [
        { type: "text", id: "title", text: "Document Helper", tone: "strong", onclick: "alert(1)" },
        { type: "button", id: "inspect", label: "Inspect", action: "inspect-doc", variant: "primary" },
        { type: "input", id: "prefix", label: "Layer prefix", value: "Retouch", placeholder: "Name" },
        { type: "script", code: "alert(1)" },
      ],
    }),
  ).toEqual({
    type: "stack",
    id: "root",
    children: [
      { type: "text", id: "title", text: "Document Helper", tone: "strong" },
      { type: "button", id: "inspect", label: "Inspect", action: "inspect-doc", variant: "primary" },
      { type: "input", id: "prefix", label: "Layer prefix", value: "Retouch", placeholder: "Name" },
    ],
  })
})

test("iframe srcdoc injects a sandbox API bootstrap without granting same-origin access", () => {
  const srcDoc = buildPluginIframeSrcDoc({
    pluginId: "plug_panel",
    token: "secret-token",
    html: "<main>Plugin</main><script>photoshopWeb.request('document.getInfo')</script>",
  })

  expect(srcDoc).toContain("default-src 'none'")
  expect(srcDoc).toContain("connect-src 'none'")
  expect(srcDoc).toContain("secret-token")
  expect(srcDoc).toContain("photoshopWeb")
  expect(srcDoc).toContain("<main>Plugin</main>")
})

test("message validation requires source window, plugin id, token, and known methods", () => {
  const source = {} as Window
  const valid: PluginPanelRequest = {
    channel: "photoshop-web-plugin",
    pluginId: "plug_panel",
    token: "secret-token",
    requestId: "req_1",
    method: "document.getInfo",
    params: {},
  }

  expect(validatePluginPanelRequest(valid, { pluginId: "plug_panel", token: "secret-token", source, eventSource: source })).toEqual(valid)
  expect(validatePluginPanelRequest({ ...valid, token: "wrong" }, { pluginId: "plug_panel", token: "secret-token", source, eventSource: source })).toBeNull()
  expect(validatePluginPanelRequest({ ...valid, method: "window.eval" }, { pluginId: "plug_panel", token: "secret-token", source, eventSource: source })).toBeNull()
  expect(validatePluginPanelRequest(valid, { pluginId: "plug_panel", token: "secret-token", source, eventSource: {} as Window })).toBeNull()
})
