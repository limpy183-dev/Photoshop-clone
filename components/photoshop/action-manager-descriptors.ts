/**
 * Action Manager descriptor coverage for the in-browser Photoshop clone.
 *
 * This module defines the subset of Adobe Action Manager `_obj` descriptors
 * that the browser editor can deterministically map onto its own state
 * machine, plus a round-trip recorder so that a sequence of dispatched edits
 * can be serialised as descriptors, re-played, and produce the same visible
 * edit.
 *
 * It complements the existing executor inside
 * `advanced-subsystems-dialog.tsx` (get/make/set/select/hide/show/delete/
 * duplicate/filter/move/transform). The executor in this module is the single
 * source of truth and `runPluginActionDescriptors` in the dialog now delegates
 * to it.
 *
 * The descriptors here intentionally cover only documented public Photoshop
 * `_obj` values. They are NOT a bit-exact reproduction of Photoshop's binary
 * Action Manager byte-stream (see BOUNDARIES.md §3) — they are a JSON
 * descriptor subset.
 */

import { FILTERS } from "./filters"
import type {
  BlendMode,
  Layer,
  LayerKind,
  PluginActionDescriptor,
  PsDocument,
} from "./types"

/* --------------------------- Documented descriptor names ---------------- */

/**
 * Documented `_obj` values that the browser host understands. Any value not in
 * this list is reported as `unsupported` rather than throwing — plugins can
 * fall back to other strategies.
 */
export const ACTION_DESCRIPTOR_OPS = [
  // document operations
  "open", "save", "close", "duplicate-document",
  "resize-document", "crop-document", "rotate-document", "flatten-document",
  // layer operations
  "get", "make", "set", "select", "hide", "show", "delete", "duplicate",
  "new-layer", "delete-layer", "duplicate-layer", "group-layers", "ungroup-layers",
  "merge-down", "merge-visible", "rasterize-layer", "transform-layer",
  "set-layer-blend", "set-layer-mask",
  // filter / pixel operations
  "filter", "apply-filter", "move", "transform",
] as const

export type ActionDescriptorOp = (typeof ACTION_DESCRIPTOR_OPS)[number]

const KNOWN_OPS = new Set<string>(ACTION_DESCRIPTOR_OPS)

/* --------------------------- safe coercion helpers ---------------------- */

export function descNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export function descInteger(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return Math.round(descNumber(value, fallback, min, max))
}

export function descString(value: unknown, fallback: string, maxLen = 200): string {
  if (typeof value !== "string") return fallback
  return value.slice(0, maxLen)
}

export function descBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (value === "true" || value === 1) return true
  if (value === "false" || value === 0) return false
  return fallback
}

export function descRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/* --------------------------- target resolution -------------------------- */

function descTarget(descriptor: PluginActionDescriptor): Record<string, unknown> | null {
  if (!Array.isArray(descriptor._target)) return null
  for (const entry of descriptor._target) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return entry as Record<string, unknown>
    }
  }
  return null
}

export function descTargetsDocument(descriptor: PluginActionDescriptor): boolean {
  const target = descTarget(descriptor)
  if (!target) return false
  const ref = typeof target._ref === "string" ? target._ref.toLowerCase() : ""
  return ref === "document" || ref === "doc"
}

export function descTargetsLayer(descriptor: PluginActionDescriptor): boolean {
  const target = descTarget(descriptor)
  if (!target) return true // many ops imply active layer when target is missing
  const ref = typeof target._ref === "string" ? target._ref.toLowerCase() : ""
  return ref === "layer" || ref === "" || !target._ref
}

export function descLayerKey(descriptor: PluginActionDescriptor): string {
  const target = descTarget(descriptor)
  if (!target) return "active"
  if (typeof target._id === "string") return target._id
  if (typeof target.name === "string") return target.name
  if (typeof target._index === "number") return `__index:${target._index}`
  return "active"
}

export function resolveLayer(doc: PsDocument, active: Layer | null, key: string): Layer | null {
  if (!key || key === "active") return active
  if (key.startsWith("__index:")) {
    const idx = Number(key.slice("__index:".length))
    return doc.layers[idx] ?? null
  }
  return doc.layers.find((l) => l.id === key || l.name === key) ?? null
}

/* --------------------------- Filter parameter normalisation ------------- */

/**
 * For a descriptor of the form { _obj: "filter", filter: "<id>", params: {...} }
 * normalise the params against the registry definition: clamp sliders, pick
 * valid select options, coerce booleans. This is what makes filter playback
 * deterministic across record → replay.
 */
