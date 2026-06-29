#!/usr/bin/env node
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TEST_COMMAND_CONFIG = "--config=playwright.node.config.ts"
const PRODUCTION_SOURCE = /^(?:app\/|components\/|hooks\/|lib\/|types\/|proxy\.ts$|next\.config\.mjs$)/
const BROAD_FALLBACK_COMMAND = "npx playwright test --grep-invert @visual"

const GROUPS = [
  {
    id: "format-import-export",
    match: [
      /^components\/photoshop\/document-/,
      /^components\/photoshop\/raster-codecs\.ts$/,
      /^components\/photoshop\/psd-/,
      /^components\/photoshop\/export-/,
      /^components\/photoshop\/file-info-dialog\.tsx$/,
      /^components\/photoshop\/zip-packaging\.ts$/,
    ],
    tests: [
      "tests/document-import-sniffers.spec.ts",
      "tests/document-io-preflight.spec.ts",
      "tests/export-workflow-depth.spec.ts",
      "tests/file-format-depth.spec.ts",
      "tests/import-hardening.spec.ts",
      "tests/io-color-filter-hardening.spec.ts",
      "tests/psd-browser-compatibility.spec.ts",
      "tests/psd-channels-masks.spec.ts",
      "tests/psd-color-modes.spec.ts",
      "tests/psd-effects-adjustments.spec.ts",
      "tests/psd-resources-metadata.spec.ts",
      "tests/psd-roundtrip-fixtures.spec.ts",
      "tests/project-roundtrip-fixtures.spec.ts",
    ],
  },
  {
    id: "canvas-pixels-filters",
    match: [
      /^components\/photoshop\/canvas-/,
      /^components\/photoshop\/canvas-view\.tsx$/,
      /^components\/photoshop\/brush-/,
      /^components\/photoshop\/selection-/,
      /^components\/photoshop\/filters?(\.ts|\/)/,
    ],
    tests: [
      "tests/canvas-brush-dynamics.spec.ts",
      "tests/canvas-compositor.spec.ts",
      "tests/canvas-filter-overlays.spec.ts",
      "tests/canvas-interaction-performance.spec.ts",
      "tests/canvas-preview-drawing.spec.ts",
      "tests/canvas-selection-helpers.spec.ts",
      "tests/canvas-selection-overlays.spec.ts",
      "tests/canvas-tools.spec.ts",
      "tests/canvas-transform-geometry.spec.ts",
      "tests/canvas-view-runtime.spec.ts",
    ],
  },
  {
    id: "editor-lifecycle-history",
    match: [
      /^components\/photoshop\/editor-/,
      /^components\/photoshop\/editor-context\.tsx$/,
      /^components\/photoshop\/history-/,
    ],
    tests: [
      "tests/editor-document-cloning.spec.ts",
      "tests/editor-document-lifecycle.spec.ts",
      "tests/editor-history-storage.spec.ts",
      "tests/editor-persisted-settings.spec.ts",
    ],
    browserMatch: [
      /^components\/photoshop\/editor-history-storage\.ts$/,
    ],
    browserTests: [
      "tests/editor-history-pixel-fidelity.spec.ts",
    ],
  },
  {
    id: "security-api-plugins",
    match: [
      /^app\/api\//,
      /^lib\/marketing-store\.ts$/,
      /^components\/photoshop\/plugin-/,
      /^components\/photoshop\/advanced-subsystems-dialog\.tsx$/,
    ],
    tests: [
      "tests/plugin-host-contract.spec.ts",
      "tests/plugin-system.spec.ts",
      "tests/security-regression-limits.spec.ts",
    ],
    browserTests: [
      "tests/marketing-security.spec.ts",
    ],
  },
  {
    id: "project-sanitization",
    match: [
      /^components\/photoshop\/project-/,
      /^components\/photoshop\/import-/,
    ],
    tests: [
      "tests/project-json-sanitizer.spec.ts",
      "tests/project-roundtrip-fixtures.spec.ts",
      "tests/import-hardening.spec.ts",
    ],
  },
  {
    id: "webgl-compositor",
    match: [
      /^components\/photoshop\/webgl-/,
      /^components\/photoshop\/blend-/,
      /^components\/photoshop\/compositor-/,
    ],
    tests: [
      "tests/canvas-compositor.spec.ts",
      "tests/canvas-compositor-cache.spec.ts",
      "tests/webgl-color-pipeline.spec.ts",
    ],
  },
  {
    id: "color-high-bit",
    match: [
      /^components\/photoshop\/color-/,
      /^components\/photoshop\/high-bit-/,
      /^components\/photoshop\/document-mode-/,
    ],
    tests: [
      "tests/color-channel-ops.spec.ts",
      "tests/color-mode-conversion.spec.ts",
      "tests/color-pipeline.spec.ts",
      "tests/high-bit-document.spec.ts",
      "tests/high-bit-editing-surface.spec.ts",
    ],
  },
  {
    id: "performance-storage",
    match: [
      /^components\/photoshop\/performance-/,
      /^components\/photoshop\/client-storage\.ts$/,
      /^components\/photoshop\/editor-persisted-settings\.ts$/,
      /^components\/photoshop\/preferences-/,
    ],
    tests: [
      "tests/performance-2-9.spec.ts",
      "tests/performance-scale.spec.ts",
      "tests/performance-storage.spec.ts",
      "tests/preferences-performance-settings.spec.ts",
    ],
  },
  {
    id: "panels-timeline",
    match: [
      /^components\/photoshop\/panels\//,
      /^components\/photoshop\/panel-/,
      /^components\/photoshop\/timeline-/,
      /^components\/photoshop\/three-d-video-/,
    ],
    tests: [
      "tests/panel-completion-helpers.spec.ts",
      "tests/panel-dock-ux.spec.ts",
      "tests/panels-layers.spec.ts",
      "tests/right-panel-status-context.spec.ts",
      "tests/timeline-animation.spec.ts",
    ],
  },
  {
    id: "shared-types",
    match: [
      /^components\/photoshop\/types\.ts$/,
      /^types\//,
    ],
    tests: [
      "tests/editor-document-lifecycle.spec.ts",
      "tests/canvas-tools.spec.ts",
      "tests/project-roundtrip-fixtures.spec.ts",
      "tests/high-bit-document.spec.ts",
    ],
  },
]

