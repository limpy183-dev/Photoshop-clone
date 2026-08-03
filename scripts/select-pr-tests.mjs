#!/usr/bin/env node
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TEST_COMMAND_CONFIG = "--config=playwright/node.config.ts"
const PRODUCTION_SOURCE = /^(?:app\/|components\/|editor\/|hooks\/|lib\/|types\/|proxy\.ts$|next\.config\.mjs$)/
const MANIFEST_PATH = ".pr-test-invocations.json"

const GROUPS = [
  {
    id: "format-import-export",
    match: [
      /^(?:editor|components\/photoshop)\/document\//,
      /^editor\/raster\/codecs\.ts$/,
      /^editor\/raster\/codec-/,
      /^editor\/raster\/[^/]+-encoders\.ts$/,
      /^editor\/raster\/metadata-/,
      /^editor\/psd\//,
      /^(?:editor|components\/photoshop)\/export\//,
      /^components\/photoshop\/file-info-dialog\.tsx$/,
      /^editor\/zip-packaging\.ts$/,
    ],
    tests: [
      "tests/document/import-sniffers.spec.ts",
      "tests/document/io-preflight.spec.ts",
      "tests/export/workflow-depth.spec.ts",
      "tests/file-format-depth.spec.ts",
      "tests/import-hardening.spec.ts",
      "tests/io-color-filter-hardening.spec.ts",
      "tests/psd/browser-compatibility.spec.ts",
      "tests/psd/channels-masks.spec.ts",
      "tests/psd/color-modes.spec.ts",
      "tests/psd/effects-adjustments.spec.ts",
      "tests/psd/resources-metadata.spec.ts",
      "tests/psd/roundtrip-fixtures.spec.ts",
      "tests/project-roundtrip-fixtures.spec.ts",
    ],
  },
  {
    id: "canvas-pixels-filters",
    match: [
      /^(?:editor|components\/photoshop)\/canvas\//,
      /^components\/photoshop\/canvas\/view\.tsx$/,
      /^editor\/brush-/,
      /^editor\/filters\/worker/,
      /^editor\/filters\/registry-worker/,
      /^(?:editor|components\/photoshop)\/selection-/,
      /^(?:editor|components\/photoshop)\/filters(?:-meta)?(\.ts|\/)/,
    ],
    tests: [
      "tests/canvas/brush-dynamics.spec.ts",
      "tests/canvas/compositor.spec.ts",
      "tests/canvas/filter-overlays.spec.ts",
      "tests/canvas/interaction-performance.spec.ts",
      "tests/canvas/preview-drawing.spec.ts",
      "tests/canvas/selection-helpers.spec.ts",
      "tests/canvas/selection-overlays.spec.ts",
      "tests/canvas/tools.spec.ts",
      "tests/canvas/transform-geometry.spec.ts",
      "tests/canvas/view-runtime.spec.ts",
      "tests/filters-algorithms.spec.ts",
      "tests/io-color-filter-hardening.spec.ts",
    ],
  },
  {
    id: "tile-only-large-documents",
    match: [
      /^editor\/tile-only-/,
      /^(?:editor|components\/photoshop)\/large-document-/,
    ],
    tests: [
      "tests/large-document-tile-only.spec.ts",
    ],
  },
  {
    id: "editor-lifecycle-history",
    match: [
      /^editor\/(?:context-contract|context-projection|document-cloning|document-lifecycle|global-light|initial-state|layer-rasterize|persisted-settings|reducer|reducer-late|reducer-model|selectors|store)\.ts$/,
      /^components\/photoshop\/editor\//,
      /^editor\/history-/,
    ],
    tests: [
      "tests/editor/document-cloning.spec.ts",
      "tests/editor/document-lifecycle.spec.ts",
      "tests/editor/history-storage.spec.ts",
      "tests/editor/persisted-settings.spec.ts",
    ],
    browserMatch: [
      /^editor\/history-storage\.ts$/,
    ],
    browserTests: [
      "tests/editor/history-pixel-fidelity.spec.ts",
    ],
  },
  {
    id: "security-api-plugins",
    match: [
      /^app\/api\//,
      /^lib\/marketing-store\.ts$/,
      /^editor\/plugin-/,
      /^components\/photoshop\/advanced\/subsystems-dialog\.tsx$/,
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
      /^editor\/project-/,
      /^editor\/import-/,
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
      /^editor\/webgl-/,
      /^editor\/blend-/,
      /^editor\/compositor-/,
    ],
    tests: [
      "tests/canvas/compositor.spec.ts",
      "tests/canvas/compositor-cache.spec.ts",
      "tests/webgl-color-pipeline.spec.ts",
    ],
  },
  {
    id: "color-high-bit",
    match: [
      /^(?:editor|components\/photoshop)\/color\//,
      /^editor\/high-bit-/,
      /^editor\/document\/mode-/,
    ],
    tests: [
      "tests/color/channel-ops.spec.ts",
      "tests/color/mode-conversion.spec.ts",
      "tests/color/pipeline.spec.ts",
      "tests/high-bit-document.spec.ts",
      "tests/high-bit-editing-surface.spec.ts",
    ],
  },
  {
    id: "performance-storage",
    match: [
      /^editor\/performance-/,
      /^editor\/client-storage\.ts$/,
      /^editor\/persisted-settings\.ts$/,
      /^(?:editor|components\/photoshop)\/preferences-/,
    ],
    tests: [
      "tests/performance-2-9.spec.ts",
      "tests/performance-scale.spec.ts",
      "tests/performance-storage.spec.ts",
      "tests/preferences-performance-settings.spec.ts",
    ],
  },
  {
    id: "capabilities-diagnostics",
    match: [
      /^editor\/capabilit(?:y|ies)-/,
      /^editor\/capabilities\.ts$/,
      /^editor\/browser-diagnostics\.ts$/,
      /^editor\/document\/compatibility\.ts$/,
      /^editor\/preflight-engine\.ts$/,
    ],
    tests: [
      "tests/capabilities.spec.ts",
      "tests/browser-diagnostics.spec.ts",
      "tests/document/io-preflight.spec.ts",
    ],
  },
  {
    id: "panels-timeline",
    match: [
      /^components\/photoshop\/panels\//,
      /^components\/photoshop\/panel-/,
      /^editor\/timeline-/,
      /^editor\/three-d-/,
    ],
    tests: [
      "tests/panel-completion-helpers.spec.ts",
      "tests/panel-dock-ux.spec.ts",
      "tests/panels-layers.spec.ts",
      "tests/right-panel-status-context.spec.ts",
      "tests/three-d-video-depth.spec.ts",
      "tests/timeline-animation.spec.ts",
    ],
  },
  {
    id: "shared-types",
    match: [
      /^editor\/types(\.ts|\/)/,
      /^types\//,
    ],
    tests: [
      "tests/editor/document-lifecycle.spec.ts",
      "tests/canvas/tools.spec.ts",
      "tests/project-roundtrip-fixtures.spec.ts",
      "tests/high-bit-document.spec.ts",
    ],
  },
]

