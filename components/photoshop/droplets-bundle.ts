/**
 * Droplet bundle JSON format + drag-drop dispatch.
 *
 * A "droplet" in classic Photoshop is a tiny native app that, when an image
 * is dropped on it, runs a saved Action on that image and writes the result
 * back to disk. Browsers can't ship native binaries, so this implementation
 * exports a JSON bundle that the editor can re-import via a top-level
 * dropzone. The bundle is self-contained: action snapshot, pre/post DSL
 * scripts, export options, and a schema version for future migrations.
 *
 * Bundles are intentionally JSON so they can be inspected, version-controlled,
 * and produced by other tools.
 */

import { parseAutomationWorkflowImportPayload, parseSafeDslCommands, type AutomationWorkflow } from "./automation-engine"
import type { Droplet } from "./automation-store"
import { dispatchPhotoshopEvent } from "./events"
import type { AssetLibraryItem, MacroAction } from "./types"

export const DROPLET_BUNDLE_FORMAT = "ps-droplet-bundle"
export const DROPLET_BUNDLE_SCHEMA = 1
export const DROPLET_BUNDLE_MAX_BYTES = 5_000_000

export interface DropletBundle {
  format: typeof DROPLET_BUNDLE_FORMAT
  schema: number
  droplet: {
    id: string
    name: string
    actionId?: string
    condition?: Droplet["condition"]
    event?: string
    manualOnly?: boolean
    exportFormat?: Droplet["exportFormat"]
    exportName?: string
    preScript?: string
    postScript?: string
  }
  /** Optional full action snapshot so the bundle is self-contained. */
  action?: SerializedDropletAction
  /** Browser-local workflow used by Batch Processing and manual droplet runs. */
  workflow?: AutomationWorkflow
  createdAt: number
  generator?: string
}

/** Minimal serialised action (no canvases — they get re-rendered on import). */
export interface SerializedDropletAction {
  id: string
  name: string
  steps: Array<{ id: string; label: string; createdAt: number }>
  createdAt: number
  updatedAt: number
}

/* --------------------------- Build & parse ----------------------------- */

export function buildDropletBundle(
  droplet: Droplet,
  action: MacroAction | null,
  options: { workflow?: AutomationWorkflow } = {},
): DropletBundle {
  return {
    format: DROPLET_BUNDLE_FORMAT,
    schema: DROPLET_BUNDLE_SCHEMA,
    droplet: {
      id: droplet.id.slice(0, 64),
      name: droplet.name.slice(0, 80),
      actionId: droplet.actionId?.slice(0, 80),
      condition: droplet.condition,
      event: droplet.event?.slice(0, 80),
      manualOnly: droplet.manualOnly ?? true,
      exportFormat: droplet.exportFormat,
      exportName: droplet.exportName?.slice(0, 120),
      preScript: droplet.preScript?.slice(0, 8_000),
      postScript: droplet.postScript?.slice(0, 8_000),
    },
    action: action
      ? {
          id: action.id,
          name: action.name,
          createdAt: action.createdAt,
          updatedAt: action.updatedAt,
          steps: action.steps.map((step) => ({
            id: step.id,
            label: step.label.slice(0, 200),
            createdAt: step.createdAt,
          })),
        }
      : undefined,
    workflow: options.workflow ?? droplet.workflow,
    createdAt: Date.now(),
    generator: "photoshop-web",
  }
}

export function serializeDropletBundle(bundle: DropletBundle): string {
  return JSON.stringify(bundle, null, 2)
}

export function parseDropletBundle(text: string): DropletBundle {
  if (text.length > DROPLET_BUNDLE_MAX_BYTES) {
    throw new Error(`Droplet bundle is too large (${text.length} bytes)`)
  }
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== "object") throw new Error("Bundle must be a JSON object")
  const rec = parsed as Record<string, unknown>
  if (rec.format !== DROPLET_BUNDLE_FORMAT) throw new Error("Not a droplet bundle")
  const schema = typeof rec.schema === "number" ? rec.schema : 0
  if (schema !== DROPLET_BUNDLE_SCHEMA) throw new Error(`Unsupported bundle schema: ${schema}`)
  const droplet = rec.droplet as Record<string, unknown> | undefined
  if (!droplet || typeof droplet !== "object") throw new Error("Missing droplet section")
  const id = typeof droplet.id === "string" ? droplet.id.slice(0, 64) : ""
  const name = typeof droplet.name === "string" ? droplet.name.slice(0, 80) : ""
  if (!id || !name) throw new Error("Droplet section missing id/name")
  // Validate scripts so a tampered bundle can't sneak in arbitrary DSL.
  const preScript = typeof droplet.preScript === "string" ? droplet.preScript.slice(0, 8_000) : undefined
  const postScript = typeof droplet.postScript === "string" ? droplet.postScript.slice(0, 8_000) : undefined
  if (preScript) {
    try {
      parseSafeDslCommands(preScript)
    } catch (error) {
      throw new Error(`preScript invalid: ${error instanceof Error ? error.message : "Invalid script"}`)
    }
  }
  if (postScript) {
    try {
      parseSafeDslCommands(postScript)
    } catch (error) {
      throw new Error(`postScript invalid: ${error instanceof Error ? error.message : "Invalid script"}`)
    }
  }
  const action = rec.action && typeof rec.action === "object" ? sanitizeAction(rec.action as Record<string, unknown>) : undefined
  const workflow = rec.workflow && typeof rec.workflow === "object" ? parseAutomationWorkflowImportPayload(rec.workflow) : undefined
  return {
    format: DROPLET_BUNDLE_FORMAT,
    schema: DROPLET_BUNDLE_SCHEMA,
    droplet: {
      id,
      name,
      actionId: typeof droplet.actionId === "string" ? droplet.actionId.slice(0, 80) : action?.id,
      condition: cleanCondition(droplet.condition),
      event: typeof droplet.event === "string" ? droplet.event.slice(0, 80) : undefined,
      manualOnly: typeof droplet.manualOnly === "boolean" ? droplet.manualOnly : true,
      exportFormat: cleanExportFormat(droplet.exportFormat),
      exportName: typeof droplet.exportName === "string" ? droplet.exportName.slice(0, 120) : undefined,
      preScript,
      postScript,
    },
    action,
    workflow,
    createdAt: typeof rec.createdAt === "number" ? rec.createdAt : Date.now(),
    generator: typeof rec.generator === "string" ? rec.generator.slice(0, 80) : undefined,
  }
}

