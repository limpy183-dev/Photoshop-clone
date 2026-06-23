#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { attachServerProcessHandlers } from "./server-process-utils.mjs"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next")
const buildId = join(root, ".next", "BUILD_ID")

if (!existsSync(buildId)) {
  console.log("No production build found; running next build --webpack before smoke tests.")
  const build = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  })

  if (build.status !== 0) {
    process.exit(build.status ?? 1)
  }
}

const child = spawn(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
})

attachServerProcessHandlers(child)
