#!/usr/bin/env node
import { spawnSync } from "node:child_process"

const command = process.platform === "win32" ? "tsc.cmd" : "tsc"
const result = spawnSync(command, ["--noEmit"], {
  shell: process.platform === "win32",
  stdio: "inherit",
})

await import("./normalize-next-env.mjs")

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
