"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CapabilityNotice, EmptyState, FileButton, Panel } from "./advanced-subsystems-dialog-controls"
import { cleanImportText, isImportRecord } from "./advanced-subsystems-import-normalizers"
import { ADVANCED_FILE_LIMITS, applyPluginFilterToCanvas, assertAdvancedFileSize } from "./advanced-subsystems"
import { cleanBrushPatch, cleanHexColor, parseSafeDslCommands } from "./automation-engine"
import { downloadText } from "./document-io"
import { useEditor, makeCanvas } from "./editor-context"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "./events"
import { FILTERS } from "./filters"
import {
  PLUGIN_MANIFEST_FORMAT,
  buildPluginExportPayload,
  buildPluginIframeSrcDoc,
  buildPluginPackagePayload,
  canPluginUsePermission,
  createPluginStoragePatch,
  describeNativeEightBfCompatibility,
  describePluginHostCapabilities,
  normalizeNativeEightBfPlugin,
  normalizePluginActionDescriptors,
  normalizePluginPackagePayload,
  normalizePluginUiTree,
  permissionsForPluginActionDescriptors,
  pluginInstallReview,
  safePluginJson,
  validatePluginPanelRequest,
  type PluginUiNode,
} from "./plugin-system"
import { uid } from "./uid"
import type {
  AdjustmentType,
  AssetLibraryItem,
  Layer,
  PluginActionDescriptor,
  PluginCommandDescriptor,
  PluginDescriptor,
  PluginPermission,
  PsDocument,
  ToolId,
} from "./types"
const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  "document:read": "Document read",
  "layers:read": "Layer read",
  "layers:write": "Layer write",
  "filters:write": "Filter write",
  commands: "Commands",
  storage: "Storage",
  ui: "Host UI",
}

const PLUGIN_PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> = {
  "document:read": "Read document name, dimensions, color mode, and layer count.",
  "layers:read": "Read active layer metadata.",
  "layers:write": "Create or update layer records through approved host actions.",
  "filters:write": "Modify active layer pixels through JSON-described filters.",
  commands: "Run commands declared in the plugin manifest.",
  storage: "Read and write the plugin's project-local storage namespace.",
  ui: "Render host-native controls through message passing.",
}

const SAMPLE_PANEL_HTML = `
<style>
  body{font:13px system-ui;background:#181818;color:#eee;padding:12px}
  main{display:grid;gap:10px}
  .dim{color:#a7a7a7}
</style>
<main>
  <strong>Sandboxed Plugin Panel</strong>
  <span class="dim" id="summary">Waiting for host API...</span>
</main>
<script>
  async function boot() {
    const doc = await photoshopWeb.document.getInfo();
    document.getElementById("summary").textContent = doc.name + " - " + doc.width + "x" + doc.height;
    await photoshopWeb.storage.set("lastDocument", doc.name);
    await photoshopWeb.ui.render({
      type: "stack",
      id: "root",
      children: [
        { type: "text", id: "title", text: "Plugin UI Bridge", tone: "strong" },
        { type: "text", id: "doc", text: "Active document: " + doc.name, tone: "muted" },
        { type: "button", id: "inspect", label: "Inspect Active Layer", action: "inspect-layer", variant: "primary" },
        { type: "input", id: "tag", label: "Storage key", value: "lastDocument", placeholder: "key" }
      ]
    });
  }
  window.onPhotoshopWebPluginEvent = async (event) => {
    if (event.action === "inspect-layer") {
      const layer = await photoshopWeb.layers.getActive();
      await photoshopWeb.ui.toast(layer ? ("Active layer: " + layer.name) : "No active layer");
    }
  };
  boot().catch((error) => {
    document.getElementById("summary").textContent = error.message;
  });
</script>`

const SAMPLE_PLUGINS: PluginDescriptor[] = [
  {
    id: "plug_sharpen",
    name: "8BF-style Sharpen Kernel",
    kind: "8bf-filter",
    enabled: true,
    version: "1.0",
    permissions: ["filters:write"],
    commands: [{ id: "apply", title: "Apply Sharpen Kernel", group: "Filters", action: { type: "apply-filter" } }],
    filterKernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
    filterDivisor: 1,
    filterBias: 0,
    createdAt: Date.now(),
  },
  {
    id: "plug_emboss",
    name: "8BF-style Emboss Kernel",
    kind: "8bf-filter",
    enabled: true,
    version: "1.0",
    permissions: ["filters:write"],
    commands: [{ id: "apply", title: "Apply Emboss Kernel", group: "Filters", action: { type: "apply-filter" } }],
    filterKernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
    filterDivisor: 1,
    filterBias: 128,
    createdAt: Date.now(),
  },
  {
    id: "plug_panel",
    name: "UXP-style Document Helper",
    kind: "ux-plugin",
    enabled: true,
    version: "1.0",
    permissions: ["document:read", "layers:read", "storage", "ui", "commands"],
    panelHtml: SAMPLE_PANEL_HTML,
    storageDefaults: { lastDocument: "", launches: 0 },
    commands: [
      { id: "open", title: "Open Document Helper Panel", group: "Panels", action: { type: "open-panel" } },
      { id: "ping", title: "Send Inspect Event", group: "Panels", action: { type: "post-message", message: { action: "inspect-layer" } } },
    ],
    createdAt: Date.now(),
  },
]

function clonePluginForInstall(plugin: PluginDescriptor, index: number, source: PluginDescriptor["source"] = "registry"): PluginDescriptor {
  return {
    ...plugin,
    id: uid("plugin"),
    createdAt: Date.now() + index,
    installedAt: Date.now() + index,
    manifestVersion: 1,
    source,
    trusted: source === "registry" || source === "sample",
    storageDefaults: isImportRecord(plugin.storageDefaults) ? (safePluginJson(plugin.storageDefaults) as Record<string, unknown>) : undefined,
  }
}

function mergePluginStorageDefaults(
  current: Record<string, Record<string, unknown>> | undefined,
  plugins: PluginDescriptor[],
) {
  const next: Record<string, Record<string, unknown>> = { ...(current ?? {}) }
  for (const plugin of plugins) {
    if (!next[plugin.id]) {
      next[plugin.id] = isImportRecord(plugin.storageDefaults)
        ? (safePluginJson(plugin.storageDefaults) as Record<string, unknown>) ?? {}
        : {}
    }
  }
  for (const id of Object.keys(next)) {
    if (!plugins.some((plugin) => plugin.id === id)) delete next[id]
  }
  return next
}

