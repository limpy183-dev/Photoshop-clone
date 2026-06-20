import { expect, test } from "@playwright/test"

import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PLUGIN_PACKAGE_FORMAT,
  describePluginHostCapabilities,
  describeNativeEightBfCompatibility,
  buildPluginMarketplaceListing,
  buildPluginPackagePayload,
  buildPluginExportPayload,
  buildPluginIframeSrcDoc,
  canPluginUsePermission,
  createPluginStoragePatch,
  getPluginManifestSchema,
  normalizeNativeEightBfPlugin,
  normalizePluginActionDescriptors,
  normalizePluginPackagePayload,
  normalizePluginImportPayload,
  normalizePluginUiTree,
  permissionsForPluginActionDescriptors,
  pluginInstallReview,
  validatePluginPanelRequest,
  type PluginPanelRequest,
} from "../components/photoshop/plugin-system"
import type { PluginDescriptor } from "../components/photoshop/types"

test("plugin contract exposes a stable manifest schema and explicit host API", () => {
  const schema = getPluginManifestSchema()
  const capabilities = describePluginHostCapabilities()

  expect(PLUGIN_MANIFEST_SCHEMA_VERSION).toBe(1)
  expect(schema).toMatchObject({
    $id: "https://photoshop-web.local/schemas/plugin-manifest.v1.json",
    type: "object",
    required: ["format", "version", "plugins"],
  })
  expect(schema.properties.format.const).toBe(PLUGIN_MANIFEST_FORMAT)
  expect(schema.properties.plugins.items.required).toEqual(["name", "kind"])
  expect(capabilities.manifest).toMatchObject({
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: 1,
    packageFormat: PLUGIN_PACKAGE_FORMAT,
  })
  expect(capabilities.messageApi.channel).toBe("photoshop-web-plugin")
  expect(capabilities.messageApi.allowedMethods).toEqual([
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
  ])
  expect(capabilities.sandbox.iframeSandbox).toBe("allow-scripts")
  expect(capabilities.adobeCompatibility).toMatchObject({
    uxp: { mode: "browser-compatible adapter" },
    cep: { mode: "browser-compatible adapter" },
    eightBf: { mode: "browser-safe descriptor executor" },
    actionManager: { mode: "allow-listed descriptor bridge" },
  })
})

test("plugin import adapts UXP manifests into browser-safe plugin descriptors", () => {
  const imported = normalizePluginImportPayload(
    {
      manifestVersion: 5,
      id: "com.example.document-helper",
      name: "Document Helper",
      version: "2.1.0",
      host: { app: "PS", minVersion: "25.0.0" },
      main: "index.html",
      entrypoints: [
        { type: "panel", id: "panel", label: { default: "Document Helper" } },
        { type: "command", id: "renameActive", label: { default: "Rename Active Layer" } },
      ],
      requiredPermissions: {
        localFileSystem: "plugin",
        clipboard: "read",
      },
    },
    { fileSizeBytes: 2048, now: 1000, makeId: (prefix, index) => `${prefix}_${index}` },
  )

  expect(imported).toEqual([
    expect.objectContaining({
      id: "plugin_0",
      name: "Document Helper",
      kind: "ux-plugin",
      enabled: true,
      version: "2.1.0",
      permissions: ["storage", "ui", "commands"],
      capabilities: expect.arrayContaining(["UXP manifest adapter", "2 UXP entrypoints"]),
      uxpManifest: {
        manifestVersion: 5,
        id: "com.example.document-helper",
        main: "index.html",
        hostApp: "PS",
        minVersion: "25.0.0",
        entrypoints: [
          { id: "panel", type: "panel", label: "Document Helper" },
          { id: "renameActive", type: "command", label: "Rename Active Layer" },
        ],
      },
      commands: [
        { id: "panel", title: "Document Helper", group: "UXP", action: { type: "open-panel" }, requiredPermissions: ["ui"] },
        {
          id: "renameActive",
          title: "Rename Active Layer",
          group: "UXP",
          action: { type: "post-message", message: { entrypoint: "renameActive", runtime: "uxp" } },
          requiredPermissions: ["commands"],
        },
      ],
      createdAt: 1000,
    }),
  ])
})

