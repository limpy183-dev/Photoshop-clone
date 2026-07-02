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
      hookDependencySuppressions: { count: number; max: number }
    }
    directClientStorage: Array<{ file: string; count: number }>
    coordinationFiles: Array<{
      file: string
      imports: number
      maxImports: number
      fanIn: number
      maxFanIn: number
      ok: boolean
    }>
  }

  expect(report.importCycles).toEqual([])
  expect(report.checks.every((check) => check.ok)).toBe(true)
  expect(report.budgets.rawPhotoshopEvents.count).toBeLessThanOrEqual(report.budgets.rawPhotoshopEvents.max)
  expect(report.budgets.rawPhotoshopEvents.max).toBe(0)
  expect(report.budgets.rawPhotoshopListeners.count).toBeLessThanOrEqual(report.budgets.rawPhotoshopListeners.max)
  expect(report.budgets.rawPhotoshopListeners.max).toBe(0)
  expect(report.budgets.oversizeFiles.count).toBeLessThanOrEqual(report.budgets.oversizeFiles.max)
  expect(report.budgets.oversizeFiles.max).toBeLessThanOrEqual(14)
  expect(report.budgets.useEditorImports.count).toBeLessThanOrEqual(report.budgets.useEditorImports.max)
  expect(report.budgets.useEditorImports.max).toBeLessThanOrEqual(15)
  expect(report.budgets.topLargestFiles.count).toBe(10)
  expect(report.budgets.topLargestFiles.totalLines).toBeLessThanOrEqual(report.budgets.topLargestFiles.maxTotalLines)
  expect(report.budgets.topLargestFiles.maxTotalLines).toBeLessThanOrEqual(29000)
  expect(report.budgets.directClientStorage.count).toBeLessThanOrEqual(report.budgets.directClientStorage.max)
  expect(report.budgets.hookDependencySuppressions.count).toBeLessThanOrEqual(
    report.budgets.hookDependencySuppressions.max,
  )
  expect(report.budgets.hookDependencySuppressions.max).toBeLessThanOrEqual(6)
  expect(report.directClientStorage.map((entry) => entry.file)).not.toEqual(
    expect.arrayContaining([
      "components/photoshop/editor-persisted-settings.ts",
      "components/photoshop/filter-gallery.tsx",
      "components/photoshop/preferences-engine.ts",
      "components/photoshop/tech-previews.ts",
    ]),
  )
  expect(report.coordinationFiles).toHaveLength(3)
  expect(report.coordinationFiles.every((entry) => entry.ok)).toBe(true)
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
  expect(pkg.scripts?.build).toContain("normalize-next-env")
  expect(pkg.scripts?.typecheck).toContain("scripts/typecheck.mjs")
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

  for (const hook of ["useActiveDocument", "useActiveLayer", "useToolState", "useDocumentLifecycle", "useHistoryState", "useHistoryCommands"]) {
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

test("workflow shell dialogs consume focused selector hooks instead of broad editor context", () => {
  const focusedSelectorConsumers = [
    "components/photoshop/autosave-recovery.tsx",
    "components/photoshop/new-document-dialog.tsx",
    "components/photoshop/photomerge-dialog.tsx",
    "components/photoshop/processing-dialogs.tsx",
    "components/photoshop/color-picker-dialog.tsx",
  ]

  for (const file of focusedSelectorConsumers) {
    const source = readFileSync(file, "utf8")
    expect(source, `${file} should select only the editor values it reads`).toContain("useEditorSelector")
    expect(source, `${file} should not import or call broad useEditor`).not.toMatch(/\buseEditor\b/)
  }
})

test("bundle analyzer includes manifest and sourcemap attribution hooks", () => {
  const source = readFileSync("scripts/analyze-bundle.mjs", "utf8")
  const routeSource = readFileSync("scripts/measure-route-bundles.mjs", "utf8")
  const nextConfig = readFileSync("next.config.mjs", "utf8")
  const gitignore = readFileSync(".gitignore", "utf8")

  expect(source).toContain("readChunkSourceMapOwnership")
  expect(source).toContain("readWebpackStatsOwnership")
  expect(source).toContain("sourcemapModuleSamples")
  expect(source).toContain("webpackStatsModuleSamples")
  expect(source).toContain("ownershipSources")
  expect(source).toContain("measureRouteBundles")
  expect(source).toContain("routeMetrics")
  expect(source).toContain("BUNDLE_REPORT_PATH")
  expect(source).toContain("BUNDLE_REPORT_GENERATED_AT")
  expect(source).toContain("BUNDLE_MAX_APP_OWNED_STARTUP_CHUNK_BYTES")
  expect(source).toContain("819_200")
  expect(source).toContain("appOwnedStartupChunks")
  expect(source).toContain("appOwnedStartupChunkReasons")
  expect(source).toContain("reviewGuidance")
  expect(source).toContain("maxDecodedBytes")
  expect(source).toContain("bundle-baseline.json")
  expect(source).toContain("routeDeltas")
  expect(source).toContain("newOwnerModules")
  expect(source).toContain("1_572_864")
  expect(routeSource).toContain("normalizeBundleReportUrl")
  expect(routeSource).toContain("sortBundleResources")
  expect(nextConfig).toContain("BUNDLE_WEBPACK_STATS_PATH")
  expect(nextConfig).toContain("artifacts/webpack-stats.json")
  expect(nextConfig).toContain("getChunkModulesIterable")
  expect(nextConfig).toContain("collectWebpackChunkModules")
  expect(gitignore).toContain("artifacts/webpack-stats.json")
  for (const route of ["/", "/editor", "/marketing", "/documentation"]) {
    expect(routeSource).toContain(`"${route}"`)
  }
  expect(routeSource).toContain("encodedBodyBytes")
  expect(routeSource).toContain("decodedBodyBytes")
  expect(routeSource).toContain("requestCount")
  expect(routeSource).toContain("largestStartupChunk")
})

test("startup rendering modules do not import the broad advanced subsystem bundle", () => {
  for (const file of [
    "components/photoshop/canvas-view.tsx",
    "components/photoshop/document-rendering.ts",
    "components/photoshop/three-d-video-engine.ts",
  ]) {
    const source = readFileSync(file, "utf8")
    expect(source, file).not.toMatch(/from\s+["']\.\/advanced-subsystems["']/)
  }
})

test("runtime document diagnostics do not import the full capability catalog", () => {
  for (const file of [
    "components/photoshop/browser-diagnostics.ts",
    "components/photoshop/document-compatibility.ts",
    "components/photoshop/preflight-engine.ts",
  ]) {
    const source = readFileSync(file, "utf8")
    expect(source, file).toContain("capability-warnings")
    expect(source, file).not.toMatch(/from\s+["']\.\/capabilities["']/)
  }
})

test("storage architecture gate covers all browser persistence entrypoints", () => {
  const source = readFileSync("scripts/check-architecture.mjs", "utf8")

  expect(source).toContain("sessionStorage")
  expect(source).toContain("indexedDB")
  expect(source).toContain("getDirectory")
  expect(source).toContain("storage-registry.ts")
})

test("build output normalization keeps generated type stubs stable", () => {
  const source = readFileSync("scripts/normalize-next-env.mjs", "utf8")
  const nextEnv = readFileSync("next-env.d.ts", "utf8")

  expect(source).toContain("./.next/types/routes.d.ts")
  expect(source).toContain("./.next/dev/types/routes.d.ts")
  expect(nextEnv).toContain('import "./.next/types/routes.d.ts";')
})

test("start workspace suppresses extension-injected hidden input hydration noise", () => {
  const source = readFileSync("components/photoshop/start-workspace.tsx", "utf8")
  const inputStart = source.indexOf('data-testid="start-open-image-input"')
  const inputBlock = source.slice(inputStart, source.indexOf("/>", inputStart))

  expect(inputStart).toBeGreaterThanOrEqual(0)
  expect(inputBlock).toContain("suppressHydrationWarning")
})
