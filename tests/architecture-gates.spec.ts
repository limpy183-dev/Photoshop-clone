import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

function runNodeScript(script: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
}

test("architecture gate reports no import cycles or budget regressions", () => {
  const result = runNodeScript("scripts/check-architecture.mjs", "--json")
  const output = `${result.stdout}\n${result.stderr}`

  expect(result.status, output).toBe(0)

  const report = JSON.parse(result.stdout) as {
    checks: Array<{ id: string; ok: boolean }>
    importCycles: string[][]
    budgets: {
      rawPhotoshopEvents: { count: number; max: number }
      rawPhotoshopListeners: { count: number; max: number }
      oversizeFiles: { count: number; max: number }
      useEditorImports: { count: number; max: number }
      topLargestFiles: { count: number; totalLines: number; maxTotalLines: number }
      directClientStorage: { count: number; max: number }
    }
    directClientStorage: Array<{ file: string; count: number }>
  }

  expect(report.importCycles).toEqual([])
  expect(report.checks.every((check) => check.ok)).toBe(true)
  expect(report.budgets.rawPhotoshopEvents.count).toBeLessThanOrEqual(report.budgets.rawPhotoshopEvents.max)
  expect(report.budgets.rawPhotoshopEvents.max).toBe(0)
  expect(report.budgets.rawPhotoshopListeners.count).toBeLessThanOrEqual(report.budgets.rawPhotoshopListeners.max)
  expect(report.budgets.rawPhotoshopListeners.max).toBe(0)
  expect(report.budgets.oversizeFiles.count).toBeLessThanOrEqual(report.budgets.oversizeFiles.max)
  expect(report.budgets.oversizeFiles.max).toBeLessThan(26)
  expect(report.budgets.useEditorImports.count).toBeLessThanOrEqual(report.budgets.useEditorImports.max)
  expect(report.budgets.useEditorImports.max).toBeLessThan(79)
  expect(report.budgets.topLargestFiles.count).toBe(10)
  expect(report.budgets.topLargestFiles.totalLines).toBeLessThanOrEqual(report.budgets.topLargestFiles.maxTotalLines)
  expect(report.budgets.topLargestFiles.maxTotalLines).toBeLessThan(36119)
  expect(report.budgets.directClientStorage.count).toBeLessThanOrEqual(report.budgets.directClientStorage.max)
  expect(report.directClientStorage.map((entry) => entry.file)).not.toEqual(
    expect.arrayContaining([
      "components/photoshop/editor-persisted-settings.ts",
      "components/photoshop/filter-gallery.tsx",
      "components/photoshop/preferences-engine.ts",
      "components/photoshop/tech-previews.ts",
    ]),
  )
})

test("package metadata pins the local development runtime and verification scripts", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    engines?: Record<string, string>
    packageManager?: string
    scripts?: Record<string, string>
  }

  expect(pkg.engines?.node).toBe(">=22 <23")
  expect(pkg.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/)
  expect(readFileSync(".npmrc", "utf8")).toContain("engine-strict=true")
  expect(pkg.scripts?.["check:node"]).toBe("node scripts/ensure-node-22.mjs")
  expect(pkg.scripts?.predev).toBe("npm run check:node")
  expect(pkg.scripts?.prebuild).toBe("npm run check:node")
  expect(pkg.scripts?.preverify).toBe("npm run check:node")
  expect(pkg.scripts?.doctor).toBe("node scripts/doctor.mjs")
  expect(pkg.scripts?.["check:architecture"]).toBe("node scripts/check-architecture.mjs")
  expect(pkg.scripts?.["test:smoke:ci"]).toContain("playwright.smoke.config.ts")
  expect(pkg.scripts?.["test:static-export:smoke"]).toContain("playwright.static.config.ts")
})

test("doctor script reports npm and Playwright checks as structured diagnostics", () => {
  const result = runNodeScript("scripts/doctor.mjs", "--json")
  const report = JSON.parse(result.stdout) as {
    checks: Array<{ id: string; ok: boolean; detail: string }>
  }

  expect(result.status).not.toBeNull()
  expect(report.checks.find((check) => check.id === "npm-version")).toMatchObject({ ok: true })
  expect(report.checks.find((check) => check.id === "package-manager-version")).toMatchObject({
    ok: true,
    detail: expect.stringContaining("expected=npm@11.5.2"),
  })
  expect(report.checks.find((check) => check.id === "playwright-cli")).toMatchObject({ ok: true })
  expect(report.checks.find((check) => check.id === "playwright-browsers")?.detail).toMatch(/playwright/i)
})

test("editor selector helper hooks avoid broad editor context reads", () => {
  const sources = [
    readFileSync("components/photoshop/editor-context.tsx", "utf8"),
    readFileSync("components/photoshop/editor-history-hooks.ts", "utf8"),
  ]

  for (const hook of ["useActiveDocument", "useActiveLayer", "useDocumentLifecycle", "useHistoryState", "useHistoryCommands"]) {
    const source = sources.find((candidate) => candidate.includes(`export function ${hook}`)) ?? ""
    const start = source.indexOf(`export function ${hook}`)
    const end = source.indexOf("\nexport function", start + 1)
    const block = source.slice(start, end > start ? end : undefined)
    expect(start, `${hook} should exist`).toBeGreaterThanOrEqual(0)
    expect(block, hook).not.toContain("useEditor()")
  }
})

test("history panel consumes focused selector and command hooks", () => {
  const source = readFileSync("components/photoshop/panels/history-panel.tsx", "utf8")

  expect(source).toContain("useActiveDocument")
  expect(source).toContain("useHistoryCommands")
  expect(source).toContain("useHistoryState")
  expect(source).not.toContain("useEditor")
})

test("bundle analyzer includes manifest and sourcemap attribution hooks", () => {
  const source = readFileSync("scripts/analyze-bundle.mjs", "utf8")

  expect(source).toContain("readChunkSourceMapOwnership")
  expect(source).toContain("readWebpackStatsOwnership")
  expect(source).toContain("sourcemapModuleSamples")
  expect(source).toContain("webpackStatsModuleSamples")
  expect(source).toContain("ownershipSources")
})
