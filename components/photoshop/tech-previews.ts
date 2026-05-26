"use client"

import * as React from "react"

/**
 * Technology Previews registry.
 *
 * This module is the single source of truth for experimental, opt-in feature
 * flags surfaced in the Preferences > Technology Previews tab. Each flag is
 * intentionally off by default; experimental code paths should gate themselves
 * by calling `isTechPreviewEnabled(id)` (anywhere) or `useTechPreviewFlag(id)`
 * (inside React components, to subscribe to changes).
 *
 * Flags are persisted to `localStorage` under `TECH_PREVIEW_STORAGE_KEY` as a
 * stable, versioned record. The store is independent of the broader
 * preferences set so a corrupted preview-flag file cannot affect the user's
 * other preferences, and so previews can be exported/imported on their own.
 *
 * Risk levels follow a soft contract:
 *   - `alpha`        — early, observable bugs are likely
 *   - `beta`         — usable for evaluation, but rendering / behavior may differ
 *   - `experimental` — exploration-only, may regress or be removed
 *
 * All flags must remain inside BOUNDARIES.md. Do NOT add a flag whose enabled
 * behavior would require Adobe-owned services, native plugin runtimes,
 * certified CMM behavior, or codecs beyond what the browser exposes.
 */

export const TECH_PREVIEW_STORAGE_KEY = "ps-tech-preview-flags"
export const TECH_PREVIEW_SCHEMA_VERSION = 1
export const TECH_PREVIEW_EVENT = "ps-tech-preview-flags-changed"
export const MAX_TECH_PREVIEW_IMPORT_BYTES = 32 * 1024

export type TechPreviewRiskLevel = "alpha" | "beta" | "experimental"

export interface TechPreviewFlagDefinition {
  /** Stable identifier persisted in localStorage and used by code paths. */
  id: string
  /** Short human-readable name shown in the Preferences UI. */
  label: string
  /** Risk classification — drives the badge color and ordering. */
  riskLevel: TechPreviewRiskLevel
  /** Inline help shown under the toggle. Plain text, no markdown. */
  helpText: string
  /** Default value. All flags currently default to `false`. */
  defaultEnabled: boolean
}

export interface TechPreviewFlagState extends TechPreviewFlagDefinition {
  enabled: boolean
}

export interface TechPreviewExport {
  schemaVersion: typeof TECH_PREVIEW_SCHEMA_VERSION
  exportedAt: string
  flags: Record<string, boolean>
}

/**
 * Registry of all known technology preview flags.
 *
 * IDs prefixed with the underlying subsystem name to avoid collisions. The
 * order here is also the visual order in the Preferences panel — risk levels
 * are mixed deliberately so related flags stay grouped.
 *
 * Coverage rationale:
 *   - WebGL compositor / GPU filter pipeline — implementation-status item #18
 *     and gap report item #18. Existing webgl-compositor.ts has partial paths.
 *   - Tile-only editing — gap report item #19. tile-only-pipeline.ts / large-document.ts
 *     have partial coverage.
 *   - AVIF/HEIF advanced encoder — gap report item #14. raster-codecs.ts /
 *     export-as-dialog.tsx have partial metadata/control surfaces.
 *   - OPFS native I/O — opfs-scratch.ts persists scratch via OPFS already;
 *     extending to native document I/O is experimental.
 *   - WebGPU 3D path tracing — gap report item #29. three-d-video-engine.ts
 *     currently runs CPU raytrace; WebGPU path is experimental.
 *   - HDR canvas / WebGPU accel / local generative fill / camera-raw sidecars —
 *     mirror the four engine-level flags so a single registry covers both.
 */
