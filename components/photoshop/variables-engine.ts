/**
 * Variables / Data Sets engine.
 *
 * - Parses CSV/JSON imports into bounded data rows.
 * - Binds dataset columns to layer properties (text content, visibility,
 *   opacity, image replacement).
 * - Applies a single row to a snapshot of the document, producing a list of
 *   per-row patches that the caller dispatches (or composites into PNG
 *   exports).
 *
 * The renderer in the dialog produces a per-row PNG by drawing each layer
 * with the binding-substituted content into a fresh offscreen canvas. This
 * keeps the export deterministic and does not mutate the live document
 * outside the preview.
 */

import { parseAutomationDataRows } from "./automation-engine"
import type {
  Layer,
  PsDocument,
  VariableBinding,
  VariableDataSet,
} from "./types"

export type { VariableDataSet, VariableBinding } from "./types"

export const MAX_DATASET_ROWS = 2000
export const MAX_DATASET_COLUMNS = 64
const MAX_NAME_LENGTH = 80

/* --------------------------- Parsing ------------------------------------ */

export interface ParsedDataset {
  rows: Record<string, string>[]
  columns: string[]
}

/** Parse a CSV or JSON payload into normalized rows + ordered column list. */
export function parseDataset(text: string, filename = "dataset.csv"): ParsedDataset {
  const rows = parseAutomationDataRows(text, filename).slice(0, MAX_DATASET_ROWS)
  const columns = collectColumns(rows)
  return { rows, columns }
}

function collectColumns(rows: Record<string, string>[]): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (set.size >= MAX_DATASET_COLUMNS) break
      set.add(key)
    }
  }
  return Array.from(set)
}

/* --------------------------- Binding ------------------------------------ */

export interface BindingDescriptor {
  layerId: string
  property: VariableBinding["property"]
  column: string
}

export function createBinding(layerId: string, property: VariableBinding["property"], column: string): VariableBinding {
  return {
    id: `var-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xfffff).toString(36)}`,
    layerId,
    property,
    column,
  }
}

export function upsertBinding(set: VariableDataSet, binding: VariableBinding): VariableDataSet {
  const existing = set.bindings.findIndex((b) => b.layerId === binding.layerId && b.property === binding.property)
  const next = set.bindings.slice()
  if (existing >= 0) next[existing] = binding
  else next.push(binding)
  return { ...set, bindings: next }
}

export function removeBinding(set: VariableDataSet, bindingId: string): VariableDataSet {
  return { ...set, bindings: set.bindings.filter((b) => b.id !== bindingId) }
}

/* --------------------------- Row application --------------------------- */

export type LayerOverride =
  | { kind: "text"; layerId: string; text: string }
  | { kind: "visibility"; layerId: string; visible: boolean }
  | { kind: "opacity"; layerId: string; opacity: number }
  | { kind: "image"; layerId: string; url: string }

export interface AppliedRow {
  overrides: LayerOverride[]
  rowIndex: number
  filenameHint: string
}

/**
 * Convert a row's column values into editor-ready layer overrides. The
 * caller decides whether to dispatch them (preview) or to feed them into
 * an offscreen renderer (export).
 */
export function applyRow(set: VariableDataSet, doc: PsDocument, rowIndex: number): AppliedRow {
  const row = set.rows[rowIndex] ?? {}
  const overrides: LayerOverride[] = []
  for (const binding of set.bindings) {
    const layer = doc.layers.find((l) => l.id === binding.layerId)
    if (!layer) continue
    const value = row[binding.column] ?? ""
    switch (binding.property) {
      case "text":
        overrides.push({ kind: "text", layerId: layer.id, text: value })
        break
      case "visibility":
        overrides.push({ kind: "visibility", layerId: layer.id, visible: parseVisibility(value) })
        break
      case "opacity":
        overrides.push({ kind: "opacity", layerId: layer.id, opacity: parseOpacity(value) })
        break
      case "image":
        overrides.push({ kind: "image", layerId: layer.id, url: value })
        break
    }
  }
  return { overrides, rowIndex, filenameHint: buildRowFilename(set, rowIndex) }
}

function parseVisibility(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === "1" || v === "true" || v === "yes" || v === "y" || v === "on") return true
  if (v === "0" || v === "false" || v === "no" || v === "n" || v === "off") return false
  return !!v // any other non-empty value = visible
}

