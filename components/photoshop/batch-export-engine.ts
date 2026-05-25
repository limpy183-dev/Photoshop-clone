import { blobToZipEntry, type StoredZipEntry } from "./zip-packaging"

export interface BatchExportItem {
  name: string
  canvas?: HTMLCanvasElement
}

export interface BatchExportFailure {
  name: string
  error: string
}

export interface BatchExportProgressEvent {
  total: number
  completed: number
  failed: number
  currentName?: string
  canceled: boolean
}

export interface BatchExportResult {
  total: number
  completed: number
  failed: BatchExportFailure[]
  entries: StoredZipEntry[]
  canceled: boolean
}

export interface RunBatchExportOptions<T extends BatchExportItem> {
  signal?: AbortSignal
  continueOnError?: boolean
  encode: (item: T, index: number) => Promise<Blob>
  onProgress?: (event: BatchExportProgressEvent) => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Export failed")
}

function emitProgress<T extends BatchExportItem>(
  items: readonly T[],
  completed: number,
  failed: readonly BatchExportFailure[],
  currentName: string | undefined,
  canceled: boolean,
  onProgress: RunBatchExportOptions<T>["onProgress"],
) {
  onProgress?.({
    total: items.length,
    completed,
    failed: failed.length,
    currentName,
    canceled,
  })
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve(undefined))
    else setTimeout(resolve, 0)
  })
}

export async function runBatchExportItems<T extends BatchExportItem>(
  items: readonly T[],
  options: RunBatchExportOptions<T>,
): Promise<BatchExportResult> {
  const entries: StoredZipEntry[] = []
  const failures: BatchExportFailure[] = []
  let completed = 0
  let canceled = false

  emitProgress(items, completed, failures, undefined, false, options.onProgress)
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (options.signal?.aborted) {
      canceled = true
      break
    }
    emitProgress(items, completed, failures, item.name, false, options.onProgress)
    try {
      const blob = await options.encode(item, index)
      entries.push(await blobToZipEntry(item.name, blob))
      completed++
    } catch (error) {
      failures.push({ name: item.name, error: errorMessage(error) })
      if (!options.continueOnError) throw error
    }
    canceled = !!options.signal?.aborted
    emitProgress(items, completed, failures, item.name, canceled, options.onProgress)
    if (canceled) break
    await nextFrame()
  }

  return {
    total: items.length,
    completed,
    failed: failures,
    entries,
    canceled,
  }
}