export function normalizeFilterParams(filterId: string, params: Record<string, unknown>): Record<string, number | string | boolean> {
  const filter = FILTERS[filterId]
  const out: Record<string, number | string | boolean> = {}
  if (!filter) return out
  for (const param of filter.params) {
    const incoming = params[param.key]
    if (param.type === "slider") {
      const n = descNumber(incoming, param.default, param.min, param.max)
      out[param.key] = param.step
        ? Math.round(n / param.step) * param.step
        : n
    } else if (param.type === "select") {
      const values = new Set(param.options.map((opt) => opt.value))
      const candidate = typeof incoming === "string" ? incoming : param.default
      out[param.key] = values.has(candidate) ? candidate : param.default
    } else if (param.type === "checkbox") {
      out[param.key] = descBoolean(incoming, param.default)
    } else if (param.type === "text") {
      out[param.key] = descString(incoming, param.default, 4000)
    }
  }
  return out
}

/* --------------------------- Edit recorder ------------------------------ */

/**
 * Internal representation of an editor edit produced by recordable
 * operations. The recorder maps each into a documented descriptor.
 */
export type RecordableEdit =
  | { kind: "doc.open"; name: string; width: number; height: number }
  | { kind: "doc.save"; format?: string }
  | { kind: "doc.close"; force?: boolean }
  | { kind: "doc.duplicate"; name?: string }
  | { kind: "doc.resize"; width: number; height: number }
  | { kind: "doc.crop"; x: number; y: number; width: number; height: number }
  | { kind: "doc.rotate"; angle: 0 | 90 | 180 | 270 }
  | { kind: "doc.flatten" }
  | { kind: "layer.new"; layerKey: string; name?: string; layerKind?: LayerKind }
  | { kind: "layer.delete"; layerKey: string }
  | { kind: "layer.duplicate"; layerKey: string; newName?: string }
  | { kind: "layer.group"; layerKeys: string[]; groupName?: string }
  | { kind: "layer.ungroup"; groupKey: string }
  | { kind: "layer.mergeDown"; layerKey: string }
  | { kind: "layer.mergeVisible" }
  | { kind: "layer.rasterize"; layerKey: string; option: "layer" | "type" | "shape" | "smart-object" | "layer-style" | "all" }
  | { kind: "layer.transform"; layerKey: string; mode: "rotate" | "scale" | "flip-h" | "flip-v" | "translate"; values: Record<string, number> }
  | { kind: "layer.blend"; layerKey: string; blendMode: BlendMode }
  | { kind: "layer.mask"; layerKey: string; option: "white" | "black" | "from-selection" | "remove" | "enable" | "disable" }
  | { kind: "layer.rename"; layerKey: string; name: string }
  | { kind: "layer.opacity"; layerKey: string; opacity: number }
  | { kind: "layer.visibility"; layerKey: string; visible: boolean }
  | { kind: "filter.apply"; layerKey: string; filterId: string; params: Record<string, number | string | boolean> }

/**
 * Convert a RecordableEdit into the corresponding JSON descriptor.
 */
