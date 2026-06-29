import { expect, test } from "@playwright/test"

async function loadSelector() {
  return await import("../scripts/select-pr-tests.mjs") as {
    selectPrTestCommands: (changedFiles: string[]) => string[]
  }
}

test("path-aware selector maps document IO and decoder changes to import/export tests", async () => {
  const { selectPrTestCommands } = await loadSelector()
  expect(selectPrTestCommands([
    "components/photoshop/document-io.ts",
    "components/photoshop/raster-codecs.ts",
  ])).toEqual([
    "npx playwright test tests/document-import-sniffers.spec.ts tests/document-io-preflight.spec.ts tests/export-workflow-depth.spec.ts tests/file-format-depth.spec.ts tests/import-hardening.spec.ts tests/io-color-filter-hardening.spec.ts tests/psd-browser-compatibility.spec.ts tests/psd-channels-masks.spec.ts tests/psd-color-modes.spec.ts tests/psd-effects-adjustments.spec.ts tests/psd-resources-metadata.spec.ts tests/psd-roundtrip-fixtures.spec.ts tests/project-roundtrip-fixtures.spec.ts --config=playwright.node.config.ts",
  ])
})

test("path-aware selector maps canvas, editor, and security changes to focused suites", async () => {
  const { selectPrTestCommands } = await loadSelector()
  expect(selectPrTestCommands([
    "components/photoshop/canvas-view.tsx",
    "components/photoshop/editor-context.tsx",
    "app/api/feedback/route.ts",
    "components/photoshop/plugin-system.ts",
  ])).toEqual([
    expect.stringContaining("tests/canvas-compositor.spec.ts"),
    "npx playwright test tests/marketing-security.spec.ts",
  ])
  const commands = selectPrTestCommands([
    "components/photoshop/canvas-view.tsx",
    "components/photoshop/editor-context.tsx",
    "app/api/feedback/route.ts",
    "components/photoshop/plugin-system.ts",
  ])
  expect(commands[0]).toContain("--config=playwright.node.config.ts")
  expect(commands[0]).toContain("tests/security-regression-limits.spec.ts")
  expect(commands[1]).not.toContain("playwright.node.config.ts")
})

test("path-aware selector runs browser history fidelity for history storage changes", async () => {
  const { selectPrTestCommands } = await loadSelector()
  const commands = selectPrTestCommands([
    "components/photoshop/editor-history-storage.ts",
  ])

  expect(commands).toEqual([
    expect.stringContaining("tests/editor-history-storage.spec.ts"),
    "npx playwright test tests/editor-history-pixel-fidelity.spec.ts",
  ])
  expect(commands[0]).toContain("--config=playwright.node.config.ts")
  expect(commands[1]).not.toContain("playwright.node.config.ts")
})

test("path-aware selector returns no commands for documentation-only changes", async () => {
  const { selectPrTestCommands } = await loadSelector()
  expect(selectPrTestCommands([
    "docs/codebase-analysis-report-2026-06-23.md",
    "README.md",
  ])).toEqual([])
})

test("path-aware selector covers major production subsystems", async () => {
  const { selectPrTestCommands } = await loadSelector()
  const commands = selectPrTestCommands([
    "components/photoshop/project-json-sanitizer.ts",
    "components/photoshop/webgl-compositor.ts",
    "components/photoshop/color-pipeline.ts",
    "components/photoshop/performance-storage.ts",
    "components/photoshop/panels/timeline-panel.tsx",
    "components/photoshop/types.ts",
  ])
  const joined = commands.join("\n")

  for (const testFile of [
    "tests/project-json-sanitizer.spec.ts",
    "tests/webgl-color-pipeline.spec.ts",
    "tests/high-bit-document.spec.ts",
    "tests/performance-storage.spec.ts",
    "tests/timeline-animation.spec.ts",
  ]) {
    expect(joined).toContain(testFile)
  }
})

test("path-aware selector falls back to broad browser tests for unmatched production code", async () => {
  const { selectPrTestCommands } = await loadSelector()

  expect(selectPrTestCommands([
    "components/photoshop/future-subsystem.ts",
  ])).toEqual([
    "npx playwright test --grep-invert @visual",
  ])
})
