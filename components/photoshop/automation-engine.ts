import { FILTERS } from "./filters"
import type { BrowserRasterExportFormat } from "./document-io"
import type { BrushSettings, Layer, ToolId } from "./types"
import { uid } from "./uid"

export type AutomationOperation =
  | "none"
  | "auto-tone"
  | "auto-contrast"
  | "auto-color"
  | "equalize"
  | "hdr-toning"
  | "invert"
  | "grayscale"
  | "desaturate"

export type AutomationStep =
  | { id: string; type: "operation"; operation: AutomationOperation }
  | { id: string; type: "filter"; filterId: string; params?: Record<string, number | string | boolean> }
  | { id: string; type: "resize"; maxWidth: number; maxHeight: number }
  | { id: string; type: "script"; source: string }
  | { id: string; type: "action"; actionId: string }

export interface AutomationOutputPreset {
  format: BrowserRasterExportFormat
  quality: number
  transparent: boolean
  matte: string
  filenameTemplate: string
}

export interface AutomationWorkflow {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  steps: AutomationStep[]
  output: AutomationOutputPreset
}

export interface CommandMacro {
  id: string
  name: string
  source: string
  createdAt: number
  updatedAt: number
}

export type SafeDslCommand = { method: string; args: unknown[]; lineNumber: number }

export const COMMAND_MACROS_STORAGE_KEY = "ps-command-macros-v1"
export const AUTOMATION_WORKFLOWS_STORAGE_KEY = "ps-automation-workflows-v1"

export const RASTER_AUTOMATION_FORMATS: BrowserRasterExportFormat[] = ["jpeg", "png", "webp", "gif", "avif"]