export function editToDescriptor(edit: RecordableEdit): PluginActionDescriptor {
  switch (edit.kind) {
    case "doc.open":
      return { _obj: "open", name: edit.name, width: edit.width, height: edit.height }
    case "doc.save":
      return { _obj: "save", format: edit.format ?? "png" }
    case "doc.close":
      return { _obj: "close", force: !!edit.force }
    case "doc.duplicate":
      return { _obj: "duplicate-document", name: edit.name ?? "" }
    case "doc.resize":
      return { _obj: "resize-document", width: edit.width, height: edit.height }
    case "doc.crop":
      return { _obj: "crop-document", x: edit.x, y: edit.y, width: edit.width, height: edit.height }
    case "doc.rotate":
      return { _obj: "rotate-document", angle: edit.angle }
    case "doc.flatten":
      return { _obj: "flatten-document" }
    case "layer.new":
      return {
        _obj: "new-layer",
        _target: [{ _ref: "layer" }],
        name: edit.name ?? "Layer",
        layerKind: edit.layerKind ?? "raster",
      }
    case "layer.delete":
      return { _obj: "delete-layer", _target: [{ _ref: "layer", _id: edit.layerKey }] }
    case "layer.duplicate":
      return {
        _obj: "duplicate-layer",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        newName: edit.newName ?? "",
      }
    case "layer.group":
      return {
        _obj: "group-layers",
        _target: edit.layerKeys.map((id) => ({ _ref: "layer", _id: id })),
        groupName: edit.groupName ?? "Group",
      }
    case "layer.ungroup":
      return { _obj: "ungroup-layers", _target: [{ _ref: "layer", _id: edit.groupKey }] }
    case "layer.mergeDown":
      return { _obj: "merge-down", _target: [{ _ref: "layer", _id: edit.layerKey }] }
    case "layer.mergeVisible":
      return { _obj: "merge-visible" }
    case "layer.rasterize":
      return {
        _obj: "rasterize-layer",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        option: edit.option,
      }
    case "layer.transform":
      return {
        _obj: "transform-layer",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        mode: edit.mode,
        values: edit.values,
      }
    case "layer.blend":
      return {
        _obj: "set-layer-blend",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        blendMode: edit.blendMode,
      }
    case "layer.mask":
      return {
        _obj: "set-layer-mask",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        option: edit.option,
      }
    case "layer.rename":
      return {
        _obj: "set",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        to: { name: edit.name },
      }
    case "layer.opacity":
      return {
        _obj: "set",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        to: { opacity: edit.opacity },
      }
    case "layer.visibility":
      return {
        _obj: edit.visible ? "show" : "hide",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
      }
    case "filter.apply":
      return {
        _obj: "filter",
        _target: [{ _ref: "layer", _id: edit.layerKey }],
        filter: edit.filterId,
        params: edit.params,
      }
  }
}

/**
 * Inverse of editToDescriptor: turn an incoming descriptor back into a
 * RecordableEdit so callers can audit or replay it. Returns null for
 * descriptors that have no recordable representation (e.g. `get`).
 */
export function descriptorToEdit(d: PluginActionDescriptor): RecordableEdit | null {
  const op = (d._obj ?? "").toLowerCase()
  const params = descRecord(d)
  const layerKey = descLayerKey(d)
  switch (op) {
    case "open":
      return {
        kind: "doc.open",
        name: descString(params.name, "Untitled"),
        width: descInteger(params.width, 100, 1, 30000),
        height: descInteger(params.height, 100, 1, 30000),
      }
    case "save":
      return { kind: "doc.save", format: descString(params.format, "png") }
    case "close":
      return { kind: "doc.close", force: descBoolean(params.force, false) }
    case "duplicate-document":
      return { kind: "doc.duplicate", name: descString(params.name, "") }
    case "resize-document":
      return {
        kind: "doc.resize",
        width: descInteger(params.width, 100, 1, 30000),
        height: descInteger(params.height, 100, 1, 30000),
      }
    case "crop-document":
      return {
        kind: "doc.crop",
        x: descInteger(params.x, 0, 0, 30000),
        y: descInteger(params.y, 0, 0, 30000),
        width: descInteger(params.width, 100, 1, 30000),
        height: descInteger(params.height, 100, 1, 30000),
      }
    case "rotate-document": {
      const a = descInteger(params.angle, 0)
      const norm = ((a % 360) + 360) % 360
      const snap = (norm < 45 || norm >= 315 ? 0 : norm < 135 ? 90 : norm < 225 ? 180 : 270) as 0 | 90 | 180 | 270
      return { kind: "doc.rotate", angle: snap }
    }
    case "flatten-document":
      return { kind: "doc.flatten" }
    case "new-layer":
    case "make":
      return {
        kind: "layer.new",
        layerKey,
        name: descString(params.name, "Layer"),
        layerKind: descString(params.layerKind ?? params.kind, "raster") as LayerKind,
      }
    case "delete":
    case "delete-layer":
      return { kind: "layer.delete", layerKey }
    case "duplicate":
    case "duplicate-layer":
      return { kind: "layer.duplicate", layerKey, newName: descString(params.newName, "") }
    case "group-layers": {
      const keys = (Array.isArray(d._target) ? d._target : [])
        .map((t) => (t && typeof t === "object" && typeof (t as { _id?: unknown })._id === "string" ? (t as { _id: string })._id : null))
        .filter((v): v is string => !!v)
      return { kind: "layer.group", layerKeys: keys, groupName: descString(params.groupName, "Group") }
    }
    case "ungroup-layers":
      return { kind: "layer.ungroup", groupKey: layerKey }
    case "merge-down":
      return { kind: "layer.mergeDown", layerKey }
    case "merge-visible":
      return { kind: "layer.mergeVisible" }
    case "rasterize-layer": {
      const validOpts = new Set(["layer", "type", "shape", "smart-object", "layer-style", "all"])
      const option = descString(params.option, "layer")
      return {
        kind: "layer.rasterize",
        layerKey,
        option: (validOpts.has(option) ? option : "layer") as "layer" | "type" | "shape" | "smart-object" | "layer-style" | "all",
      }
    }
    case "transform-layer": {
      const validModes = new Set(["rotate", "scale", "flip-h", "flip-v", "translate"])
      const mode = descString(params.mode, "rotate")
      const rawValues = descRecord(params.values)
      const values: Record<string, number> = {}
      for (const [k, v] of Object.entries(rawValues)) values[k] = descNumber(v, 0)
      return {
        kind: "layer.transform",
        layerKey,
        mode: (validModes.has(mode) ? mode : "rotate") as "rotate" | "scale" | "flip-h" | "flip-v" | "translate",
        values,
      }
    }
    case "set-layer-blend":
      return { kind: "layer.blend", layerKey, blendMode: descString(params.blendMode, "normal") as BlendMode }
    case "set-layer-mask": {
      const validOpts = new Set(["white", "black", "from-selection", "remove", "enable", "disable"])
      const option = descString(params.option, "white")
      return {
        kind: "layer.mask",
        layerKey,
        option: (validOpts.has(option) ? option : "white") as "white" | "black" | "from-selection" | "remove" | "enable" | "disable",
      }
    }
    case "set": {
      const patch = descRecord(params.to ?? params.using ?? params)
      if (typeof patch.name === "string") {
        return { kind: "layer.rename", layerKey, name: descString(patch.name, "Layer") }
      }
      if (typeof patch.opacity === "number") {
        return { kind: "layer.opacity", layerKey, opacity: descNumber(patch.opacity, 1, 0, 1) }
      }
      if (typeof patch.visible === "boolean") {
        return { kind: "layer.visibility", layerKey, visible: patch.visible }
      }
      return null
    }
    case "hide":
      return { kind: "layer.visibility", layerKey, visible: false }
    case "show":
      return { kind: "layer.visibility", layerKey, visible: true }
    case "filter":
    case "apply-filter": {
      const filterId = descString(params.filter ?? params.filterId, "invert", 80)
      const rawParams = descRecord(params.params)
      return {
        kind: "filter.apply",
        layerKey,
        filterId,
        params: normalizeFilterParams(filterId, rawParams),
      }
    }
    default:
      return null
  }
}

