// Safe command DSL used by the scripting panel, command macros and
// droplets. The DSL is intentionally narrow: each line is
// `api.method(JSON-arg, JSON-arg, ...)`, with `//` line comments. We
// never `new Function()` or `eval()` user text; every call is dispatched
// by name into a hand-written allow-list. That lets recorded macros be
// persisted to localStorage and replayed across sessions without
// re-introducing the unsafe-script behaviour we already audited away.

import type { FilterDef } from "./filters"
import type {
  AdjustmentType,
  BlendMode,
  BrushSettings,
  Layer,
  PsDocument,
  ToolId,
} from "./types"

const MAX_SCRIPT_CHARS = 8_000
const MAX_SCRIPT_LINES = 300
const MAX_LINE_CHARS = 1_000
const MAX_JSON_ARGS = 6
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

const BLEND_MODES = new Set<BlendMode>([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
])

export const DSL_TOOL_IDS = new Set<ToolId>([
  "move",
  "marquee-rect",
  "marquee-ellipse",
  "marquee-row",
  "marquee-col",
  "lasso",
  "lasso-polygon",
  "lasso-magnetic",
  "magic-wand",
  "object-select",
  "quick-selection",
  "refine-edge-brush",
  "crop",
  "perspective-crop",
  "slice",
  "frame",
  "eyedropper",
  "ruler",
  "note",
  "count",
  "color-sampler",
  "material-eyedropper",
  "material-drop",
  "spot-healing",
  "healing-brush",
  "patch-tool",
  "content-aware-move",
  "brush",
  "pencil",
  "mixer-brush",
  "clone-stamp",
  "history-brush",
  "art-history-brush",
  "eraser",
  "gradient",
  "paint-bucket",
  "blur",
  "sharpen",
  "smudge",
  "dodge",
  "burn",
  "sponge",
  "pen",
  "curvature-pen",
  "type",
  "type-mask-horizontal",
  "type-mask-vertical",
  "path-select",
  "direct-select",
  "shape-rect",
  "shape-ellipse",
  "shape-line",
  "custom-shape",
  "artboard",
  "hand",
  "rotate-view",
  "zoom",
  "transform",
  "select-subject",
  "remove-tool",
  "select-sky",
  "select-background",
  "color-replace",
  "pattern-stamp",
  "magic-eraser",
  "background-eraser",
])

export type DslCommandName =
  | "report"
  | "reportDocument"
  | "reportActiveLayer"
  | "setTool"
  | "setForeground"
  | "setBackground"
  | "setBrush"
  | "newLayer"
  | "renameLayer"
  | "renameActiveLayer"
  | "duplicateLayer"
  | "deleteLayer"
  | "setLayerVisibility"
  | "setLayerOpacity"
  | "setLayerBlendMode"
  | "selectAll"
  | "deselect"
  | "invertSelection"
  | "flattenImage"
  | "createAdjustment"
  | "applyFilter"
  | "applyAdjustment"
  | "commit"
  | "wait"

export const DSL_COMMAND_NAMES: ReadonlySet<DslCommandName> = new Set<DslCommandName>([
  "report",
  "reportDocument",
  "reportActiveLayer",
  "setTool",
  "setForeground",
  "setBackground",
  "setBrush",
  "newLayer",
  "renameLayer",
  "renameActiveLayer",
  "duplicateLayer",
  "deleteLayer",
  "setLayerVisibility",
  "setLayerOpacity",
  "setLayerBlendMode",
  "selectAll",
  "deselect",
  "invertSelection",
  "flattenImage",
  "createAdjustment",
  "applyFilter",
  "applyAdjustment",
  "commit",
  "wait",
])

export const DSL_SNIPPETS: { label: string; code: string }[] = [
  { label: "Rename layer", code: 'api.renameActiveLayer("Retouched Layer")' },
  { label: "Soft brush", code: 'api.setTool("brush")\napi.setBrush({"size":36,"hardness":35,"opacity":85,"flow":70})' },
  { label: "Add contrast", code: 'api.createAdjustment("brightness-contrast")' },
  { label: "Sharpen layer", code: 'api.applyFilter("sharpen")\napi.commit("Sharpen")' },
  { label: "Vibrance boost", code: 'api.applyAdjustment("vibrance",{"vibrance":40,"saturation":10})' },
  { label: "Duplicate active", code: 'api.duplicateLayer("active")\napi.commit("Duplicate")' },
]

