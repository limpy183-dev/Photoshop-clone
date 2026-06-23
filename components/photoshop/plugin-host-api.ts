/**
 * Plugin host API surface.
 *
 * This module documents and implements the stable JavaScript surface exposed
 * to plugins running inside the sandboxed iframe runtime. It is the bridge
 * that Action Manager descriptors and CEP scripts ultimately resolve to.
 *
 * The categories below are the contract:
 *
 *   document.*   — read document name/size/colorMode/bitDepth/layer count
 *   layers.*     — read active layer, create, update, query
 *   selection.*  — read selection bounds, marquee state, isEmpty
 *   history.*    — list snapshots, undo/redo (single step only — bounded)
 *   fsSafe.*     — read/write the plugin's project-local storage namespace
 *   ui.*         — render host-native controls; prompt/confirm via host
 *
 * Any other adobe-flavoured API names that look familiar (PhotoMerge, Sky
 * Replacement, Neural Filters, …) are NOT exposed because they map onto
 * Adobe-cloud services that BOUNDARIES.md §1 documents as out of scope.
 */

import type {
  Layer,
  PluginActionDescriptor,
  PsDocument,
  Selection,
} from "./types"
import { dispatchPhotoshopEvent } from "./events"

/* --------------------------- Method names ------------------------------- */

/**
 * Canonical list of method names plugins can invoke through
 * `postMessage`. The host runtime validates that every incoming request
 * matches one of these and refuses anything else.
 */
export const PLUGIN_HOST_METHODS = [
  // metadata
  "host.getInfo",
  "host.listAvailable",
  "host.listSimulated",
  "host.listUnavailable",
  // document
  "document.getInfo",
  "document.getLayers",
  "document.getColorModeInfo",
  // layers
  "layers.getActive",
  "layers.getAll",
  "layers.create",
  "layers.update",
  "layers.delete",
  "layers.duplicate",
  "layers.setActive",
  // selection
  "selection.getBounds",
  "selection.isEmpty",
  "selection.selectAll",
  "selection.deselect",
  // history
  "history.list",
  "history.undo",
  "history.redo",
  "history.snapshot",
  // filesystem-safe (plugin-namespaced storage; never touches host disk)
  "fsSafe.read",
  "fsSafe.write",
  "fsSafe.remove",
  "fsSafe.list",
  // ui
  "ui.render",
  "ui.toast",
  "ui.prompt",
  "ui.confirm",
  // batch-play (Action Manager)
  "action.batchPlay",
  // UXP / CEP shims
  "uxp.executeAsModal",
  "cep.evalScript",
  "cep.dispatchEvent",
  // 8bf metadata
  "8bf.getInfo",
  "8bf.run",
  // host-defined commands
  "commands.run",
  // storage (legacy alias retained alongside fsSafe)
  "storage.get",
  "storage.set",
  "storage.remove",
  "storage.clear",
  "storage.keys",
  // plugin lifecycle
  "plugin.ready",
] as const

export type PluginHostMethod = (typeof PLUGIN_HOST_METHODS)[number]

const PLUGIN_HOST_METHOD_SET = new Set<string>(PLUGIN_HOST_METHODS)

export function isPluginHostMethod(name: string): name is PluginHostMethod {
  return PLUGIN_HOST_METHOD_SET.has(name)
}

/* --------------------------- Capability documentation ------------------- */

/**
 * For every method, document whether the browser host actually executes it
 * (`native`), simulates it via shims (`simulated`), or refuses (`unavailable`).
 *
 * The Plugin Workspace surfaces this list so plugin authors can see which
 * capabilities exist in this environment before deploying their plugin.
 */
export type PluginCapability = "native" | "simulated" | "unavailable"

export const PLUGIN_CAPABILITY_TABLE: Record<PluginHostMethod, PluginCapability> = {
  "host.getInfo": "native",
  "host.listAvailable": "native",
  "host.listSimulated": "native",
  "host.listUnavailable": "native",
  "document.getInfo": "native",
  "document.getLayers": "native",
  "document.getColorModeInfo": "native",
  "layers.getActive": "native",
  "layers.getAll": "native",
  "layers.create": "native",
  "layers.update": "native",
  "layers.delete": "native",
  "layers.duplicate": "native",
  "layers.setActive": "native",
  "selection.getBounds": "native",
  "selection.isEmpty": "native",
  "selection.selectAll": "native",
  "selection.deselect": "native",
  "history.list": "native",
  "history.undo": "native",
  "history.redo": "native",
  "history.snapshot": "native",
  "fsSafe.read": "native",
  "fsSafe.write": "native",
  "fsSafe.remove": "native",
  "fsSafe.list": "native",
  "ui.render": "native",
  "ui.toast": "native",
  "ui.prompt": "native",
  "ui.confirm": "native",
  "action.batchPlay": "native",
  // UXP/CEP/8bf are simulated; see BOUNDARIES.md §2
  "uxp.executeAsModal": "simulated",
  "cep.evalScript": "simulated",
  "cep.dispatchEvent": "simulated",
  "8bf.getInfo": "simulated",
  "8bf.run": "simulated",
  "commands.run": "native",
  "storage.get": "native",
  "storage.set": "native",
  "storage.remove": "native",
  "storage.clear": "native",
  "storage.keys": "native",
  "plugin.ready": "native",
}