/**
 * Round-trip helper used by both the runtime executor and the unit test
 * harness. `record → JSON → replay → JSON` MUST produce identical descriptors
 * for any RecordableEdit covered by this module. Tests in
 * `tests/action-manager-descriptors.spec.ts` exercise this property.
 */
export function roundTripDescriptor(edit: RecordableEdit): { descriptor: PluginActionDescriptor; restored: RecordableEdit | null } {
  const descriptor = editToDescriptor(edit)
  const restored = descriptorToEdit(descriptor)
  return { descriptor, restored }
}

export function isKnownDescriptor(d: PluginActionDescriptor): boolean {
  return KNOWN_OPS.has((d._obj ?? "").toLowerCase())
}

/* --------------------------- Replay against an editor host -------------- */

/**
 * Interface the host editor (or test harness) must implement so the executor
 * can dispatch real editor actions. This keeps replay logic decoupled from
 * the EditorContext singleton — it is also why we can unit-test it.
 */
export interface DescriptorHost {
  getDocument(): PsDocument | null
  getActiveLayer(): Layer | null
  dispatch: (action: { type: string; [k: string]: unknown }) => void
  requestRender: () => void
  commit: (label: string, layerIds?: string[]) => void
  /** Apply a registered filter to a layer's pixels. Default: in-place. */
  applyFilter: (layer: Layer, filterId: string, params: Record<string, number | string | boolean>) => void
  /** Create a new blank layer in the active document. */
  createBlankLayer: (name: string, kind: LayerKind) => Layer
}

export interface DescriptorReplayResult {
  results: unknown[]
  touchedLayers: string[]
  unsupported: string[]
}

/**
 * Execute the descriptors against the host. Returns per-descriptor results
 * (success/failure summary) and the set of layers that were touched, which
 * the host should pass to its history commit.
 */
