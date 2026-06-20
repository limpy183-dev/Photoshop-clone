import { spawnSync } from "node:child_process"

import { expect, test } from "@playwright/test"

test("capability checker follows decomposed video export sources", () => {
  const result = spawnSync(process.execPath, ["scripts/check-capabilities.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  const output = `${result.stdout}\n${result.stderr}`

  expect(result.status, output).toBe(0)

  const report = JSON.parse(result.stdout) as { findings: Array<{ ruleId: string }> }
  expect(report.findings.filter((finding) => finding.ruleId.startsWith("video-"))).toEqual([])
})