export const TECH_PREVIEW_FLAGS: readonly TechPreviewFlagDefinition[] = [
  {
    id: "webglAdjustmentCompositor",
    label: "WebGL compositor for adjustments",
    riskLevel: "beta",
    helpText:
      "Routes adjustment layers through the WebGL compositor instead of the Canvas 2D path. Faster on most GPUs but a few blend modes still fall back to CPU.",
    defaultEnabled: false,
  },
  {
    id: "gpuFilterPipeline",
    label: "GPU filter pipeline",
    riskLevel: "alpha",
    helpText:
      "Runs supported filters through GPU shaders instead of the worker pipeline. Output is verified against golden images for the supported subset only.",
    defaultEnabled: false,
  },
  {
    id: "tileOnlyEditing",
    label: "Tile-only editing for huge documents",
    riskLevel: "beta",
    helpText:
      "Keeps documents larger than the configured tile budget in tile-local storage and avoids materializing the full canvas. Some tools fall back to the full-canvas path.",
    defaultEnabled: false,
  },
  {
    id: "avifHeifAdvancedEncoder",
    label: "AVIF/HEIF advanced encoder",
    riskLevel: "experimental",
    helpText:
      "Enables advanced encoder controls (chroma subsampling, alpha mode, bit depth selection) for AVIF and HEIF export when the browser exposes them. Output may not be readable by older viewers.",
    defaultEnabled: false,
  },
  {
    id: "opfsNativeIO",
    label: "OPFS native I/O for documents",
    riskLevel: "alpha",
    helpText:
      "Uses the Origin Private File System for document save / autosave / recovery instead of in-memory blobs. Recoveries persist across reloads. Available only in browsers that expose synchronous OPFS access handles.",
    defaultEnabled: false,
  },
  {
    id: "webgpuPathTracing3D",
    label: "WebGPU 3D path tracing",
    riskLevel: "experimental",
    helpText:
      "Exposes experimental WebGPU path-tracing probes when WebGPU is available. CPU raytrace remains the production renderer; this is not a production replacement.",
    defaultEnabled: false,
  },
  {
    id: "hdrCanvasCompositor",
    label: "HDR canvas compositor",
    riskLevel: "beta",
    helpText:
      "Routes high-bit and HDR preview layers through the wide-range canvas compositor before tone mapping. Output can differ from the stable compositor for mixed-bit documents.",
    defaultEnabled: false,
  },
  {
    id: "webgpuAcceleration",
    label: "WebGPU acceleration (general)",
    riskLevel: "experimental",
    helpText:
      "Enables WebGPU-backed acceleration for eligible color, filter, and preview pipelines when the browser exposes WebGPU. Browser and driver differences can cause fallback or visual mismatches.",
    defaultEnabled: false,
  },
  {
    id: "localGenerativeFill",
    label: "Local generative fill routing",
    riskLevel: "alpha",
    helpText:
      "Shows model-backed generative fill routing controls alongside the deterministic local inpainting fallback. Results depend on the configured GENERATIVE_IMAGE_ENDPOINT.",
    defaultEnabled: false,
  },
  {
    id: "cameraRawSidecars",
    label: "Camera Raw XMP sidecars",
    riskLevel: "beta",
    helpText:
      "Enables experimental Camera Raw XMP sidecar import / export for RAW-style browser edits. Recipe coverage is partial; keep original RAW files alongside generated sidecars.",
    defaultEnabled: false,
  },
] as const

export type TechPreviewFlagId = (typeof TECH_PREVIEW_FLAGS)[number]["id"]
export type TechPreviewFlagsState = Record<string, boolean>

const FLAG_INDEX: Map<string, TechPreviewFlagDefinition> = new Map(
  TECH_PREVIEW_FLAGS.map((flag) => [flag.id, flag]),
)

/** Stable risk-level ordering for display sort fallback. */
export const TECH_PREVIEW_RISK_ORDER: Record<TechPreviewRiskLevel, number> = {
  alpha: 0,
  beta: 1,
  experimental: 2,
}

export function getTechPreviewFlagDefinition(id: string): TechPreviewFlagDefinition | undefined {
  return FLAG_INDEX.get(id)
}

export function listTechPreviewFlagDefinitions(): readonly TechPreviewFlagDefinition[] {
  return TECH_PREVIEW_FLAGS
}

/**
 * Returns the default flag map (all flags at their `defaultEnabled` value).
 * A fresh object is returned each call so callers can mutate without
 * affecting other consumers.
 */
export function defaultTechPreviewFlags(): TechPreviewFlagsState {
  const state: TechPreviewFlagsState = {}
  for (const flag of TECH_PREVIEW_FLAGS) {
    state[flag.id] = flag.defaultEnabled
  }
  return state
}

