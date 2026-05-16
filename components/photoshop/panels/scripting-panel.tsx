"use client"

import * as React from "react"
import { useEditor, makeCanvas } from "../editor-context"
import { FILTERS } from "../filters"
import { Textarea } from "@/components/ui/textarea"
import { Code2, Play, RotateCcw, ShieldCheck } from "lucide-react"
import type { AdjustmentType, BrushSettings, Layer, ToolId } from "../types"

const STARTER_SCRIPT = `api.report("Ready")
api.reportDocument()
api.reportActiveLayer()
api.renameActiveLayer("Retouched Layer")
// api.createAdjustment("brightness-contrast")
// api.setForeground("#ff3366")
`

const SCRIPT_SNIPPETS = [
  { label: "Rename layer", code: 'api.renameActiveLayer("Retouched Layer")' },
  { label: "Soft brush", code: 'api.setTool("brush")\napi.setBrush({"size":36,"hardness":35,"opacity":85,"flow":70})' },
  { label: "Add contrast", code: 'api.createAdjustment("brightness-contrast")' },
] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MAX_SCRIPT_LINES = 120

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
  "object-select",
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

const SCRIPT_METHODS = new Set([
  "createAdjustment",
  "newLayer",
  "renameActiveLayer",
  "report",
  "reportActiveLayer",
  "reportDocument",
  "setBackground",
  "setBrush",
  "setForeground",
  "setLayerOpacity",
  "setTool",
])

function validateScript(source: string) {
  if (source.length > 4_000) return "Scripts are limited to 4000 characters."
  if (source.split(/\r?\n/).length > MAX_SCRIPT_LINES) return `Scripts are limited to ${MAX_SCRIPT_LINES} lines.`
  return null
}

function cleanName(value: unknown, fallback: string) {
  const next = (typeof value === "string" ? value : "").trim().slice(0, 80)
  return next || fallback
}

function cleanColor(color: unknown) {
  if (typeof color !== "string") throw new Error("Colors must use #RRGGBB format.")
  if (!HEX_COLOR.test(color)) throw new Error("Colors must use #RRGGBB format.")
  return color
}

function clamp(value: unknown, min: number, max: number) {
  const next = typeof value === "number" && Number.isFinite(value) ? value : min
  return Math.max(min, Math.min(max, next))
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

type ScriptCommand = { method: string; args: unknown[]; lineNumber: number }

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

function parseScriptCommands(source: string): ScriptCommand[] {
  const commands: ScriptCommand[] = []
  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith("//")) return
    const statement = trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed
    const match = /^api\.([A-Za-z][A-Za-z0-9_]*)\((.*)\)$/.exec(statement)
    if (!match) {
      throw new Error(`Line ${lineNumber}: use api.method(JSON arguments) commands only.`)
    }
    const [, method, rawArgs] = match
    if (!SCRIPT_METHODS.has(method)) {
      throw new Error(`Line ${lineNumber}: api.${method} is not available.`)
    }
    let args: unknown[]
    try {
      args = rawArgs.trim() ? JSON.parse(`[${rawArgs}]`) : []
    } catch {
      throw new Error(`Line ${lineNumber}: arguments must be JSON literals.`)
    }
    commands.push({ method, args, lineNumber })
  })
  return commands
}