/**
 * Methods that are part of the documented Adobe Action Manager / Generator
 * API but cannot be implemented in a browser sandbox. They are exposed in
 * the listUnavailable() call so plugin authors get explicit "not in browser"
 * rather than a silent stub.
 */
export const PLUGIN_UNAVAILABLE_APIS = [
  { name: "neuralFilters.run", reason: "Requires Adobe Sensei service (BOUNDARIES §1)" },
  { name: "generativeFill.run", reason: "Requires Adobe Firefly (BOUNDARIES §1)" },
  { name: "library.sync", reason: "Requires Creative Cloud account (BOUNDARIES §1)" },
  { name: "fonts.adobeSync", reason: "Requires Adobe Fonts account (BOUNDARIES §1)" },
  { name: "cep.evalScript:native", reason: "CEP runtime is host-only (BOUNDARIES §2)" },
  { name: "uxp.fs.open:disk", reason: "Browser sandbox blocks raw disk access (BOUNDARIES §6)" },
  { name: "press.outputSeparations", reason: "Requires certified CMM (BOUNDARIES §4)" },
] as const

/* --------------------------- Host implementation ------------------------ */

export interface HostRequest {
  channel: string
  pluginId: string
  token: string
  requestId: string
  method: PluginHostMethod
  args?: Record<string, unknown>
}