function permissionsForPluginCommand(command: PluginCommandDescriptor): PluginPermission[] {
  if (command.requiredPermissions?.length) return command.requiredPermissions
  if (command.action.type === "apply-filter") return ["filters:write"]
  if (command.action.type === "post-message") return ["commands"]
  if (command.action.type === "batch-play") return permissionsForPluginActionDescriptors(command.action.descriptors)
  if (command.action.type === "eval-script") return ["commands"]
  return []
}

function permissionForPanelMethod(method: string): PluginPermission | null {
  if (method === "host.getInfo" || method === "plugin.ready" || method === "8bf.getInfo") return null
  if (method === "document.getInfo") return "document:read"
  if (method === "layers.getActive") return "layers:read"
  if (method === "layers.create" || method === "layers.update") return "layers:write"
  if (method.startsWith("storage.")) return "storage"
  if (method.startsWith("ui.")) return "ui"
  if (method === "commands.run" || method === "action.batchPlay" || method === "uxp.executeAsModal" || method.startsWith("cep.")) return "commands"
  if (method === "8bf.run") return "filters:write"
  return null
}

function postPluginResponse(
  frame: HTMLIFrameElement | null,
  plugin: PluginDescriptor,
  requestId: string,
  payload: { ok: true; result: unknown } | { ok: false; error: string },
) {
  frame?.contentWindow?.postMessage(
    {
      channel: "photoshop-web-plugin",
      pluginId: plugin.id,
      requestId,
      type: "response",
      ...payload,
    },
    "*",
  )
}

function postPluginUiEvent(
  frame: HTMLIFrameElement | null,
  plugin: PluginDescriptor,
  event: Record<string, unknown>,
) {
  frame?.contentWindow?.postMessage(
    {
      channel: "photoshop-web-plugin",
      pluginId: plugin.id,
      type: "ui:event",
      event,
    },
    "*",
  )
}

function summarizeRuntimeLayer(layer: Layer | null) {
  return layer
    ? {
        id: layer.id,
        name: layer.name,
        kind: layer.kind ?? "raster",
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        width: layer.canvas.width,
        height: layer.canvas.height,
      }
    : null
}

function runtimeStringArg(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback
}

function runtimeNumberArg(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, typeof value === "number" && Number.isFinite(value) ? value : fallback))
}

function runtimeBooleanArg(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function runtimeRecord(value: unknown): Record<string, unknown> {
  return isImportRecord(value) ? value : {}
}

function resolveRuntimeLayer(doc: PsDocument, activeLayer: Layer | null, id: unknown) {
  const requested = typeof id === "string" ? id : ""
  if (!requested || requested === "active" || requested === "targetEnum") return activeLayer
  return doc.layers.find((layer) => layer.id === requested || layer.name === requested) ?? activeLayer
}

function descriptorTargetsLayer(descriptor: PluginActionDescriptor) {
  return JSON.stringify(descriptor._target ?? descriptor).toLowerCase().includes("layer")
}

function descriptorTargetsDocument(descriptor: PluginActionDescriptor) {
  return JSON.stringify(descriptor._target ?? descriptor).toLowerCase().includes("document")
}

function descriptorLayerId(descriptor: PluginActionDescriptor) {
  const target = Array.isArray(descriptor._target) ? descriptor._target.find(isImportRecord) : null
  return target && typeof target._id === "string" ? target._id : target && typeof target.name === "string" ? target.name : "active"
}

function pluginLayerPatchFromDescriptor(descriptor: PluginActionDescriptor) {
  return runtimeRecord(descriptor.to ?? descriptor.using ?? descriptor)
}

function applyFilterIdToLayer(layer: Layer, filterId: string, params?: Record<string, number | string | boolean>) {
  const filter = FILTERS[filterId]
  if (!filter) throw new Error(`Unknown filter: ${filterId}`)
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) throw new Error("Active layer canvas is unavailable.")
  const defaults: Record<string, number | string | boolean> = {}
  for (const param of filter.params) defaults[param.key] = param.default
  const image = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  ctx.putImageData(filter.apply(image, { ...defaults, ...(params ?? {}) }), 0, 0)
}

function createRuntimeLayer(doc: PsDocument, params: Record<string, unknown>): Layer {
  return {
    id: uid("plugin-layer"),
    name: runtimeStringArg(params.name, "Plugin Layer"),
    kind: "raster",
    visible: true,
    locked: false,
    opacity: runtimeNumberArg(params.opacity, 1, 0, 1),
    blendMode: "normal",
    canvas: makeCanvas(doc.width, doc.height),
  }
}

