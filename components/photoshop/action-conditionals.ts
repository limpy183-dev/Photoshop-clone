/**
 * Conditional steps and richer playback for the Actions panel.
 *
 * The base MacroAction type stores a flat list of MacroStep entries that
 * each carry a full HistoryEntry snapshot. To support conditional logic,
 * breakpoints, and error recovery without breaking serialisation, we attach
 * an out-of-band "condition envelope" indexed by step id and stored
 * alongside the action. The Actions panel resolves these envelopes at
 * playback time.
 */

import type {
  HistoryEntry,
  Layer,
  LayerSnapshot,
  MacroAction,
  MacroStep,
  PsDocument,
  Selection,
} from "./types"

/* --------------------------- Conditions --------------------------------- */

export type ConditionAttribute =
  | "layer.exists"
  | "layer.visible"
  | "layer.locked"
  | "layer.hasMask"
  | "layer.kind"
  | "layer.opacityGte"
  | "layer.opacityLte"
  | "selection.empty"
  | "selection.hasBounds"
  | "channels.count"
  | "document.colorMode"
  | "document.bitDepth"

export interface StepCondition {
  /** What to check. */
  attribute: ConditionAttribute
  /** Comparison value where applicable (string for enums, number for thresholds). */
  value?: string | number | boolean
  /** Layer name/id when the attribute targets a specific layer. */
  layerKey?: string
  /** If the condition fails, do this. Defaults to "skip". */
  onFail?: "skip" | "abort" | "continue"
}

/** Per-step playback envelope. Stored separately from the snapshot payload. */
export interface StepEnvelope {
  condition?: StepCondition
  /** Pause before executing this step (waits for resume). */
  breakpoint?: boolean
  /** Pause delay in ms before executing (for visual review). */
  pauseMs?: number
  /** If the step itself throws, what to do. */
  onError?: "skip" | "abort" | "retry"
  /** How many times to retry before giving up. */
  retryLimit?: number
  /** Free-text label shown in the playback log. */
  note?: string
}

export interface ActionEnvelope {
  /** keyed by MacroStep.id */
  steps: Record<string, StepEnvelope>
}

/* --------------------------- Persistence -------------------------------- */

export const ACTION_ENVELOPE_STORAGE_KEY = "ps-action-envelopes"

export function loadActionEnvelopes(): Record<string, ActionEnvelope> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(ACTION_ENVELOPE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, ActionEnvelope> = {}
    for (const [actionId, envelope] of Object.entries(parsed as Record<string, unknown>)) {
      if (!envelope || typeof envelope !== "object") continue
      const steps = (envelope as { steps?: unknown }).steps
      if (!steps || typeof steps !== "object") continue
      const normalised: Record<string, StepEnvelope> = {}
      for (const [stepId, raw] of Object.entries(steps as Record<string, unknown>)) {
        const env = normaliseEnvelope(raw)
        if (env) normalised[stepId] = env
      }
      out[actionId] = { steps: normalised }
    }
    return out
  } catch {
    return {}
  }
}

export function saveActionEnvelopes(envelopes: Record<string, ActionEnvelope>): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(ACTION_ENVELOPE_STORAGE_KEY, JSON.stringify(envelopes))
  } catch {
    // localStorage may be full or unavailable; ignore.
  }
}

function normaliseEnvelope(raw: unknown): StepEnvelope | null {
  if (!raw || typeof raw !== "object") return null
  const env = raw as Record<string, unknown>
  const out: StepEnvelope = {}
  if (env.condition && typeof env.condition === "object") {
    const cond = env.condition as Record<string, unknown>
    if (typeof cond.attribute === "string" && KNOWN_ATTRIBUTES.has(cond.attribute as ConditionAttribute)) {
      out.condition = {
        attribute: cond.attribute as ConditionAttribute,
        value: cond.value as string | number | boolean | undefined,
        layerKey: typeof cond.layerKey === "string" ? cond.layerKey : undefined,
        onFail: cond.onFail === "abort" || cond.onFail === "continue" ? cond.onFail : "skip",
      }
    }
  }
  if (typeof env.breakpoint === "boolean") out.breakpoint = env.breakpoint
  if (typeof env.pauseMs === "number" && env.pauseMs >= 0) out.pauseMs = Math.min(env.pauseMs, 60_000)
  if (env.onError === "skip" || env.onError === "abort" || env.onError === "retry") out.onError = env.onError
  if (typeof env.retryLimit === "number" && env.retryLimit >= 0) out.retryLimit = Math.min(Math.round(env.retryLimit), 10)
  if (typeof env.note === "string") out.note = env.note.slice(0, 200)
  return out
}

