import { existsSync, readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

test("Pages export uses the non-destructive local build command", () => {
  const workflow = readFileSync(".github/workflows/deploy-pages.yml", "utf8")

  expect(workflow).not.toMatch(/rm\s+-rf\s+app\/api/)
  expect(workflow).toContain("npm run build:static")
  expect(existsSync("scripts/build-static-export.mjs")).toBe(true)
})

