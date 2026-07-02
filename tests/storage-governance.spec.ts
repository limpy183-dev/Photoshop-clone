import { expect, test } from "@playwright/test"
import {
  getStorageResourceRegistry,
  migrateRegisteredPayload,
  runRegisteredAtomicTransaction,
  STORAGE_RESOURCES,
  writeWithRegisteredQuotaRecovery,
} from "../components/photoshop/storage-registry"

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
