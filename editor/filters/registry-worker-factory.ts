export function createRegistryFilterWorker(): Worker {
  return new Worker(new URL("./registry-worker.ts", import.meta.url), { type: "module" })
}