export interface DslCommand {
  method: DslCommandName
  args: unknown[]
  lineNumber: number
}

export function parseDslSource(source: string): DslCommand[] {
  if (source.length > MAX_SCRIPT_CHARS) {
    throw new Error(`Scripts are limited to ${MAX_SCRIPT_CHARS} characters.`)
  }
  const lines = source.split(/\r?\n/)
  if (lines.length > MAX_SCRIPT_LINES) {
    throw new Error(`Scripts are limited to ${MAX_SCRIPT_LINES} lines.`)
  }
  const commands: DslCommand[] = []
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    if (rawLine.length > MAX_LINE_CHARS) {
      throw new Error(`Line ${lineNumber}: line is longer than ${MAX_LINE_CHARS} characters.`)
    }
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith("//")) return
    const statement = trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed
    const match = /^api\.([A-Za-z][A-Za-z0-9_]*)\((.*)\)$/.exec(statement)
    if (!match) {
      throw new Error(`Line ${lineNumber}: use api.method(JSON arguments) commands only.`)
    }
    const [, method, rawArgs] = match
    if (!DSL_COMMAND_NAMES.has(method as DslCommandName)) {
      throw new Error(`Line ${lineNumber}: api.${method} is not available.`)
    }
    let args: unknown[]
    try {
      args = rawArgs.trim() ? JSON.parse(`[${rawArgs}]`) : []
    } catch {
      throw new Error(`Line ${lineNumber}: arguments must be JSON literals.`)
    }
    if (args.length > MAX_JSON_ARGS) {
      throw new Error(`Line ${lineNumber}: too many arguments.`)
    }
    commands.push({ method: method as DslCommandName, args, lineNumber })
  })
  return commands
}

export interface DslLayerOpHandle {
  layer: Layer
  doc: PsDocument
}

export interface DslHostApi {
  log: (message: string) => void
  doc: () => PsDocument
  activeLayer: () => Layer | null
  setTool: (tool: ToolId) => void
  setForeground: (color: string) => void
  setBackground: (color: string) => void
  setBrush: (patch: Partial<BrushSettings>) => void
  renameLayer: (id: string, name: string) => void
  newLayer: (name?: string) => string
  duplicateLayer: (id: string) => string | null
  deleteLayer: (id: string) => void
  setLayerVisibility: (id: string, visible: boolean) => void
  setLayerOpacity: (id: string, opacity: number) => void
  setLayerBlendMode: (id: string, mode: BlendMode) => void
  selectAll: () => void
  deselect: () => void
  invertSelection: () => void
  flattenImage: () => void
  createAdjustmentLayer: (type: AdjustmentType) => string
  applyFilterToLayer: (id: string, filter: FilterDef, params: Record<string, number | string | boolean>) => Promise<void> | void
  applyAdjustmentToLayer: (id: string, type: AdjustmentType, params: Record<string, number | string | boolean>) => Promise<void> | void
  resolveFilter: (id: string) => FilterDef | null
  isAdjustmentType: (id: string) => id is AdjustmentType
  requestRender: () => void
  commit: (label: string, layerIds?: "all" | string[]) => void
  wait: (ms: number) => Promise<void>
}

function cleanName(value: unknown, fallback: string) {
  const next = (typeof value === "string" ? value : "").trim().slice(0, 120)
  return next || fallback
}

function cleanColor(color: unknown) {
  if (typeof color !== "string" || !HEX_COLOR.test(color)) {
    throw new Error("Colors must use #RRGGBB format.")
  }
  return color
}

function clamp(value: unknown, min: number, max: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : min
  return Math.max(min, Math.min(max, next))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stringArg(value: unknown, name: string) {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`)
  return value
}

function numberArg(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a number.`)
  return value
}