function runPluginActionDescriptors({
  descriptors,
  activeDoc,
  activeLayer,
  dispatch,
  requestRender,
  commit,
}: {
  descriptors: PluginActionDescriptor[]
  activeDoc: PsDocument
  activeLayer: Layer | null
  dispatch: ReturnType<typeof useEditor>["dispatch"]
  requestRender: () => void
  commit: ReturnType<typeof useEditor>["commit"]
}) {
  const results: unknown[] = []
  const touchedLayers = new Set<string>()
  for (const descriptor of descriptors) {
    const action = descriptor._obj.toLowerCase()
    if (action === "get") {
      if (descriptorTargetsDocument(descriptor)) {
        results.push({
          id: activeDoc.id,
          name: activeDoc.name,
          width: activeDoc.width,
          height: activeDoc.height,
          colorMode: activeDoc.colorMode,
          bitDepth: activeDoc.bitDepth,
          layerCount: activeDoc.layers.length,
        })
      } else {
        results.push(summarizeRuntimeLayer(resolveRuntimeLayer(activeDoc, activeLayer, descriptorLayerId(descriptor))))
      }
      continue
    }
    if (action === "make" && descriptorTargetsLayer(descriptor)) {
      const layer = createRuntimeLayer(activeDoc, pluginLayerPatchFromDescriptor(descriptor))
      dispatch({ type: "add-layer", layer })
      touchedLayers.add(layer.id)
      results.push(summarizeRuntimeLayer(layer))
      continue
    }
    const targetLayer = resolveRuntimeLayer(activeDoc, activeLayer, descriptorLayerId(descriptor))
    if (!targetLayer && descriptorTargetsLayer(descriptor)) throw new Error("No target layer is available.")
    if (action === "set" && targetLayer) {
      const patch = pluginLayerPatchFromDescriptor(descriptor)
      if (typeof patch.name === "string") dispatch({ type: "rename-layer", id: targetLayer.id, name: runtimeStringArg(patch.name, targetLayer.name) })
      if (typeof patch.opacity === "number") dispatch({ type: "set-layer-opacity", id: targetLayer.id, opacity: runtimeNumberArg(patch.opacity, targetLayer.opacity, 0, 1) })
      if (typeof patch.visible === "boolean") dispatch({ type: "set-layer-visibility", id: targetLayer.id, visible: patch.visible })
      touchedLayers.add(targetLayer.id)
      results.push({ ok: true, layerId: targetLayer.id })
      continue
    }
    if (action === "select" && targetLayer) {
      dispatch({ type: "set-active-layer", id: targetLayer.id })
      results.push({ ok: true, activeLayerId: targetLayer.id })
      continue
    }
    if ((action === "hide" || action === "show") && targetLayer) {
      dispatch({ type: "set-layer-visibility", id: targetLayer.id, visible: action === "show" })
      touchedLayers.add(targetLayer.id)
      results.push({ ok: true, layerId: targetLayer.id, visible: action === "show" })
      continue
    }
    if (action === "duplicate" && targetLayer) {
      dispatch({ type: "duplicate-layer", id: targetLayer.id })
      results.push({ ok: true, duplicatedLayerId: targetLayer.id })
      continue
    }
    if (action === "delete" && targetLayer) {
      dispatch({ type: "remove-layer", id: targetLayer.id })
      results.push({ ok: true, removedLayerId: targetLayer.id })
      continue
    }
    if (action === "filter" && targetLayer) {
      const filterId = runtimeStringArg(descriptor.filter ?? descriptor.filterId, "invert")
      applyFilterIdToLayer(targetLayer, filterId, runtimeRecord(descriptor.params) as Record<string, number | string | boolean>)
      touchedLayers.add(targetLayer.id)
      results.push({ ok: true, layerId: targetLayer.id, filterId })
      continue
    }
    results.push({ ok: false, unsupported: descriptor._obj })
  }
  if (touchedLayers.size) {
    requestRender()
    window.setTimeout(() => commit("Plugin Action Manager", [...touchedLayers]), 0)
  }
  return results
}

function runCepSafeScript({
  source,
  activeDoc,
  activeLayer,
  dispatch,
  requestRender,
  commit,
}: {
  source: string
  activeDoc: PsDocument
  activeLayer: Layer | null
  dispatch: ReturnType<typeof useEditor>["dispatch"]
  requestRender: () => void
  commit: ReturnType<typeof useEditor>["commit"]
}) {
  const commands = parseSafeDslCommands(source)
  const output: string[] = []
  const touchedLayers = new Set<string>()
  for (const command of commands) {
    const args = command.args
    if (command.method === "report") output.push(String(args[0] ?? "").slice(0, 500))
    else if (command.method === "reportDocument") output.push(`${activeDoc.name}: ${activeDoc.width} x ${activeDoc.height}px, ${activeDoc.layers.length} layers`)
    else if (command.method === "reportActiveLayer") output.push(activeLayer ? `Active layer: ${activeLayer.name}` : "No active layer")
    else if (command.method === "setTool") dispatch({ type: "set-tool", tool: runtimeStringArg(args[0], "move") as ToolId })
    else if (command.method === "setForeground") dispatch({ type: "set-foreground", color: cleanHexColor(args[0]) })
    else if (command.method === "setBackground") dispatch({ type: "set-background", color: cleanHexColor(args[0]) })
    else if (command.method === "setBrush") dispatch({ type: "set-brush", brush: cleanBrushPatch(args[0]) })
    else if (command.method === "renameActiveLayer" && activeLayer) {
      dispatch({ type: "rename-layer", id: activeLayer.id, name: runtimeStringArg(args[0], activeLayer.name) })
      touchedLayers.add(activeLayer.id)
    } else if (command.method === "setLayerOpacity") {
      const target = resolveRuntimeLayer(activeDoc, activeLayer, args[0])
      if (target) {
        dispatch({ type: "set-layer-opacity", id: target.id, opacity: runtimeNumberArg(args[1], target.opacity, 0, 1) })
        touchedLayers.add(target.id)
      }
    } else if (command.method === "setLayerVisibility") {
      const target = resolveRuntimeLayer(activeDoc, activeLayer, args[0])
      if (target) {
        dispatch({ type: "set-layer-visibility", id: target.id, visible: runtimeBooleanArg(args[1], target.visible) })
        touchedLayers.add(target.id)
      }
    } else if (command.method === "newLayer") {
      const layer = createRuntimeLayer(activeDoc, { name: args[0] })
      dispatch({ type: "add-layer", layer })
      touchedLayers.add(layer.id)
    } else if (command.method === "createAdjustment") {
      const adjustmentType = runtimeStringArg(args[0], "brightness-contrast") as AdjustmentType
      const filter = FILTERS[adjustmentType]
      if (!filter) throw new Error(`Unknown adjustment: ${adjustmentType}`)
      const params: Record<string, number | string | boolean> = {}
      for (const param of filter.params) params[param.key] = param.default
      const layer: Layer = {
        id: uid("plugin-adj"),
        name: filter.name,
        kind: "adjustment",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: makeCanvas(activeDoc.width, activeDoc.height),
        mask: makeCanvas(activeDoc.width, activeDoc.height, "#ffffff"),
        adjustment: { type: adjustmentType, params },
      }
      dispatch({ type: "add-layer", layer })
      touchedLayers.add(layer.id)
    } else if (command.method === "applyFilter" && activeLayer) {
      applyFilterIdToLayer(activeLayer, runtimeStringArg(args[0], "invert"), runtimeRecord(args[1]) as Record<string, number | string | boolean>)
      touchedLayers.add(activeLayer.id)
    } else if ((command.method === "invert" || command.method === "grayscale" || command.method === "desaturate" || command.method === "equalize" || command.method === "hdrToning") && activeLayer) {
      applyFilterIdToLayer(activeLayer, command.method === "hdrToning" ? "hdr-toning" : command.method)
      touchedLayers.add(activeLayer.id)
    }
  }
  if (touchedLayers.size) {
    requestRender()
    window.setTimeout(() => commit("CEP evalScript", [...touchedLayers]), 0)
  }
  return { result: output.join("\n") || `OK (${commands.length} command${commands.length === 1 ? "" : "s"})`, commands: commands.length }
}

