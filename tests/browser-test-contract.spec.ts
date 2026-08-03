import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

function source(path: string) {
  return readFileSync(path, "utf8")
}

test("main browser suite runs against a production build", () => {
  const config = source("playwright/main.config.ts")
  // The server command itself lives in the shared base; the lane only picks a port.
  const base = source("playwright/base.ts")

  expect(base).toContain("scripts/serve-next-smoke.mjs")
  expect(config).toContain("nextSmokeServer(3000")
  expect(config).not.toContain("next dev")
  expect(base).not.toContain("next dev")
  expect(config).toContain('testIgnore: ["**/unit/**"]')
})

test("development-only behavior has a dedicated next dev suite", () => {
  const config = source("playwright/dev.config.ts")

  expect(config).toContain("next dev")
  expect(config).toContain("startup-hydration-security.spec.ts")
})

test("critical interaction repeat lane disables retries", () => {
  const config = source("playwright/repeat.config.ts")

  expect(config).toMatch(/retries:\s*0/)
  expect(config).toContain("brush-stroke-undo.spec.ts")
})

test("every lane resolves its paths against the repo root, not playwright/", () => {
  // webServer.cwd defaults to the config's own directory, so a lane that shells
  // out to scripts/ without pinning the root would look inside playwright/.
  for (const lane of ["main", "smoke", "dev", "repeat", "static"]) {
    const config = source(`playwright/${lane}.config.ts`)
    if (!config.includes("command:")) continue
    expect(config, lane).toContain("cwd: repoRoot")
  }
  expect(source("playwright/base.ts")).toContain("cwd: repoRoot")
})

test("persistent editor chrome shares one measured readiness contract", () => {
  const app = source("components/photoshop/editor/app.tsx")
  const shell = source("components/photoshop/editor/shell.tsx")
  const guard = source("tests/support/runtime-guard.ts")

  expect(app.match(/const EditorShell = dynamic/g)).toHaveLength(1)
  for (const moduleName of [
    "menu-bar",
    "options-bar",
    "document/tabs",
    "tool/palette",
    "panel-dock",
    "status-bar",
    "canvas/view",
  ]) {
    expect(app).not.toContain(`import("@/components/photoshop/${moduleName}")`)
    expect(shell).toContain(`from "@/components/photoshop/${moduleName}"`)
  }
  expect(guard).toContain("[data-canvas-stage]")
  expect(guard).toContain("getBoundingClientRect")
  expect(guard).toContain("getImageData")
  expect(guard).toContain("nextjs-portal")
})