function normalizePath(file) {
  return String(file).trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

function invocationForTests(tests, config = TEST_COMMAND_CONFIG) {
  const existingTests = tests.filter((file) => existsSync(file))
  if (!existingTests.length) return null
  return {
    executable: "npx",
    args: [
      "playwright",
      "test",
      ...existingTests,
      ...(config ? [config] : []),
    ],
  }
}

function invocationToCommand(invocation) {
  return [invocation.executable, ...invocation.args].join(" ")
}

export function selectPrTestInvocations(changedFiles) {
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
    return [{
      executable: "npx",
      args: ["playwright", "test", "--grep-invert", "@visual"],
    }]
  }

  return [
    invocationForTests(selectedNodeTests),
    invocationForTests(selectedBrowserTests, ""),
  ].filter(Boolean)
}

export function selectPrTestCommands(changedFiles) {
  return selectPrTestInvocations(changedFiles).map(invocationToCommand)
}

function readChangedFilesFromCli(argv) {
  const fileListArg = argv.find((arg) => !arg.startsWith("--"))
  if (fileListArg) {
    return readFileSync(fileListArg, "utf8").split(/\r?\n/)
  }
  return readFileSync(0, "utf8").split(/\r?\n/)
}

function writeGitHubOutput(commands, manifestPath) {
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `count=${commands.length}`,
      `manifest=${manifestPath}`,
      "",
    ].join("\n"),
  )
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const changedFiles = readChangedFilesFromCli(process.argv.slice(2))
  const invocations = selectPrTestInvocations(changedFiles)
  const commands = invocations.map(invocationToCommand)
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(invocations, null, 2)}\n`)
  writeGitHubOutput(commands, MANIFEST_PATH)
  process.stdout.write(commands.join("\n"))
  if (commands.length) process.stdout.write("\n")
}
