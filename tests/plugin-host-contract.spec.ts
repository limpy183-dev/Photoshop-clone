import { expect, test } from "@playwright/test"

import {
  PLUGIN_CAPABILITY_TABLE,
  PLUGIN_HOST_METHODS,
  PLUGIN_UNAVAILABLE_APIS,
  dispatchHostRequest,
  isPluginHostMethod,
  type HostContext,
  type HostRequest,
  type PluginStorageAdapter,
} from "../components/photoshop/plugin-host-api"
import {
  PLUGIN_LIFECYCLE_EVENT,
  defaultSmokeTests,
  emitPluginLifecycle,
  isPluginTestInput,
  runPluginTestSuite,
  summariseTestValue,
  type PluginTestInput,
} from "../components/photoshop/plugin-lifecycle"
import type { PluginDescriptor } from "../components/photoshop/types"
import { installFixtureDom, richFixtureDocument } from "./photoshop-fixtures"

function request(method: HostRequest["method"], args?: Record<string, unknown>): HostRequest {
  return {
    channel: "photoshop-web-plugin",
    pluginId: "plugin-a",
    token: "token",
    requestId: `req-${method}`,
    method,
    args,
  }
}

class ScopedStorage implements PluginStorageAdapter {
  private values = new Map<string, Map<string, unknown>>()

  private scope(pluginId: string) {
    let scope = this.values.get(pluginId)
    if (!scope) {
      scope = new Map()
      this.values.set(pluginId, scope)
    }
    return scope
  }

  get(pluginId: string, key: string) {
    return this.scope(pluginId).get(key)
  }

  set(pluginId: string, key: string, value: unknown) {
    this.scope(pluginId).set(key, value)
  }

  remove(pluginId: string, key: string) {
    this.scope(pluginId).delete(key)
  }

  clear(pluginId: string) {
    this.scope(pluginId).clear()
  }

  keys(pluginId: string) {
    return [...this.scope(pluginId).keys()]
  }
}

test.beforeEach(() => {
  installFixtureDom()
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  })
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
  Reflect.deleteProperty(globalThis, "document")
})

test("plugin host method allow-list and capability table remain complete and explicit", () => {
  expect(new Set(PLUGIN_HOST_METHODS).size).toBe(PLUGIN_HOST_METHODS.length)
  expect(new Set(Object.keys(PLUGIN_CAPABILITY_TABLE))).toEqual(new Set(PLUGIN_HOST_METHODS))
  for (const method of PLUGIN_HOST_METHODS) {
    expect(isPluginHostMethod(method)).toBe(true)
    expect(["native", "simulated", "unavailable"]).toContain(PLUGIN_CAPABILITY_TABLE[method])
  }
  expect(isPluginHostMethod("window.eval")).toBe(false)
  expect(PLUGIN_UNAVAILABLE_APIS.every((entry) => entry.reason.includes("BOUNDARIES"))).toBe(true)
})

test("host metadata calls report native, simulated, and unavailable surfaces", async () => {
  const info = await dispatchHostRequest(request("host.getInfo"), { activeDoc: null, activeLayer: null })
  const available = await dispatchHostRequest(request("host.listAvailable"), { activeDoc: null, activeLayer: null })
  const simulated = await dispatchHostRequest(request("host.listSimulated"), { activeDoc: null, activeLayer: null })
  const unavailable = await dispatchHostRequest(request("host.listUnavailable"), { activeDoc: null, activeLayer: null })

  expect(info).toMatchObject({
    channel: "photoshop-web-plugin",
    pluginId: "plugin-a",
    ok: true,
    result: { host: "photoshop-web", version: 1 },
  })
  expect(available.result).toEqual(expect.arrayContaining(["document.getInfo", "action.batchPlay"]))
  expect(simulated.result).toEqual(expect.arrayContaining(["uxp.executeAsModal", "cep.evalScript", "8bf.run"]))
  expect(unavailable.result).toEqual(PLUGIN_UNAVAILABLE_APIS)
})

test("document and layer queries return bounded summaries without exposing canvas objects", async () => {
  const doc = richFixtureDocument()
  const ctx: HostContext = { activeDoc: doc, activeLayer: doc.layers[0] }

  const docInfo = await dispatchHostRequest(request("document.getInfo"), ctx)
  const layers = await dispatchHostRequest(request("document.getLayers"), ctx)
  const active = await dispatchHostRequest(request("layers.getActive"), ctx)

  expect(docInfo.result).toEqual({
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    colorMode: doc.colorMode,
    bitDepth: doc.bitDepth,
    layerCount: doc.layers.length,
  })
  expect(layers.result).toEqual(doc.layers.map((layer) => expect.objectContaining({
    id: layer.id,
    name: layer.name,
    width: layer.canvas.width,
    height: layer.canvas.height,
  })))
  expect(JSON.stringify(layers.result)).not.toContain("imageData")
  expect(active.result).toMatchObject({ id: doc.layers[0].id, opacity: doc.layers[0].opacity })
})

