/**
 * Plugin lifecycle and test harness.
 *
 * Plugins running inside the sandboxed iframe go through a deterministic
 * lifecycle:
 *
 *     loading -> ready -> running -> unloading -> unloaded
 *
 * The host emits `ps-plugin-lifecycle` window events for each transition so
 * other components (status bar, panels, the test harness) can observe state
 * without coupling to the plugin runtime internals.
 *
 * The test harness is a pure module that lets developers exercise plugin
 * commands with mock inputs and asserts on the emitted outputs. It does not
 * depend on React and can run in unit tests.
 */

import type { PluginActionDescriptor, PluginDescriptor } from "./types"
import { dispatchPhotoshopEvent } from "./events"

export const PLUGIN_LIFECYCLE_EVENT = "ps-plugin-lifecycle"
export const PLUGIN_TEST_INPUT_EVENT = "ps-plugin-test-input"
export const PLUGIN_TEST_RESULT_EVENT = "ps-plugin-test-result"

export type PluginLifecyclePhase =
  | "loading"
  | "ready"
  | "running"
  | "unloading"
  | "unloaded"
  | "error"

export interface PluginLifecycleEvent {
  pluginId: string
  phase: PluginLifecyclePhase
  at: number
  detail?: unknown
}

/** Emit a lifecycle transition. Safe to call from SSR (no-op). */
export function emitPluginLifecycle(pluginId: string, phase: PluginLifecyclePhase, detail?: unknown): void {
  if (typeof window === "undefined") return
  const event: PluginLifecycleEvent = { pluginId, phase, at: Date.now(), detail }
  dispatchPhotoshopEvent(PLUGIN_LIFECYCLE_EVENT, event)
}

/* --------------------------- Test harness ------------------------------- */

export type PluginTestInputKind =
  | { kind: "command"; commandId: string; args?: Record<string, unknown> }
  | { kind: "message"; payload: unknown }
  | { kind: "batch-play"; descriptors: PluginActionDescriptor[] }
  | { kind: "ui-render"; node: unknown }
  | { kind: "lifecycle"; phase: PluginLifecyclePhase }

export interface PluginTestInput {
  pluginId: string
  inputId: string
  input: PluginTestInputKind
  /** Synthetic "expected" hint that the harness records alongside outputs. */
  expectation?: Record<string, unknown>
}

export interface PluginTestOutput {
  pluginId: string
  inputId: string
  ok: boolean
  result?: unknown
  error?: string
  /** Lifecycle transitions observed during this input. */
  lifecycle: PluginLifecycleEvent[]
  /** Host calls invoked during this input (method name + summary). */
  hostCalls: Array<{ method: string; ok: boolean; result?: unknown; error?: string }>
}

/**
 * A pluggable runtime adapter. The dialog implements this against the real
 * iframe runtime; unit tests can mock it.
 */
export interface PluginTestRuntime {
  /** Send an input to the plugin and resolve with its summarised output. */
  send(input: PluginTestInput): Promise<PluginTestOutput>
}

/**
 * Run a sequence of test inputs and collect results. Errors do not stop the
 * suite — the harness records each result. This is what the test panel in
 * the Plugin Workspace uses.
 */
export async function runPluginTestSuite(runtime: PluginTestRuntime, inputs: PluginTestInput[]): Promise<PluginTestOutput[]> {
  const out: PluginTestOutput[] = []
  for (const input of inputs) {
    try {
      const result = await runtime.send(input)
      out.push(result)
    } catch (err) {
      out.push({
        pluginId: input.pluginId,
        inputId: input.inputId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        lifecycle: [],
        hostCalls: [],
      })
    }
  }
  return out
}

/* --------------------------- Built-in test templates -------------------- */

/**
 * Smoke-test templates the dialog's test panel offers for every loaded
 * plugin. They exercise the most common surfaces without making any
 * destructive edits.
 */
export function defaultSmokeTests(plugin: PluginDescriptor): PluginTestInput[] {
  const tests: PluginTestInput[] = [
    {
      pluginId: plugin.id,
      inputId: "smoke-host-info",
      input: { kind: "command", commandId: "__host_getInfo__" },
      expectation: { method: "host.getInfo" },
    },
    {
      pluginId: plugin.id,
      inputId: "smoke-document-info",
      input: { kind: "command", commandId: "__document_getInfo__" },
      expectation: { method: "document.getInfo" },
    },
  ]
  for (const cmd of plugin.commands ?? []) {
    tests.push({
      pluginId: plugin.id,
      inputId: `smoke-cmd-${cmd.id}`,
      input: { kind: "command", commandId: cmd.id },
      expectation: { title: cmd.title },
    })
  }
  return tests
}

/* --------------------------- postMessage validation --------------------- */

const ALLOWED_INPUT_KINDS = new Set(["command", "message", "batch-play", "ui-render", "lifecycle"])

/**
 * Validate an inbound message claiming to be a PluginTestInput. The dialog
 * uses this before forwarding into the runtime so a misbehaving iframe
 * cannot inject arbitrary host calls.
 */
export function isPluginTestInput(value: unknown): value is PluginTestInput {
  if (!value || typeof value !== "object") return false
  const rec = value as Record<string, unknown>
  if (typeof rec.pluginId !== "string" || !rec.pluginId) return false
  if (typeof rec.inputId !== "string" || !rec.inputId) return false
  const input = rec.input
  if (!input || typeof input !== "object") return false
  const kind = (input as { kind?: unknown }).kind
  return typeof kind === "string" && ALLOWED_INPUT_KINDS.has(kind)
}

/**
 * Bounded JSON stringify for test result rendering. Avoids leaking giant
 * canvas backing stores into the test log.
 */
export function summariseTestValue(value: unknown, maxLen = 400): string {
  try {
    const replacer = (_: string, v: unknown) => {
      if (v instanceof ArrayBuffer) return `[ArrayBuffer ${v.byteLength}b]`
      if (typeof v === "object" && v && (v as { tagName?: string }).tagName === "CANVAS") return "[Canvas]"
      if (typeof v === "function") return "[Function]"
      return v
    }
    const text = JSON.stringify(value, replacer)
    return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text
  } catch {
    return "[unserialisable]"
  }
}