export function replayDescriptors(descriptors: PluginActionDescriptor[], host: DescriptorHost): DescriptorReplayResult {
  const results: unknown[] = []
  const touched = new Set<string>()
  const unsupported: string[] = []
  for (const descriptor of descriptors) {
    const doc = host.getDocument()
    const active = host.getActiveLayer()
    if (!doc) {
      results.push({ ok: false, reason: "no document" })
      continue
    }
    if (!isKnownDescriptor(descriptor)) {
      unsupported.push(descriptor._obj)
      results.push({ ok: false, unsupported: descriptor._obj })
      continue
    }
    const edit = descriptorToEdit(descriptor)
    // Some descriptors (like "get") have no edit; we handle them separately.
    if (!edit) {
      if ((descriptor._obj ?? "").toLowerCase() === "get") {
        if (descTargetsDocument(descriptor)) {
          results.push({
            id: doc.id, name: doc.name, width: doc.width, height: doc.height,
            colorMode: doc.colorMode, bitDepth: doc.bitDepth, layerCount: doc.layers.length,
          })
        } else {
          const layer = resolveLayer(doc, active, descLayerKey(descriptor))
          results.push(layer
            ? { id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode }
            : { ok: false, reason: "no layer" })
        }
        continue
      }
      // select is a one-liner without a RecordableEdit equivalent (no pixel change)
      if ((descriptor._obj ?? "").toLowerCase() === "select") {
        const layer = resolveLayer(doc, active, descLayerKey(descriptor))
        if (layer) {
          host.dispatch({ type: "set-active-layer", id: layer.id })
          results.push({ ok: true, activeLayerId: layer.id })
        } else {
          results.push({ ok: false, reason: "no layer" })
        }
        continue
      }
      results.push({ ok: false, unsupported: descriptor._obj })
      continue
    }
    try {
      const outcome = applyEdit(edit, doc, active, host)
      if (outcome.layerId) touched.add(outcome.layerId)
      for (const id of outcome.extraLayers ?? []) touched.add(id)
      results.push({ ok: true, ...outcome.summary })
    } catch (err) {
      results.push({ ok: false, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  if (touched.size) {
    host.requestRender()
    host.commit("Action Manager", [...touched])
  }
  return { results, touchedLayers: [...touched], unsupported }
}

interface ApplyEditResult {
  layerId?: string
  extraLayers?: string[]
  summary: Record<string, unknown>
}

function applyEdit(edit: RecordableEdit, doc: PsDocument, active: Layer | null, host: DescriptorHost): ApplyEditResult {
  switch (edit.kind) {
    case "doc.resize":
      host.dispatch({ type: "resize-document", width: edit.width, height: edit.height })
      return { summary: { resized: true, width: edit.width, height: edit.height } }
    case "doc.crop":
      host.dispatch({ type: "resize-canvas", width: edit.width, height: edit.height, offsetX: -edit.x, offsetY: -edit.y, fill: "transparent" })
      return { summary: { cropped: true, width: edit.width, height: edit.height } }
    case "doc.rotate":
      host.dispatch({ type: "set-rotation", rotation: edit.angle })
      return { summary: { rotated: edit.angle } }
    case "doc.flatten":
      host.dispatch({ type: "flatten" })
      return { summary: { flattened: true } }
    case "doc.duplicate":
    case "doc.open":
    case "doc.save":
    case "doc.close":
      // These cross document boundaries; the host editor surfaces them via
      // separate dispatches. We mark them as recognized but defer to the
      // host (the dialog wires up the actual file pickers).
      return { summary: { acknowledged: edit.kind } }

    case "layer.new": {
      const layer = host.createBlankLayer(edit.name ?? "Layer", edit.layerKind ?? "raster")
      return { layerId: layer.id, summary: { createdLayerId: layer.id, name: layer.name } }
    }
    case "layer.delete": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer to delete")
      host.dispatch({ type: "remove-layer", id: layer.id })
      return { summary: { removedLayerId: layer.id } }
    }
    case "layer.duplicate": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer to duplicate")
      host.dispatch({ type: "duplicate-layer", id: layer.id })
      return { layerId: layer.id, summary: { duplicatedLayerId: layer.id } }
    }
    case "layer.group": {
      const groupId = `group-${Date.now().toString(36)}`
      const valid = edit.layerKeys
        .map((k) => resolveLayer(doc, active, k))
        .filter((l): l is Layer => !!l)
      if (!valid.length) throw new Error("No layers to group")
      // First select the layers, then group.
      host.dispatch({ type: "set-selected-layers", ids: valid.map((l) => l.id), activeId: valid[0].id })
      host.dispatch({ type: "group-selected", groupId })
      return { extraLayers: valid.map((l) => l.id), summary: { groupId, count: valid.length } }
    }
    case "layer.ungroup": {
      const layer = resolveLayer(doc, active, edit.groupKey)
      if (!layer) throw new Error("No group to ungroup")
      host.dispatch({ type: "ungroup", groupId: layer.id })
      return { summary: { ungrouped: layer.id } }
    }
    case "layer.mergeDown": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer to merge")
      host.dispatch({ type: "merge-down", id: layer.id })
      return { layerId: layer.id, summary: { mergedDown: layer.id } }
    }
    case "layer.mergeVisible":
      host.dispatch({ type: "merge-selected" })
      return { summary: { mergedVisible: true } }
    case "layer.rasterize": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer to rasterize")
      host.dispatch({ type: "rasterize-layers", ids: [layer.id], option: edit.option })
      return { layerId: layer.id, summary: { rasterized: layer.id, option: edit.option } }
    }
    case "layer.transform": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer to transform")
      // Build a TransformState describing the immediate transformation.
      // The host's reducer applies and commits this. Round-tripping the
      // descriptor preserves mode + values; the layout math is left to the
      // host so that perspective and skew remain editable.
      const bounds = { x: 0, y: 0, w: layer.canvas?.width ?? doc.width, h: layer.canvas?.height ?? doc.height }
      const rotation = edit.mode === "rotate" ? descNumber(edit.values.angle, 0) : 0
      const scaleX = edit.mode === "scale" ? descNumber(edit.values.x, 1) : edit.mode === "flip-h" ? -1 : 1
      const scaleY = edit.mode === "scale" ? descNumber(edit.values.y, 1) : edit.mode === "flip-v" ? -1 : 1
      const tx = edit.mode === "translate" ? descNumber(edit.values.x, 0) : 0
      const ty = edit.mode === "translate" ? descNumber(edit.values.y, 0) : 0
      host.dispatch({
        type: "set-transform",
        transform: {
          active: true,
          layerId: layer.id,
          source: layer.canvas ?? null,
          bounds,
          tx, ty,
          rotation, scaleX, scaleY,
          skewX: 0, skewY: 0,
        },
      })
      return { layerId: layer.id, summary: { transformed: layer.id, mode: edit.mode } }
    }
    case "layer.blend": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer for blend mode")
      host.dispatch({ type: "set-layer-blend", id: layer.id, blendMode: edit.blendMode })
      return { layerId: layer.id, summary: { blendMode: edit.blendMode } }
    }
    case "layer.mask": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer for mask")
      if (edit.option === "remove") {
        host.dispatch({ type: "set-layer-mask", id: layer.id, mask: null })
      } else if (edit.option === "enable" || edit.option === "disable") {
        host.dispatch({ type: "set-layer-mask-enabled", id: layer.id, enabled: edit.option === "enable" })
      } else if (edit.option === "white" || edit.option === "black") {
        host.dispatch({ type: "fill-layer-mask", id: layer.id, value: edit.option })
      } else {
        // from-selection: editor decides; we just send the event.
        host.dispatch({ type: "fill-layer-mask", id: layer.id, value: "white" })
      }
      return { layerId: layer.id, summary: { mask: edit.option } }
    }
    case "layer.rename": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer to rename")
      host.dispatch({ type: "rename-layer", id: layer.id, name: edit.name })
      return { layerId: layer.id, summary: { renamed: layer.id, name: edit.name } }
    }
    case "layer.opacity": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer for opacity")
      host.dispatch({ type: "set-layer-opacity", id: layer.id, opacity: edit.opacity })
      return { layerId: layer.id, summary: { opacity: edit.opacity } }
    }
    case "layer.visibility": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer for visibility")
      host.dispatch({ type: "set-layer-visibility", id: layer.id, visible: edit.visible })
      return { layerId: layer.id, summary: { visible: edit.visible } }
    }
    case "filter.apply": {
      const layer = resolveLayer(doc, active, edit.layerKey)
      if (!layer) throw new Error("No layer for filter")
      const filter = FILTERS[edit.filterId]
      if (!filter) throw new Error(`Unknown filter: ${edit.filterId}`)
      host.applyFilter(layer, edit.filterId, edit.params)
      return { layerId: layer.id, summary: { filterId: edit.filterId } }
    }
  }
}
