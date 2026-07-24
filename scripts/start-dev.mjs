#!/usr/bin/env node
import { spawn } from "node:child_process"
import { constants, setPriority } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const nextBin = resolve(root, "node_modules/next/dist/bin/next")
const child = spawn(
  process.execPath,
  [
    "--max-old-space-size=1536",
    nextBin,
    "dev",
    "--webpack",
    "--disable-source-maps",
    "--hostname",
    "127.0.0.1",
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: "inherit" },
)

// First compilation is CPU-heavy in this editor. Let the desktop stay
// responsive while Windows schedules the development server in the background.
try {
  setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL)
} catch {
  // Keep the development server portable if the host cannot change priority.
}

child.once("error", (error) => {
  console.error("Could not start the Next.js development server:", error)
  process.exitCode = 1
})

child.once("exit", (code) => {
  process.exitCode = code ?? 1
})