export function dropletBundleToAutomationAsset(
  bundle: DropletBundle,
  options: { makeId?: (prefix: string, index: number) => string; now?: number } = {},
): AssetLibraryItem {
  const makeId = options.makeId ?? ((prefix: string, index: number) => `${prefix}_${index}`)
  const payload = {
    type: bundle.workflow ? "workflow" : "droplet",
    actionId: bundle.droplet.actionId,
    condition: bundle.droplet.condition ?? "always",
    event: bundle.droplet.event,
    manualOnly: bundle.droplet.manualOnly ?? true,
    format: bundle.droplet.exportFormat,
    workflow: bundle.workflow,
  }
  return {
    id: makeId("automation", 0),
    name: bundle.droplet.name,
    kind: "prepress",
    group: "Automation",
    payload,
    createdAt: options.now ?? Date.now(),
  }
}

function cleanCondition(value: unknown): Droplet["condition"] | undefined {
  return value === "always" ||
    value === "has-selection" ||
    value === "has-active-layer" ||
    value === "multi-layer" ||
    value === "rgb" ||
    value === "print-ready" ||
    value === "document-open"
    ? value
    : undefined
}

function cleanExportFormat(value: unknown): Droplet["exportFormat"] | undefined {
  return value === "none" || value === "png" || value === "jpeg" || value === "webp" ? value : undefined
}

function sanitizeAction(rec: Record<string, unknown>): SerializedDropletAction | undefined {
  if (typeof rec.id !== "string" || typeof rec.name !== "string") return undefined
  const stepsRaw = Array.isArray(rec.steps) ? rec.steps : []
  const steps: SerializedDropletAction["steps"] = []
  for (const stepRaw of stepsRaw.slice(0, 256)) {
    if (!stepRaw || typeof stepRaw !== "object") continue
    const step = stepRaw as Record<string, unknown>
    if (typeof step.id !== "string" || typeof step.label !== "string") continue
    steps.push({
      id: step.id.slice(0, 80),
      label: step.label.slice(0, 200),
      createdAt: typeof step.createdAt === "number" ? step.createdAt : Date.now(),
    })
  }
  return {
    id: rec.id.slice(0, 80),
    name: rec.name.slice(0, 80),
    steps,
    createdAt: typeof rec.createdAt === "number" ? rec.createdAt : Date.now(),
    updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : Date.now(),
  }
}

/* --------------------------- Drag-drop dispatch ------------------------- */

export const DROPLET_DROP_EVENT = "ps-droplet-bundle-dropped"

/**
 * Attach a one-time droplet dropzone handler to a DOM element. When the user
 * drags a *.psweb-droplet.json file onto the element, the file is parsed and
 * a `ps-droplet-bundle-dropped` event is emitted with the parsed bundle in
 * its detail. The dialog/menu hooks listen for this event and dispatch the
 * import.
 *
 * Returns a teardown function.
 */
export function attachDropletDropzone(element: HTMLElement, onBundle: (bundle: DropletBundle, file: File) => void): () => void {
  const onDragOver = (event: DragEvent) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    }
  }
  const onDrop = async (event: DragEvent) => {
    if (!event.dataTransfer?.files?.length) return
    const file = Array.from(event.dataTransfer.files).find((f) => isDropletBundleFile(f))
    if (!file) return
    event.preventDefault()
    try {
      const text = await file.text()
      const bundle = parseDropletBundle(text)
      onBundle(bundle, file)
      dispatchPhotoshopEvent(DROPLET_DROP_EVENT, { bundle, fileName: file.name })
    } catch {
      // Silently ignore malformed drops; caller can show their own error UI
      // via a separate file picker if they need richer feedback.
    }
  }
  element.addEventListener("dragover", onDragOver)
  element.addEventListener("drop", onDrop)
  return () => {
    element.removeEventListener("dragover", onDragOver)
    element.removeEventListener("drop", onDrop)
  }
}

export function isDropletBundleFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith(".psweb-droplet.json") || name.endsWith(".droplet.json")
}

export function dropletBundleFileName(bundle: DropletBundle): string {
  const safe = bundle.droplet.name.replace(/[^A-Za-z0-9 _\-]/g, "_").slice(0, 60) || "droplet"
  return `${safe}.psweb-droplet.json`
}