test("plugin import adapts CEP extension manifests into CSInterface descriptors", () => {
  const imported = normalizePluginImportPayload(
    {
      cepManifestXml: `
        <ExtensionManifest ExtensionBundleName="Legacy Retouch Tools" ExtensionBundleVersion="4.0">
          <ExtensionList><Extension Id="com.example.legacy.retouch" Version="4.0"/></ExtensionList>
          <ExecutionEnvironment>
            <HostList><Host Name="PHXS" Version="[22.0,99.9]"/></HostList>
          </ExecutionEnvironment>
          <DispatchInfoList>
            <Extension Id="com.example.legacy.retouch">
              <DispatchInfo>
                <Resources><MainPath>./index.html</MainPath></Resources>
              </DispatchInfo>
            </Extension>
          </DispatchInfoList>
        </ExtensionManifest>
      `,
    },
    { fileSizeBytes: 2048, now: 1000, makeId: (prefix, index) => `${prefix}_${index}` },
  )

  expect(imported[0]).toMatchObject({
    id: "plugin_0",
    name: "Legacy Retouch Tools",
    kind: "cep-panel",
    enabled: true,
    version: "4.0",
    permissions: ["ui", "commands"],
    capabilities: expect.arrayContaining(["CEP CSInterface adapter"]),
    cepManifest: {
      extensionId: "com.example.legacy.retouch",
      bundleName: "Legacy Retouch Tools",
      bundleVersion: "4.0",
      host: "PHXS",
      mainPath: "./index.html",
    },
    commands: [{ id: "open", title: "Open Legacy Retouch Tools", group: "CEP", action: { type: "open-panel" }, requiredPermissions: ["ui"] }],
  })
})

test("native 8BF imports keep binary metadata and only execute safe declared kernels", () => {
  const plugin = normalizeNativeEightBfPlugin(new Uint8Array([0x38, 0x42, 0x46, 0, 1, 2, 3, 4]).buffer, {
    fileName: "Legacy Sharpen.8bf",
    now: 1000,
    makeId: (prefix, index) => `${prefix}_${index}`,
  })

  expect(plugin).toMatchObject({
    id: "plugin_0",
    name: "Legacy Sharpen",
    kind: "8bf-filter",
    enabled: false,
    permissions: [],
    capabilities: expect.arrayContaining(["Native 8BF binary metadata", "Requires browser-safe kernel or WebAssembly adapter"]),
    binary8bf: {
      fileName: "Legacy Sharpen.8bf",
      byteLength: 8,
      signature: "3842460001020304",
      executable: false,
      reason: "Native 8BF binaries cannot execute inside the browser sandbox.",
    },
  })

  expect(describeNativeEightBfCompatibility(plugin)).toEqual({
    executable: false,
    mode: "metadata-only",
    reason: "Native 8BF binaries cannot execute inside the browser sandbox.",
  })
})

test("Action Manager bridge normalizes descriptors and infers permissions", () => {
  const descriptors = normalizePluginActionDescriptors([
    { _obj: "get", _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }] },
    { _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { name: "Retouched", opacity: 42 } },
    { _obj: "make", _target: [{ _ref: "layer" }], using: { name: "Plugin Layer" } },
    { _obj: "filter", filter: "invert" },
  ])

  expect(descriptors).toEqual([
    { _obj: "get", _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }] },
    { _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { name: "Retouched", opacity: 42 } },
    { _obj: "make", _target: [{ _ref: "layer" }], using: { name: "Plugin Layer" } },
    { _obj: "filter", filter: "invert" },
  ])
  expect(permissionsForPluginActionDescriptors(descriptors)).toEqual(["document:read", "layers:read", "layers:write", "filters:write"])
})

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

