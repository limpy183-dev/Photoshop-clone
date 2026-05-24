"use client"

import * as React from "react"
import { useEditor, makeCanvas } from "../editor-context"
import { downloadText } from "../document-io"
import { FILTERS } from "../filters"
import { Textarea } from "@/components/ui/textarea"
import { Code2, Download, Play, RotateCcw, Save, ShieldCheck, Trash2, Upload } from "lucide-react"
import type { AdjustmentType, Layer, ToolId } from "../types"
import {
  cleanBrushPatch,
  cleanHexColor,
  loadCommandMacros,
  parseSafeDslCommands,
  saveCommandMacros,
  type CommandMacro,
} from "../automation-engine"
import { uid } from "../uid"

const STARTER_SCRIPT = `report("Ready")
reportDocument()
reportActiveLayer()
renameActiveLayer("Retouched Layer")
// createAdjustment("brightness-contrast")
// setForeground("#ff3366")
// applyFilter("invert")
`

const SCRIPT_SNIPPETS = [
  { label: "Rename layer", code: 'renameActiveLayer("Retouched Layer")' },
  { label: "Soft brush", code: 'setTool("brush")\nsetBrush({"size":36,"hardness":35,"opacity":85,"flow":70})' },
  { label: "Add contrast", code: 'createAdjustment("brightness-contrast")' },
  { label: "Invert pixels", code: 'applyFilter("invert")' },
] as const

