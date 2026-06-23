import { expect, test } from "@playwright/test"

async function loadProcessUtils() {
  return await import("../scripts/server-process-utils.mjs") as {
    exitCodeForTerminatedChild: (code: number | null, signal: string | null) => number
    terminateProcessTree: (
      child: { pid?: number; kill: (signal: string) => boolean },
      options: { platform: string; signal?: string; spawnSync: (command: string, args: string[]) => { status: number | null } },
    ) => boolean
  }
}

test("Windows process-tree termination uses taskkill for the spawned server pid", async () => {
  const { terminateProcessTree } = await loadProcessUtils()
  const calls: Array<{ command: string; args: string[] }> = []
  const killed: string[] = []

  terminateProcessTree(
    {
      pid: 1234,
      kill: (signal) => {
        killed.push(String(signal))
        return true
      },
    },
    {
      platform: "win32",
      spawnSync: (command, args) => {
        calls.push({ command, args })
        return { status: 0 }
      },
    },
  )

  expect(calls).toEqual([{ command: "taskkill.exe", args: ["/pid", "1234", "/t", "/f"] }])
  expect(killed).toEqual([])
})

test("non-Windows process-tree termination sends the requested signal to the child", async () => {
  const { terminateProcessTree } = await loadProcessUtils()
  const killed: string[] = []

  terminateProcessTree(
    {
      pid: 5678,
      kill: (signal) => {
        killed.push(String(signal))
        return true
      },
    },
    {
      platform: "linux",
      signal: "SIGINT",
      spawnSync: () => {
        throw new Error("taskkill should not be used outside Windows")
      },
    },
  )

  expect(killed).toEqual(["SIGINT"])
})

test("server child exit status preserves normal exits and signal exits", async () => {
  const { exitCodeForTerminatedChild } = await loadProcessUtils()
  expect(exitCodeForTerminatedChild(0, null)).toBe(0)
  expect(exitCodeForTerminatedChild(1, null)).toBe(1)
  expect(exitCodeForTerminatedChild(null, "SIGTERM")).toBe(143)
  expect(exitCodeForTerminatedChild(null, "SIGINT")).toBe(130)
  expect(exitCodeForTerminatedChild(null, "SIGKILL")).toBe(1)
})