function booleanArg(value: unknown, name: string) {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`)
  return value
}

function cleanBrushPatch(brush: Record<string, unknown>): Partial<BrushSettings> {
  const patch: Partial<BrushSettings> = {}
  if ("size" in brush) patch.size = Math.round(clamp(brush.size, 1, 500))
  if ("hardness" in brush) patch.hardness = Math.round(clamp(brush.hardness, 0, 100))
  if ("opacity" in brush) patch.opacity = Math.round(clamp(brush.opacity, 0, 100))
  if ("flow" in brush) patch.flow = Math.round(clamp(brush.flow, 0, 100))
  if ("smoothing" in brush) patch.smoothing = Math.round(clamp(brush.smoothing, 0, 100))
  if ("spacing" in brush) patch.spacing = Math.round(clamp(brush.spacing, 1, 400))
  return patch
}

function cleanFilterParams(filter: FilterDef, raw: unknown): Record<string, number | string | boolean> {
  const params: Record<string, number | string | boolean> = {}
  for (const param of filter.params) {
    params[param.key] = param.default
  }
  if (raw === undefined || raw === null) return params
  if (!isRecord(raw)) throw new Error("filter params must be an object.")
  for (const param of filter.params) {
    if (!(param.key in raw)) continue
    const incoming = (raw as Record<string, unknown>)[param.key]
    if (param.type === "slider") {
      if (typeof incoming !== "number" || !Number.isFinite(incoming)) {
        throw new Error(`${param.key} must be a number.`)
      }
      params[param.key] = Math.max(param.min, Math.min(param.max, incoming))
    } else if (param.type === "select") {
      if (typeof incoming !== "string") throw new Error(`${param.key} must be a string.`)
      const allowed = param.options.some((option) => option.value === incoming)
      if (!allowed) throw new Error(`${param.key} must be one of: ${param.options.map((o) => o.value).join(", ")}`)
      params[param.key] = incoming
    } else if (param.type === "checkbox") {
      if (typeof incoming !== "boolean") throw new Error(`${param.key} must be a boolean.`)
      params[param.key] = incoming
    } else if (param.type === "text") {
      if (typeof incoming !== "string") throw new Error(`${param.key} must be a string.`)
      params[param.key] = incoming.slice(0, 4000)
    }
  }
  return params
}

function resolveLayerId(api: DslHostApi, id: unknown): string {
  const requested = stringArg(id, "layer id")
  if (requested === "active") {
    const layer = api.activeLayer()
    if (!layer) throw new Error("No active layer to target.")
    return layer.id
  }
  const doc = api.doc()
  if (!doc.layers.some((layer) => layer.id === requested)) {
    throw new Error(`Unknown layer: ${requested}`)
  }
  return requested
}

export interface RunDslResult {
  commandsRun: number
  logs: string[]
}

export async function runDsl(source: string, api: DslHostApi): Promise<RunDslResult> {
  const commands = parseDslSource(source)
  const logs: string[] = []
  const appendLog = (line: string) => {
    const next = line.slice(0, 500)
    logs.push(next)
    api.log(next)
  }

  for (const command of commands) {
    const [a0, a1, a2] = command.args
    try {
      switch (command.method) {
        case "report":
          appendLog(String(a0 ?? "").slice(0, 500))
          break
        case "reportDocument": {
          const doc = api.doc()
          appendLog(`${doc.name}: ${doc.width} x ${doc.height}px, ${doc.layers.length} layers`)
          break
        }
        case "reportActiveLayer": {
          const layer = api.activeLayer()
          appendLog(layer ? `Active layer: ${layer.name}` : "No active layer")
          break
        }
        case "setTool": {
          const tool = stringArg(a0, "tool")
          if (!DSL_TOOL_IDS.has(tool as ToolId)) throw new Error(`Unknown tool: ${tool}`)
          api.setTool(tool as ToolId)
          break
        }
        case "setForeground":
          api.setForeground(cleanColor(a0))
          break
        case "setBackground":
          api.setBackground(cleanColor(a0))
          break
        case "setBrush": {
          if (!isRecord(a0)) throw new Error("brush must be an object.")
          api.setBrush(cleanBrushPatch(a0))
          break
        }
        case "newLayer": {
          const id = api.newLayer(cleanName(a0, "Script Layer"))
          appendLog(`New layer ${id}`)
          break
        }
        case "renameLayer": {
          const id = resolveLayerId(api, a0)
          api.renameLayer(id, cleanName(a1, "Layer"))
          break
        }
        case "renameActiveLayer": {
          const layer = api.activeLayer()
          if (layer) api.renameLayer(layer.id, cleanName(a0, layer.name))
          break
        }
        case "duplicateLayer": {
          const id = resolveLayerId(api, a0)
          const newId = api.duplicateLayer(id)
          if (newId) appendLog(`Duplicated to ${newId}`)
          break
        }
        case "deleteLayer": {
          const id = resolveLayerId(api, a0)
          api.deleteLayer(id)
          break
        }
        case "setLayerVisibility": {
          const id = resolveLayerId(api, a0)
          api.setLayerVisibility(id, booleanArg(a1, "visible"))
          break
        }
        case "setLayerOpacity": {
          const id = resolveLayerId(api, a0)
          api.setLayerOpacity(id, Math.max(0, Math.min(1, numberArg(a1, "opacity"))))
          break
        }
        case "setLayerBlendMode": {
          const id = resolveLayerId(api, a0)
          const mode = stringArg(a1, "blend mode")
          if (!BLEND_MODES.has(mode as BlendMode)) throw new Error(`Unknown blend mode: ${mode}`)
          api.setLayerBlendMode(id, mode as BlendMode)
          break
        }
        case "selectAll":
          api.selectAll()
          break
        case "deselect":
          api.deselect()
          break
        case "invertSelection":
          api.invertSelection()
          break
        case "flattenImage":
          api.flattenImage()
          break
        case "createAdjustment": {
          const type = stringArg(a0, "adjustment")
          if (!api.isAdjustmentType(type)) throw new Error(`Unknown adjustment: ${type}`)
          const id = api.createAdjustmentLayer(type)
          appendLog(`Created ${type} adjustment ${id}`)
          break
        }
        case "applyFilter": {
          const filterId = stringArg(a0, "filter id")
          const filter = api.resolveFilter(filterId)
          if (!filter) throw new Error(`Unknown filter: ${filterId}`)
          const layer = api.activeLayer()
          if (!layer) throw new Error("Select a layer before applying a filter.")
          const params = cleanFilterParams(filter, a1)
          await Promise.resolve(api.applyFilterToLayer(layer.id, filter, params))
          break
        }
        case "applyAdjustment": {
          const type = stringArg(a0, "adjustment")
          if (!api.isAdjustmentType(type)) throw new Error(`Unknown adjustment: ${type}`)
          const filter = api.resolveFilter(type)
          if (!filter) throw new Error(`Adjustment not available: ${type}`)
          const layer = api.activeLayer()
          if (!layer) throw new Error("Select a layer before applying an adjustment.")
          const params = cleanFilterParams(filter, a1)
          await Promise.resolve(api.applyAdjustmentToLayer(layer.id, type, params))
          break
        }
        case "commit": {
          const label = cleanName(a0, "Script Step")
          const scope = a1 === undefined || a1 === "all"
            ? "all"
            : Array.isArray(a1)
              ? (a1.filter((id) => typeof id === "string") as string[])
              : "all"
          api.commit(label, scope as "all" | string[])
          break
        }
        case "wait": {
          const ms = Math.max(0, Math.min(2000, numberArg(a0, "ms")))
          await api.wait(ms)
          break
        }
        default:
          throw new Error(`Command ${command.method} is not implemented.`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "command failed"
      throw new Error(`Line ${command.lineNumber}: ${message}`)
    }
  }

  api.requestRender()
  return { commandsRun: commands.length, logs }
}

// Validates DSL source without running it, surfacing the parse error to
// the UI before saving a macro.
export function validateDsl(source: string): { ok: true } | { ok: false; error: string } {
  try {
    parseDslSource(source)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid script" }
  }
}