/**
 * Normalize an arbitrary input into a `TechPreviewFlagsState` map containing
 * every known flag. Unknown flag IDs are dropped. Non-boolean values fall
 * back to the registry default for that flag.
 */
export function normalizeTechPreviewFlags(input: unknown): TechPreviewFlagsState {
  const defaults = defaultTechPreviewFlags()
  if (!input || typeof input !== "object") return defaults
  const record = input as Record<string, unknown>
  const flags = ("flags" in record && record.flags && typeof record.flags === "object")
    ? (record.flags as Record<string, unknown>)
    : record
  const result: TechPreviewFlagsState = { ...defaults }
  for (const flag of TECH_PREVIEW_FLAGS) {
    const value = flags[flag.id]
    if (typeof value === "boolean") result[flag.id] = value
  }
  return result
}

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Load the current flags from localStorage, or fall back to defaults. */
export function loadTechPreviewFlags(storage?: Pick<Storage, "getItem">): TechPreviewFlagsState {
  const target = storage ?? readStorage()
  if (!target) return defaultTechPreviewFlags()
  try {
    const raw = target.getItem(TECH_PREVIEW_STORAGE_KEY)
    if (!raw) return defaultTechPreviewFlags()
    const parsed = JSON.parse(raw)
    return normalizeTechPreviewFlags(parsed)
  } catch {
    return defaultTechPreviewFlags()
  }
}

/** Persist the supplied flags to localStorage. */
export function saveTechPreviewFlags(
  flags: TechPreviewFlagsState,
  storage?: Pick<Storage, "setItem">,
): TechPreviewFlagsState {
  const normalized = normalizeTechPreviewFlags(flags)
  const target = storage ?? readStorage()
  if (target) {
    try {
      const payload: TechPreviewExport = {
        schemaVersion: TECH_PREVIEW_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        flags: normalized,
      }
      target.setItem(TECH_PREVIEW_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Storage quota or disabled — silently drop, in-memory state still wins for this session.
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(TECH_PREVIEW_EVENT, { detail: normalized }))
    } catch {
      // Older browsers may not support CustomEvent; ignore.
    }
  }
  return normalized
}

/** Reset all flags to their registry defaults and persist the result. */
export function resetTechPreviewFlags(storage?: Pick<Storage, "setItem">): TechPreviewFlagsState {
  return saveTechPreviewFlags(defaultTechPreviewFlags(), storage)
}

/** Set a single flag to a specific boolean value and persist. */
export function setTechPreviewFlag(
  id: string,
  enabled: boolean,
  storage?: Pick<Storage, "getItem" | "setItem">,
): TechPreviewFlagsState {
  if (!FLAG_INDEX.has(id)) return loadTechPreviewFlags(storage)
  const current = loadTechPreviewFlags(storage)
  current[id] = enabled
  return saveTechPreviewFlags(current, storage)
}

/**
 * Synchronous, side-effect-free check for whether a flag is enabled. Returns
 * `false` for unknown flag IDs so a typo in a feature-gate call cannot
 * accidentally light up an experimental code path.
 */
export function isTechPreviewEnabled(id: string, storage?: Pick<Storage, "getItem">): boolean {
  if (!FLAG_INDEX.has(id)) return false
  const flags = loadTechPreviewFlags(storage)
  return !!flags[id]
}

/** Summarize all flags into `{...definition, enabled}` rows for UI. */
export function summarizeTechPreviewFlags(input?: unknown): TechPreviewFlagState[] {
  const state = input === undefined ? loadTechPreviewFlags() : normalizeTechPreviewFlags(input)
  return TECH_PREVIEW_FLAGS.map((flag) => ({ ...flag, enabled: !!state[flag.id] }))
}

/** Produce a JSON string suitable for download. */
export function exportTechPreviewFlags(input?: TechPreviewFlagsState): {
  json: string
  fileName: string
  mime: string
} {
  const flags = input ? normalizeTechPreviewFlags(input) : loadTechPreviewFlags()
  const payload: TechPreviewExport = {
    schemaVersion: TECH_PREVIEW_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    flags,
  }
  const date = payload.exportedAt.slice(0, 10)
  return {
    json: JSON.stringify(payload, null, 2),
    fileName: `photoshop-tech-previews-${date}.json`,
    mime: "application/json",
  }
}