export function ScriptingPanel() {
  const editor = useEditor()
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = editor
  const [code, setCode] = React.useState(STARTER_SCRIPT)
  const [log, setLog] = React.useState<string[]>([])

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const appendLog = (line: string) => setLog((prev) => [...prev.slice(-80), line])

  const run = () => {
    const validationError = validateScript(code)
    if (validationError) {
      appendLog(validationError)
      return
    }
    const api = {
      report: (message: unknown) => appendLog(String(message).slice(0, 500)),
      reportDocument: () => appendLog(`${activeDoc.name}: ${activeDoc.width} x ${activeDoc.height}px, ${activeDoc.layers.length} layers`),
      reportActiveLayer: () => appendLog(activeLayer ? `Active layer: ${activeLayer.name}` : "No active layer"),
      setTool: (tool: unknown) => {
        const next = stringArg(tool, "tool")
        if (!TOOL_IDS.has(next as ToolId)) throw new Error(`Unknown tool: ${next}`)
        dispatch({ type: "set-tool", tool: next as ToolId })
      },
      setForeground: (color: unknown) => dispatch({ type: "set-foreground", color: cleanColor(color) }),
      setBackground: (color: unknown) => dispatch({ type: "set-background", color: cleanColor(color) }),
      setBrush: (brush: unknown) => {
        if (!isRecord(brush)) throw new Error("brush must be an object.")
        dispatch({ type: "set-brush", brush: cleanBrushPatch(brush) })
      },
      renameActiveLayer: (name: unknown) => {
        if (activeLayer) dispatch({ type: "rename-layer", id: activeLayer.id, name: cleanName(name, activeLayer.name) })
      },
      setLayerOpacity: (id: unknown, opacity: unknown) => {
        const targetId = stringArg(id, "layer id")
        const resolvedId = targetId === "active" ? activeLayer?.id : targetId
        if (!resolvedId || !activeDoc.layers.some((layer) => layer.id === resolvedId)) throw new Error(`Unknown layer: ${targetId}`)
        dispatch({ type: "set-layer-opacity", id: resolvedId, opacity: Math.max(0, Math.min(1, numberArg(opacity, "opacity"))) })
      },
      newLayer: (name: unknown = "Script Layer") => {
        const layer: Layer = {
          id: `script_${Math.random().toString(36).slice(2, 9)}`,
          name: cleanName(name, "Script Layer"),
          kind: "raster",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          canvas: makeCanvas(activeDoc.width, activeDoc.height),
        }
        dispatch({ type: "add-layer", layer })
        return layer.id
      },
      createAdjustment: (type: unknown) => {
        const adjustmentType = stringArg(type, "adjustment") as AdjustmentType
        const filter = FILTERS[adjustmentType]
        if (!filter) throw new Error(`Unknown adjustment: ${type}`)
        const params: Record<string, number | string | boolean> = {}
        for (const param of filter.params) params[param.key] = param.default
        const layer: Layer = {
          id: `script_adj_${Math.random().toString(36).slice(2, 9)}`,
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
        return layer.id
      },
    }

    try {
      appendLog("> run")
      const commands = parseScriptCommands(code)
      for (const command of commands) {
        const action = api[command.method as keyof typeof api] as (...args: unknown[]) => unknown
        const result = action(...command.args)
        if (typeof result === "string") appendLog(result)
      }
      requestRender()
      window.setTimeout(() => commit("Run Script", "all"), 0)
      appendLog(`Done (${commands.length} command${commands.length === 1 ? "" : "s"})`)
    } catch (err) {
      appendLog(err instanceof Error ? `Error: ${err.message}` : "Error: script failed")
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] p-2">
        <Code2 className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
        <span className="text-[10px] uppercase text-[var(--ps-text-dim)]">Local Script Console</span>
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-label="Command-only script mode" />
        <button
          type="button"
          className="ml-auto flex h-7 items-center gap-1 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
          onClick={() => setCode(STARTER_SCRIPT)}
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-sm bg-[var(--ps-accent)] px-2 text-[10px] text-white hover:brightness-110"
          onClick={run}
        >
          <Play className="h-3 w-3" />
          Run
        </button>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1.5">
        {SCRIPT_SNIPPETS.map((snippet) => (
          <button
            key={snippet.label}
            type="button"
            className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-1 text-[10px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
            onClick={() => setCode(snippet.code)}
          >
            {snippet.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 p-2">
        <Textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          className="h-full resize-none font-mono text-[11px]"
        />
      </div>
      <div className="max-h-32 min-h-20 overflow-y-auto border-t border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 font-mono text-[10px] text-[var(--ps-text-dim)]">
        {log.length ? log.map((line, idx) => <div key={`${idx}-${line}`}>{line}</div>) : <div>Script output appears here.</div>}
      </div>
    </div>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