export function PluginWorkspace() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState("")
  const [hostUi, setHostUi] = React.useState<PluginUiNode | null>(null)
  const [runtimeLog, setRuntimeLog] = React.useState<string[]>([])
  const [pendingInstall, setPendingInstall] = React.useState<{
    plugins: PluginDescriptor[]
    assets: AssetLibraryItem[]
    sourceLabel: string
  } | null>(null)
  const plugins = React.useMemo(() => activeDoc?.plugins ?? [], [activeDoc?.plugins])
  const selected = plugins.find((plugin) => plugin.id === selectedId) ?? plugins[0]

  React.useEffect(() => {
    setHostUi(null)
  }, [selected?.id])

  React.useEffect(() => {
    if (selectedId && !plugins.some((plugin) => plugin.id === selectedId)) setSelectedId(plugins[0]?.id ?? "")
    if (!selectedId && plugins[0]) setSelectedId(plugins[0].id)
  }, [plugins, selectedId])

  const setPlugins = React.useCallback((next: PluginDescriptor[]) => {
    if (!activeDoc) return
    dispatch({ type: "set-plugins", plugins: next })
    dispatch({ type: "set-plugin-storage", pluginStorage: mergePluginStorageDefaults(activeDoc.pluginStorage, next) })
  }, [activeDoc, dispatch])

  const logRuntime = React.useCallback((message: string) => {
    setRuntimeLog((current) => [message, ...current].slice(0, 8))
  }, [])

  const applyPluginFilter = React.useCallback((plugin: PluginDescriptor) => {
    if (!activeLayer || plugin.kind !== "8bf-filter") return
    if (!canPluginUsePermission(plugin, "filters:write")) {
      toast.error(`${plugin.name} does not have Filter write permission.`)
      return
    }
    const out = applyPluginFilterToCanvas(activeLayer.canvas, plugin)
    activeLayer.canvas.getContext("2d")!.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    activeLayer.canvas.getContext("2d")!.drawImage(out, 0, 0)
    requestRender()
    window.setTimeout(() => commit(`Apply Plugin: ${plugin.name}`, [activeLayer.id]), 0)
    logRuntime(`Applied ${plugin.name} to ${activeLayer.name}`)
  }, [activeLayer, commit, logRuntime, requestRender])

  const runPluginCommand = React.useCallback((plugin: PluginDescriptor, command: PluginCommandDescriptor) => {
    if (plugin.enabled === false) {
      toast.error(`${plugin.name} is disabled.`)
      return
    }
    const missing = permissionsForPluginCommand(command).filter((permission) => !canPluginUsePermission(plugin, permission))
    if (missing.length) {
      toast.error(`Missing permission: ${PLUGIN_PERMISSION_LABELS[missing[0]]}`)
      return
    }
    setSelectedId(plugin.id)
    if (command.action.type === "open-panel") {
      logRuntime(`Opened ${plugin.name} panel`)
      return
    }
    if (command.action.type === "apply-filter") {
      applyPluginFilter(plugin)
      return
    }
    if (command.action.type === "post-message") {
      dispatchPhotoshopEvent("ps-plugin-panel-command", { pluginId: plugin.id, commandId: command.id, message: command.action.message })
      logRuntime(`Sent ${command.title} to ${plugin.name}`)
      return
    }
    if (command.action.type === "batch-play") {
      dispatchPhotoshopEvent("ps-plugin-panel-command", {
        pluginId: plugin.id,
        commandId: command.id,
        message: { runtime: "action", descriptors: command.action.descriptors },
      })
      logRuntime(`Queued ${command.title} Action Manager descriptors for ${plugin.name}`)
      return
    }
    dispatchPhotoshopEvent("ps-plugin-panel-command", {
      pluginId: plugin.id,
      commandId: command.id,
      message: { runtime: "cep", source: command.action.source },
    })
    logRuntime(`Queued ${command.title} CEP script for ${plugin.name}`)
  }, [applyPluginFilter, logRuntime])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-run-plugin-command", (detail) => {
      const plugin = plugins.find((item) => item.id === detail?.pluginId)
      const command = plugin?.commands?.find((item) => item.id === detail?.commandId)
      if (plugin && command) runPluginCommand(plugin, command)
    })
  }, [plugins, runPluginCommand])

  const stageInstall = React.useCallback((nextPlugins: PluginDescriptor[], sourceLabel: string, assets: AssetLibraryItem[] = []) => {
    setPendingInstall({ plugins: nextPlugins, assets, sourceLabel })
  }, [])

  const addSamples = () => {
    if (!activeDoc) return
    stageInstall(SAMPLE_PLUGINS.map((plugin, index) => clonePluginForInstall(plugin, index, "sample")), "Sample plugins")
  }

  const installPending = () => {
    if (!activeDoc || !pendingInstall?.plugins.length) return
    const installed = pendingInstall.plugins
    setPlugins([...installed, ...plugins])
    setSelectedId(installed[0]?.id ?? "")
    const pluginAssets: AssetLibraryItem[] = installed.map((plugin) => ({
      id: uid("asset"),
      name: plugin.name,
      kind: "plugin" as const,
      group: "Plugins",
      payload: plugin,
      createdAt: Date.now(),
    }))
    dispatch({
      type: "set-asset-library",
      assets: [...pluginAssets, ...pendingInstall.assets, ...(activeDoc.assetLibrary ?? [])],
    })
    setPendingInstall(null)
    toast.success(`${installed.length} plugin${installed.length === 1 ? "" : "s"} installed`)
  }

  const importPlugin = async (file: File) => {
    if (!activeDoc) return
    assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.jsonBytes, "Plugin manifest or package file")
    if (/\.8bf$/i.test(file.name)) {
      const plugin = normalizeNativeEightBfPlugin(await file.arrayBuffer(), {
        fileName: file.name,
        now: Date.now(),
        makeId: () => uid("plugin"),
      })
      stageInstall([plugin], file.name)
      return
    }
    const parsed: unknown = JSON.parse(await file.text())
    const imported = normalizePluginPackagePayload(parsed, {
      fileSizeBytes: file.size,
      now: Date.now(),
      makeId: () => uid("plugin"),
    })
    stageInstall(imported.plugins.map((plugin) => ({ ...plugin, source: imported.assets.length ? "package" : "import" })), file.name, imported.assets)
  }

  const exportPlugins = (scope: "selected" | "all") => {
    const chosen = scope === "selected" && selected ? [selected] : plugins
    if (!chosen.length) return
    downloadText(
      JSON.stringify(buildPluginExportPayload(chosen), null, 2),
      scope === "selected" && selected ? `${selected.name}.psplugin.json` : "photoshop-web-plugins.psplugin.json",
      "application/json",
    )
  }

  const exportPluginPackage = () => {
    const chosen = selected ? [selected] : plugins
    if (!chosen.length || !activeDoc) return
    const packageAssets = (activeDoc.assetLibrary ?? []).filter((asset) =>
      asset.kind === "plugin" ||
      asset.kind === "cloud-library" ||
      asset.kind === "stock" ||
      asset.kind === "font" ||
      asset.kind === "swatch",
    )
    downloadText(
      JSON.stringify(buildPluginPackagePayload(chosen, { assets: packageAssets }), null, 2),
      selected ? `${selected.name}.psplugin.json` : "photoshop-web-plugin-package.psplugin.json",
      "application/json",
    )
  }

  const registryPlugins = SAMPLE_PLUGINS

  const toggleSelectedEnabled = () => {
    if (!selected) return
    setPlugins(plugins.map((plugin) => plugin.id === selected.id ? { ...plugin, enabled: !plugin.enabled } : plugin))
  }

  const removeSelected = () => {
    if (!selected || !activeDoc) return
    const next = plugins.filter((plugin) => plugin.id !== selected.id)
    setPlugins(next)
    setSelectedId(next[0]?.id ?? "")
  }

  if (!activeDoc) return <EmptyState text="Open a document before installing plugins." />

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="grid content-start gap-4">
        <Panel title="Installed Local Plugins">
          <CapabilityNotice>
            Browser-safe UXP and CEP adapters are available through sandboxed panels, manifest permissions, CSInterface/evalScript shims, Action Manager batchPlay descriptors, and local 8BF kernel execution. Native 8BF binaries import as metadata unless paired with a safe kernel or WebAssembly adapter.
          </CapabilityNotice>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={addSamples}>Review Samples</Button>
            <FileButton accept=".json,.psplugin,.psplugin.json,.8bf,application/json" label="Import Manifest / 8BF" onFile={importPlugin} />
            <Button size="sm" variant="secondary" disabled={!selected} onClick={() => exportPlugins("selected")}>Export Selected</Button>
            <Button size="sm" variant="secondary" disabled={!plugins.length} onClick={() => exportPlugins("all")}>Export All</Button>
            <Button className="col-span-2" size="sm" variant="secondary" disabled={!selected && !plugins.length} onClick={exportPluginPackage}>Export Package</Button>
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
            {plugins.map((plugin) => (
              <button key={plugin.id} type="button" onClick={() => setSelectedId(plugin.id)} className={`grid w-full grid-cols-[1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-left text-[11px] ${selected?.id === plugin.id ? "bg-[var(--ps-tool-active)]" : "hover:bg-[var(--ps-tool-hover)]"}`}>
                <span className="min-w-0">
                  <span className="block truncate">{plugin.name}</span>
                  <span className="block truncate text-[var(--ps-text-dim)]">
                    {(plugin.commands?.length ?? 0)} command{plugin.commands?.length === 1 ? "" : "s"} - {(plugin.permissions ?? []).length} permission{plugin.permissions?.length === 1 ? "" : "s"} - {plugin.enabled ? "enabled" : "disabled"}
                  </span>
                </span>
                <span className="text-[var(--ps-text-dim)]">{plugin.kind}</span>
              </button>
            ))}
            {!plugins.length ? <div className="p-3 text-[12px] text-[var(--ps-text-dim)]">No plugins installed.</div> : null}
          </div>
          {selected ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={toggleSelectedEnabled}>
                {selected.enabled ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="destructive" onClick={removeSelected}>Remove</Button>
            </div>
          ) : null}
        </Panel>

        <Panel title="Local Plugin Registry">
          <div className="space-y-2">
            {registryPlugins.map((plugin, index) => {
              const review = pluginInstallReview(plugin)
              const installed = plugins.some((item) => item.name === plugin.name)
              return (
                <div key={plugin.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2 text-[11px]">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{plugin.name}</div>
                      <div className="text-[10px] text-[var(--ps-text-dim)]">{plugin.kind} - {review.capabilities.join(", ") || "Manifest descriptor"}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={installed}
                      aria-label={installed ? undefined : `Review install for ${plugin.name}`}
                      onClick={() => stageInstall([clonePluginForInstall(plugin, index, "registry")], "Local registry")}
                    >
                      {installed ? "Installed" : "Review"}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        {pendingInstall ? (
          <Panel title="Permission review">
            <div className="space-y-3 text-[11px]">
              <div className="text-[var(--ps-text-dim)]">
                {pendingInstall.sourceLabel}: {pendingInstall.plugins.length} plugin{pendingInstall.plugins.length === 1 ? "" : "s"}
                {pendingInstall.assets.length ? ` and ${pendingInstall.assets.length} library asset${pendingInstall.assets.length === 1 ? "" : "s"}` : ""}
              </div>
              {pendingInstall.plugins.map((plugin) => {
                const review = pluginInstallReview(plugin)
                return (
                  <div key={plugin.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2">
                    <div className="font-medium">{review.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {review.capabilities.map((capability) => (
                        <span key={capability} className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text-dim)]">{capability}</span>
                      ))}
                    </div>
                    <div className="mt-2 space-y-1">
                      {review.permissions.length ? review.permissions.map((permission) => (
                        <div key={permission.id}>
                          <span>{permission.label}</span>
                          <span className="block text-[10px] text-[var(--ps-text-dim)]">{permission.description}</span>
                        </div>
                      )) : <span className="text-[var(--ps-text-dim)]">No privileged host permissions requested.</span>}
                    </div>
                  </div>
                )
              })}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={installPending}>Install reviewed plugin</Button>
                <Button size="sm" variant="secondary" onClick={() => setPendingInstall(null)}>Cancel</Button>
              </div>
            </div>
          </Panel>
        ) : null}
      </div>
      <Panel title="Plugin Runtime">
        {selected ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{selected.name}</div>
                  <div className="text-[11px] text-[var(--ps-text-dim)]">
                    {PLUGIN_MANIFEST_FORMAT} - {selected.version ?? "unversioned"} - {selected.enabled ? "enabled" : "disabled"}
                  </div>
                </div>
                <Button size="sm" variant="secondary" aria-label="Toggle selected plugin" onClick={toggleSelectedEnabled}>
                  {selected.enabled ? "Disable" : "Enable"}
                </Button>
                <Button size="sm" variant="destructive" onClick={removeSelected}>Remove</Button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {selected.kind === "8bf-filter" ? (
                  <Button size="sm" disabled={!activeLayer || !canPluginUsePermission(selected, "filters:write")} onClick={() => applyPluginFilter(selected)}>
                    Apply Kernel to Active Layer
                  </Button>
                ) : null}
                {(selected.commands ?? []).map((command) => (
                  <Button key={command.id} size="sm" variant="secondary" onClick={() => runPluginCommand(selected, command)}>
                    {command.title}
                  </Button>
                ))}
              </div>

              {selected.panelHtml ? (
                <PluginIframeRuntime
                  plugin={selected}
                  activeDoc={activeDoc}
                  activeLayer={activeLayer ?? null}
                  storage={activeDoc.pluginStorage ?? {}}
                  dispatch={dispatch}
                  commit={commit}
                  requestRender={requestRender}
                  applyPluginFilter={applyPluginFilter}
                  runPluginCommand={runPluginCommand}
                  onUiTree={setHostUi}
                  onLog={logRuntime}
                />
              ) : (
                <div className="mt-3 rounded-sm border border-[var(--ps-divider)] p-3 text-[12px] text-[var(--ps-text-dim)]">
                  This plugin does not declare a panel. Use its manifest commands or import a plugin with `panelHtml`.
                </div>
              )}

              {hostUi ? (
                <div className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-bg)] p-3">
                  <div className="mb-2 text-[11px] uppercase text-[var(--ps-text-dim)]">Host-rendered plugin UI</div>
                  <PluginUiRenderer
                    node={hostUi}
                    onEvent={(event) => dispatchPhotoshopEvent("ps-plugin-host-ui-event", { pluginId: selected.id, event })}
                  />
                </div>
              ) : null}
            </div>

            <div className="grid min-w-0 content-start gap-3 text-[11px]">
              <div className="rounded-sm border border-[var(--ps-divider)]">
                <div className="border-b border-[var(--ps-divider)] px-2 py-1.5 font-medium">Permissions</div>
                {Object.entries(PLUGIN_PERMISSION_LABELS).map(([permission, label]) => {
                  const allowed = canPluginUsePermission(selected, permission as PluginPermission)
                  return (
                    <div key={permission} className="border-b border-[var(--ps-divider)] px-2 py-1.5 last:border-b-0">
                      <div className={allowed ? "text-[var(--ps-text)]" : "text-[var(--ps-text-dim)]"}>{allowed ? "Granted" : "Denied"} - {label}</div>
                      <div className="text-[10px] text-[var(--ps-text-dim)]">{PLUGIN_PERMISSION_DESCRIPTIONS[permission as PluginPermission]}</div>
                    </div>
                  )
                })}
              </div>
              <div className="rounded-sm border border-[var(--ps-divider)]">
                <div className="border-b border-[var(--ps-divider)] px-2 py-1.5 font-medium">Storage Namespace</div>
                <pre className="max-h-44 overflow-auto p-2 text-[10px] text-[var(--ps-text-dim)]">{JSON.stringify(activeDoc.pluginStorage?.[selected.id] ?? {}, null, 2)}</pre>
              </div>
              <div className="rounded-sm border border-[var(--ps-divider)]">
                <div className="border-b border-[var(--ps-divider)] px-2 py-1.5 font-medium">Runtime Log</div>
                {runtimeLog.length ? runtimeLog.map((line, index) => <div key={`${line}-${index}`} className="border-b border-[var(--ps-divider)] px-2 py-1.5 last:border-b-0">{line}</div>) : <div className="px-2 py-2 text-[var(--ps-text-dim)]">No runtime events yet.</div>}
              </div>
            </div>
          </div>
        ) : <EmptyState text="Install or import a plugin manifest." />}
      </Panel>
    </div>
  )
}