test("missing host dependencies return structured errors instead of rejecting", async () => {
  const noDoc = await dispatchHostRequest(request("document.getInfo"), { activeDoc: null, activeLayer: null })
  const noDispatch = await dispatchHostRequest(request("layers.delete", { id: "layer-a" }), {
    activeDoc: richFixtureDocument(),
    activeLayer: null,
  })
  const unknown = await dispatchHostRequest(
    { ...request("host.getInfo"), method: "unknown.method" as HostRequest["method"] },
    { activeDoc: null, activeLayer: null },
  )

  expect(noDoc).toMatchObject({ ok: false, error: "No active document" })
  expect(noDispatch).toMatchObject({ ok: false, error: "dispatch not wired in this context" })
  expect(unknown).toMatchObject({ ok: false, error: "Unknown method: unknown.method" })
})

test("layer mutations validate ids, clamp opacity, and dispatch through the editor action surface", async () => {
  const doc = richFixtureDocument()
  const layer = doc.layers[0]
  const actions: Array<{ type: string; [key: string]: unknown }> = []
  const ctx: HostContext = {
    activeDoc: doc,
    activeLayer: layer,
    dispatch: (action) => actions.push(action),
  }

  const updated = await dispatchHostRequest(request("layers.update", {
    id: layer.id,
    name: "Updated",
    opacity: 5,
    visible: false,
  }), ctx)
  const selected = await dispatchHostRequest(request("layers.setActive", { id: layer.id }), ctx)
  const missing = await dispatchHostRequest(request("layers.update", { id: "missing" }), ctx)

  expect(updated.result).toEqual({ ok: true, layerId: layer.id })
  expect(selected.result).toEqual({ ok: true, activeLayerId: layer.id })
  expect(actions).toEqual([
    { type: "rename-layer", id: layer.id, name: "Updated" },
    { type: "set-layer-opacity", id: layer.id, opacity: 1 },
    { type: "set-layer-visibility", id: layer.id, visible: false },
    { type: "set-active-layer", id: layer.id },
  ])
  expect(missing).toMatchObject({ ok: false, error: "layers.update: layer not found" })
})

test("selection methods report mask-only selections and dispatch full-document bounds", async () => {
  const doc = richFixtureDocument()
  const actions: Array<{ type: string; [key: string]: unknown }> = []
  const maskOnly: HostContext = {
    activeDoc: doc,
    activeLayer: doc.layers[0],
    selection: { bounds: null, shape: "freehand", mask: doc.layers[0].canvas },
    dispatch: (action) => actions.push(action),
  }

  expect((await dispatchHostRequest(request("selection.getBounds"), maskOnly)).result).toEqual({
    empty: false,
    bounded: false,
    hasMask: true,
    shape: "freehand",
  })
  expect((await dispatchHostRequest(request("selection.isEmpty"), maskOnly)).result).toBe(false)
  await dispatchHostRequest(request("selection.selectAll"), maskOnly)
  await dispatchHostRequest(request("selection.deselect"), maskOnly)
  expect(actions).toEqual([
    {
      type: "set-selection",
      selection: { bounds: { x: 0, y: 0, w: doc.width, h: doc.height }, shape: "rect", mask: null },
    },
    {
      type: "set-selection",
      selection: { bounds: null, shape: "rect", mask: null },
    },
  ])
})

test("plugin storage aliases remain scoped by plugin id and require string keys", async () => {
  const storage = new ScopedStorage()
  const ctx: HostContext = { activeDoc: null, activeLayer: null, storage }

  await dispatchHostRequest(request("fsSafe.write", { key: "theme", value: "dark" }), ctx)
  await dispatchHostRequest({ ...request("storage.set", { key: "theme", value: "light" }), pluginId: "plugin-b" }, ctx)

  expect((await dispatchHostRequest(request("storage.get", { key: "theme" }), ctx)).result).toBe("dark")
  expect((await dispatchHostRequest({ ...request("fsSafe.read", { key: "theme" }), pluginId: "plugin-b" }, ctx)).result).toBe("light")
  expect((await dispatchHostRequest(request("storage.keys"), ctx)).result).toEqual(["theme"])

  await dispatchHostRequest(request("fsSafe.remove", { key: "theme" }), ctx)
  expect((await dispatchHostRequest(request("storage.keys"), ctx)).result).toEqual([])
  expect(await dispatchHostRequest(request("fsSafe.read", { key: 42 }), ctx)).toMatchObject({
    ok: false,
    error: "fsSafe.read: key required",
  })
})