const KNOWN_ATTRIBUTES: ReadonlySet<ConditionAttribute> = new Set([
  "layer.exists", "layer.visible", "layer.locked", "layer.hasMask", "layer.kind",
  "layer.opacityGte", "layer.opacityLte",
  "selection.empty", "selection.hasBounds",
  "channels.count",
  "document.colorMode", "document.bitDepth",
])

/* --------------------------- Evaluation --------------------------------- */

export interface ConditionContext {
  doc: PsDocument
  activeLayer: Layer | null
  /** History entry that will be applied if the condition passes. */
  entry: HistoryEntry
  selection: Selection | null
}

export interface ConditionResult {
  passed: boolean
  reason: string
  decision: "execute" | "skip" | "abort" | "continue"
}

export function evaluateCondition(condition: StepCondition | undefined, ctx: ConditionContext): ConditionResult {
  if (!condition) return { passed: true, reason: "no condition", decision: "execute" }
  const passed = checkAttribute(condition, ctx)
  if (passed) return { passed: true, reason: `${condition.attribute} matched`, decision: "execute" }
  const decision = condition.onFail ?? "skip"
  return { passed: false, reason: `${condition.attribute} did not match`, decision }
}

function checkAttribute(condition: StepCondition, ctx: ConditionContext): boolean {
  const { doc, entry, selection, activeLayer } = ctx
  const layer = condition.layerKey ? findLayerInEntry(entry, condition.layerKey) : findLayerSnapshot(entry, activeLayer?.id ?? null)
  switch (condition.attribute) {
    case "layer.exists":
      return !!layer
    case "layer.visible":
      return !!layer && layer.visible === asBool(condition.value, true)
    case "layer.locked":
      return !!layer && layer.locked === asBool(condition.value, true)
    case "layer.hasMask":
      return !!layer?.mask
    case "layer.kind":
      return !!layer && layer.kind === asString(condition.value, "raster")
    case "layer.opacityGte":
      return !!layer && layer.opacity >= asNumber(condition.value, 0)
    case "layer.opacityLte":
      return !!layer && layer.opacity <= asNumber(condition.value, 1)
    case "selection.empty":
      return !selection?.bounds && !selection?.mask
    case "selection.hasBounds":
      return !!selection?.bounds
    case "channels.count":
      return (entry.channels?.length ?? 0) === asNumber(condition.value, 0)
    case "document.colorMode":
      return doc.colorMode === asString(condition.value, "RGB")
    case "document.bitDepth":
      return doc.bitDepth === asNumber(condition.value, 8)
    default:
      return false
  }
}

function findLayerSnapshot(entry: HistoryEntry, id: string | null): LayerSnapshot | undefined {
  if (!id) return entry.layers[0]
  return entry.layers.find((l) => l.id === id)
}

function findLayerInEntry(entry: HistoryEntry, key: string): LayerSnapshot | undefined {
  return entry.layers.find((l) => l.id === key || l.name === key)
}

function asBool(v: unknown, fb: boolean): boolean {
  if (typeof v === "boolean") return v
  if (v === "true") return true
  if (v === "false") return false
  return fb
}
function asString(v: unknown, fb: string): string {
  return typeof v === "string" ? v : fb
}
function asNumber(v: unknown, fb: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fb
}

/* --------------------------- Playback ----------------------------------- */

export interface PlaybackHooks {
  /** Apply a step. Returns true if it succeeded. */
  applyStep(step: MacroStep): Promise<void>
  /** Called before each step. Allows breakpoint UIs to suspend playback. */
  shouldPause?(step: MacroStep, envelope: StepEnvelope | undefined): Promise<boolean>
  /** Called when the user resumes after a breakpoint. */
  awaitResume?(): Promise<void>
  /** Called when an error happens. Returns the chosen recovery strategy. */
  onError?(step: MacroStep, error: Error, attempt: number): Promise<"skip" | "abort" | "retry">
  /** Optional logger sink for the error log UI. */
  log?(message: string, level: "info" | "warn" | "error"): void
}