/**
 * Parse an imported flag payload. Throws with a descriptive message if the
 * payload is too large or not JSON. Unknown flag IDs are silently dropped.
 */
export function parseTechPreviewFlags(value: string | unknown): TechPreviewFlagsState {
  if (typeof value === "string") {
    if (value.length > MAX_TECH_PREVIEW_IMPORT_BYTES) {
      throw new Error(
        `Technology preview imports are limited to ${Math.round(MAX_TECH_PREVIEW_IMPORT_BYTES / 1024)} KB.`,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown parse error"
      throw new Error(`Technology preview file is not valid JSON: ${message}`)
    }
    return normalizeTechPreviewFlags(parsed)
  }
  return normalizeTechPreviewFlags(value)
}

/**
 * React hook returning the current state of a single technology preview flag.
 *
 * The hook subscribes to `TECH_PREVIEW_EVENT` so toggles made elsewhere
 * (Preferences dialog, programmatic resets, multiple-tab updates via `storage`)
 * propagate to consumers without needing prop drilling.
 *
 * For SSR safety this returns `false` until mounted on the client.
 */
export function useTechPreviewFlag(id: string): boolean {
  const [enabled, setEnabled] = React.useState<boolean>(() => {
    // Server / first client render: return the definition's default so SSR and
    // first paint match. The real persisted value lands in the effect below.
    const definition = FLAG_INDEX.get(id)
    return definition ? definition.defaultEnabled : false
  })

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const refresh = () => {
      setEnabled(isTechPreviewEnabled(id))
    }
    refresh()
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<TechPreviewFlagsState>).detail
      if (detail && typeof detail === "object" && id in detail) {
        setEnabled(!!detail[id])
        return
      }
      refresh()
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== TECH_PREVIEW_STORAGE_KEY) return
      refresh()
    }
    window.addEventListener(TECH_PREVIEW_EVENT, handleCustom)
    window.addEventListener("storage", handleStorage)
    return () => {
      window.removeEventListener(TECH_PREVIEW_EVENT, handleCustom)
      window.removeEventListener("storage", handleStorage)
    }
  }, [id])

  return enabled
}

/**
 * React hook returning the full flag map plus a setter that persists changes.
 * Useful for the Preferences dialog and other admin surfaces.
 */
export function useTechPreviewFlags(): {
  flags: TechPreviewFlagsState
  summary: TechPreviewFlagState[]
  setFlag: (id: string, enabled: boolean) => void
  resetAll: () => void
  replaceAll: (next: TechPreviewFlagsState) => void
} {
  const [flags, setFlags] = React.useState<TechPreviewFlagsState>(() => defaultTechPreviewFlags())

  React.useEffect(() => {
    if (typeof window === "undefined") return
    setFlags(loadTechPreviewFlags())
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<TechPreviewFlagsState>).detail
      if (detail && typeof detail === "object") {
        setFlags(normalizeTechPreviewFlags(detail))
      } else {
        setFlags(loadTechPreviewFlags())
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== TECH_PREVIEW_STORAGE_KEY) return
      setFlags(loadTechPreviewFlags())
    }
    window.addEventListener(TECH_PREVIEW_EVENT, handleCustom)
    window.addEventListener("storage", handleStorage)
    return () => {
      window.removeEventListener(TECH_PREVIEW_EVENT, handleCustom)
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  const setFlag = React.useCallback((id: string, enabled: boolean) => {
    const next = setTechPreviewFlag(id, enabled)
    setFlags(next)
  }, [])

  const resetAll = React.useCallback(() => {
    const next = resetTechPreviewFlags()
    setFlags(next)
  }, [])

  const replaceAll = React.useCallback((next: TechPreviewFlagsState) => {
    const persisted = saveTechPreviewFlags(next)
    setFlags(persisted)
  }, [])

  const summary = React.useMemo(() => summarizeTechPreviewFlags(flags), [flags])

  return { flags, summary, setFlag, resetAll, replaceAll }
}