function parseOpacity(value: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  if (n > 1.0001) return Math.min(1, Math.max(0, n / 100))
  return Math.min(1, Math.max(0, n))
}

function buildRowFilename(set: VariableDataSet, rowIndex: number): string {
  const safeName = set.name.replace(/[^A-Za-z0-9 _\-]/g, "_").slice(0, 40) || "data"
  const idx = String(rowIndex + 1).padStart(3, "0")
  return `${safeName}-${idx}`
}

/* --------------------------- Image replacement ------------------------- */

const ALLOWED_IMAGE_PREFIXES = ["data:image/", "blob:", "https:", "http:"]

/** Validate that an image URL can be safely loaded. */
export function isAllowedImageUrl(url: string): boolean {
  if (!url) return false
  return ALLOWED_IMAGE_PREFIXES.some((prefix) => url.startsWith(prefix))
}

/**
 * Load an image URL and stamp it onto the layer canvas with cover/contain
 * fit. Returns true on success, false if the URL was rejected or load
 * failed. Used by the per-row export path.
 */
export async function applyImageOverride(layer: Layer, url: string, fit: "cover" | "contain" = "cover"): Promise<boolean> {
  if (!isAllowedImageUrl(url)) return false
  if (typeof Image === "undefined") return false
  return await new Promise<boolean>((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const ctx = layer.canvas.getContext("2d")
        if (!ctx) return resolve(false)
        const tw = layer.canvas.width
        const th = layer.canvas.height
        ctx.clearRect(0, 0, tw, th)
        const iw = img.naturalWidth || img.width
        const ih = img.naturalHeight || img.height
        if (!iw || !ih) return resolve(false)
        const scale = fit === "cover" ? Math.max(tw / iw, th / ih) : Math.min(tw / iw, th / ih)
        const dw = iw * scale
        const dh = ih * scale
        ctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh)
        resolve(true)
      } catch {
        resolve(false)
      }
    }
    img.onerror = () => resolve(false)
    img.src = url
  })
}

/* --------------------------- Validation -------------------------------- */

export function validateBinding(binding: VariableBinding, columns: string[], doc: PsDocument): { ok: boolean; reason?: string } {
  if (!doc.layers.some((l) => l.id === binding.layerId)) return { ok: false, reason: "Layer not found" }
  if (!columns.includes(binding.column)) return { ok: false, reason: `Column "${binding.column}" not found in dataset` }
  return { ok: true }
}

export function buildDataset(name: string, parsed: ParsedDataset): VariableDataSet {
  return {
    id: `dataset-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xfffff).toString(36)}`,
    name: name.slice(0, MAX_NAME_LENGTH) || "Untitled Data Set",
    rows: parsed.rows,
    bindings: [],
    activeRow: parsed.rows.length ? 0 : undefined,
  }
}

export function clampActiveRow(set: VariableDataSet): VariableDataSet {
  if (!set.rows.length) return { ...set, activeRow: undefined }
  const next = Math.max(0, Math.min(set.rows.length - 1, set.activeRow ?? 0))
  return { ...set, activeRow: next }
}

/* --------------------------- Per-row rendering ------------------------- */

/**
 * Pure preview: compute what each layer's effective property value would be
 * after applying the given row, without mutating anything. The dialog uses
 * this to render the "What this row will produce" panel.
 */
export function previewRow(set: VariableDataSet, doc: PsDocument, rowIndex: number) {
  const applied = applyRow(set, doc, rowIndex)
  const preview: Array<{
    layerId: string
    layerName: string
    overrides: { text?: string; visible?: boolean; opacity?: number; imageUrl?: string }
  }> = []
  for (const layer of doc.layers) {
    const overrides: { text?: string; visible?: boolean; opacity?: number; imageUrl?: string } = {}
    for (const op of applied.overrides) {
      if (op.layerId !== layer.id) continue
      if (op.kind === "text") overrides.text = op.text
      else if (op.kind === "visibility") overrides.visible = op.visible
      else if (op.kind === "opacity") overrides.opacity = op.opacity
      else if (op.kind === "image") overrides.imageUrl = op.url
    }
    if (Object.keys(overrides).length) {
      preview.push({ layerId: layer.id, layerName: layer.name, overrides })
    }
  }
  return preview
}
