#!/usr/bin/env node
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TEST_COMMAND_CONFIG = "--config=playwright.node.config.ts"

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
  },
]

function normalizePath(file) {
  return String(file).trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

function commandForTests(tests) {
  const existingTests = tests.filter((file) => existsSync(file))
  if (!existingTests.length) return null
  return `npx playwright test ${existingTests.join(" ")} ${TEST_COMMAND_CONFIG}`
}

export function selectPrTestCommands(changedFiles) {
  const files = changedFiles.map(normalizePath).filter(Boolean)
  const selectedTests = []
  const seenTests = new Set()

  for (const group of GROUPS) {
    const selected = files.some((file) => group.match.some((pattern) => pattern.test(file)))
    if (!selected) continue
    for (const test of group.tests) {
      if (!seenTests.has(test)) {
        selectedTests.push(test)
        seenTests.add(test)
      }
    }
  }

  const command = commandForTests(selectedTests)
  return command ? [command] : []
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