function normalizePath(file) {
  return String(file).trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

function commandForTests(tests, config = TEST_COMMAND_CONFIG) {
  const existingTests = tests.filter((file) => existsSync(file))
  if (!existingTests.length) return null
  return `npx playwright test ${existingTests.join(" ")}${config ? ` ${config}` : ""}`
}

export function selectPrTestCommands(changedFiles) {
  const files = changedFiles.map(normalizePath).filter(Boolean)
  const selectedNodeTests = []
  const selectedBrowserTests = []
  const seenNodeTests = new Set()
  const seenBrowserTests = new Set()
  const matchedFiles = new Set()

  for (const group of GROUPS) {
    const groupFiles = files.filter((file) => group.match.some((pattern) => pattern.test(file)))
    if (!groupFiles.length) continue
    for (const file of groupFiles) matchedFiles.add(file)
    for (const test of group.tests) {
      if (!seenNodeTests.has(test)) {
        selectedNodeTests.push(test)
        seenNodeTests.add(test)
      }
    }
    const shouldRunBrowserTests = !group.browserMatch || groupFiles.some((file) => group.browserMatch.some((pattern) => pattern.test(file)))
    for (const test of shouldRunBrowserTests ? (group.browserTests ?? []) : []) {
      if (!seenBrowserTests.has(test)) {
        selectedBrowserTests.push(test)
        seenBrowserTests.add(test)
      }
    }
  }

  if (files.some((file) => PRODUCTION_SOURCE.test(file) && !matchedFiles.has(file))) {
    return [BROAD_FALLBACK_COMMAND]
  }

  return [
    commandForTests(selectedNodeTests),
    commandForTests(selectedBrowserTests, ""),
  ].filter(Boolean)
}

function readChangedFilesFromCli(argv) {
  const fileListArg = argv.find((arg) => !arg.startsWith("--"))
  if (fileListArg) {
    return readFileSync(fileListArg, "utf8").split(/\r?\n/)
  }
  return readFileSync(0, "utf8").split(/\r?\n/)
}

function writeGitHubOutput(commands) {
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `count=${commands.length}`,
      "commands<<EOF",
      ...commands,
      "EOF",
      "",
    ].join("\n"),
  )
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const commands = selectPrTestCommands(readChangedFilesFromCli(process.argv.slice(2)))
  writeGitHubOutput(commands)
  process.stdout.write(commands.join("\n"))
  if (commands.length) process.stdout.write("\n")
}