function PluginIframeRuntime({
  plugin,
  activeDoc,
  activeLayer,
  storage,
  dispatch,
  commit,
  requestRender,
  applyPluginFilter,
  runPluginCommand,
  onUiTree,
  onLog,
}: {
  plugin: PluginDescriptor
  activeDoc: PsDocument
  activeLayer: Layer | null
  storage: Record<string, Record<string, unknown>>
  dispatch: ReturnType<typeof useEditor>["dispatch"]
  commit: ReturnType<typeof useEditor>["commit"]
  requestRender: ReturnType<typeof useEditor>["requestRender"]
  applyPluginFilter: (plugin: PluginDescriptor) => void
  runPluginCommand: (plugin: PluginDescriptor, command: PluginCommandDescriptor) => void
  onUiTree: (tree: PluginUiNode | null) => void
  onLog: (message: string) => void
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const seenRequestIdsRef = React.useRef<Set<string>>(new Set())
  const [token, setToken] = React.useState(() => uid("plugintoken"))
  const [runtimeState, setRuntimeState] = React.useState<"booting" | "ready" | "error">("booting")
  const [reloadKey, setReloadKey] = React.useState(0)
  React.useEffect(() => {
    seenRequestIdsRef.current.clear()
    setToken(uid("plugintoken"))
    setRuntimeState("booting")
    onUiTree(null)
  }, [onUiTree, plugin.id, reloadKey])

  const srcDoc = React.useMemo(
    () => buildPluginIframeSrcDoc({ pluginId: plugin.id, token, html: plugin.panelHtml }),
    [plugin.id, plugin.panelHtml, token],
  )

  const sendUiEvent = React.useCallback((event: Record<string, unknown>) => {
    postPluginUiEvent(iframeRef.current, plugin, event)
  }, [plugin])

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const request = validatePluginPanelRequest(event.data, {
        pluginId: plugin.id,
        token,
        source: iframeRef.current?.contentWindow ?? null,
        eventSource: event.source,
        seenRequestIds: seenRequestIdsRef.current,
      })
      if (!request) return
      const required = permissionForPanelMethod(request.method)
      if (required && !canPluginUsePermission(plugin, required)) {
        postPluginResponse(iframeRef.current, plugin, request.requestId, {
          ok: false,
          error: `Permission denied: ${PLUGIN_PERMISSION_LABELS[required]}`,
        })
        return
      }
      try {
        if (request.method === "plugin.ready") {
          setRuntimeState("ready")
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: describePluginHostCapabilities(),
          })
          onLog(`${plugin.name} panel ready`)
          return
        }
        if (request.method === "host.getInfo") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: {
              ...describePluginHostCapabilities(),
              activeDocument: {
                id: activeDoc.id,
                name: activeDoc.name,
                width: activeDoc.width,
                height: activeDoc.height,
                colorMode: activeDoc.colorMode,
                bitDepth: activeDoc.bitDepth,
              },
              plugin: {
                id: plugin.id,
                name: plugin.name,
                kind: plugin.kind,
                runtimeAdapters: plugin.runtimeAdapters ?? [],
              },
            },
          })
          onLog(`${plugin.name} read host info`)
          return
        }
        if (request.method === "document.getInfo") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: {
              id: activeDoc.id,
              name: activeDoc.name,
              width: activeDoc.width,
              height: activeDoc.height,
              colorMode: activeDoc.colorMode,
              bitDepth: activeDoc.bitDepth,
              layerCount: activeDoc.layers.length,
              activeLayerId: activeDoc.activeLayerId,
            },
          })
          onLog(`${plugin.name} read document info`)
          return
        }
        if (request.method === "layers.getActive") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: summarizeRuntimeLayer(activeLayer),
          })
          onLog(`${plugin.name} read active layer`)
          return
        }
        if (request.method === "layers.create") {
          const params = runtimeRecord(request.params)
          const layer = createRuntimeLayer(activeDoc, params)
          dispatch({ type: "add-layer", layer })
          requestRender()
          window.setTimeout(() => commit("Plugin Create Layer", [layer.id]), 0)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: summarizeRuntimeLayer(layer) })
          onLog(`${plugin.name} created layer ${layer.name}`)
          return
        }
        if (request.method === "layers.update") {
          const params = runtimeRecord(request.params)
          const patch = runtimeRecord(params.patch)
          const target = resolveRuntimeLayer(activeDoc, activeLayer, params.id)
          if (!target) throw new Error("No target layer is available.")
          if (typeof patch.name === "string") dispatch({ type: "rename-layer", id: target.id, name: runtimeStringArg(patch.name, target.name) })
          if (typeof patch.opacity === "number") dispatch({ type: "set-layer-opacity", id: target.id, opacity: runtimeNumberArg(patch.opacity, target.opacity, 0, 1) })
          if (typeof patch.visible === "boolean") dispatch({ type: "set-layer-visibility", id: target.id, visible: patch.visible })
          requestRender()
          window.setTimeout(() => commit("Plugin Update Layer", [target.id]), 0)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: { ok: true, layerId: target.id } })
          onLog(`${plugin.name} updated layer ${target.name}`)
          return
        }
        if (request.method === "action.batchPlay") {
          const params = runtimeRecord(request.params)
          const descriptors = normalizePluginActionDescriptors(params.descriptors)
          const missing = permissionsForPluginActionDescriptors(descriptors).filter((permission) => !canPluginUsePermission(plugin, permission))
          if (missing.length) throw new Error(`Permission denied: ${PLUGIN_PERMISSION_LABELS[missing[0]]}`)
          const result = runPluginActionDescriptors({ descriptors, activeDoc, activeLayer, dispatch, requestRender, commit })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result })
          onLog(`${plugin.name} ran ${descriptors.length} Action Manager descriptor${descriptors.length === 1 ? "" : "s"}`)
          return
        }
        if (request.method === "uxp.executeAsModal") {
          const params = runtimeRecord(request.params)
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: {
              commandName: runtimeStringArg(params.commandName, "Plugin Modal Command"),
              modalBehavior: "browser-cooperative",
              cancelled: false,
            },
          })
          onLog(`${plugin.name} entered browser-safe modal scope`)
          return
        }
        if (request.method === "cep.evalScript") {
          const params = runtimeRecord(request.params)
          const source = runtimeStringArg(params.source, "")
          const result = runCepSafeScript({ source, activeDoc, activeLayer, dispatch, requestRender, commit })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: result.result })
          onLog(`${plugin.name} ran CEP evalScript (${result.commands} command${result.commands === 1 ? "" : "s"})`)
          return
        }
        if (request.method === "cep.dispatchEvent") {
          dispatchPhotoshopEvent("ps-plugin-cep-event", { pluginId: plugin.id, event: safePluginJson(request.params) })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          onLog(`${plugin.name} dispatched CEP event`)
          return
        }
        if (request.method === "8bf.getInfo") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: describeNativeEightBfCompatibility(plugin) })
          return
        }
        if (request.method === "8bf.run") {
          if (!activeLayer) throw new Error("No active layer is available.")
          const compatibility = describeNativeEightBfCompatibility(plugin)
          if (!compatibility.executable) throw new Error(compatibility.reason)
          applyPluginFilter(plugin)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: compatibility })
          return
        }
        if (request.method === "storage.keys") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: Object.keys(storage[plugin.id] ?? {}) })
          return
        }
        if (request.method === "storage.get") {
          const key = isImportRecord(request.params) && typeof request.params.key === "string" ? request.params.key : ""
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: (storage[plugin.id] ?? {})[key] })
          return
        }
        if (request.method === "storage.set") {
          const key = isImportRecord(request.params) && typeof request.params.key === "string" ? request.params.key : ""
          const value = isImportRecord(request.params) ? request.params.value : undefined
          const next = createPluginStoragePatch(storage, plugin.id, { operation: "set", key, value })
          dispatch({ type: "set-plugin-storage", pluginStorage: next })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: next[plugin.id]?.[key] })
          onLog(`${plugin.name} wrote storage:${key}`)
          return
        }
        if (request.method === "storage.remove") {
          const key = isImportRecord(request.params) && typeof request.params.key === "string" ? request.params.key : ""
          const next = createPluginStoragePatch(storage, plugin.id, { operation: "remove", key })
          dispatch({ type: "set-plugin-storage", pluginStorage: next })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          return
        }
        if (request.method === "storage.clear") {
          const next = createPluginStoragePatch(storage, plugin.id, { operation: "clear" })
          dispatch({ type: "set-plugin-storage", pluginStorage: next })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          return
        }
        if (request.method === "commands.run") {
          const commandId = isImportRecord(request.params) && typeof request.params.id === "string" ? request.params.id : ""
          const command = plugin.commands?.find((item) => item.id === commandId)
          if (!command) throw new Error("Command is not declared in the manifest.")
          runPluginCommand(plugin, command)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          return
        }
        if (request.method === "ui.render") {
          const tree = normalizePluginUiTree(isImportRecord(request.params) ? request.params.tree : null)
          onUiTree(tree)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: !!tree })
          onLog(`${plugin.name} rendered host UI`)
          return
        }
        if (request.method === "ui.toast") {
          const message = isImportRecord(request.params) ? cleanImportText(request.params.message, "Plugin message", 180) : "Plugin message"
          toast.info(message)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
        }
      } catch (error) {
        setRuntimeState("error")
        postPluginResponse(iframeRef.current, plugin, request.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : "Plugin request failed",
        })
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [activeDoc, activeLayer, applyPluginFilter, commit, dispatch, onLog, onUiTree, plugin, requestRender, runPluginCommand, storage, token])

  React.useEffect(() => {
    const commandHandler = (detail: { pluginId?: string; commandId?: string; message?: unknown }) => {
      if (detail?.pluginId !== plugin.id) return
      sendUiEvent({ componentId: "manifest-command", event: "command", commandId: detail.commandId, message: detail.message })
    }
    const uiHandler = (detail: { pluginId?: string; event?: unknown }) => {
      if (detail?.pluginId !== plugin.id || !isImportRecord(detail.event)) return
      sendUiEvent(detail.event)
    }
    const removeCommand = addPhotoshopEventListener("ps-plugin-panel-command", commandHandler)
    const removeUi = addPhotoshopEventListener("ps-plugin-host-ui-event", uiHandler)
    return () => {
      removeCommand()
      removeUi()
    }
  }, [plugin.id, sendUiEvent])

  return (
    <div className="mt-3 overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[#171717]">
      <div className="flex h-8 items-center border-b border-[var(--ps-divider)] px-2 text-[10px] text-[var(--ps-text-dim)]">
        <span>Sandbox runtime: {runtimeState}</span>
        <Button className="ml-auto h-6 px-2 text-[10px]" size="sm" variant="ghost" onClick={() => setReloadKey((value) => value + 1)}>
          Reload
        </Button>
      </div>
      <iframe
        key={`${plugin.id}-${token}`}
        ref={iframeRef}
        title={plugin.name}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={() => setRuntimeState("booting")}
        className="h-72 w-full bg-[#171717]"
      />
    </div>
  )
}