function cleanName(value: unknown, fallback: string) {
  const next = (typeof value === "string" ? value : "").trim().slice(0, 80)
  return next || fallback
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

function importMacrosPayload(value: unknown): CommandMacro[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { macros?: unknown[] }).macros)
      ? (value as { macros: unknown[] }).macros
      : [value]
  return raw.slice(0, 100).map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Macro ${index + 1} is not valid.`)
    const record = item as Record<string, unknown>
    const source = stringArg(record.source, "macro source")
    parseSafeDslCommands(source)
    const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now()
    return {
      id: uid("macro"),
      name: cleanName(record.name, `Imported Macro ${index + 1}`),
      source,
      createdAt,
      updatedAt: Date.now(),
    }
  })
}

export function ScriptingPanel() {
  const editor = useEditor()
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = editor
  const [code, setCode] = React.useState(STARTER_SCRIPT)
  const [macroName, setMacroName] = React.useState("Command Macro")
  const [macros, setMacros] = React.useState<CommandMacro[]>([])
  const [log, setLog] = React.useState<string[]>([])
  const importRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setMacros(loadCommandMacros())
  }, [])

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const appendLog = (line: string) => setLog((prev) => [...prev.slice(-80), line])

  const updateMacros = (next: CommandMacro[]) => {
    setMacros(next)
    saveCommandMacros(next)
  }

  const applyFilterToActiveLayer = (filterId: string, params?: Record<string, number | string | boolean>) => {
    if (!activeLayer) return
    const filter = FILTERS[filterId]
    if (!filter) throw new Error(`Unknown filter: ${filterId}`)
    const ctx = activeLayer.canvas.getContext("2d")
    if (!ctx) throw new Error("Active layer canvas is unavailable.")
    const defaults: Record<string, number | string | boolean> = {}
    for (const param of filter.params) defaults[param.key] = param.default
    const image = ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    ctx.putImageData(filter.apply(image, { ...defaults, ...(params ?? {}) }), 0, 0)
  }

  const runSource = (source: string, label = "Run Script") => {
    try {
      appendLog("> run")
      const commands = parseSafeDslCommands(source)
      for (const command of commands) {
        const args = command.args
        if (command.method === "report") appendLog(String(args[0] ?? "").slice(0, 500))
        else if (command.method === "reportDocument") appendLog(`${activeDoc.name}: ${activeDoc.width} x ${activeDoc.height}px, ${activeDoc.layers.length} layers`)
        else if (command.method === "reportActiveLayer") appendLog(activeLayer ? `Active layer: ${activeLayer.name}` : "No active layer")
        else if (command.method === "setTool") dispatch({ type: "set-tool", tool: stringArg(args[0], "tool") as ToolId })
        else if (command.method === "setForeground") dispatch({ type: "set-foreground", color: cleanHexColor(args[0]) })
        else if (command.method === "setBackground") dispatch({ type: "set-background", color: cleanHexColor(args[0]) })
        else if (command.method === "setBrush") dispatch({ type: "set-brush", brush: cleanBrushPatch(args[0]) })
        else if (command.method === "renameActiveLayer") {
          if (activeLayer) dispatch({ type: "rename-layer", id: activeLayer.id, name: cleanName(args[0], activeLayer.name) })
        } else if (command.method === "setLayerOpacity") {
          const targetId = stringArg(args[0], "layer id")
          const resolvedId = targetId === "active" ? activeLayer?.id : targetId
          if (!resolvedId || !activeDoc.layers.some((layer) => layer.id === resolvedId)) throw new Error(`Unknown layer: ${targetId}`)
          dispatch({ type: "set-layer-opacity", id: resolvedId, opacity: Math.max(0, Math.min(1, numberArg(args[1], "opacity"))) })
        } else if (command.method === "setLayerVisibility") {
          const targetId = stringArg(args[0], "layer id")
          const resolvedId = targetId === "active" ? activeLayer?.id : targetId
          if (!resolvedId || !activeDoc.layers.some((layer) => layer.id === resolvedId)) throw new Error(`Unknown layer: ${targetId}`)
          dispatch({ type: "set-layer-visibility", id: resolvedId, visible: booleanArg(args[1], "visibility") })
        } else if (command.method === "newLayer") {
          const layer: Layer = {
            id: uid("script"),
            name: cleanName(args[0], "Script Layer"),
            kind: "raster",
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: "normal",
            canvas: makeCanvas(activeDoc.width, activeDoc.height),
          }
          dispatch({ type: "add-layer", layer })
        } else if (command.method === "createAdjustment") {
          const adjustmentType = stringArg(args[0], "adjustment") as AdjustmentType
          const filter = FILTERS[adjustmentType]
          if (!filter) throw new Error(`Unknown adjustment: ${args[0]}`)
          const params: Record<string, number | string | boolean> = {}
          for (const param of filter.params) params[param.key] = param.default
          const layer: Layer = {
            id: uid("script-adj"),
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
        } else if (command.method === "applyFilter") {
          applyFilterToActiveLayer(stringArg(args[0], "filter"), args[1] as Record<string, number | string | boolean> | undefined)
        } else if (command.method === "invert") applyFilterToActiveLayer("invert")
        else if (command.method === "grayscale") applyFilterToActiveLayer("grayscale")
        else if (command.method === "desaturate") applyFilterToActiveLayer("desaturate")
        else if (command.method === "equalize") applyFilterToActiveLayer("equalize")
        else if (command.method === "hdrToning") applyFilterToActiveLayer("hdr-toning")
      }
      requestRender()
      window.setTimeout(() => commit(label, "all"), 0)
      appendLog(`Done (${commands.length} command${commands.length === 1 ? "" : "s"})`)
    } catch (err) {
      appendLog(err instanceof Error ? `Error: ${err.message}` : "Error: script failed")
    }
  }

  const saveMacro = () => {
    try {
      parseSafeDslCommands(code)
      const now = Date.now()
      updateMacros([
        {
          id: uid("macro"),
          name: macroName.trim() || `Macro ${macros.length + 1}`,
          source: code,
          createdAt: now,
          updatedAt: now,
        },
        ...macros,
      ])
      appendLog("Macro saved")
    } catch (error) {
      appendLog(error instanceof Error ? `Error: ${error.message}` : "Error: macro was not saved")
    }
  }

  const importMacros = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const imported = importMacrosPayload(parsed)
      updateMacros([...imported, ...macros])
      appendLog(`Imported ${imported.length} macro${imported.length === 1 ? "" : "s"}`)
    } catch (error) {
      appendLog(error instanceof Error ? `Error: ${error.message}` : "Error: macro import failed")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <input
        ref={importRef}
        type="file"
        accept=".json,.psmacro,.psmacro.json,application/json"
        className="hidden"
        aria-label="Import command macros"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void importMacros(file)
        }}
      />
      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] p-2">
        <Code2 className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
        <span className="text-[10px] uppercase text-[var(--ps-text-dim)]">Safe Command DSL</span>
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
          onClick={() => runSource(code)}
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
      <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto]">
        <div className="min-h-0 p-2">
          <Textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="h-full resize-none font-mono text-[11px]"
          />
        </div>
        <div className="border-t border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] gap-1">
            <input
              value={macroName}
              onChange={(event) => setMacroName(event.target.value)}
              aria-label="Command macro name"
              className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[10px] outline-none focus:border-[var(--ps-accent)]"
            />
            <button type="button" className="flex h-7 items-center gap-1 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]" onClick={saveMacro}>
              <Save className="h-3 w-3" />
              Save
            </button>
            <button type="button" className="flex h-7 items-center gap-1 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]" onClick={() => importRef.current?.click()}>
              <Upload className="h-3 w-3" />
              Import
            </button>
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
              disabled={!macros.length}
              onClick={() => downloadText(JSON.stringify({ app: "Photoshop Web", format: "psmacro", version: 1, macros }, null, 2), "command-macros.psmacro.json")}
            >
              <Download className="h-3 w-3" />
              Export
            </button>
          </div>
          <div className="max-h-28 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
            {macros.length ? macros.map((macro) => (
              <div key={macro.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 border-b border-[var(--ps-divider)] px-2 py-1">
                <span className="min-w-0 truncate">{macro.name}</span>
                <button type="button" className="rounded-sm px-1.5 py-1 text-[10px] hover:bg-[var(--ps-tool-hover)]" onClick={() => runSource(macro.source, `Run Macro: ${macro.name}`)}>Run</button>
                <button type="button" className="rounded-sm px-1.5 py-1 text-[10px] hover:bg-[var(--ps-tool-hover)]" onClick={() => setCode(macro.source)}>Insert</button>
                <button type="button" className="rounded-sm px-1 py-1 hover:bg-[var(--ps-tool-hover)]" aria-label={`Delete macro ${macro.name}`} onClick={() => updateMacros(macros.filter((item) => item.id !== macro.id))}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )) : <div className="px-2 py-2 text-[var(--ps-text-dim)]">No command macros saved.</div>}
          </div>
        </div>
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
