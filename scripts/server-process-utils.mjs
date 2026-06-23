import { spawnSync as defaultSpawnSync } from "node:child_process"

export function exitCodeForTerminatedChild(code, signal) {
  if (typeof code === "number") return code
  if (signal === "SIGTERM") return 143
  if (signal === "SIGINT") return 130
  return 1
}

export function terminateProcessTree(child, options = {}) {
  const platform = options.platform ?? process.platform
  const signal = options.signal ?? "SIGTERM"
  const spawnSync = options.spawnSync ?? defaultSpawnSync

  if (platform === "win32" && child.pid) {
    const result = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    })
    if (result.status === 0) return true
  }

  return child.kill(signal)
}

export function attachServerProcessHandlers(child, options = {}) {
  const forceExitMs = options.forceExitMs ?? 5_000
  let shuttingDown = false

  child.on("exit", (code, signal) => {
    process.exit(exitCodeForTerminatedChild(code, signal))
  })

  child.on("error", (error) => {
    console.error(`Unable to start server process: ${error.message}`)
    process.exit(1)
  })

  function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    terminateProcessTree(child, { ...options, signal })
    const timer = setTimeout(() => {
      process.exit(exitCodeForTerminatedChild(null, signal))
    }, forceExitMs)
    timer.unref?.()
  }

  process.once("SIGINT", () => shutdown("SIGINT"))
  process.once("SIGTERM", () => shutdown("SIGTERM"))
}
