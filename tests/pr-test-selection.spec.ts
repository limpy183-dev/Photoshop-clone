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
    "npx playwright test tests/canvas-brush-dynamics.spec.ts tests/canvas-compositor.spec.ts tests/canvas-filter-overlays.spec.ts tests/canvas-interaction-performance.spec.ts tests/canvas-preview-drawing.spec.ts tests/canvas-selection-helpers.spec.ts tests/canvas-selection-overlays.spec.ts tests/canvas-tools.spec.ts tests/canvas-transform-geometry.spec.ts tests/canvas-view-runtime.spec.ts tests/editor-document-cloning.spec.ts tests/editor-document-lifecycle.spec.ts tests/editor-history-storage.spec.ts tests/editor-persisted-settings.spec.ts tests/plugin-host-contract.spec.ts tests/plugin-system.spec.ts tests/security-regression-limits.spec.ts --config=playwright.node.config.ts",
  ])
})

test("path-aware selector returns no commands for documentation-only changes", async () => {
  const { selectPrTestCommands } = await loadSelector()
  expect(selectPrTestCommands([
    "docs/codebase-analysis-report-2026-06-23.md",
    "README.md",
  ])).toEqual([])
})
