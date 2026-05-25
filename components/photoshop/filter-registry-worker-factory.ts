export function createRegistryFilterWorker(): Worker {
  return new Worker(new URL("./filter-registry-worker.ts", import.meta.url), { type: "module" })
}