export const DEFAULT_AUTOMATION_OUTPUT: AutomationOutputPreset = {
  format: "png",
  quality: 0.92,
  transparent: true,
  matte: "#ffffff",
  filenameTemplate: "{{name}}-{{workflow}}-{{index}}",
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const DATA_URL_IMAGE = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i
const SAFE_METHOD = /^[A-Za-z][A-Za-z0-9_]*$/
const MAX_SCRIPT_CHARS = 4_000
const MAX_SCRIPT_LINES = 120
const MAX_ROWS = 2_000
const MAX_COLUMNS = 120
const MAX_CELL_CHARS = 20_000
const MAX_WORKFLOW_STEPS = 80
const MAX_WORKFLOWS = 100
const MAX_MACROS = 100
const MAX_NAME_CHARS = 120

export const SAFE_DSL_METHODS = new Set([
  "applyFilter",
  "autoColor",
  "autoContrast",
  "autoTone",
  "createAdjustment",
  "desaturate",
  "equalize",
  "grayscale",
  "hdrToning",
  "invert",
  "newLayer",
  "renameActiveLayer",
  "report",
  "reportActiveLayer",
  "reportDocument",
  "resize",
  "setBackground",
  "setBrush",
  "setForeground",
  "setLayerOpacity",
  "setLayerVisibility",
  "setTool",
])

const TOOL_IDS = new Set<ToolId>([
  "move",
  "marquee-rect",
  "marquee-ellipse",
  "marquee-row",
  "marquee-col",
  "lasso",
  "lasso-polygon",
  "lasso-magnetic",
  "magic-wand",
  "quick-selection",
  "object-select",
  "refine-edge-brush",
  "crop",
  "perspective-crop",
  "slice",
  "slice-select",
  "frame",
  "eyedropper",
  "ruler",
  "note",
  "count",
  "color-sampler",
  "red-eye",
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
  "freeform-pen",
  "curvature-pen",
  "add-anchor-point",
  "delete-anchor-point",
  "convert-point",
  "type",
  "type-vertical",
  "type-mask-horizontal",
  "type-mask-vertical",
  "path-select",
  "direct-select",
  "shape-rect",
  "shape-rounded-rect",
  "shape-ellipse",
  "shape-polygon",
  "shape-triangle",
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
  "material-eyedropper",
  "material-drop",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function cleanName(value: unknown, fallback: string, limit = MAX_NAME_CHARS) {
  const next = (typeof value === "string" ? value : "").trim().slice(0, limit)
  return next || fallback
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, next))
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

export function cleanHexColor(color: unknown) {
  if (typeof color !== "string" || !HEX_COLOR.test(color)) throw new Error("Colors must use #RRGGBB format.")
  return color
}

export function cleanBrushPatch(brush: unknown): Partial<BrushSettings> {
  if (!isRecord(brush)) throw new Error("Brush settings must be an object.")
  const patch: Partial<BrushSettings> = {}
  if ("size" in brush) patch.size = Math.round(finiteNumber(brush.size, 1, 1, 500))
  if ("hardness" in brush) patch.hardness = Math.round(finiteNumber(brush.hardness, 0, 0, 100))
  if ("opacity" in brush) patch.opacity = Math.round(finiteNumber(brush.opacity, 100, 0, 100))
  if ("flow" in brush) patch.flow = Math.round(finiteNumber(brush.flow, 100, 0, 100))
  if ("smoothing" in brush) patch.smoothing = Math.round(finiteNumber(brush.smoothing, 0, 0, 100))
  if ("spacing" in brush) patch.spacing = Math.round(finiteNumber(brush.spacing, 1, 1, 400))
  return patch
}

function validateJsonValue(value: unknown, context: string, depth = 0): void {
  if (depth > 8) throw new Error(`${context} is nested too deeply.`)
  if (value === null || value === undefined || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${context} must contain finite numbers.`)
    return
  }
  if (typeof value === "string") {
    if (value.length > MAX_CELL_CHARS) throw new Error(`${context} string is too large.`)
    if (/^javascript:/i.test(value.trim())) throw new Error(`${context} contains an unsafe URL.`)
    if (/^data:/i.test(value.trim()) && !DATA_URL_IMAGE.test(value.trim())) throw new Error(`${context} contains an unsafe data URL.`)
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLUMNS) throw new Error(`${context} array is too large.`)
    value.forEach((item, index) => validateJsonValue(item, `${context}[${index}]`, depth + 1))
    return
  }
  if (!isRecord(value)) throw new Error(`${context} contains unsupported data.`)
  const entries = Object.entries(value)
  if (entries.length > MAX_COLUMNS) throw new Error(`${context} has too many fields.`)
  entries.forEach(([key, child]) => validateJsonValue(child, `${context}.${key}`, depth + 1))
}

function normalizeCell(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value.slice(0, MAX_CELL_CHARS)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value).slice(0, MAX_CELL_CHARS)
}

export function parseCsvRows(text: string): Record<string, string>[] {
  if (text.length > 1_500_000) throw new Error("CSV files are limited to 1.5 MB.")
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' && text[i + 1] === '"') {
      cell += '"'
      i++
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === "," && !quoted) {
      row.push(cell)
      cell = ""
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ""
      if (rows.length > MAX_ROWS + 1) throw new Error(`Data sets are limited to ${MAX_ROWS} rows.`)
    } else {
      cell += ch
      if (cell.length > MAX_CELL_CHARS) throw new Error("CSV cells are too large.")
    }
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  const headers = (rows.shift() ?? []).map((value) => value.trim()).filter(Boolean).slice(0, MAX_COLUMNS)
  if (!headers.length) return []
  return rows.slice(0, MAX_ROWS).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").slice(0, MAX_CELL_CHARS)])),
  )
}

export function parseAutomationDataRows(text: string, filename = "rows.csv"): Record<string, string>[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".json") || text.trim().startsWith("[") || text.trim().startsWith("{")) {
    const parsed: unknown = JSON.parse(text)
    const rawRows = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.rows : null
    if (!Array.isArray(rawRows)) throw new Error("JSON data set must be an array or an object with a rows array.")
    if (rawRows.length > MAX_ROWS) throw new Error(`Data sets are limited to ${MAX_ROWS} rows.`)
    return rawRows.map((row, rowIndex) => {
      if (!isRecord(row)) throw new Error(`Row ${rowIndex + 1} must be an object.`)
      validateJsonValue(row, `Row ${rowIndex + 1}`)
      return Object.fromEntries(Object.entries(row).slice(0, MAX_COLUMNS).map(([key, value]) => [key, normalizeCell(value)]))
    })
  }
  return parseCsvRows(text)
}

function validateCommand(command: SafeDslCommand) {
  const { method, args, lineNumber } = command
  if (method === "setForeground" || method === "setBackground") cleanHexColor(args[0])
  if (method === "setTool") {
    const tool = stringArg(args[0], "tool")
    if (!TOOL_IDS.has(tool as ToolId)) throw new Error(`Line ${lineNumber}: unknown tool "${tool}".`)
  }
  if (method === "setBrush") cleanBrushPatch(args[0])
  if (method === "setLayerOpacity") {
    stringArg(args[0], "layer id")
    const opacity = numberArg(args[1], "opacity")
    if (opacity < 0 || opacity > 1) throw new Error(`Line ${lineNumber}: opacity must be between 0 and 1.`)
  }
  if (method === "setLayerVisibility") {
    stringArg(args[0], "layer id")
    booleanArg(args[1], "visibility")
  }
  if (method === "renameActiveLayer" || method === "newLayer") stringArg(args[0], "name")
  if (method === "createAdjustment" || method === "applyFilter") {
    const filterId = stringArg(args[0], "filter")
    if (!FILTERS[filterId]) throw new Error(`Line ${lineNumber}: unknown filter "${filterId}".`)
    if (args[1] !== undefined && !isRecord(args[1])) throw new Error(`Line ${lineNumber}: filter params must be an object.`)
  }
  if (method === "resize") {
    const w = numberArg(args[0], "max width")
    const h = numberArg(args[1], "max height")
    if (w < 1 || h < 1 || w > 16384 || h > 16384) throw new Error(`Line ${lineNumber}: resize bounds are invalid.`)
  }
}

export function parseSafeDslCommands(source: string): SafeDslCommand[] {
  if (source.length > MAX_SCRIPT_CHARS) throw new Error(`Scripts are limited to ${MAX_SCRIPT_CHARS} characters.`)
  const lines = source.split(/\r?\n/)
  if (lines.length > MAX_SCRIPT_LINES) throw new Error(`Scripts are limited to ${MAX_SCRIPT_LINES} lines.`)
  const commands: SafeDslCommand[] = []
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return
    const statement = trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed
    const match = /^(?:api\.)?([A-Za-z][A-Za-z0-9_]*)\((.*)\)$/.exec(statement)
    if (!match) throw new Error(`Line ${lineNumber}: use command(JSON arguments) or api.method(JSON arguments) commands only.`)
    const [, method, rawArgs] = match
    if (!SAFE_METHOD.test(method) || !SAFE_DSL_METHODS.has(method)) {
      throw new Error(`Line ${lineNumber}: command "${method}" is not available; use api.method(JSON arguments) commands only.`)
    }
    let args: unknown[]
    try {
      args = rawArgs.trim() ? JSON.parse(`[${rawArgs}]`) : []
    } catch {
      throw new Error(`Line ${lineNumber}: arguments must be JSON literals.`)
    }
    const command = { method, args, lineNumber }
    validateCommand(command)
    commands.push(command)
  })
  return commands
}

function cleanOperation(value: unknown): AutomationOperation {
  const operation = typeof value === "string" ? value : "none"
  if (
    operation === "none" ||
    operation === "auto-tone" ||
    operation === "auto-contrast" ||
    operation === "auto-color" ||
    operation === "equalize" ||
    operation === "hdr-toning" ||
    operation === "invert" ||
    operation === "grayscale" ||
    operation === "desaturate"
  ) {
    return operation
  }
  return "none"
}

function cleanOutput(value: unknown): AutomationOutputPreset {
  const raw = isRecord(value) ? value : {}
  const format = RASTER_AUTOMATION_FORMATS.includes(raw.format as BrowserRasterExportFormat) ? raw.format as BrowserRasterExportFormat : DEFAULT_AUTOMATION_OUTPUT.format
  return {
    format,
    quality: finiteNumber(raw.quality, DEFAULT_AUTOMATION_OUTPUT.quality, 0.1, 1),
    transparent: typeof raw.transparent === "boolean" ? raw.transparent : DEFAULT_AUTOMATION_OUTPUT.transparent,
    matte: HEX_COLOR.test(String(raw.matte ?? "")) ? String(raw.matte) : DEFAULT_AUTOMATION_OUTPUT.matte,
    filenameTemplate: cleanName(raw.filenameTemplate, DEFAULT_AUTOMATION_OUTPUT.filenameTemplate, 160),
  }
}

function cleanStep(value: unknown, index: number): AutomationStep {
  if (!isRecord(value)) throw new Error(`Workflow step ${index + 1} must be an object.`)
  const type = value.type
  const id = cleanName(value.id, uid("step"), 80)
  if (type === "operation") return { id, type, operation: cleanOperation(value.operation) }
  if (type === "filter") {
    const filterId = stringArg(value.filterId, `Workflow step ${index + 1} filter`)
    if (!FILTERS[filterId]) throw new Error(`Workflow step ${index + 1} uses an unknown filter.`)
    if (value.params !== undefined && !isRecord(value.params)) throw new Error(`Workflow step ${index + 1} params must be an object.`)
    return { id, type, filterId, params: value.params as Record<string, number | string | boolean> | undefined }
  }
  if (type === "resize") {
    return {
      id,
      type,
      maxWidth: Math.round(finiteNumber(value.maxWidth, 2048, 1, 16384)),
      maxHeight: Math.round(finiteNumber(value.maxHeight, 2048, 1, 16384)),
    }
  }
  if (type === "script") {
    const source = stringArg(value.source, `Workflow step ${index + 1} script`)
    parseSafeDslCommands(source)
    return { id, type, source }
  }
  if (type === "action") {
    return { id, type, actionId: cleanName(value.actionId, "", 100) }
  }
  throw new Error(`Workflow step ${index + 1} has unsupported type.`)
}

export function parseAutomationWorkflowImportPayload(parsed: unknown): AutomationWorkflow {
  const raw = isRecord(parsed) && parsed.workflow !== undefined ? parsed.workflow : parsed
  if (!isRecord(raw)) throw new Error("Workflow file does not contain a workflow object.")
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : []
  if (!rawSteps.length) throw new Error("Workflow must contain at least one step.")
  if (rawSteps.length > MAX_WORKFLOW_STEPS) throw new Error(`Workflows are limited to ${MAX_WORKFLOW_STEPS} steps.`)
  const createdAt = finiteNumber(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
  return {
    id: cleanName(raw.id, uid("workflow"), 80),
    name: cleanName(raw.name, "Imported Workflow"),
    createdAt,
    updatedAt: finiteNumber(raw.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    steps: rawSteps.map(cleanStep),
    output: cleanOutput(raw.output),
  }
}

export function createAutomationWorkflow(
  name: string,
  steps: AutomationStep[],
  output: Partial<AutomationOutputPreset> = {},
): AutomationWorkflow {
  const now = Date.now()
  return parseAutomationWorkflowImportPayload({
    id: uid("workflow"),
    name,
    createdAt: now,
    updatedAt: now,
    steps,
    output: { ...DEFAULT_AUTOMATION_OUTPUT, ...output },
  })
}

export function renderTemplateName(template: string, row: Record<string, string>, rowIndex: number, extra: Record<string, string> = {}) {
  const raw = template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    if (key === "index") return String(rowIndex + 1).padStart(2, "0")
    return row[key] ?? extra[key] ?? ""
  })
  return safeFilename(raw)
}

export function safeFilename(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 140) || "output"
  )
}

function parseStoredArray(raw: string | null): unknown[] {
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : []
}

export function loadCommandMacros(): CommandMacro[] {
  if (typeof localStorage === "undefined") return []
  try {
    return parseStoredArray(localStorage.getItem(COMMAND_MACROS_STORAGE_KEY)).slice(0, MAX_MACROS).map((item, index) => {
      if (!isRecord(item)) throw new Error("Invalid macro")
      const source = stringArg(item.source, "macro source")
      parseSafeDslCommands(source)
      const createdAt = finiteNumber(item.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
      return {
        id: cleanName(item.id, uid("macro"), 80),
        name: cleanName(item.name, `Macro ${index + 1}`),
        source,
        createdAt,
        updatedAt: finiteNumber(item.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER),
      }
    })
  } catch {
    return []
  }
}

export function saveCommandMacros(macros: CommandMacro[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(COMMAND_MACROS_STORAGE_KEY, JSON.stringify(macros.slice(0, MAX_MACROS)))
}

export function loadAutomationWorkflows(): AutomationWorkflow[] {
  if (typeof localStorage === "undefined") return []
  try {
    return parseStoredArray(localStorage.getItem(AUTOMATION_WORKFLOWS_STORAGE_KEY)).slice(0, MAX_WORKFLOWS).map(parseAutomationWorkflowImportPayload)
  } catch {
    return []
  }
}

export function saveAutomationWorkflows(workflows: AutomationWorkflow[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(AUTOMATION_WORKFLOWS_STORAGE_KEY, JSON.stringify(workflows.slice(0, MAX_WORKFLOWS)))
}

export function macroToWorkflow(macro: CommandMacro, output: Partial<AutomationOutputPreset> = {}): AutomationWorkflow {
  return createAutomationWorkflow(
    macro.name,
    [{ id: uid("step"), type: "script", source: macro.source }],
    { ...DEFAULT_AUTOMATION_OUTPUT, filenameTemplate: "{{name}}-macro-{{index}}", ...output },
  )
}

function filterDefaultParams(filterId: string) {
  const filter = FILTERS[filterId]
  const params: Record<string, number | string | boolean> = {}
  if (!filter) return params
  for (const param of filter.params) params[param.key] = param.default
  return params
}

export function applyImageDataFilter(canvas: HTMLCanvasElement, filterId: string, params?: Record<string, number | string | boolean>) {
  const filter = FILTERS[filterId]
  if (!filter) throw new Error(`Unknown filter: ${filterId}`)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context is unavailable.")
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height)
  ctx.putImageData(filter.apply(source, { ...filterDefaultParams(filterId), ...(params ?? {}) }), 0, 0)
}

export function autoToneCanvas(canvas: HTMLCanvasElement, perChannel: boolean) {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context is unavailable.")
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const mins = [255, 255, 255]
  const maxs = [0, 0, 0]
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    if (perChannel) {
      for (let c = 0; c < 3; c++) {
        mins[c] = Math.min(mins[c], img.data[i + c])
        maxs[c] = Math.max(maxs[c], img.data[i + c])
      }
    } else {
      const v = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
      mins[0] = Math.min(mins[0], v)
      maxs[0] = Math.max(maxs[0], v)
    }
  }
  for (let i = 0; i < img.data.length; i += 4) {
    if (perChannel) {
      for (let c = 0; c < 3; c++) {
        const range = Math.max(1, maxs[c] - mins[c])
        img.data[i + c] = Math.max(0, Math.min(255, ((img.data[i + c] - mins[c]) * 255) / range))
      }
    } else {
      const range = Math.max(1, maxs[0] - mins[0])
      for (let c = 0; c < 3; c++) {
        img.data[i + c] = Math.max(0, Math.min(255, ((img.data[i + c] - mins[0]) * 255) / range))
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

export function autoColorCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context is unavailable.")
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    sumR += img.data[i]
    sumG += img.data[i + 1]
    sumB += img.data[i + 2]
    count++
  }
  if (!count) return
  const gray = (sumR + sumG + sumB) / (3 * count)
  const gains = [gray / Math.max(1, sumR / count), gray / Math.max(1, sumG / count), gray / Math.max(1, sumB / count)]
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.max(0, Math.min(255, img.data[i] * gains[0]))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * gains[1]))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * gains[2]))
  }
  ctx.putImageData(img, 0, 0)
}

export function resizeCanvasToFit(canvas: HTMLCanvasElement, maxWidth: number, maxHeight: number, makeCanvas: (width: number, height: number) => HTMLCanvasElement) {
  const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height, 1)
  if (ratio >= 1) return canvas
  const width = Math.max(1, Math.round(canvas.width * ratio))
  const height = Math.max(1, Math.round(canvas.height * ratio))
  const out = makeCanvas(width, height)
  const ctx = out.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context is unavailable.")
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(canvas, 0, 0, width, height)
  return out
}

export function applyAutomationOperation(canvas: HTMLCanvasElement, operation: AutomationOperation) {
  if (operation === "none") return
  if (operation === "auto-tone") autoToneCanvas(canvas, false)
  else if (operation === "auto-contrast") autoToneCanvas(canvas, true)
  else if (operation === "auto-color") autoColorCanvas(canvas)
  else if (operation === "equalize" || operation === "hdr-toning" || operation === "invert" || operation === "grayscale" || operation === "desaturate") {
    applyImageDataFilter(canvas, operation)
  }
}

export interface CanvasWorkflowContext {
  makeCanvas: (width: number, height: number, fill?: string) => HTMLCanvasElement
  log?: (message: string) => void
}

export async function executeCanvasWorkflow(
  source: HTMLCanvasElement,
  workflow: AutomationWorkflow,
  context: CanvasWorkflowContext,
): Promise<HTMLCanvasElement> {
  let canvas = source
  for (const step of workflow.steps) {
    if (step.type === "operation") applyAutomationOperation(canvas, step.operation)
    else if (step.type === "filter") applyImageDataFilter(canvas, step.filterId, step.params)
    else if (step.type === "resize") canvas = resizeCanvasToFit(canvas, step.maxWidth, step.maxHeight, context.makeCanvas)
    else if (step.type === "script") {
      const commands = parseSafeDslCommands(step.source)
      for (const command of commands) {
        if (command.method === "report") context.log?.(String(command.args[0] ?? "").slice(0, 500))
        else if (command.method === "autoTone") autoToneCanvas(canvas, false)
        else if (command.method === "autoContrast") autoToneCanvas(canvas, true)
        else if (command.method === "autoColor") autoColorCanvas(canvas)
        else if (command.method === "equalize") applyImageDataFilter(canvas, "equalize")
        else if (command.method === "hdrToning") applyImageDataFilter(canvas, "hdr-toning")
        else if (command.method === "invert") applyImageDataFilter(canvas, "invert")
        else if (command.method === "grayscale") applyImageDataFilter(canvas, "grayscale")
        else if (command.method === "desaturate") applyImageDataFilter(canvas, "desaturate")
        else if (command.method === "applyFilter") applyImageDataFilter(canvas, stringArg(command.args[0], "filter"), command.args[1] as Record<string, number | string | boolean> | undefined)
        else if (command.method === "resize") {
          canvas = resizeCanvasToFit(canvas, numberArg(command.args[0], "max width"), numberArg(command.args[1], "max height"), context.makeCanvas)
        }
      }
    } else if (step.type === "action") {
      context.log?.(`Action step "${step.actionId}" is editor-document only and was skipped for raster batch input.`)
    }
  }
  return canvas
}

export function layerMatchesId(layer: Layer, id: string | undefined) {
  return !!id && (id === "active" || layer.id === id || layer.name === id)
}