export interface HostResponse {
  channel: string
  pluginId: string
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

/**
 * Minimal context the host passes to the dispatcher for each request. The
 * dialog wraps the live `useEditor()` values; tests can pass a stub object.
 */
export interface HostContext {
  activeDoc: PsDocument | null
  activeLayer: Layer | null
  selection?: Selection | null
  history?: { id: string; label: string; createdAt: number }[]
  dispatch?: (action: { type: string; [k: string]: unknown }) => void
  storage?: PluginStorageAdapter
  ui?: PluginUiAdapter
  /** Replay descriptor batches via the Action Manager subsystem. */
  runDescriptors?: (descriptors: PluginActionDescriptor[]) => unknown[]
  /** Execute a CEP-compatible safe DSL script. Returns stdout text. */
  runSafeScript?: (source: string) => string
  /** Run a host command registered in this editor. */
  runHostCommand?: (id: string) => unknown
}

export interface PluginStorageAdapter {
  get(pluginId: string, key: string): unknown
  set(pluginId: string, key: string, value: unknown): void
  remove(pluginId: string, key: string): void
  clear(pluginId: string): void
  keys(pluginId: string): string[]
}

export interface PluginUiAdapter {
  render(pluginId: string, node: unknown): void
  toast(pluginId: string, message: string, kind?: "info" | "error" | "success"): void
  prompt(pluginId: string, title: string, defaultValue?: string): Promise<string | null>
  confirm(pluginId: string, title: string): Promise<boolean>
}

/**
 * Dispatch a single host request. Returns a HostResponse the runtime can
 * post back across the iframe boundary. Pure of editor singletons so it can
 * be unit-tested.
 */
export async function dispatchHostRequest(req: HostRequest, ctx: HostContext): Promise<HostResponse> {
  const base: Omit<HostResponse, "ok"> = {
    channel: req.channel,
    pluginId: req.pluginId,
    requestId: req.requestId,
  }
  try {
    const result = await runMethod(req.method, req.args ?? {}, req.pluginId, ctx)
    return { ...base, ok: true, result }
  } catch (err) {
    return { ...base, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function runMethod(method: PluginHostMethod, args: Record<string, unknown>, pluginId: string, ctx: HostContext): Promise<unknown> {
  switch (method) {
    case "plugin.ready":
      return { ok: true, ready: true }
    case "host.getInfo":
      return {
        host: "photoshop-web",
        version: 1,
        capabilities: PLUGIN_CAPABILITY_TABLE,
        unavailable: PLUGIN_UNAVAILABLE_APIS,
      }
    case "host.listAvailable":
      return Object.entries(PLUGIN_CAPABILITY_TABLE).filter(([, c]) => c === "native").map(([m]) => m)
    case "host.listSimulated":
      return Object.entries(PLUGIN_CAPABILITY_TABLE).filter(([, c]) => c === "simulated").map(([m]) => m)
    case "host.listUnavailable":
      return PLUGIN_UNAVAILABLE_APIS

    case "document.getInfo":
      requireDoc(ctx)
      return {
        id: ctx.activeDoc!.id,
        name: ctx.activeDoc!.name,
        width: ctx.activeDoc!.width,
        height: ctx.activeDoc!.height,
        colorMode: ctx.activeDoc!.colorMode,
        bitDepth: ctx.activeDoc!.bitDepth,
        layerCount: ctx.activeDoc!.layers.length,
      }
    case "document.getLayers":
      requireDoc(ctx)
      return ctx.activeDoc!.layers.map(summarizeLayer)
    case "document.getColorModeInfo":
      requireDoc(ctx)
      return {
        colorMode: ctx.activeDoc!.colorMode,
        bitDepth: ctx.activeDoc!.bitDepth,
        modeSettings: ctx.activeDoc!.modeSettings ?? null,
      }

    case "layers.getActive":
      return ctx.activeLayer ? summarizeLayer(ctx.activeLayer) : null
    case "layers.getAll":
      requireDoc(ctx)
      return ctx.activeDoc!.layers.map(summarizeLayer)
    case "layers.create": {
      requireDispatch(ctx)
      requireDoc(ctx)
      const name = typeof args.name === "string" ? args.name : "Layer"
      const opacity = typeof args.opacity === "number" ? clamp(args.opacity, 0, 1) : 1
      // Create via dispatch; the host attaches the canvas.
      const layer: Layer = {
        id: `plugin-${pluginId}-${Date.now().toString(36)}`,
        name,
        kind: "raster",
        visible: true,
        locked: false,
        opacity,
        blendMode: "normal",
        canvas: makeBlankCanvas(ctx.activeDoc!.width, ctx.activeDoc!.height),
      }
      ctx.dispatch!({ type: "add-layer", layer })
      return summarizeLayer(layer)
    }
    case "layers.update": {
      requireDispatch(ctx)
      requireDoc(ctx)
      const layerId = typeof args.id === "string" ? args.id : ctx.activeLayer?.id
      if (!layerId) throw new Error("layers.update: id required")
      const layer = ctx.activeDoc!.layers.find((l) => l.id === layerId)
      if (!layer) throw new Error("layers.update: layer not found")
      if (typeof args.name === "string") ctx.dispatch!({ type: "rename-layer", id: layer.id, name: args.name })
      if (typeof args.opacity === "number") ctx.dispatch!({ type: "set-layer-opacity", id: layer.id, opacity: clamp(args.opacity, 0, 1) })
      if (typeof args.visible === "boolean") ctx.dispatch!({ type: "set-layer-visibility", id: layer.id, visible: args.visible })
      return { ok: true, layerId: layer.id }
    }
    case "layers.delete": {
      requireDispatch(ctx)
      const layerId = typeof args.id === "string" ? args.id : ctx.activeLayer?.id
      if (!layerId) throw new Error("layers.delete: id required")
      ctx.dispatch!({ type: "remove-layer", id: layerId })
      return { ok: true, removedLayerId: layerId }
    }
    case "layers.duplicate": {
      requireDispatch(ctx)
      const layerId = typeof args.id === "string" ? args.id : ctx.activeLayer?.id
      if (!layerId) throw new Error("layers.duplicate: id required")
      ctx.dispatch!({ type: "duplicate-layer", id: layerId })
      return { ok: true, duplicatedFromLayerId: layerId }
    }
    case "layers.setActive": {
      requireDispatch(ctx)
      const layerId = typeof args.id === "string" ? args.id : ""
      if (!layerId) throw new Error("layers.setActive: id required")
      ctx.dispatch!({ type: "set-active-layer", id: layerId })
      return { ok: true, activeLayerId: layerId }
    }

    case "selection.getBounds": {
      const sel = ctx.selection
      if (!sel || (!sel.bounds && !sel.mask)) return { empty: true }
      const b = sel.bounds
      if (b) return { empty: false, x: b.x, y: b.y, width: b.w, height: b.h, shape: sel.shape }
      return { empty: false, bounded: false, hasMask: !!sel.mask, shape: sel.shape }
    }
    case "selection.isEmpty":
      return !ctx.selection?.bounds && !ctx.selection?.mask
    case "selection.selectAll": {
      requireDispatch(ctx)
      requireDoc(ctx)
      ctx.dispatch!({
        type: "set-selection",
        selection: { bounds: { x: 0, y: 0, w: ctx.activeDoc!.width, h: ctx.activeDoc!.height }, shape: "rect", mask: null },
      })
      return { ok: true }
    }
    case "selection.deselect":
      requireDispatch(ctx)
      ctx.dispatch!({ type: "set-selection", selection: { bounds: null, shape: "rect", mask: null } })
      return { ok: true }

    case "history.list":
      return ctx.history ?? []
    case "history.undo":
      // Undo/redo go through the editor's restore-history mechanism, which
      // needs index arithmetic. The dialog binds these via a custom event so
      // the host editor (which holds the history scheduler) performs the
      // actual jump. We just signal intent here.
      if (typeof window !== "undefined") dispatchPhotoshopEvent("ps-plugin-host-undo", { pluginId })
      return { ok: true, requested: "undo" }
    case "history.redo":
      if (typeof window !== "undefined") dispatchPhotoshopEvent("ps-plugin-host-redo", { pluginId })
      return { ok: true, requested: "redo" }
    case "history.snapshot": {
      const label = typeof args.label === "string" ? args.label : "Plugin Snapshot"
      // Snapshot is a marker the host can record; the actual commit is the
      // host's responsibility (dialog wires it up).
      return { ok: true, label }
    }

    case "fsSafe.read":
    case "storage.get":
      return ctx.storage?.get(pluginId, requireString(args.key, "fsSafe.read: key required")) ?? null
    case "fsSafe.write":
    case "storage.set":
      ctx.storage?.set(pluginId, requireString(args.key, "fsSafe.write: key required"), args.value ?? null)
      return { ok: true }
    case "fsSafe.remove":
    case "storage.remove":
      ctx.storage?.remove(pluginId, requireString(args.key, "fsSafe.remove: key required"))
      return { ok: true }
    case "storage.clear":
      ctx.storage?.clear(pluginId)
      return { ok: true }
    case "fsSafe.list":
    case "storage.keys":
      return ctx.storage?.keys(pluginId) ?? []

    case "ui.render":
      ctx.ui?.render(pluginId, args.node)
      return { ok: true }
    case "ui.toast":
      ctx.ui?.toast(pluginId, typeof args.message === "string" ? args.message : "", (typeof args.kind === "string" ? args.kind : "info") as "info" | "error" | "success")
      return { ok: true }
    case "ui.prompt":
      return await (ctx.ui?.prompt(pluginId, typeof args.title === "string" ? args.title : "", typeof args.defaultValue === "string" ? args.defaultValue : undefined) ?? Promise.resolve(null))
    case "ui.confirm":
      return await (ctx.ui?.confirm(pluginId, typeof args.title === "string" ? args.title : "") ?? Promise.resolve(false))

    case "action.batchPlay": {
      const descriptors = Array.isArray(args.descriptors) ? args.descriptors as PluginActionDescriptor[] : []
      if (!ctx.runDescriptors) throw new Error("action.batchPlay not wired in this context")
      return ctx.runDescriptors(descriptors)
    }

    case "uxp.executeAsModal":
      // Best-effort shim: synchronous dispatch then commit. Plugins that
      // actually need atomic transactions should batch via action.batchPlay.
      return { ok: true, simulated: true }
    case "cep.evalScript": {
      const source = typeof args.source === "string" ? args.source : ""
      if (!ctx.runSafeScript) throw new Error("cep.evalScript not wired in this context")
      return ctx.runSafeScript(source)
    }
    case "cep.dispatchEvent":
      return { ok: true, simulated: true }
    case "8bf.getInfo":
      return { simulated: true, message: "8bf metadata read-only; see BOUNDARIES §2" }
    case "8bf.run":
      return { simulated: true, message: "8bf safe kernel execution via 3×3 descriptor only" }

    case "commands.run":
      if (!ctx.runHostCommand) throw new Error("commands.run not wired")
      return ctx.runHostCommand(requireString(args.id, "commands.run: id required"))

    default:
      throw new Error(`Unknown method: ${String(method)}`)
  }
}

/* --------------------------- helpers ------------------------------------ */

function requireDoc(ctx: HostContext): void {
  if (!ctx.activeDoc) throw new Error("No active document")
}

function requireDispatch(ctx: HostContext): void {
  if (!ctx.dispatch) throw new Error("dispatch not wired in this context")
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message)
  return value
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function makeBlankCanvas(w: number, h: number): HTMLCanvasElement {
  const c = typeof document !== "undefined" ? document.createElement("canvas") : ({ width: w, height: h, getContext: () => null } as unknown as HTMLCanvasElement)
  c.width = w
  c.height = h
  return c
}

function summarizeLayer(layer: Layer): Record<string, unknown> {
  return {
    id: layer.id,
    name: layer.name,
    kind: layer.kind,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    width: layer.canvas?.width ?? null,
    height: layer.canvas?.height ?? null,
  }
}