test("descriptor, safe script, host command, and UI calls forward to injected adapters", async () => {
  const calls: unknown[] = []
  const ctx: HostContext = {
    activeDoc: null,
    activeLayer: null,
    runDescriptors: (descriptors) => {
      calls.push(["descriptors", descriptors])
      return [{ ok: true }]
    },
    runSafeScript: (source) => {
      calls.push(["script", source])
      return "done"
    },
    runHostCommand: (id) => {
      calls.push(["command", id])
      return { id }
    },
    ui: {
      render: (pluginId, node) => { calls.push(["render", pluginId, node]) },
      toast: (pluginId, message, kind) => { calls.push(["toast", pluginId, message, kind]) },
      prompt: async () => "typed",
      confirm: async () => true,
    },
  }

  expect((await dispatchHostRequest(request("action.batchPlay", { descriptors: [{ _obj: "get" }] }), ctx)).result).toEqual([{ ok: true }])
  expect((await dispatchHostRequest(request("cep.evalScript", { source: 'report("ok")' }), ctx)).result).toBe("done")
  expect((await dispatchHostRequest(request("commands.run", { id: "file.save" }), ctx)).result).toEqual({ id: "file.save" })
  await dispatchHostRequest(request("ui.render", { node: { type: "text" } }), ctx)
  await dispatchHostRequest(request("ui.toast", { message: "Saved", kind: "success" }), ctx)
  expect((await dispatchHostRequest(request("ui.prompt", { title: "Name" }), ctx)).result).toBe("typed")
  expect((await dispatchHostRequest(request("ui.confirm", { title: "Continue?" }), ctx)).result).toBe(true)
  expect(calls).toEqual([
    ["descriptors", [{ _obj: "get" }]],
    ["script", 'report("ok")'],
    ["command", "file.save"],
    ["render", "plugin-a", { type: "text" }],
    ["toast", "plugin-a", "Saved", "success"],
  ])
})

test("lifecycle events include plugin id, phase, timestamp, and optional detail", () => {
  const events: unknown[] = []
  window.addEventListener(PLUGIN_LIFECYCLE_EVENT, (event) => {
    events.push((event as CustomEvent).detail)
  })
  emitPluginLifecycle("plugin-a", "running", { commandId: "resize" })

  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    pluginId: "plugin-a",
    phase: "running",
    detail: { commandId: "resize" },
  })
  expect((events[0] as { at: number }).at).toBeGreaterThan(0)
})

test("plugin test suites preserve input order and continue after runtime errors", async () => {
  const inputs: PluginTestInput[] = [
    { pluginId: "p", inputId: "ok", input: { kind: "message", payload: 1 } },
    { pluginId: "p", inputId: "bad", input: { kind: "command", commandId: "fail" } },
    { pluginId: "p", inputId: "after", input: { kind: "lifecycle", phase: "ready" } },
  ]
  const sent: string[] = []
  const results = await runPluginTestSuite({
    send: async (input) => {
      sent.push(input.inputId)
      if (input.inputId === "bad") throw new Error("runtime failed")
      return {
        pluginId: input.pluginId,
        inputId: input.inputId,
        ok: true,
        result: input.input.kind,
        lifecycle: [],
        hostCalls: [],
      }
    },
  }, inputs)

  expect(sent).toEqual(["ok", "bad", "after"])
  expect(results).toEqual([
    expect.objectContaining({ inputId: "ok", ok: true, result: "message" }),
    { pluginId: "p", inputId: "bad", ok: false, error: "runtime failed", lifecycle: [], hostCalls: [] },
    expect.objectContaining({ inputId: "after", ok: true, result: "lifecycle" }),
  ])
})

test("default smoke tests include host probes and every declared plugin command", () => {
  const plugin: PluginDescriptor = {
    id: "plugin-a",
    name: "Example",
    kind: "ux-plugin",
    enabled: true,
    createdAt: 1,
    commands: [
      { id: "resize", title: "Resize", action: { type: "post-message", message: {} } },
      { id: "export", title: "Export", action: { type: "post-message", message: {} } },
    ],
  }

  expect(defaultSmokeTests(plugin)).toEqual([
    expect.objectContaining({ inputId: "smoke-host-info", expectation: { method: "host.getInfo" } }),
    expect.objectContaining({ inputId: "smoke-document-info", expectation: { method: "document.getInfo" } }),
    expect.objectContaining({ inputId: "smoke-cmd-resize", expectation: { title: "Resize" } }),
    expect.objectContaining({ inputId: "smoke-cmd-export", expectation: { title: "Export" } }),
  ])
})

test("plugin test input validation rejects malformed envelopes and summary output stays bounded", () => {
  expect(isPluginTestInput({
    pluginId: "plugin-a",
    inputId: "input-1",
    input: { kind: "batch-play", descriptors: [] },
  })).toBe(true)
  expect(isPluginTestInput({ pluginId: "", inputId: "x", input: { kind: "message" } })).toBe(false)
  expect(isPluginTestInput({ pluginId: "p", inputId: "x", input: { kind: "eval" } })).toBe(false)
  expect(isPluginTestInput({ pluginId: "p", inputId: "x", input: null })).toBe(false)

  const summary = summariseTestValue({
    bytes: new ArrayBuffer(12),
    canvas: { tagName: "CANVAS", huge: "x".repeat(100) },
    callback: () => undefined,
    text: "x".repeat(500),
  }, 120)
  expect(summary.length).toBe(120)
  expect(summary).toContain("[ArrayBuffer 12b]")
  expect(summary).toContain("[Canvas]")

  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  expect(summariseTestValue(cyclic)).toBe("[unserialisable]")
})
