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
export const MAX_DATASET_IMPORTS = 64
export const VARIABLE_DATA_SET_FORMAT = "ps-variable-data-sets"
export const VARIABLE_DATA_SET_VERSION = 1
const MAX_NAME_LENGTH = 80
const MAX_CELL_LENGTH = 20_000

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

/* --------------------------- Import / export --------------------------- */

export interface VariableDataSetExportPayload {
  app: "Photoshop Web"
  format: typeof VARIABLE_DATA_SET_FORMAT
  version: typeof VARIABLE_DATA_SET_VERSION
  exportedAt: string
  dataSets: VariableDataSet[]
}

export interface VariableDataSetImportOptions {
  doc?: PsDocument
  makeId?: (prefix: string, index: number) => string
}

const VARIABLE_BINDING_PROPERTIES: ReadonlySet<VariableBinding["property"]> = new Set([
  "text",
  "visibility",
  "opacity",
  "image",
])

export function buildVariableDataSetExportPayload(
  dataSets: VariableDataSet[],
  options: { exportedAt?: string } = {},
): VariableDataSetExportPayload {
  return {
    app: "Photoshop Web",
    format: VARIABLE_DATA_SET_FORMAT,
    version: VARIABLE_DATA_SET_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    dataSets: dataSets.slice(0, MAX_DATASET_IMPORTS).map((set) => clampActiveRow({
      id: cleanText(set.id, "dataset", 80),
      name: cleanText(set.name, "Untitled Data Set", MAX_NAME_LENGTH),
      rows: normalizeRows(set.rows),
      bindings: normalizeBindingsForExport(set.bindings, collectColumns(set.rows)),
      activeRow: set.activeRow,
    })),
  }
}

export function parseVariableDataSetImportPayload(parsed: unknown, options: VariableDataSetImportOptions = {}): VariableDataSet[] {
  const list = extractDataSetRecords(parsed)
  const makeId = options.makeId ?? ((prefix: string, index: number) => `${prefix}-${Date.now().toString(36)}-${index}`)
  return list.slice(0, MAX_DATASET_IMPORTS).map((record, setIndex) => {
    const rows = normalizeRows(Array.isArray(record.rows) ? record.rows : [])
    const columns = collectColumns(rows)
    const activeRow = clampRowIndex(record.activeRow, rows.length)
    return {
      id: makeId("dataset", setIndex),
      name: cleanText(record.name, `Data Set ${setIndex + 1}`, MAX_NAME_LENGTH),
      rows,
      bindings: normalizeBindings(Array.isArray(record.bindings) ? record.bindings : [], columns, options.doc, setIndex, makeId),
      activeRow,
    }
  }).filter((set) => set.rows.length)
}

export function serializeDatasetRowsCsv(rows: Record<string, string>[], columns = collectColumns(rows)): string {
  if (!rows.length || !columns.length) return ""
  const header = columns.map(csvCell).join(",")
  const body = rows.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(","))
  return [header, ...body].join("\r\n")
}

export function inferVariableBindings(doc: PsDocument, columns: string[]): VariableBinding[] {
  const normalizedColumns = columns.map((column) => ({ raw: column, key: normalizeKey(column) }))
  const bindings: VariableBinding[] = []
  for (const layer of doc.layers) {
    const layerKey = normalizeKey(layer.name)
    if (layer.text) {
      const column =
        normalizedColumns.find((item) => item.key === layerKey)?.raw ??
        normalizedColumns.find((item) => item.key === "text" || item.key === "headline" || item.key === "title")?.raw
      if (column) bindings.push(createBinding(layer.id, "text", column))
    }
    const visible = normalizedColumns.find((item) => item.key === `show_${layerKey}` || item.key === `${layerKey}_visible`)?.raw
    if (visible) bindings.push(createBinding(layer.id, "visibility", visible))
    const opacity = normalizedColumns.find((item) => item.key === `${layerKey}_opacity` || item.key === "opacity")?.raw
    if (opacity) bindings.push(createBinding(layer.id, "opacity", opacity))
    const image = normalizedColumns.find((item) => item.key === `${layerKey}_image` || item.key === "image")?.raw
    if (image) bindings.push(createBinding(layer.id, "image", image))
  }
  return bindings
}

function extractDataSetRecords(parsed: unknown): Array<Record<string, unknown>> {
  if (isRecord(parsed) && parsed.format === VARIABLE_DATA_SET_FORMAT) {
    if (parsed.version !== VARIABLE_DATA_SET_VERSION) throw new Error(`Unsupported variable data set version: ${String(parsed.version)}`)
    if (!Array.isArray(parsed.dataSets)) throw new Error("Variable data set file must contain a dataSets array.")
    return parsed.dataSets.filter(isRecord)
  }
  if (Array.isArray(parsed)) return parsed.filter(isRecord)
  if (isRecord(parsed) && Array.isArray(parsed.rows)) return [parsed]
  throw new Error("File does not contain variable data sets.")
}

function normalizeRows(rows: unknown): Record<string, string>[] {
  if (!Array.isArray(rows)) return []
  return rows.slice(0, MAX_DATASET_ROWS).filter(isRecord).map((row) => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(row).slice(0, MAX_DATASET_COLUMNS)) {
      const cleanKey = cleanText(key, "", MAX_NAME_LENGTH)
      if (!cleanKey) continue
      out[cleanKey] = normalizeCell(value)
    }
    return out
  })
}

function normalizeBindings(
  bindings: unknown[],
  columns: string[],
  doc?: PsDocument,
  setIndex = 0,
  makeId: (prefix: string, index: number) => string = (prefix, index) => `${prefix}-${index}`,
): VariableBinding[] {
  const out: VariableBinding[] = []
  bindings.slice(0, MAX_DATASET_COLUMNS * 4).forEach((raw) => {
    if (!isRecord(raw)) return
    const property = raw.property
    if (!VARIABLE_BINDING_PROPERTIES.has(property as VariableBinding["property"])) return
    const layerId = cleanText(raw.layerId, "", 120)
    const column = cleanText(raw.column, "", MAX_NAME_LENGTH)
    if (!layerId || !column || !columns.includes(column)) return
    if (doc && !doc.layers.some((layer) => layer.id === layerId)) return
    out.push({
      id: makeId(`binding_${setIndex}`, out.length),
      layerId,
      property: property as VariableBinding["property"],
      column,
    })
  })
  return out
}

function normalizeBindingsForExport(bindings: VariableBinding[], columns: string[]): VariableBinding[] {
  const out: VariableBinding[] = []
  for (const binding of bindings.slice(0, MAX_DATASET_COLUMNS * 4)) {
    if (!VARIABLE_BINDING_PROPERTIES.has(binding.property)) continue
    const layerId = cleanText(binding.layerId, "", 120)
    const column = cleanText(binding.column, "", MAX_NAME_LENGTH)
    if (!layerId || !column || !columns.includes(column)) continue
    out.push({
      id: cleanText(binding.id, `binding-${out.length}`, 80),
      layerId,
      property: binding.property,
      column,
    })
  }
  return out
}

function clampRowIndex(value: unknown, rowCount: number): number | undefined {
  if (!rowCount) return undefined
  const index = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0
  return Math.max(0, Math.min(rowCount - 1, index))
}

function normalizeCell(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value.slice(0, MAX_CELL_LENGTH)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value).slice(0, MAX_CELL_LENGTH)
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function cleanText(value: unknown, fallback: string, limit: number): string {
  const next = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, limit)
    : ""
  return next || fallback
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
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
