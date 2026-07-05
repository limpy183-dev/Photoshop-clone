import { expect, test } from "@playwright/test"
import {
  getStorageResourceRegistry,
  migrateRegisteredPayload,
  runRegisteredAtomicTransaction,
  STORAGE_RESOURCES,
  writeWithRegisteredQuotaRecovery,
} from "../components/photoshop/storage-registry"
import {
  migrateRecentDocumentsPayload,
  planAutosavesForQuotaRetry,
  rankAutosavesForQuotaRetry,
} from "../components/photoshop/recent-documents"
import {
  _resetScratchStateForTests,
  readScratchBlob,
  writeScratchBlob,
} from "../components/photoshop/opfs-scratch"

test("every browser storage resource declares governance metadata", () => {
  const resources = getStorageResourceRegistry()
  expect(resources.length).toBeGreaterThanOrEqual(6)
  for (const resource of resources) {
    expect(resource.owner.length).toBeGreaterThan(0)
    expect(resource.schemaVersion).toBeGreaterThan(0)
    expect(resource.migrationVersions.length).toBeGreaterThanOrEqual(2)
    expect(resource.quotaPolicy.length).toBeGreaterThan(0)
    expect(resource.sensitivity).toMatch(/^(preference|project-data|diagnostic)$/)
    expect(typeof resource.resettable).toBe("boolean")
    expect(typeof resource.exportable).toBe("boolean")
  }
  expect(STORAGE_RESOURCES.learningQuery.kind).toBe("sessionStorage")
  expect(STORAGE_RESOURCES.recentDocuments.kind).toBe("indexedDB")
  expect(STORAGE_RESOURCES.scratch.kind).toBe("opfs")
})

test("registered payloads migrate across the previous two schema versions", () => {
  const descriptor = STORAGE_RESOURCES.recentDocuments
  const steps: string[] = []
  const migrated = migrateRegisteredPayload(
    descriptor,
    { schemaVersion: descriptor.schemaVersion - 2, payload: { migrated: 0 } },
    (payload, from, to) => {
      steps.push(`${from}->${to}`)
      return { migrated: payload.migrated + 1 }
    },
  )

  expect(steps).toEqual(["0->1", "1->2"])
  expect(migrated).toEqual({ schemaVersion: 2, payload: { migrated: 2 } })
  expect(migrateRegisteredPayload(
    descriptor,
    { schemaVersion: 99, payload: {} },
    (payload) => payload,
  )).toBeNull()
})

test("recent-document migrations upgrade both real previous schemas", () => {
  const migrated = migrateRegisteredPayload(
    STORAGE_RESOURCES.recentDocuments,
    {
      schemaVersion: 0,
      payload: [{
        id: "legacy",
        kind: "project",
        name: "Legacy",
        serialized: "{}",
      }],
    },
    migrateRecentDocumentsPayload,
  )
  expect(migrated).toEqual({
    schemaVersion: 2,
    payload: [{
      id: "legacy",
      documentId: "legacy",
      kind: "autosave",
      name: "Legacy",
      serialized: "{}",
      updatedAt: 0,
    }],
  })
})

test("quota recovery evicts once and retries the registered write", async () => {
  let attempts = 0
  let evictions = 0
  const result = await writeWithRegisteredQuotaRecovery(
    STORAGE_RESOURCES.scratch,
    async () => {
      attempts++
      if (attempts === 1) throw new DOMException("full", "QuotaExceededError")
      return "stored"
    },
    async () => {
      evictions++
    },
  )

  expect(result).toBe("stored")
  expect(attempts).toBe(2)
  expect(evictions).toBe(1)
})

test("atomic storage transactions abort partial writes", async () => {
  let committed = 0
  let aborted = 0
  await expect(runRegisteredAtomicTransaction(
    async () => {
      throw new Error("interrupted")
    },
    {
      commit: () => committed++,
      abort: () => aborted++,
    },
  )).rejects.toThrow("interrupted")
  expect(committed).toBe(0)
  expect(aborted).toBe(1)
})

test("failed OPFS writes keep the valid in-memory blob ahead of a stale file", async () => {
  _resetScratchStateForTests()
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  const stale = new Blob(["stale"])
  const directory = {
    async getFileHandle(_name: string, options?: { create?: boolean }) {
      return {
        name: "tile.bin",
        async createWritable() {
          return {
            async write() {
              throw new Error("write interrupted")
            },
            async close() {},
          }
        },
        async getFile() {
          expect(options?.create).toBe(false)
          return stale
        },
      }
    },
    async removeEntry() {},
    async *values() {},
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      storage: {
        async getDirectory() {
          return {
            async getDirectoryHandle() {
              return directory
            },
          }
        },
      },
    },
  })

  try {
    const valid = new Blob(["valid"])
    await expect(writeScratchBlob("tile.bin", valid)).resolves.toBe("in-memory")
    await expect(readScratchBlob("tile.bin").then((blob) => blob?.text())).resolves.toBe("valid")
  } finally {
    _resetScratchStateForTests()
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
    else Reflect.deleteProperty(globalThis, "navigator")
  }
})

test("quota recovery prioritizes the active autosave then retains recent documents", () => {
  const entries = [
    { id: "old", documentId: "old", name: "Old", kind: "autosave", serialized: "a", updatedAt: 10 },
    { id: "recent", documentId: "recent", name: "Recent", kind: "autosave", serialized: "b", updatedAt: 30 },
    { id: "active", documentId: "active", name: "Active", kind: "autosave", serialized: "c", updatedAt: 20 },
  ] as const

  expect(rankAutosavesForQuotaRetry(entries, "active").map((entry) => entry.documentId))
    .toEqual(["active", "recent", "old"])
  expect(planAutosavesForQuotaRetry(entries, "active").map((entry) => entry.documentId))
    .toEqual(["active", "recent"])
})
