import { execFileSync } from "node:child_process"

import { expect, test } from "@playwright/test"

test("source hygiene rejects common mojibake in visible source", () => {
  expect(() => {
    execFileSync(process.execPath, ["scripts/check-source-hygiene.mjs"], {
      encoding: "utf8",
      stdio: "pipe",
    })
  }).not.toThrow()
})