function PluginUiRenderer({ node, onEvent }: { node: PluginUiNode; onEvent: (event: Record<string, unknown>) => void }) {
  if (node.type === "stack" || node.type === "row") {
    return (
      <div className={node.type === "row" ? "flex flex-wrap items-center gap-2" : "grid gap-2"}>
        {(node.children ?? []).map((child, index) => <PluginUiRenderer key={child.id ?? index} node={child} onEvent={onEvent} />)}
      </div>
    )
  }
  if (node.type === "text") {
    const tone = node.tone ?? "normal"
    return <div className={`text-[12px] ${tone === "muted" ? "text-[var(--ps-text-dim)]" : tone === "strong" ? "font-medium" : tone === "danger" ? "text-red-300" : ""}`}>{node.text}</div>
  }
  if (node.type === "badge") {
    return <span className="inline-flex w-fit rounded-sm border border-[var(--ps-divider)] px-2 py-0.5 text-[10px] text-[var(--ps-text-dim)]">{node.label}</span>
  }
  if (node.type === "button") {
    return (
      <Button
        size="sm"
        variant={node.variant === "danger" ? "destructive" : node.variant === "secondary" ? "secondary" : "default"}
        onClick={() => onEvent({ componentId: node.id, event: "click", action: node.action })}
      >
        {node.label}
      </Button>
    )
  }
  if (node.type === "input") {
    return (
      <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">
        {node.label ? <span>{node.label}</span> : null}
        <Input
          defaultValue={node.value ?? ""}
          placeholder={node.placeholder}
          className="h-8"
          onChange={(event) => onEvent({ componentId: node.id, event: "change", value: event.currentTarget.value })}
        />
      </label>
    )
  }
  if (node.type === "meter") {
    const max = node.max ?? 100
    const pct = Math.max(0, Math.min(100, (node.value / max) * 100))
    return (
      <div className="grid gap-1">
        {node.label ? <div className="text-[11px] text-[var(--ps-text-dim)]">{node.label}</div> : null}
        <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--ps-tool-hover)]">
          <div className="h-full bg-[var(--ps-accent)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  return <div className="h-px bg-[var(--ps-divider)]" />
}