test("plugin marketplace metadata simulates ratings dependencies and signed manifests", () => {
  const [plugin] = normalizePluginImportPayload(
    {
      format: PLUGIN_MANIFEST_FORMAT,
      version: 1,
      plugins: [
        {
          name: "Marketplace Retouch Pack",
          kind: "ux-plugin",
          version: "3.2.1",
          dependencies: ["browser-action-engine", "native 8bf fallback"],
          marketplace: {
            bundleId: "bundle.retouch.local",
            rating: 4.7,
            ratingsCount: 128,
            signature: {
              signed: true,
              signer: "Local Test Store",
              algorithm: "sha256",
              digest: "abc123",
              expectedDigest: "abc123",
            },
          },
        },
      ],
    },
    { fileSizeBytes: 2048, now: 1000, makeId: (prefix, index) => `${prefix}_${index}` },
  )

  expect(plugin).toMatchObject({
    dependencies: ["browser-action-engine", "native 8bf fallback"],
    marketplace: {
      bundleId: "bundle.retouch.local",
      rating: 4.7,
      ratingsCount: 128,
      signature: { signed: true, verified: true, signer: "Local Test Store" },
      dependencyWarnings: ["native 8bf fallback may need a browser-safe adapter or local bundle fallback."],
    },
  })
  expect(buildPluginMarketplaceListing([plugin])).toEqual([
    expect.objectContaining({
      bundleId: "bundle.retouch.local",
      rating: 4.7,
      dependencyWarnings: ["native 8bf fallback may need a browser-safe adapter or local bundle fallback."],
      signature: expect.objectContaining({ verified: true }),
    }),
  ])
  expect(pluginInstallReview(plugin)).toMatchObject({
    marketplace: {
      dependencies: ["browser-action-engine", "native 8bf fallback"],
      dependencyWarnings: ["native 8bf fallback may need a browser-safe adapter or local bundle fallback."],
      signature: { signed: true, verified: true, signer: "Local Test Store", algorithm: "sha256", digest: "abc123", reason: expect.any(String) },
    },
    capabilities: expect.arrayContaining(["Signed manifest verified", "1 dependency warning"]),
  })
})

test("plugin package payloads round-trip manifests with local library assets", () => {
  const plugin: PluginDescriptor = {
    id: "plug_packaged",
    name: "Packaged Helper",
    kind: "ux-plugin",
    enabled: true,
    permissions: ["document:read", "storage", "ui"],
    commands: [{ id: "open", title: "Open Helper", action: { type: "open-panel" } }],
    panelHtml: "<main>Packaged</main>",
    createdAt: 1000,
  }

  const payload = buildPluginPackagePayload([plugin], {
    exportedAt: "2026-05-23T00:00:00.000Z",
    assets: [{ id: "asset_1", name: "Brand Blue", kind: "swatch", group: "Brand", payload: { color: "#0057ff" }, createdAt: 1000 }],
  })

  expect(payload).toMatchObject({
    app: "Photoshop Web",
    format: PLUGIN_PACKAGE_FORMAT,
    exportedAt: "2026-05-23T00:00:00.000Z",
    manifest: { format: PLUGIN_MANIFEST_FORMAT, version: 1, plugins: [plugin] },
    assets: [{ name: "Brand Blue", kind: "swatch" }],
  })

  const normalized = normalizePluginPackagePayload(payload, {
    fileSizeBytes: 4096,
    now: 2000,
    makeId: (prefix, index) => `${prefix}_${index}`,
  })

  expect(normalized.plugins[0]).toMatchObject({ id: "plugin_0", name: "Packaged Helper", permissions: ["document:read", "storage", "ui"] })
  expect(normalized.assets[0]).toMatchObject({ id: "asset_0", name: "Brand Blue", kind: "swatch", group: "Brand" })
})

test("plugin install review summarizes requested permissions and declared capabilities", () => {
  const plugin: PluginDescriptor = {
    id: "plug_review",
    name: "Review Helper",
    kind: "ux-plugin",
    enabled: true,
    permissions: ["document:read", "layers:read", "storage", "ui"],
    commands: [
      { id: "open", title: "Open Review Helper", action: { type: "open-panel" } },
      { id: "inspect", title: "Inspect Layer", action: { type: "post-message", message: { action: "inspect" } } },
    ],
    panelHtml: "<main>Review</main>",
    createdAt: 1000,
  }

  expect(pluginInstallReview(plugin)).toEqual({
    pluginId: "plug_review",
    name: "Review Helper",
    requiresPrompt: true,
    permissions: [
      { id: "document:read", label: "Document read", description: "Read document name, dimensions, color mode, and layer count." },
      { id: "layers:read", label: "Layer read", description: "Read active layer metadata." },
      { id: "storage", label: "Storage", description: "Read and write the plugin's project-local storage namespace." },
      { id: "ui", label: "Host UI", description: "Render host-native controls through message passing." },
    ],
    capabilities: ["Sandboxed panel", "2 manifest commands", "Project-local storage"],
  })
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
  expect(srcDoc).toContain("function require")
  expect(srcDoc).toContain("executeAsModal")
  expect(srcDoc).toContain("action.batchPlay")
  expect(srcDoc).toContain("CSInterface")
  expect(srcDoc).toContain("cep.evalScript")
  expect(srcDoc).toContain("eightBf")
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