export interface PlaybackContextProvider {
  /** Provide a fresh ConditionContext immediately before each step. */
  getContext(step: MacroStep): ConditionContext
}

export interface PlaybackResult {
  executed: string[]
  skipped: Array<{ stepId: string; reason: string }>
  failed: Array<{ stepId: string; error: string }>
  aborted: boolean
}

export type ActionPlaybackSpeed = "instant" | "fast" | "normal" | "slow"

export const ACTION_PLAYBACK_SPEED_STORAGE_KEY = "ps-action-playback-speed"

export function playbackSpeedToDelayMs(speed: ActionPlaybackSpeed): number {
  switch (speed) {
    case "instant":
      return 0
    case "fast":
      return 30
    case "slow":
      return 180
    case "normal":
    default:
      return 70
  }
}

export function normalizePlaybackSpeed(value: unknown): ActionPlaybackSpeed {
  return value === "instant" || value === "fast" || value === "slow" || value === "normal" ? value : "normal"
}

export function readPlaybackSpeedDelayMs(): number {
  if (typeof window === "undefined") return playbackSpeedToDelayMs("normal")
  try {
    return playbackSpeedToDelayMs(normalizePlaybackSpeed(window.localStorage.getItem(ACTION_PLAYBACK_SPEED_STORAGE_KEY)))
  } catch {
    return playbackSpeedToDelayMs("normal")
  }
}

/**
 * Play an action with conditional/breakpoint/error-recovery support. Each
 * step is evaluated against its envelope. Errors are reported to onError
 * which decides the strategy (defaulting to the envelope's onError or
 * "skip").
 */
export async function playAction(action: MacroAction, envelope: ActionEnvelope, providers: PlaybackContextProvider, hooks: PlaybackHooks): Promise<PlaybackResult> {
  const result: PlaybackResult = { executed: [], skipped: [], failed: [], aborted: false }
  for (const step of action.steps) {
    const env = envelope.steps[step.id]
    if (env?.note) hooks.log?.(env.note, "info")
    const cond = evaluateCondition(env?.condition, providers.getContext(step))
    if (!cond.passed) {
      hooks.log?.(`Step ${step.label}: ${cond.reason}; ${cond.decision}`, "warn")
      if (cond.decision === "abort") {
        result.aborted = true
        return result
      }
      if (cond.decision === "skip") {
        result.skipped.push({ stepId: step.id, reason: cond.reason })
        continue
      }
      // "continue" runs the step anyway
    }
    if (env?.breakpoint && hooks.shouldPause) {
      const pause = await hooks.shouldPause(step, env)
      if (pause && hooks.awaitResume) await hooks.awaitResume()
    }
    if (env?.pauseMs && env.pauseMs > 0) {
      await new Promise((r) => setTimeout(r, env.pauseMs))
    }
    let attempt = 0
    let succeeded = false
    const retryLimit = env?.retryLimit ?? 0
    while (!succeeded) {
      try {
        await hooks.applyStep(step)
        result.executed.push(step.id)
        succeeded = true
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        attempt++
        const defaultStrategy = env?.onError ?? "skip"
        const strategy = hooks.onError ? await hooks.onError(step, error, attempt) : defaultStrategy
        hooks.log?.(`Step ${step.label} failed (attempt ${attempt}): ${error.message}; ${strategy}`, "error")
        if (strategy === "abort") {
          result.failed.push({ stepId: step.id, error: error.message })
          result.aborted = true
          return result
        }
        if (strategy === "retry") {
          if (attempt > retryLimit) {
            result.failed.push({ stepId: step.id, error: error.message })
            break
          }
          continue
        }
        // skip
        result.failed.push({ stepId: step.id, error: error.message })
        break
      }
    }
  }
  return result
}

/* --------------------------- Convenience -------------------------------- */

export function setStepEnvelope(envelopes: Record<string, ActionEnvelope>, actionId: string, stepId: string, env: StepEnvelope | null): Record<string, ActionEnvelope> {
  const current = envelopes[actionId] ?? { steps: {} }
  const nextSteps = { ...current.steps }
  if (env === null) {
    delete nextSteps[stepId]
  } else {
    nextSteps[stepId] = env
  }
  return { ...envelopes, [actionId]: { steps: nextSteps } }
}
