import { expect, test } from "@playwright/test"

import {
  createProjectSanitizationReport,
  PROJECT_PAYLOAD_LIMITS,
  safeJsonArray,
  safeJsonObject,
  SAFE_JSON_DEFAULT_LIMITS,
  type ProjectSanitizationDiagnostics,
} from "../components/photoshop/project-json-sanitizer"

test("project JSON sanitizer strips unsafe object keys and unsupported values", () => {
  const cleaned = safeJsonObject<Record<string, unknown>>({
    safeKey: "kept",
    "also-safe:key_1": 12,
    "__proto__": { polluted: true },
    constructor: { prototype: { polluted: true } },
    "bad key": "dropped",
    nan: Number.NaN,
    infinite: Number.POSITIVE_INFINITY,
    fn: () => "dropped",
    symbol: Symbol("dropped"),
    nested: {
      prototype: "dropped",
      ok: true,
    },
  })

  expect(cleaned).toEqual({
    safeKey: "kept",
    "also-safe:key_1": 12,
    nested: { ok: true },
  })
  expect(Object.prototype).not.toHaveProperty("polluted")
})

test("project JSON sanitizer bounds arrays, strings, keys, and depth while collecting diagnostics", () => {
  const diagnostics: ProjectSanitizationDiagnostics = { truncatedFields: [] }
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (message?: unknown) => {
    warnings.push(String(message))
  }

  try {
    const cleaned = safeJsonObject<Record<string, unknown>>(
      {
        longText: "abcdef",
        manyItems: [1, 2, 3, 4],
        deep: { level1: { level2: "too deep" } },
        a: 1,
        b: 2,
        c: 3,
      },
      { maxString: 3, maxArray: 2, maxKeys: 4, maxDepth: 2 },
      "metadata",
      diagnostics,
    )

    expect(cleaned).toEqual({
      longText: "abc",
      manyItems: [1, 2],
      deep: {},
      a: 1,
    })
  } finally {
    console.warn = originalWarn
  }
  expect(diagnostics.truncatedFields).toEqual(["metadata"])
  expect(warnings).toEqual([
    'Project field "metadata" exceeded sanitiser limits and was truncated on load.',
  ])
})

test("project JSON sanitizer preserves large project payloads within raised limits", () => {
  const payload = "x".repeat(SAFE_JSON_DEFAULT_LIMITS.maxString + 10)
  const diagnostics: ProjectSanitizationDiagnostics = { truncatedFields: [] }

  const cleaned = safeJsonArray<string>(
    [payload],
    PROJECT_PAYLOAD_LIMITS,
    "pluginStorage",
    diagnostics,
  )

  expect(cleaned).toEqual([payload])
  expect(diagnostics.truncatedFields).toEqual([])
})

test("project JSON sanitizer creates import warning reports only for truncated fields", () => {
  expect(createProjectSanitizationReport("Clean", { truncatedFields: [] })).toBeUndefined()

  const report = createProjectSanitizationReport("Recovered Project", {
    truncatedFields: ["pluginStorage", "metadata"],
  })

  expect(report).toMatchObject({
    title: "Project Import: Recovered Project",
    source: "Project Import",
    items: [
      {
        label: "Sanitizer warning",
        status: "approximated",
        detail: expect.stringContaining("pluginStorage"),
      },
      {
        label: "Sanitizer warning",
        status: "approximated",
        detail: expect.stringContaining("metadata"),
      },
    ],
  })
})
